import nodemailer from 'nodemailer';
import type { InstanceSettingsStored } from '@sitewright/schema';

/** A form submission to deliver by email. */
export interface SubmissionMail {
  recipient: string;
  subject: string;
  formName: string;
  fields: Record<string, string>;
  /** Optional Reply-To (the submitter's email), pre-validated by the caller. */
  replyTo?: string;
}

/** Delivers a form submission. Returns false when mail is not configured/enabled. */
export interface SubmissionMailer {
  send(mail: SubmissionMail): Promise<boolean>;
}

/** Minimal transport surface (so tests can inject a fake instead of a live SMTP). */
export interface MailTransport {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
    replyTo?: string;
  }): Promise<unknown>;
}

export interface TransportConfig {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string };
}

export type TransportFactory = (config: TransportConfig) => MailTransport;

const defaultTransportFactory: TransportFactory = (config) => nodemailer.createTransport(config);

/** The instance-settings surface the mailer needs (decoupled from the repo class). */
export interface MailerSettings {
  getStored(): Promise<InstanceSettingsStored>;
  getSmtpPassword(): Promise<string | null>;
}

/**
 * Renders a submission as a readable plain-text email body. Multi-line values
 * (e.g. a textarea) are indented under their key so a value's own newlines can't
 * be mistaken for the next field — and can't fake a `key: value` line.
 */
export function formatSubmissionText(formName: string, fields: Record<string, string>): string {
  const lines = Object.entries(fields).map(([k, v]) => `${k}:\n  ${v.replace(/\n/g, '\n  ')}`);
  return `New submission for "${formName}"\n\n${lines.join('\n\n')}\n`;
}

/**
 * Mode A mailer: sends via the instance's GLOBAL SMTP. Returns false (rather than
 * throwing) when the global-SMTP mode is disabled, no SMTP is configured, or the
 * stored password can't be decrypted (e.g. a rotated key) — the submission is
 * already stored, so a delivery gap must not fail the visitor's request.
 */
export class GlobalSmtpMailer implements SubmissionMailer {
  constructor(
    private readonly settings: MailerSettings,
    private readonly transportFactory: TransportFactory = defaultTransportFactory,
  ) {}

  async send(mail: SubmissionMail): Promise<boolean> {
    const stored = await this.settings.getStored();
    if (!stored.formModes.globalSmtp || !stored.smtp) return false;
    const smtp = stored.smtp;
    let password: string | null;
    try {
      password = await this.settings.getSmtpPassword();
    } catch {
      // Decryption failed (e.g. SW_ENCRYPTION_KEY rotated) — can't authenticate.
      return false;
    }
    const config: TransportConfig = { host: smtp.host, port: smtp.port, secure: smtp.secure };
    if (smtp.user && password) config.auth = { user: smtp.user, pass: password };
    const transport = this.transportFactory(config);
    const from = smtp.fromName ? `${smtp.fromName} <${smtp.fromEmail}>` : smtp.fromEmail;
    await transport.sendMail({
      from,
      to: mail.recipient,
      subject: mail.subject,
      text: formatSubmissionText(mail.formName, mail.fields),
      ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
    });
    return true;
  }
}
