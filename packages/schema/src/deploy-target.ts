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

/** A git remote URL for a `git` target — http(s) only (token auth), bounded, no control chars. */
const RepoUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .regex(/^https?:\/\/[^\s]+$/i, 'repoUrl must be an http(s) URL')
  .refine((v) => !hasControlChars(v), 'repoUrl must not contain control characters')
  // Must be URL-parseable (so the SSRF host extraction can never throw).
  .refine((v) => {
    try {
      new URL(v);
      return true;
    } catch {
      return false;
    }
  }, 'repoUrl must be a valid URL')
  // No embedded credentials — the token lives in the encrypted `secret`, not in the (plaintext) URL.
  .refine((v) => {
    try {
      const u = new URL(v);
      return !u.username && !u.password;
    } catch {
      return true; // unparseable is already rejected above
    }
  }, 'repoUrl must not embed credentials — use the token field');

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
    /** SFTP host-key fingerprint (not secret). */
    hostFingerprint: z.string().min(1).max(256).optional(),
    /** Encrypted credentials: FTP/SFTP `{password?, privateKey?, passphrase?}`, or git `{token}`. */
    secret: EncryptedSecretSchema.optional(),
    // ── Local Hosting serve options (only meaningful on a `local` target) ──
    /** When set, `/sites/<slug>/…` requires a matching `?token=` — a soft "unlisted preview" gate. */
    previewToken: PreviewTokenSchema.optional(),
    /** Minify each page's HTML at build (collapse whitespace, drop comments). Off by default. */
    minifyHtml: z.boolean().optional(),
    // ── git fields (only meaningful on a `git` target) ──
    /** The remote repository (http/https; token auth). */
    repoUrl: RepoUrlSchema.optional(),
    /** The branch the built site is force-committed to (gh-pages style). */
    branch: GitBranchSchema.optional(),
  })
  // FTP/FTPS/SFTP need a host, a user, and credentials.
  .refine(
    (t) => (t.protocol !== 'ftp' && t.protocol !== 'ftps' && t.protocol !== 'sftp') || (!!t.host && !!t.user && !!t.secret),
    { message: 'host, user and credentials are required for an FTP/FTPS/SFTP target', path: ['host'] },
  )
  // git needs a repoUrl, a branch, and a token (the `secret`).
  .refine((t) => t.protocol !== 'git' || (!!t.repoUrl && !!t.branch && !!t.secret), {
    message: 'repoUrl, branch and a token are required for a git target',
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
