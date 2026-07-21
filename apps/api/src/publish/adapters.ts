import { readFile, readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { z } from 'zod';
import JSZip from 'jszip';
import { Client as FtpClientImpl } from 'basic-ftp';
import SftpClientImpl from 'ssh2-sftp-client';
import {
  type DeployManifest,
  MANIFEST_FILENAME,
  computeManifest,
  diffManifests,
  isSafeRel,
  parseManifestJson,
  serializeManifest,
  toPosixRel,
} from './deploy/manifest.js';
import { planLeafDirs, remoteJoin } from './deploy/plan.js';

// Re-exported so deploy consumers + tests get the manifest type from the adapters barrel.
export type { DeployManifest } from './deploy/manifest.js';

/** SSH/SFTP handshake timeout (ssh2 `readyTimeout` — bounds ONLY the initial connect). Generous so a
 *  slow or distant SFTP server that takes a while to complete the handshake isn't dropped before the
 *  transfer begins. */
const SFTP_CONNECT_TIMEOUT_MS = 60_000;
/** FTP/FTPS control-socket timeout. basic-ftp applies this per TASK (login, mkdir, each upload), not
 *  just the initial connect, so it's kept tighter than the SFTP handshake timeout to bound the
 *  worst-case per-operation hold against a stalled control connection. */
const FTP_TIMEOUT_MS = 15_000;
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024; // 100 MiB cap on a built site archive
/** Concurrent fastPut operations over the single SSH connection (SFTP upload path).
 *  ssh2 multiplexes SFTP handles over one transport, so parallel puts overlap the round-trip
 *  latency; kept modest so a strict server's max-open-handles / channel limits aren't tripped. */
const SFTP_UPLOAD_CONCURRENCY = 8;
/** Cap on the untrusted remote manifest we download + JSON.parse. A manifest is path→{size,hash};
 *  even tens of thousands of files stay well under this. Anything larger (a compromised/MITM'd
 *  target returning a giant payload) is treated as unreadable → a first-deploy full upload. */
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;

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
    // host reaches the `ssh` CLI as a positional on the rsync path — restrict it to a hostname/IP
    // charset with no leading `-`, else `-oProxyCommand=…` would be read as an ssh option.
    host: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[A-Za-z0-9]([A-Za-z0-9.:_-]*[A-Za-z0-9])?\.?$/, 'host must be a valid hostname or IP address'),
    port: z.number().int().min(1).max(65535).optional(),
    user: z.string().min(1).max(255).refine((v) => !v.startsWith('-'), 'user must not start with "-"'),
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
    hostFingerprint: z
      .string()
      .min(1)
      .max(1024)
      // No control chars / newlines — on the rsync path this is written verbatim into a known_hosts
      // file when it carries a key line, so a newline could inject extra pre-trusted hosts.
      .refine((v) => !hasControlChars(v), 'hostFingerprint must not contain control characters')
      .optional(),
    // Transfer with rsync-over-SSH instead of the per-file SFTP transport (SFTP-only).
    useRsync: z.boolean().optional(),
  })
  .refine((c) => c.password !== undefined || c.privateKey !== undefined, {
    message: 'a password or a private key is required',
    path: ['password'],
  })
  // A private key is an SSH concept — FTP/FTPS have no key auth.
  .refine((c) => c.privateKey === undefined || c.protocol === 'sftp', {
    message: 'a private key requires the SFTP protocol',
    path: ['privateKey'],
  })
  // rsync rides SSH — only meaningful for an SFTP target.
  .refine((c) => !c.useRsync || c.protocol === 'sftp', {
    message: 'rsync transfer is only available for the SFTP protocol',
    path: ['useRsync'],
  })
  // rsync's --delete prunes everything under remoteDir not in the build → require a non-root dir.
  .refine((c) => !c.useRsync || (c.remoteDir !== '/' && c.remoteDir.split('/').some((s) => s.length > 0)), {
    message: 'rsync requires an explicit non-root remote directory (it deletes remote files absent from the build)',
    path: ['remoteDir'],
  })
  // rsync host-key pinning needs a known_hosts LINE (whitespace); reject a SHA-256 fingerprint rather
  // than silently falling back to trust-on-first-use.
  .refine((c) => !c.useRsync || !c.hostFingerprint || /\s/.test(c.hostFingerprint), {
    message: 'rsync host-key pinning needs a known_hosts line, not a SHA-256 fingerprint — clear it to trust on first use',
    path: ['hostFingerprint'],
  });
export type DeployConfig = z.infer<typeof DeployConfigSchema>;

/** A single built-site file: its path relative to the site root + its absolute source path. */
export interface SiteFile {
  rel: string;
  abs: string;
}

/** The bulk-upload strategy used for a deploy (surfaced to the UI as the transfer mode).
 *  'rsync' is the standalone rsync-over-SSH path (see rsync-deploy.ts); 'files' is the per-file
 *  path the SFTP/FTP transports use (concurrent fastPut on SFTP, sequential on FTP). */
export type DeployStrategy = 'files' | 'rsync';

/**
 * A pluggable upload transport (FTP/FTPS/SFTP), injectable for testing. The orchestrator
 * (`deploySite`) drives it: read the prior manifest, upload the changed files, prune the removed
 * ones, then write the new manifest. `onFile` ticks once per uploaded file (its POSIX rel path) so a
 * deploy can report live progress.
 */
export interface DeployTransport {
  connect(): Promise<void>;
  /** Reads the previously-deployed manifest from remoteDir, or null when absent/unreadable. */
  readManifest(remoteDir: string): Promise<DeployManifest | null>;
  /** Writes the manifest into remoteDir — called last, after the uploads + prune succeed. */
  writeManifest(remoteDir: string, manifest: DeployManifest): Promise<void>;
  /** Uploads `files` (already filtered to the changed set) under remoteDir. onFile ticks once per file. */
  upload(remoteDir: string, files: ReadonlyArray<SiteFile>, onFile?: (rel: string) => void): Promise<void>;
  /** Deletes the given safe relative paths under remoteDir (best-effort per file). */
  remove(remoteDir: string, rels: ReadonlyArray<string>): Promise<void>;
  close(): Promise<void>;
}

/** A deploy progress event streamed to the UI. `index`/`total` drive a determinate bar; `bytes` +
 *  `elapsedMs` let the UI show throughput; `strategy` names the transfer mode. */
export interface DeployProgress {
  phase: 'connecting' | 'checking' | 'uploading' | 'done';
  total: number;
  index: number;
  file?: string;
  /** Files skipped as unchanged (present once the manifest has been diffed). */
  skipped?: number;
  /** Stale remote files pruned (present on the `done` event). */
  removed?: number;
  /** The bulk-transfer mode in use. */
  strategy?: DeployStrategy;
  /** Cumulative bytes uploaded so far. */
  bytes?: number;
  /** Milliseconds since the upload phase started (0 on the first `uploading` event). */
  elapsedMs?: number;
}

/** The result of a completed deploy (returned + streamed as the `done` payload). */
export interface DeployResult {
  protocol: DeployConfig['protocol'];
  /** Total built files. */
  files: number;
  /** Files actually transferred (new or content-changed). */
  uploaded: number;
  /** Files skipped as unchanged via the manifest. */
  skipped: number;
  /** Stale remote files pruned. */
  removed: number;
  /** The transfer mode used. */
  strategy: DeployStrategy;
  /** Bytes transferred. */
  bytes: number;
  /** Upload-phase duration in milliseconds. */
  elapsedMs: number;
}

/** Recursively lists the files of a built site, relative to its root (sorted, confined). */
export async function collectSiteFiles(siteDir: string): Promise<SiteFile[]> {
  const base = resolve(siteDir);
  const out: SiteFile[] = [];
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

/* v8 ignore start -- thin I/O shims over basic-ftp / ssh2-sftp-client; exercised by manual
   integration against real servers, not unit-testable without live infra. The orchestration
   (deploySite) and the pure helpers (manifest.ts / plan.ts) ARE unit-tested. */

class FtpTransport implements DeployTransport {
  private readonly client = new FtpClientImpl(FTP_TIMEOUT_MS);
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
  async readManifest(remoteDir: string): Promise<DeployManifest | null> {
    const chunks: Buffer[] = [];
    let total = 0;
    const sink = new Writable({
      write(chunk, _enc, cb) {
        total += chunk.length;
        // Bound the download: a hostile/broken target could return an arbitrarily large payload here.
        if (total > MAX_MANIFEST_BYTES) return void cb(new Error('manifest too large'));
        chunks.push(Buffer.from(chunk));
        cb();
      },
    });
    try {
      await this.client.downloadTo(sink, remoteJoin(remoteDir, MANIFEST_FILENAME));
    } catch {
      return null; // missing / too large / unreadable → treat as a first deploy
    }
    return parseManifestJson(Buffer.concat(chunks).toString('utf8'));
  }
  async writeManifest(remoteDir: string, manifest: DeployManifest): Promise<void> {
    await this.client.ensureDir(remoteDir); // creates remoteDir + cds into it
    await this.client.uploadFrom(Readable.from(serializeManifest(manifest)), MANIFEST_FILENAME);
  }
  async upload(remoteDir: string, files: ReadonlyArray<SiteFile>, onFile?: (rel: string) => void): Promise<void> {
    // basic-ftp is single-connection + sequential; the incremental manifest already keeps this to the
    // CHANGED files only. ensureDir cds into each dir once (files arrive sorted, so grouped by dir).
    let currentDir = '';
    for (const file of files) {
      const rel = toPosixRel(file.rel);
      const slash = rel.lastIndexOf('/');
      const dir = slash === -1 ? (remoteDir.replace(/\/+$/, '') || '/') : remoteJoin(remoteDir, rel.slice(0, slash));
      const baseName = slash === -1 ? rel : rel.slice(slash + 1);
      if (dir !== currentDir) {
        await this.client.ensureDir(dir);
        currentDir = dir;
      }
      await this.client.uploadFrom(file.abs, baseName); // relative to cwd (== dir after ensureDir)
      onFile?.(rel);
    }
  }
  async remove(remoteDir: string, rels: ReadonlyArray<string>): Promise<void> {
    for (const rel of rels) {
      if (!isSafeRel(rel)) continue;
      await this.client.remove(remoteJoin(remoteDir, rel)).catch(() => {
        /* best-effort prune */
      });
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
    const opts: Parameters<SftpClientImpl['connect']>[0] = {
      host: this.cfg.host,
      port: this.cfg.port ?? 22,
      username: this.cfg.user,
      // Password and/or private-key auth — ssh2 tries whichever is provided.
      ...(this.cfg.password ? { password: this.cfg.password } : {}),
      ...(this.cfg.privateKey
        ? { privateKey: this.cfg.privateKey, ...(this.cfg.passphrase ? { passphrase: this.cfg.passphrase } : {}) }
        : {}),
      readyTimeout: SFTP_CONNECT_TIMEOUT_MS,
      hostHash: 'sha256',
      hostVerifier: makeHostVerifier(this.cfg.hostFingerprint),
    };
    // SSH transport compression: HTML/CSS/JS deploys are highly compressible, so this alone cuts a
    // text-heavy site's on-the-wire bytes several-fold; it falls back gracefully if the server
    // declines. Not surfaced in @types/ssh2-sftp-client's ConnectOptions, but ssh2 reads it.
    (opts as { compress?: boolean }).compress = true;
    await this.client.connect(opts);
  }
  async readManifest(remoteDir: string): Promise<DeployManifest | null> {
    const path = remoteJoin(remoteDir, MANIFEST_FILENAME);
    try {
      // Bound the read before pulling it into memory: a compromised/MITM'd target could otherwise
      // return an arbitrarily large payload at this path. Missing file → stat throws → first deploy.
      const stat = await this.client.stat(path);
      if (typeof stat.size === 'number' && stat.size > MAX_MANIFEST_BYTES) return null;
      const buf = (await this.client.get(path)) as Buffer;
      return parseManifestJson(buf.toString('utf8'));
    } catch {
      return null; // missing / unreadable → treat as a first deploy
    }
  }
  async writeManifest(remoteDir: string, manifest: DeployManifest): Promise<void> {
    await this.client.mkdir(remoteDir, true).catch(() => {
      /* already exists */
    });
    await this.client.put(Buffer.from(serializeManifest(manifest), 'utf8'), remoteJoin(remoteDir, MANIFEST_FILENAME));
  }
  async upload(remoteDir: string, files: ReadonlyArray<SiteFile>, onFile?: (rel: string) => void): Promise<void> {
    await this.putFiles(remoteDir, files, onFile);
  }
  /** Pre-create the leaf dirs, then fastPut through a bounded concurrency pool. With the flat
   *  `_assets/` layout there are far fewer leaf dirs, so the per-file path is fast without a tar
   *  fast-path or an SSH capability probe (both removed — they added a round trip and could hang on
   *  odd servers for a benefit the flat layout erased). */
  private async putFiles(remoteDir: string, files: ReadonlyArray<SiteFile>, onFile?: (rel: string) => void): Promise<void> {
    const rels = files.map((f) => toPosixRel(f.rel));
    for (const dir of planLeafDirs(remoteDir, rels)) {
      await this.client.mkdir(dir, true).catch(() => {
        /* already exists */
      });
    }
    let next = 0;
    let failed = false;
    const worker = async (): Promise<void> => {
      for (;;) {
        if (failed) return; // a sibling failed — stop claiming new work
        const i = next;
        next += 1;
        if (i >= files.length) return;
        try {
          await this.client.fastPut(files[i]!.abs, remoteJoin(remoteDir, rels[i]!));
        } catch (err) {
          failed = true;
          throw err;
        }
        onFile?.(rels[i]!);
      }
    };
    await Promise.all(Array.from({ length: Math.min(SFTP_UPLOAD_CONCURRENCY, files.length) }, () => worker()));
  }
  async remove(remoteDir: string, rels: ReadonlyArray<string>): Promise<void> {
    for (const rel of rels) {
      if (!isSafeRel(rel)) continue;
      await this.client.delete(remoteJoin(remoteDir, rel), true).catch(() => {
        /* best-effort prune */
      });
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
 * Deploys a built site directory to a remote target as an INCREMENTAL sync: it hashes the build,
 * reads the manifest left by the previous deploy, uploads only the new/changed files (via the
 * transport's fastest available strategy), prunes files that were removed, and writes a fresh
 * manifest. The transport factory is injectable so the orchestration is unit-testable without a
 * server. Pass `opts.incremental = false` to force a full re-upload (ignore the prior manifest).
 */
export async function deploySite(
  siteDir: string,
  config: DeployConfig,
  makeTransport: (cfg: DeployConfig) => DeployTransport = defaultTransport,
  onProgress?: (e: DeployProgress) => void,
  opts: { incremental?: boolean } = {},
): Promise<DeployResult> {
  const files = await collectSiteFiles(siteDir);
  const total = files.length;
  const nextManifest = await computeManifest(files);
  const transport = makeTransport(config);
  const incremental = opts.incremental !== false;
  let index = 0;
  try {
    onProgress?.({ phase: 'connecting', total, index });
    await transport.connect();

    // Read the prior manifest to diff against (skipped on a forced full re-upload).
    onProgress?.({ phase: 'checking', total, index });
    const prev = incremental ? await transport.readManifest(config.remoteDir) : null;
    const { upload, remove } = diffManifests(prev, nextManifest);
    const uploadSet = new Set(upload);
    const changed = files.filter((f) => uploadSet.has(toPosixRel(f.rel)));
    const skipped = total - changed.length;
    // SFTP/FTP both use the per-file path (concurrent fastPut on SFTP); rsync is a separate deployer.
    const strategy: DeployStrategy = 'files';

    // Unchanged files are already on the target — count them as done so the bar starts partly filled.
    index = skipped;
    const startedAt = Date.now();
    let bytes = 0;
    onProgress?.({ phase: 'uploading', total, index, skipped, strategy, bytes, elapsedMs: 0 });

    if (changed.length > 0) {
      await transport.upload(config.remoteDir, changed, (rel) => {
        index += 1;
        bytes += nextManifest[rel]?.size ?? 0;
        onProgress?.({ phase: 'uploading', total, index, file: rel, skipped, strategy, bytes, elapsedMs: Date.now() - startedAt });
      });
    }
    // True per-file transfer time, measured before the prune + manifest write (which the reported
    // throughput should not be diluted by).
    const elapsedMs = Date.now() - startedAt;
    // Write the manifest BEFORE pruning: if the process dies between the two, the persisted manifest
    // already reflects the new build, so the next deploy re-derives an accurate diff — a crash here
    // leaves at worst a few harmless orphan files on the target, never a silently-missing one (which
    // the reverse order — prune then write — could cause if a pruned file's twin later reappears).
    await transport.writeManifest(config.remoteDir, nextManifest);
    if (remove.length > 0) await transport.remove(config.remoteDir, remove);

    onProgress?.({ phase: 'done', total, index: total, skipped, removed: remove.length, strategy, bytes, elapsedMs });
    return { protocol: config.protocol, files: total, uploaded: changed.length, skipped, removed: remove.length, strategy, bytes, elapsedMs };
  } finally {
    await transport.close().catch(() => {
      /* best-effort close */
    });
  }
}
