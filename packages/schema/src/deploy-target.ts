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
 *  `ftp`/`ftps`/`sftp` = upload it to an external server. */
export const DeployProtocolSchema = z.enum(['local', 'ftp', 'ftps', 'sftp']);
export type DeployProtocol = z.infer<typeof DeployProtocolSchema>;

/** Soft "unlisted preview" gate for a locally-hosted site: a url-safe token required as `?token=`. */
const PreviewTokenSchema = z
  .string()
  .min(16)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'previewToken must be url-safe (A–Z, a–z, 0–9, _ or -)');

/**
 * A saved deploy target. A `local` target hosts the built site on this platform at `/sites/<slug>/`
 * (with optional serve options); a `ftp`/`ftps`/`sftp` target uploads it to an external server (with
 * credentials stored only as an encrypted `secret` — plaintext is never persisted). This is the stored
 * shape (a `deploy_target` content row); the API never returns `secret` to clients.
 */
export const DeployTargetSchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1).max(120),
    protocol: DeployProtocolSchema,
    // ── Remote-transport fields (FTP/FTPS/SFTP) — absent on a `local` target ──
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
    secret: EncryptedSecretSchema.optional(),
    // ── Local Hosting serve options (only meaningful on a `local` target) ──
    /** When set, `/sites/<slug>/…` requires a matching `?token=` — a soft "unlisted preview" gate. */
    previewToken: PreviewTokenSchema.optional(),
    /** Minify each page's HTML at build (collapse whitespace, drop comments). Off by default. */
    minifyHtml: z.boolean().optional(),
  })
  // A remote (FTP/FTPS/SFTP) target needs a host, a user, and credentials; a local target has none.
  .refine((t) => t.protocol === 'local' || (!!t.host && !!t.user && !!t.secret), {
    message: 'host, user and credentials are required for an FTP/FTPS/SFTP target',
    path: ['host'],
  })
  .refine((t) => t.protocol !== 'local' || (!t.host && !t.user && !t.secret), {
    message: 'a local hosting target has no host, user or credentials',
    path: ['protocol'],
  });
export type DeployTarget = z.infer<typeof DeployTargetSchema>;

/** Public view of a deploy target — never includes the encrypted secret. */
export type DeployTargetView = Omit<DeployTarget, 'secret'>;
