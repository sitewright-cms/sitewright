import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Form, FormModes, SmtpStored } from '@sitewright/schema';
import { decryptSecret } from '../crypto/secret.js';
import { PublishError } from './build.js';
import { hasPhpSmtpForm, renderPhpSmtpConfig, PHP_SMTP_CONFIG_FILE } from './contact-php.js';

/**
 * The deploy protocols a live credential may travel over: a direct file transfer to a host the
 * operator controls. Used as an ALLOWLIST — see the fail-closed check in `writePhpSmtpConfig`.
 *
 * ★ Note the residual on plain FTP: the file is uploaded 0600 over SFTP (an explicit mode on the
 * transfer, see `SftpTransport.putFiles`), but FTP has no permission concept, so there the file
 * lands under the remote umask and its confidentiality rests on the in-file PHP guard and the
 * emitted `.htaccess` deny rule rather than on file mode. Prefer SFTP for this delivery mode.
 */
const CREDENTIAL_SAFE_PROTOCOLS: readonly string[] = ['ftp', 'ftps', 'sftp'];

/**
 * Materializes `sw-mail.config.php` — the ONLY file that ever carries the project's SMTP password
 * in plaintext — into a DEPLOY PAYLOAD.
 *
 * Three deliberate constraints, each of which would be a real leak if relaxed:
 *
 *  1. **Deploy payload only, never the published store.** The persisted site directory is exposed
 *     through `/projects/:id/publish/archive`, a MEMBER-readable zip whose justification is "these
 *     bytes are already public". That reasoning holds for HTML/CSS but not for a credential, so the
 *     file is written into the throwaway build directory a deploy uploads from — which is removed
 *     immediately afterwards — and never into the stored artifact. (Platform-hosted sites don't
 *     execute PHP anyway, so nothing is lost there.)
 *  2. **Never on a git target.** A password in a commit is permanent, replicated to every clone and
 *     often to a public mirror. Refused outright rather than warned about.
 *  3. **Never in the build worker.** The worker runs `--network none` with no secrets by design;
 *     this runs in the main API process, after the build.
 *
 * Fails LOUD (PublishError → 409) rather than shipping a form that silently cannot send: an
 * operator who disabled the mode, a project with no SMTP configured, or an undecryptable password
 * all stop the deploy with an actionable message.
 */
export async function writePhpSmtpConfig(opts: {
  /** The freshly built site directory a deploy will upload from. */
  dir: string;
  /** Every form in the project (only `contactPhpSmtp` ones matter). */
  forms: readonly Form[];
  /** Deploy protocol of the target this payload is destined for. */
  protocol: string;
  /** The instance-wide permitted modes. */
  formModes: FormModes;
  /** The project's stored SMTP config, or null when it has none. */
  smtp: SmtpStored | null;
  /** Instance encryption key — required to decrypt a stored password. */
  encryptionKey?: Buffer;
}): Promise<void> {
  if (!hasPhpSmtpForm(opts.forms)) return;

  if (!opts.formModes.contactPhpSmtp) {
    throw new PublishError(
      'This site has a form set to “contact.php (SMTP)”, but that delivery mode is not enabled for this instance. ' +
        'Ask an administrator to enable it in System Settings → Form delivery, or switch the form to another mode.',
    );
  }
  if (opts.protocol === 'git') {
    throw new PublishError(
      'A form uses “contact.php (SMTP)”, which writes your SMTP password into the deployed files — that must never ' +
        'be committed to a Git repository, where it would persist in the history and in every clone. Deploy this ' +
        'site over SFTP/FTP instead, or switch the form to “contact.php (host mail)” or a platform Email mode.',
    );
  }
  if (!CREDENTIAL_SAFE_PROTOCOLS.includes(opts.protocol)) {
    // Everything past this point writes a live password into the payload, so an unrecognised
    // transport must fail CLOSED. The `=== 'git'` check above stays only because it can say
    // something specific and actionable; on its own it would be a blocklist, and a blocklist lets
    // a protocol added later — or a caller that simply forgets to pass one — ship the credential.
    throw new PublishError(
      `A form uses “contact.php (SMTP)”, which writes your SMTP password into the deployed files. That is only ` +
        `supported for a direct file transfer to a host you control (SFTP or FTP), not for “${opts.protocol || 'unknown'}”. ` +
        'Switch the form to “contact.php (host mail)” or a platform Email mode.',
    );
  }
  if (!opts.smtp) {
    throw new PublishError(
      'A form uses “contact.php (SMTP)”, but this project has no SMTP server configured. Add one in the project’s ' +
        'Email settings, or switch the form to “contact.php (host mail)”.',
    );
  }

  let password: string | undefined;
  if (opts.smtp.password) {
    if (!opts.encryptionKey) {
      throw new PublishError(
        'A form uses “contact.php (SMTP)”, but this server has no encryption key configured, so the stored SMTP ' +
          'password cannot be read. Set SW_ENCRYPTION_KEY, or switch the form to another delivery mode.',
      );
    }
    try {
      password = decryptSecret(opts.smtp.password, opts.encryptionKey);
    } catch {
      // A rotated SW_ENCRYPTION_KEY leaves an undecryptable envelope. Shipping the site anyway would
      // publish a contact form that 500s on every submission.
      throw new PublishError(
        'A form uses “contact.php (SMTP)”, but the stored SMTP password could not be decrypted (the server’s ' +
          'encryption key may have changed). Re-enter the SMTP password in the project’s Email settings.',
      );
    }
  }

  const php = renderPhpSmtpConfig({
    host: opts.smtp.host,
    port: opts.smtp.port,
    secure: opts.smtp.secure,
    ...(opts.smtp.user ? { user: opts.smtp.user } : {}),
    ...(password ? { password } : {}),
    fromEmail: opts.smtp.fromEmail,
    ...(opts.smtp.fromName ? { fromName: opts.smtp.fromName } : {}),
  });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- constant filename under the caller's temp build dir
  await writeFile(join(opts.dir, PHP_SMTP_CONFIG_FILE), php, { encoding: 'utf8', mode: 0o600 });
}
