import { z } from 'zod';
import { IdSchema } from './primitives.js';

/** True if `value` contains an ASCII control character (mirrors DeployConfigSchema). */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** Encrypted-at-rest secret envelope (AES-256-GCM, base64 fields). The ciphertext now holds a JSON
 *  blob `{password?, privateKey?, passphrase?}`, so `ct` is sized to fit a PEM private key (a few KB
 *  of plaintext → a ~16KB base64 ceiling). */
export const EncryptedSecretSchema = z.object({
  iv: z.string().min(1).max(64),
  ct: z.string().min(1).max(16384),
  tag: z.string().min(1).max(64),
});
export type EncryptedSecret = z.infer<typeof EncryptedSecretSchema>;

/** Deploy protocols. `local` = host the built site on THIS server at `/sites/<slug>/` (no credentials);
 *  `ftp`/`ftps`/`sftp` = upload it to an external server; `git` = commit it to a branch of a remote repo. */
export const DeployProtocolSchema = z.enum(['local', 'ftp', 'ftps', 'sftp', 'git']);
export type DeployProtocol = z.infer<typeof DeployProtocolSchema>;

/** Soft "unlisted preview" gate for a locally-hosted site: a url-safe token required as `?token=`. */
const PreviewTokenSchema = z
  .string()
  .min(16)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'previewToken must be url-safe (A–Z, a–z, 0–9, _ or -)');

// A git remote URL is one of: http(s) (token auth), `ssh://[user@]host[:port]/path`, or the scp-like
// `user@host:path` (both SSH = key auth).
const GIT_HTTP_RE = /^https?:\/\/[^\s]+$/i;
const GIT_SSH_URL_RE = /^ssh:\/\/[^\s]+$/i;
const GIT_SCP_RE = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+$/;

/** True for an SSH git remote (`ssh://…` or scp-like `user@host:path`) — i.e. key auth, not token. */
export function isSshRepoUrl(repoUrl: string): boolean {
  return GIT_SSH_URL_RE.test(repoUrl) || (GIT_SCP_RE.test(repoUrl) && !repoUrl.includes('://'));
}

/** Extract the host of a git remote (http(s), ssh://, or scp-like) — used for the SSRF allow-list. */
export function gitRepoHost(repoUrl: string): string {
  if (GIT_SCP_RE.test(repoUrl) && !repoUrl.includes('://')) {
    const afterUser = repoUrl.slice(repoUrl.indexOf('@') + 1);
    const colon = afterUser.indexOf(':');
    return colon === -1 ? afterUser : afterUser.slice(0, colon);
  }
  return new URL(repoUrl).hostname;
}

/** A git remote URL for a `git` target — http(s) (token) or ssh (key), bounded, no control chars. */
const RepoUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((v) => GIT_HTTP_RE.test(v) || GIT_SSH_URL_RE.test(v) || GIT_SCP_RE.test(v), {
    message: 'repoUrl must be an http(s) URL or an ssh URL (ssh://… or user@host:path)',
  })
  .refine((v) => !hasControlChars(v), 'repoUrl must not contain control characters')
  // http(s)/ssh:// must be URL-parseable (so host extraction can never throw); scp-like is parsed by hand.
  .refine((v) => {
    if (GIT_SCP_RE.test(v) && !v.includes('://')) return true;
    try {
      new URL(v);
      return true;
    } catch {
      return false;
    }
  }, 'repoUrl must be a valid URL')
  // http(s) must not embed credentials (the token lives in the encrypted secret). An SSH user (git@) is fine.
  .refine((v) => {
    if (!GIT_HTTP_RE.test(v)) return true;
    try {
      const u = new URL(v);
      return !u.username && !u.password;
    } catch {
      return true;
    }
  }, 'repoUrl must not embed credentials — use the token field')
  // Belt-and-suspenders against argument injection: a repoUrl can never be read as a git/ssh flag.
  .refine((v) => !v.startsWith('-'), 'repoUrl must not start with "-"');

/** A git branch/ref name — conservative safe charset, no traversal. */
const GitBranchSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9._/-]+$/, 'branch may use letters, digits, ".", "_", "/" or "-"')
  .refine((v) => !v.split('/').some((seg) => seg === '..'), 'branch must not contain ".." segments');

/**
 * A saved deploy target. `local` hosts the built site on this platform at `/sites/<slug>/` (with serve
 * options); `ftp`/`ftps`/`sftp` upload it to an external server; `git` commits it to a branch of a
 * remote repo. Credentials (FTP/SFTP password/key, or the git token) are stored only as an encrypted
 * `secret` — plaintext is never persisted, and the API never returns `secret` to clients.
 */
export const DeployTargetSchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1).max(120),
    protocol: DeployProtocolSchema,
    // ── Remote-transport fields (FTP/FTPS/SFTP) — absent on a `local`/`git` target ──
    host: z.string().min(1).max(255).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    user: z.string().min(1).max(255).optional(),
    remoteDir: z
      .string()
      .min(1)
      .max(1024)
      // Parity with DeployConfigSchema: the stored target feeds the FTP/SFTP transport directly, so
      // reject control chars (command/path injection) AND traversal here.
      .refine((v) => !hasControlChars(v), 'remoteDir must not contain control characters')
      .refine((v) => !v.split('/').some((seg) => seg === '..'), 'remoteDir must not contain ".." segments')
      .optional(),
    /** SFTP host-key fingerprint, OR a git-SSH `known_hosts` host-key line for pinning (not secret). */
    hostFingerprint: z
      .string()
      .min(1)
      .max(1024)
      // No control chars / newlines — a multi-line value would silently pre-trust extra SSH hosts.
      .refine((v) => !hasControlChars(v), 'hostFingerprint must not contain control characters')
      .optional(),
    /** Encrypted credentials: FTP/SFTP `{password?, privateKey?, passphrase?}`, or git `{token}`. */
    secret: EncryptedSecretSchema.optional(),
    // ── Local Hosting serve options (only meaningful on a `local` target) ──
    /** When set, `/sites/<slug>/…` requires a matching `?token=` — a soft "unlisted preview" gate. */
    previewToken: PreviewTokenSchema.optional(),
    /** Minify each page's HTML at build (collapse whitespace, drop comments). Off by default. */
    minifyHtml: z.boolean().optional(),
    // ── git fields (only meaningful on a `git` target) ──
    /** The remote repository — http(s) (token auth) or ssh (key auth). */
    repoUrl: RepoUrlSchema.optional(),
    /** The branch the built site is force-committed to (gh-pages style). */
    branch: GitBranchSchema.optional(),
  })
  // FTP/FTPS/SFTP need a host, a user, and credentials.
  .refine(
    (t) => (t.protocol !== 'ftp' && t.protocol !== 'ftps' && t.protocol !== 'sftp') || (!!t.host && !!t.user && !!t.secret),
    { message: 'host, user and credentials are required for an FTP/FTPS/SFTP target', path: ['host'] },
  )
  // git needs a repoUrl, a branch, and credentials (token for https or a key for ssh — the `secret`).
  .refine((t) => t.protocol !== 'git' || (!!t.repoUrl && !!t.branch && !!t.secret), {
    message: 'repoUrl, branch and credentials are required for a git target',
    path: ['repoUrl'],
  })
  // A local target has no transport credentials or repository.
  .refine((t) => t.protocol !== 'local' || (!t.host && !t.user && !t.secret && !t.repoUrl && !t.branch), {
    message: 'a local hosting target has no host, credentials or repository',
    path: ['protocol'],
  });
export type DeployTarget = z.infer<typeof DeployTargetSchema>;

/** Public view of a deploy target — never includes the encrypted secret. */
export type DeployTargetView = Omit<DeployTarget, 'secret'>;
