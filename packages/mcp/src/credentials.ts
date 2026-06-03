import { mkdir, readFile, writeFile, chmod, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Tokens obtained from the OAuth device/PKCE login, persisted per Sitewright instance. */
export interface StoredCredentials {
  accessToken: string;
  refreshToken: string;
  /** Space-joined granted scopes (informational). */
  scope: string;
  /** ISO timestamp the tokens were obtained/refreshed (informational; not trusted for expiry). */
  obtainedAt: string;
}

/**
 * Where credentials live: `$SITEWRIGHT_CREDENTIALS` (tests/custom) or `~/.sitewright/credentials.json`.
 * Read at call time so an env override applies without re-importing. The file holds one entry per
 * instance URL and carries bearer + refresh tokens, so it is written `0600` in a `0700` directory.
 */
function credentialsFile(): string {
  return process.env.SITEWRIGHT_CREDENTIALS ?? join(homedir(), '.sitewright', 'credentials.json');
}

/** Trailing-slash-insensitive key so `…:2003` and `…:2003/` share one entry. */
function urlKey(url: string): string {
  return url.replace(/\/+$/, '');
}

async function readAll(): Promise<Record<string, StoredCredentials>> {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed env/home path, not user input
    const parsed = JSON.parse(await readFile(credentialsFile(), 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, StoredCredentials>) : {};
  } catch {
    return {}; // missing/unreadable/corrupt → treat as empty
  }
}

/**
 * Atomically replace the credentials file with `0600` content in a `0700` dir. Writing a fresh temp
 * file (which honours the create mode) and renaming over the target avoids the world-readable window
 * a plain `writeFile`+`chmod` leaves when the target already exists (`writeFile`'s mode is ignored then).
 */
async function writeAll(all: Record<string, StoredCredentials>): Promise<void> {
  const file = credentialsFile();
  const dir = dirname(file);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed env/home path, not user input
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- owner-only credentials dir
  await chmod(dir, 0o700).catch(() => {}); // tighten a pre-existing looser dir; ignore if not permitted
  const tmp = `${file}.${process.pid}.tmp`;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed env/home path, not user input
  await writeFile(tmp, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed env/home path, not user input
  await chmod(tmp, 0o600);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed env/home path, not user input
  await rename(tmp, file); // atomic; the renamed inode keeps the temp's 0600 mode
}

/** True when a stored entry actually carries usable tokens (guards a corrupt/partial file). */
function isValid(c: StoredCredentials | undefined): c is StoredCredentials {
  return (
    !!c &&
    typeof c.accessToken === 'string' &&
    c.accessToken.length > 0 &&
    typeof c.refreshToken === 'string' &&
    c.refreshToken.length > 0
  );
}

/** The stored credentials for an instance URL, or null if none / corrupt / unreadable. */
export async function loadCredentials(url: string): Promise<StoredCredentials | null> {
  const all = await readAll();
  const c = all[urlKey(url)];
  return isValid(c) ? c : null;
}

/** Persist (or replace) the credentials for an instance URL; the file is always written `0600`. */
export async function saveCredentials(url: string, creds: StoredCredentials): Promise<void> {
  const all = await readAll();
  all[urlKey(url)] = creds;
  await writeAll(all);
}

/** Remove the credentials for an instance URL (logout). No-op if none stored. */
export async function clearCredentials(url: string): Promise<void> {
  const all = await readAll();
  if (!(urlKey(url) in all)) return;
  delete all[urlKey(url)];
  await writeAll(all);
}
