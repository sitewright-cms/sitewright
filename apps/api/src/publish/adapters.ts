import { readFile, readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import JSZip from 'jszip';
import { Client as FtpClientImpl } from 'basic-ftp';
import SftpClientImpl from 'ssh2-sftp-client';

const CONNECT_TIMEOUT_MS = 15_000;
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024; // 100 MiB cap on a built site archive

/** True if the string contains an ASCII control character (0x00–0x1f or 0x7f). */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** Deploy-target configuration. Credentials are used transiently and never persisted. */
export const DeployConfigSchema = z
  .object({
    protocol: z.enum(['ftp', 'ftps', 'sftp']),
    host: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65535).optional(),
    user: z.string().min(1).max(255),
    // Password auth (required for FTP/FTPS; optional for SFTP when a key is supplied).
    password: z.string().min(1).max(1024).optional(),
    // SFTP key auth: the PRIVATE KEY CONTENTS (PEM/OpenSSH) + an optional passphrase.
    privateKey: z.string().min(1).max(16384).optional(),
    passphrase: z.string().min(1).max(1024).optional(),
    // Remote target directory: bounded length, no control characters, no traversal.
    remoteDir: z
      .string()
      .min(1)
      .max(1024)
      .refine((dir) => !hasControlChars(dir), 'remoteDir contains control characters')
      .refine((dir) => !dir.split('/').some((seg) => seg === '..'), 'remoteDir must not contain ".." segments')
      .default('/'),
    /**
     * Optional SFTP host-key fingerprint (SHA-256 hex, colons optional). When set,
     * the server's host key is verified against it (MITM protection). When omitted,
     * the host key is trusted on first use — set this to pin a known server.
     */
    hostFingerprint: z.string().min(1).max(256).optional(),
  })
  .refine((c) => c.password !== undefined || c.privateKey !== undefined, {
    message: 'a password or a private key is required',
    path: ['password'],
  })
  // A private key is an SSH concept — FTP/FTPS have no key auth.
  .refine((c) => c.privateKey === undefined || c.protocol === 'sftp', {
    message: 'a private key requires the SFTP protocol',
    path: ['privateKey'],
  });
export type DeployConfig = z.infer<typeof DeployConfigSchema>;

/** A pluggable upload transport (FTP/FTPS/SFTP), injectable for testing. `onFile` (when supported by
 *  the transport) is invoked once per uploaded file (its path) so a deploy can report live progress. */
export interface DeployTransport {
  connect(): Promise<void>;
  uploadDir(localDir: string, remoteDir: string, onFile?: (path: string) => void): Promise<void>;
  close(): Promise<void>;
}

/** A deploy progress event streamed to the UI. `index`/`total` drive a determinate bar. */
export interface DeployProgress {
  phase: 'connecting' | 'uploading' | 'done';
  total: number;
  index: number;
  file?: string;
}

/** Recursively lists the files of a built site, relative to its root (sorted, confined). */
export async function collectSiteFiles(
  siteDir: string,
): Promise<Array<{ rel: string; abs: string }>> {
  const base = resolve(siteDir);
  const out: Array<{ rel: string; abs: string }> = [];
  async function walk(dir: string): Promise<void> {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- walking a validated, confined dir
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = resolve(dir, entry.name);
      if (!abs.startsWith(base + sep)) continue; // defense-in-depth (symlinks etc.)
      if (entry.isDirectory()) await walk(abs);
      else if (entry.isFile()) out.push({ rel: relative(base, abs), abs });
    }
  }
  await walk(base);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** Packages a built site directory into a zip archive (Buffer), bounded in size. */
export async function archiveSite(siteDir: string): Promise<Buffer> {
  const files = await collectSiteFiles(siteDir);
  const zip = new JSZip();
  let total = 0;
  for (const file of files) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- abs confined to siteDir
    const data = await readFile(file.abs);
    total += data.length;
    if (total > MAX_ARCHIVE_BYTES) throw new Error('published site exceeds the archive size limit');
    zip.file(file.rel, data);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** SFTP host-key verifier: enforces the pinned fingerprint when provided (TOFU otherwise). */
function makeHostVerifier(fingerprint?: string): (hashedKey: string) => boolean {
  const pinned = fingerprint?.toLowerCase().replace(/:/g, '');
  return (hashedKey: string): boolean => {
    if (!pinned) return true; // not pinned — trust on first use (see DeployConfigSchema)
    return hashedKey.toLowerCase().replace(/:/g, '') === pinned;
  };
}

/* v8 ignore start -- thin I/O shims over basic-ftp / ssh2; exercised by manual
   integration against real servers, not unit-testable without live infra. */
class FtpTransport implements DeployTransport {
  private readonly client = new FtpClientImpl(CONNECT_TIMEOUT_MS);
  constructor(private readonly cfg: DeployConfig) {}
  async connect(): Promise<void> {
    await this.client.access({
      host: this.cfg.host,
      port: this.cfg.port ?? 21,
      user: this.cfg.user,
      password: this.cfg.password ?? '', // FTP/FTPS always carry a password (schema-enforced)
      secure: this.cfg.protocol === 'ftps', // explicit FTPS
    });
  }
  async uploadDir(localDir: string, remoteDir: string, onFile?: (path: string) => void): Promise<void> {
    // basic-ftp reports the in-flight transfer; emit a per-file tick the first time each name appears.
    const seen = new Set<string>();
    if (onFile) {
      this.client.trackProgress((info) => {
        if (info.type === 'upload' && info.name && !seen.has(info.name)) {
          seen.add(info.name);
          onFile(info.name);
        }
      });
    }
    try {
      await this.client.uploadFromDir(localDir, remoteDir);
    } finally {
      if (onFile) this.client.trackProgress(); // stop tracking
    }
  }
  async close(): Promise<void> {
    this.client.close();
  }
}

class SftpTransport implements DeployTransport {
  private readonly client = new SftpClientImpl();
  constructor(private readonly cfg: DeployConfig) {}
  async connect(): Promise<void> {
    await this.client.connect({
      host: this.cfg.host,
      port: this.cfg.port ?? 22,
      username: this.cfg.user,
      // Password and/or private-key auth — ssh2 tries whichever is provided.
      ...(this.cfg.password ? { password: this.cfg.password } : {}),
      ...(this.cfg.privateKey
        ? { privateKey: this.cfg.privateKey, ...(this.cfg.passphrase ? { passphrase: this.cfg.passphrase } : {}) }
        : {}),
      readyTimeout: CONNECT_TIMEOUT_MS,
      hostHash: 'sha256',
      hostVerifier: makeHostVerifier(this.cfg.hostFingerprint),
    });
  }
  async uploadDir(localDir: string, remoteDir: string, onFile?: (path: string) => void): Promise<void> {
    // ssh2-sftp-client emits an 'upload' event per file copied by uploadDir; dedupe by path so the
    // progress index can never exceed the file total (defensive, mirrors the FTP transport).
    const seen = new Set<string>();
    const listener = (info: { source: string }): void => {
      if (!seen.has(info.source)) {
        seen.add(info.source);
        onFile?.(info.source);
      }
    };
    if (onFile) this.client.on('upload', listener);
    try {
      await this.client.uploadDir(localDir, remoteDir);
    } finally {
      if (onFile) this.client.removeListener('upload', listener);
    }
  }
  async close(): Promise<void> {
    await this.client.end();
  }
}
/* v8 ignore stop */

/** Picks the concrete transport for a protocol. */
export function defaultTransport(cfg: DeployConfig): DeployTransport {
  return cfg.protocol === 'sftp' ? new SftpTransport(cfg) : new FtpTransport(cfg);
}

/**
 * Deploys a built site directory to a remote target. The transport factory is
 * injectable so the upload orchestration can be unit-tested without a server.
 */
export async function deploySite(
  siteDir: string,
  config: DeployConfig,
  makeTransport: (cfg: DeployConfig) => DeployTransport = defaultTransport,
  onProgress?: (e: DeployProgress) => void,
): Promise<{ protocol: DeployConfig['protocol']; files: number }> {
  const files = await collectSiteFiles(siteDir);
  const total = files.length;
  const transport = makeTransport(config);
  let index = 0;
  try {
    onProgress?.({ phase: 'connecting', total, index });
    await transport.connect();
    onProgress?.({ phase: 'uploading', total, index });
    await transport.uploadDir(siteDir, config.remoteDir, (file) => {
      index += 1;
      onProgress?.({ phase: 'uploading', total, index, file });
    });
  } finally {
    await transport.close().catch(() => {
      /* best-effort close */
    });
  }
  onProgress?.({ phase: 'done', total, index: total });
  return { protocol: config.protocol, files: total };
}
