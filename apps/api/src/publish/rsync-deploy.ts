import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { DeployConfig, DeployProgress, DeployResult } from './adapters.js';
import { MANIFEST_FILENAME } from './deploy/manifest.js';

/**
 * rsync-over-SSH deploy. For a hardened SFTP server that REFUSES arbitrary exec (so the SFTP
 * transport's tar fast path can't run) but PERMITS rsync, this ships the built site with rsync's
 * delta algorithm + compression in one connection — far faster than per-file SFTP for a full deploy.
 * It is opt-in per target (`useRsync`); rsync does its OWN change detection, so it needs no manifest.
 *
 * Like the SSH-key git path, this needs the real `rsync` + `ssh` binaries: the key / passphrase /
 * password go into a private temp dir (never argv, never logged) and are wired in via `-e ssh …` +
 * a forced askpass. Everything is removed in `finally`.
 */

const RSYNC_TIMEOUT_MS = 20 * 60 * 1000; // whole connect + transfer budget
const SSH_CONNECT_TIMEOUT_S = 15;
const MAX_STDOUT_CAPTURE_BYTES = 64 * 1024; // rolling tail — the `--stats` block is always at the end
const MAX_STDERR_CAPTURE_BYTES = 4_096; // trimmed error snippet for the server log

/** Ensures a single trailing slash (rsync semantics: `src/` copies CONTENTS of src into dest). */
function withTrailingSlash(path: string): string {
  return path.endsWith('/') ? path : `${path}/`;
}

/**
 * Builds the rsync argv (NO shell — spawned directly). `sshCommand` is the fully-formed `ssh …`
 * transport string passed via `-e`. Pure + unit-tested. The leading `--` stops rsync parsing the
 * src/dest as options (argument-injection guard, mirroring the git path's `--`).
 */
export function buildRsyncArgs(
  config: Pick<DeployConfig, 'user' | 'host'>,
  srcDir: string,
  remoteDir: string,
  sshCommand: string,
): string[] {
  return [
    // -r recurse, -l symlinks, -p perms, -t times, -z compress. Deliberately NOT -a: skip owner/group
    // (--no-o/--no-g) and devices/specials — shared hosting rejects chown and has no device nodes.
    // (Note: the SFTP transport's collectSiteFiles skips symlink entries; a build emitting a symlink
    // would therefore ship under rsync but not SFTP — a theoretical, accepted divergence.)
    '-rlptz',
    '--no-owner',
    '--no-group',
    // Protect operational files from --delete (excluded files are never pruned): certbot's ACME
    // challenge dir and the SFTP transport's own state manifest (so switching transports is safe).
    '--exclude=.well-known/',
    `--exclude=/${MANIFEST_FILENAME}`,
    '--delete', // prune remote files absent from the build (remoteDir is the schema-guarded, non-root site root)
    '--stats', // machine-parseable summary at the end
    '--info=progress2', // one aggregate progress line (bytes / % / xfr# / to-chk)
    '-e',
    sshCommand,
    '--',
    withTrailingSlash(srcDir),
    `${config.user}@${config.host}:${withTrailingSlash(remoteDir)}`,
  ];
}

/** Parsed aggregate-progress fields from an rsync `--info=progress2` line. */
export interface RsyncProgress {
  bytes: number;
  index: number; // files transferred so far (xfr#)
  total: number; // total files in the set (to-chk denominator)
}

const PROGRESS_RE = /^\s*([\d,]+)\s+\d+%\s+\S+\s+\S+\s+\(xfr#(\d+),\s+(?:ir|to)-chk=(\d+)\/(\d+)\)/;

/** Parses one rsync progress2 line → cumulative bytes + transferred/total file counts, or null. */
export function parseRsyncProgress(line: string): RsyncProgress | null {
  const m = PROGRESS_RE.exec(line);
  if (!m) return null;
  const total = Number(m[4]);
  const toCheck = Number(m[3]);
  return {
    bytes: Number(m[1]!.replace(/,/g, '')),
    index: Math.max(0, total - toCheck), // files whose delta is resolved
    total,
  };
}

/** Parsed rsync `--stats` summary. */
export interface RsyncStats {
  totalFiles: number; // regular files in the set
  uploaded: number; // regular files actually transferred (new / changed)
  removed: number; // files deleted on the remote by --delete
  bytes: number; // total transferred (post-delta, pre-compression) size
}

/** First label to match wins → its captured number (commas stripped); 0 if none match. Multiple
 *  labels tolerate rsync's wording differences across versions (see parseRsyncStats). */
function statNumber(stdout: string, ...labels: RegExp[]): number {
  for (const label of labels) {
    const m = label.exec(stdout);
    if (m) return Number(m[1]!.replace(/,/g, ''));
  }
  return 0;
}

/**
 * Parses rsync's `--stats` block into a DeployResult-shaped summary (missing fields → 0). Tolerates
 * the wording differences across rsync versions: the `(reg: N)` breakdown and the "regular"/"deleted"
 * qualifiers arrived in rsync 3.1; a pre-3.1 remote (common on locked-down appliances — this
 * feature's audience) prints "Number of files: N" / "Number of files transferred: N" and no
 * deleted-files line, so we fall back to those rather than silently reporting 0 transferred.
 */
export function parseRsyncStats(stdout: string): RsyncStats {
  return {
    totalFiles: statNumber(stdout, /Number of files:\s+[\d,]+\s+\(reg:\s+([\d,]+)/, /Number of files:\s+([\d,]+)/),
    uploaded: statNumber(stdout, /Number of regular files transferred:\s+([\d,]+)/, /Number of files transferred:\s+([\d,]+)/),
    removed: statNumber(stdout, /Number of deleted files:\s+([\d,]+)/),
    bytes: statNumber(stdout, /Total transferred file size:\s+([\d,]+)/),
  };
}

/* v8 ignore start -- I/O shim over the rsync/ssh binaries; exercised by manual integration against a
   real rsync-capable server, not unit-testable without live infra. The arg/stat/progress parsing
   above IS unit-tested. */

/** Runs rsync to completion, streaming progress and returning its parsed `--stats`. Rejects (with a
 *  trimmed stderr tail for the server log — never the key/password) on non-zero exit or timeout. */
function runRsync(args: string[], env: NodeJS.ProcessEnv, onLine: (line: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    // detached → its own process group, so on timeout we can SIGKILL the WHOLE group (rsync forks a
    // separate `ssh` child to carry the transport; killing rsync alone would orphan that ssh + its
    // open connection to the target).
    const child = spawn('rsync', args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let stdout = '';
    let stderr = '';
    let carry = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, RSYNC_TIMEOUT_MS);
    child.stdout.on('data', (d: Buffer) => {
      const text = d.toString();
      // Retain only the tail — `--stats` is always the trailing block, and progress2's \r updates
      // would otherwise accumulate unboundedly over a long transfer.
      stdout = (stdout + text).slice(-MAX_STDOUT_CAPTURE_BYTES);
      // progress2 rewrites the same line via \r; split on both so each update is one line.
      carry += text;
      const parts = carry.split(/[\r\n]/);
      carry = parts.pop() ?? '';
      for (const line of parts) if (line) onLine(line);
    });
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < MAX_STDERR_CAPTURE_BYTES) stderr += d.toString();
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`rsync timed out after ${RSYNC_TIMEOUT_MS}ms`));
      if (code === 0) return resolve(stdout);
      const tail = stderr.trim().split('\n').slice(-1)[0] ?? '';
      reject(new Error(`rsync failed (exit ${code})${tail ? `: ${tail}` : ''}`));
    });
  });
}

export async function deployRsync(
  siteDir: string,
  config: DeployConfig,
  onProgress?: (e: DeployProgress) => void,
): Promise<DeployResult> {
  const sshDir = await mkdtemp(join(tmpdir(), 'sw-rsync-')); // key + known_hosts + askpass (0700)
  // rsync's `-e` is word-split (NOT shell-parsed), so quoting can't rescue a temp path with spaces.
  // os.tmpdir() is space-free in every supported deploy image; guard defensively rather than mangle.
  if (/\s/.test(sshDir)) {
    await rm(sshDir, { recursive: true, force: true }).catch(() => {});
    throw new Error('rsync deploy requires a whitespace-free temp dir');
  }
  // Set just before rsync runs (below), so elapsedMs/throughput measures the TRANSFER — not the temp
  // key/known_hosts setup — comparable to deploySite's upload-only timing.
  let startedAt = Date.now();
  try {
    onProgress?.({ phase: 'connecting', total: 0, index: 0 });
    const knownHosts = join(sshDir, 'known_hosts');
    // hostFingerprint doubles as an optional known_hosts LINE (`host keytype base64…`) — a value with
    // internal whitespace. Pin against it (StrictHostKeyChecking=yes) when present; else trust on
    // first use (accept-new), parity with the SFTP transport's un-pinned default.
    const pin = config.hostFingerprint && /\s/.test(config.hostFingerprint) ? config.hostFingerprint : undefined;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined mkdtemp path
    await writeFile(knownHosts, pin ? `${pin}\n` : '', { mode: 0o600 });

    const sshOpts = [
      `-o ConnectTimeout=${SSH_CONNECT_TIMEOUT_S}`,
      `-o StrictHostKeyChecking=${pin ? 'yes' : 'accept-new'}`,
      `-o UserKnownHostsFile=${knownHosts}`,
      ...(config.port ? [`-p ${config.port}`] : []),
    ];

    // A MINIMAL env — never leak the API's own secrets (DB url, encryption key, …) into rsync/ssh.
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
    };

    if (config.privateKey) {
      const keyPath = join(sshDir, 'id');
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined mkdtemp path
      await writeFile(keyPath, config.privateKey.endsWith('\n') ? config.privateKey : `${config.privateKey}\n`, { mode: 0o600 });
      sshOpts.push(`-i ${keyPath}`, '-o IdentitiesOnly=yes', '-o PreferredAuthentications=publickey');
      if (config.passphrase) {
        await writeAskpass(sshDir, env, config.passphrase);
      } else {
        sshOpts.push('-o BatchMode=yes'); // unencrypted key → never block on a prompt
      }
    } else {
      // Password auth: force keyboard-interactive/password only, and feed the password via the same
      // forced-askpass mechanism (works for password prompts too — no `sshpass` binary needed).
      sshOpts.push('-o PubkeyAuthentication=no', '-o PreferredAuthentications=password,keyboard-interactive', '-o NumberOfPasswordPrompts=1');
      await writeAskpass(sshDir, env, config.password ?? '');
    }

    const args = buildRsyncArgs(config, siteDir, config.remoteDir, `ssh ${sshOpts.join(' ')}`);

    // rsync builds its file list + computes the delta before the first byte moves.
    onProgress?.({ phase: 'checking', total: 0, index: 0, strategy: 'rsync' });
    let lastTotal = 0;
    startedAt = Date.now();
    // NOTE: progress `total` here (rsync's to-chk denominator) counts all list items (files + dirs)
    // and, under incremental recursion, can grow mid-transfer; the final result's `files` uses the
    // stats regular-file count. A small last-frame count adjustment is expected + cosmetic.
    const stdout = await runRsync(args, env, (line) => {
      const p = parseRsyncProgress(line);
      if (!p) return;
      lastTotal = p.total;
      onProgress?.({ phase: 'uploading', total: p.total, index: p.index, bytes: p.bytes, strategy: 'rsync', elapsedMs: Date.now() - startedAt });
    });

    const stats = parseRsyncStats(stdout);
    const totalFiles = stats.totalFiles || lastTotal;
    const elapsedMs = Date.now() - startedAt;
    onProgress?.({
      phase: 'done',
      total: totalFiles,
      index: totalFiles,
      skipped: Math.max(0, totalFiles - stats.uploaded),
      removed: stats.removed,
      strategy: 'rsync',
      bytes: stats.bytes,
      elapsedMs,
    });
    return {
      protocol: config.protocol,
      files: totalFiles,
      uploaded: stats.uploaded,
      skipped: Math.max(0, totalFiles - stats.uploaded),
      removed: stats.removed,
      strategy: 'rsync',
      bytes: stats.bytes,
      elapsedMs,
    };
  } finally {
    await rm(sshDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Writes a forced-askpass script (echoes the secret from a private env var) + wires the ssh env so
 *  a key passphrase OR a login password is supplied non-interactively (no tty, no `sshpass`). */
async function writeAskpass(sshDir: string, env: NodeJS.ProcessEnv, secret: string): Promise<void> {
  const askPath = join(sshDir, 'askpass.sh');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined mkdtemp path
  await writeFile(askPath, '#!/bin/sh\nprintf %s "$SW_SSH_SECRET"\n', { mode: 0o700 });
  env.SSH_ASKPASS = askPath;
  env.SSH_ASKPASS_REQUIRE = 'force';
  env.DISPLAY = process.env.DISPLAY ?? ':0';
  env.SW_SSH_SECRET = secret;
}
/* v8 ignore stop */
