import nodemailer from 'nodemailer';
import { and, eq } from 'drizzle-orm';
import { SmtpStoredSchema, type InstanceSettingsStored, type SmtpStored } from '@sitewright/schema';
import { decryptSecret } from '../crypto/secret.js';
import { content, PROJECT_SMTP_ENTITY_ID } from '../db/schema.js';
import type { Database } from '../db/client.js';

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
    from: string | { name: string; address: string };
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

// Fail fast: a userSmtp/global form submission must not stall the request for
// nodemailer's 2-minute default when the SMTP host is unreachable/black-holed.
const defaultTransportFactory: TransportFactory = (config) =>
  nodemailer.createTransport({ ...config, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 });

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

/** Builds a transport from an SMTP config + decrypted password and sends the mail. */
async function sendViaSmtp(
  smtp: SmtpStored,
  password: string | null,
  mail: SubmissionMail,
  transportFactory: TransportFactory,
): Promise<void> {
  const config: TransportConfig = { host: smtp.host, port: smtp.port, secure: smtp.secure };
  if (smtp.user && password) config.auth = { user: smtp.user, pass: password };
  const transport = transportFactory(config);
  // Structured form so nodemailer encodes the display name (a fromName with special
  // chars like <>" cannot break the From header).
  const from = smtp.fromName ? { name: smtp.fromName, address: smtp.fromEmail } : smtp.fromEmail;
  await transport.sendMail({
    from,
    to: mail.recipient,
    subject: mail.subject,
    text: formatSubmissionText(mail.formName, mail.fields),
    ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
  });
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
    let password: string | null;
    try {
      password = await this.settings.getSmtpPassword();
    } catch {
      // Decryption failed (e.g. SW_ENCRYPTION_KEY rotated) — can't authenticate.
      return false;
    }
    await sendViaSmtp(stored.smtp, password, mail, this.transportFactory);
    return true;
  }
}

/** Delivers a submission via a PROJECT's own SMTP (Mode B / `userSmtp`). */
export interface ProjectMailer {
  send(projectId: string, mail: SubmissionMail): Promise<boolean>;
}

/** Reads a project's stored SMTP config (server-side, no tenant context), or null. */
async function loadProjectSmtp(db: Database, projectId: string): Promise<SmtpStored | null> {
  const [row] = await db
    .select()
    .from(content)
    .where(and(eq(content.projectId, projectId), eq(content.kind, 'project_smtp'), eq(content.entityId, PROJECT_SMTP_ENTITY_ID)));
  if (!row) return null;
  const parsed = SmtpStoredSchema.safeParse(row.data);
  return parsed.success ? parsed.data : null;
}

/**
 * Mode B (`userSmtp`) mailer: sends via the PROJECT's own SMTP. Returns false when
 * the userSmtp mode is disabled instance-wide, the project has no SMTP configured,
 * or the password can't be decrypted — fail-soft, like the global mailer.
 */
export class ProjectSmtpMailer implements ProjectMailer {
  constructor(
    private readonly db: Database,
    private readonly settings: Pick<MailerSettings, 'getStored'>,
    private readonly encryptionKey: Buffer | undefined,
    private readonly transportFactory: TransportFactory = defaultTransportFactory,
  ) {}

  async send(projectId: string, mail: SubmissionMail): Promise<boolean> {
    const stored = await this.settings.getStored();
    if (!stored.formModes.userSmtp) return false;
    const smtp = await loadProjectSmtp(this.db, projectId);
    if (!smtp) return false;
    let password: string | null = null;
    if (smtp.password) {
      if (!this.encryptionKey) return false;
      try {
        password = decryptSecret(smtp.password, this.encryptionKey);
      } catch {
        return false;
      }
    }
    await sendViaSmtp(smtp, password, mail, this.transportFactory);
    return true;
  }
}
