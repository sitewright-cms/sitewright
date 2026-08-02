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

/**
 * True for a host that cannot have an on-path attacker: the traffic never leaves the machine.
 * Bracketed form included because that is how an IPv6 literal is written in a URL-ish field, and a
 * trailing dot because `localhost.` is the same name in fully-qualified form.
 *
 * ★ The 127/8 arm must match a complete ADDRESS, never a prefix. `127.` is a legal start to an
 * ordinary DNS label, so a "starts with 127." test also accepts `127.evil.com` and
 * `127.0.0.1.evil.com` — registrable names whose owner decides where they point. That would hand
 * the "loopback needs no encryption" exemption to a host on the public internet, which is the exact
 * downgrade this rule exists to prevent. Anything that is not a valid dotted quad is not loopback.
 */
export function isLoopbackSmtpHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  const quad = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!quad) return false;
  const octets = quad.slice(1).map(Number);
  return octets.every((o) => o <= 255) && octets[0] === 127; // all of 127.0.0.0/8
}

/**
 * The nodemailer options every real send is built from. Exported so tests can drive the SAME
 * options a customer's submission does, adding only a CA for the throwaway certificate — a
 * hand-rewritten copy in the test file would drift from this the first time it changed, and the
 * weaker of the two would silently become the guarantee.
 *
 * ★ `requireTLS` is the load-bearing one. With `secure:false` nodemailer's STARTTLS is
 * OPPORTUNISTIC: against a server that does not advertise the capability it carries on in the clear
 * and sends AUTH anyway — so an on-path attacker who strips STARTTLS from the EHLO reply harvests
 * the mailbox password. It is set from the same two rules the exported contact.php client follows,
 * because a customer should not get a weaker guarantee depending on which of our two SMTP clients
 * happens to deliver their mail:
 *
 *   - credentials never travel unencrypted, ANYWHERE — loopback included;
 *   - a message never travels unencrypted to a REMOTE host, but a loopback relay (the classic
 *     `localhost:25` with no auth) has no on-path attacker by construction and still works.
 *
 * `secure: true` is already encrypted before the first byte, so requireTLS is moot there.
 *
 * The timeouts exist so a submission cannot stall the visitor's request for nodemailer's 2-minute
 * default when the SMTP host is unreachable or black-holed.
 */
export function buildTransportOptions(config: TransportConfig): Record<string, unknown> {
  const needsTls = !!config.auth || !isLoopbackSmtpHost(config.host);
  return {
    ...config,
    requireTLS: !config.secure && needsTls,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  };
}

const defaultTransportFactory: TransportFactory = (config) =>
  nodemailer.createTransport(buildTransportOptions(config) as Parameters<typeof nodemailer.createTransport>[0]);

/** Outcome of a connection test: usable, or a reason an operator can act on. */
export interface SmtpVerifyResult {
  ok: boolean;
  /** Present when `ok` is false. Safe to show an admin: no credentials, no resolved IP. */
  error?: string;
}

/**
 * Opens a real session to the configured SMTP and authenticates, WITHOUT sending anything
 * (nodemailer's `verify()` — connect, EHLO, STARTTLS, AUTH, quit).
 *
 * WHY THIS EXISTS: form delivery is best-effort on purpose — the submission is stored and the
 * visitor is thanked whether or not the mail leaves. That is right for the visitor and terrible for
 * the operator, who gets no signal at all that mail stopped; the only trace is a line in the server
 * log. Requiring encryption (see buildTransportOptions) makes a genuinely insecure server fail where
 * it used to "work", so there has to be somewhere the operator can see that, at the moment they are
 * configuring it rather than weeks later when a lead is missing.
 */
export async function verifySmtpConnection(
  config: TransportConfig,
  transportFactory: TransportFactory = defaultTransportFactory,
): Promise<SmtpVerifyResult> {
  const transport = transportFactory(config) as MailTransport & { verify?: () => Promise<unknown> };
  if (!transport.verify) return { ok: false, error: 'this transport cannot be tested' };
  try {
    await transport.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: describeSmtpError(err, config) };
  }
}

/**
 * Turns a nodemailer failure into something an operator can act on.
 *
 * Deliberately does NOT pass the raw message through: it can carry the server's banner and the
 * resolved IP, which is exactly what the form-submission path is careful to keep out of the logs.
 * The mapped cases are the ones a misconfiguration actually produces.
 */
export function describeSmtpError(err: unknown, config: TransportConfig): string {
  const raw = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string } | null)?.code ?? '';
  // `ETLS` is what nodemailer raises when the STARTTLS upgrade cannot be completed — including the
  // case this platform cares most about, a server that never advertised it (we still send the
  // command, and it answers 454/500). Keyed on the CODE rather than the prose: the first version of
  // this matched wording I had invented, and it silently fell through to the generic message.
  if (code === 'ETLS' || /does not support required STARTTLS/i.test(raw)) {
    return (
      `The server at ${config.host}:${config.port} does not offer STARTTLS, so the connection cannot be encrypted. ` +
      'Sitewright will not send credentials or messages over an unencrypted connection to a remote host. ' +
      'Use the provider’s TLS port (usually 587 with STARTTLS, or 465 with “implicit TLS” enabled).'
    );
  }
  if (code === 'EDNS' || /getaddrinfo|ENOTFOUND|EAI_AGAIN/i.test(raw)) {
    return `The host name “${config.host}” could not be resolved. Check it for a typo.`;
  }
  if (code === 'ECONNECTION' || /ECONNREFUSED/i.test(raw)) {
    return `Nothing accepted a connection on ${config.host}:${config.port}. Check the port, and that the server allows connections from this machine.`;
  }
  if (code === 'ETIMEDOUT' || /timed? ?out/i.test(raw)) {
    return `${config.host}:${config.port} did not respond in time — usually a firewall dropping the connection, or the wrong port.`;
  }
  if (code === 'EAUTH' || /invalid login|authentication fail|535/i.test(raw)) {
    return 'The server rejected the username or password.';
  }
  if (/self.signed|certificate|unable to verify|CERT_/i.test(raw)) {
    return `The TLS certificate presented by ${config.host} could not be verified. A self-signed certificate is not accepted.`;
  }
  if (config.secure && /wrong version number|SSL routines|EPROTO/i.test(raw)) {
    return `${config.host}:${config.port} does not speak TLS from the first byte. Turn “implicit TLS” off to use STARTTLS on this port.`;
  }
  return `Could not establish an SMTP session with ${config.host}:${config.port}.`;
}

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
export async function loadProjectSmtp(db: Database, projectId: string): Promise<SmtpStored | null> {
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
