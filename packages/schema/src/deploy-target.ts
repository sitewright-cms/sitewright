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

/** Encrypted-at-rest secret envelope (AES-256-GCM, base64 fields). */
export const EncryptedSecretSchema = z.object({
  iv: z.string().min(1).max(64),
  ct: z.string().min(1).max(4096),
  tag: z.string().min(1).max(64),
});
export type EncryptedSecret = z.infer<typeof EncryptedSecretSchema>;

/**
 * A saved deploy target (FTP/FTPS/SFTP). The password is stored only as an
 * encrypted `secret`; plaintext credentials are never persisted. This is the
 * stored shape (a `deploy_target` content row); the API never returns `secret`
 * to clients.
 */
export const DeployTargetSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(120),
  protocol: z.enum(['ftp', 'ftps', 'sftp']),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).optional(),
  user: z.string().min(1).max(255),
  remoteDir: z
    .string()
    .min(1)
    .max(1024)
    // Parity with DeployConfigSchema: the stored target feeds the FTP/SFTP transport
    // directly, so reject control chars (command/path injection) AND traversal here.
    .refine((v) => !hasControlChars(v), 'remoteDir must not contain control characters')
    .refine((v) => !v.split('/').some((seg) => seg === '..'), 'remoteDir must not contain ".." segments')
    .default('/'),
  /** SFTP host-key fingerprint (not secret). */
  hostFingerprint: z.string().min(1).max(256).optional(),
  secret: EncryptedSecretSchema,
});
export type DeployTarget = z.infer<typeof DeployTargetSchema>;

/** Public view of a deploy target — never includes the encrypted secret. */
export type DeployTargetView = Omit<DeployTarget, 'secret'>;
