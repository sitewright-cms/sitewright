import { readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Prefix `buildForDeploy` gives every throwaway deploy payload (`mkdtemp`, so 0700). */
export const DEPLOY_TMP_PREFIX = 'sw-deploy-';

/**
 * Age below which a deploy directory is assumed to belong to a deploy that is still running, and is
 * therefore left alone. A deploy is minutes, not hours — but this only has to be longer than the
 * slowest plausible one, and deleting a live payload mid-upload would be far worse than letting an
 * orphan sit a while longer.
 */
export const DEPLOY_TMP_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Removes deploy payload directories left behind by a previous run.
 *
 * WHY THIS EXISTS: a `contactPhpSmtp` form's `sw-mail.config.php` carries the project's SMTP
 * password in plaintext, and it is the only artifact in the system that ever puts a live credential
 * on this host's disk. Every deploy path removes its payload in a `finally`, so the normal success
 * AND failure paths are already clean — but a `finally` cannot run if the process is SIGKILLed, OOM
 * killed, or the host dies between the write and the upload. That leaves the password sitting in
 * the OS temp dir indefinitely. Sweeping at boot bounds "indefinitely" to "until the next restart".
 *
 * Deliberately conservative, because deleting a payload out from under a running deploy would break
 * a customer's site rather than protect it:
 *  - only directories whose name carries our own prefix, directly inside the OS temp dir;
 *  - only those older than {@link DEPLOY_TMP_MAX_AGE_MS};
 *  - never throws — a sweep failure must not stop the server from booting.
 *
 * Boot is also the safest moment to do this: THIS process has no deploy in flight by definition.
 */
export async function sweepOrphanedDeployDirs(opts: {
  /** Override the directory scanned (tests). Defaults to the OS temp dir. */
  dir?: string;
  /** Override "now" (tests). */
  now?: number;
  maxAgeMs?: number;
  log?: (message: string) => void;
} = {}): Promise<{ removed: number }> {
  const base = opts.dir ?? tmpdir();
  const now = opts.now ?? Date.now();
  const maxAgeMs = opts.maxAgeMs ?? DEPLOY_TMP_MAX_AGE_MS;
  let removed = 0;

  let entries;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the OS temp dir, or a test-owned dir
    entries = await readdir(base, { withFileTypes: true });
  } catch {
    return { removed: 0 }; // no temp dir / not readable — nothing to do, and never a boot failure
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(DEPLOY_TMP_PREFIX)) continue;
    const abs = join(base, entry.name);
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- abs is `${base}/${entry.name}`, both ours
      const info = await stat(abs);
      if (now - info.mtimeMs < maxAgeMs) continue; // young enough to be a live deploy — leave it
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- same, and prefix-gated above
      await rm(abs, { recursive: true, force: true });
      removed += 1;
      opts.log?.(`removed orphaned deploy payload ${entry.name}`);
    } catch {
      // A racing deploy may have removed it already, or it may not be ours to delete. Either way the
      // next boot tries again; one unreadable entry must not abort the rest of the sweep.
    }
  }
  return { removed };
}
