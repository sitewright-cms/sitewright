import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { makeTestDb } from './helpers.js';
import { ProjectSmtpMailer, type MailTransport, type SubmissionMail } from '../src/mail/mailer.js';
import { encryptSecret } from '../src/crypto/secret.js';
import { organizations, projects, content } from '../src/db/schema.js';
import type { Database } from '../src/db/client.js';
import type { InstanceSettingsStored, SmtpStored } from '@sitewright/schema';

const KEY = randomBytes(32);
const userSmtpOn: InstanceSettingsStored = { formModes: { globalSmtp: false, userSmtp: true, contactPhp: false, thirdParty: false } };

let db: Database;
let projectId: string;

async function seedProjectSmtp(smtp: SmtpStored) {
  const now = new Date();
  await db.insert(content).values({ id: randomUUID(), projectId, kind: 'project_smtp', entityId: 'smtp', data: smtp, createdAt: now, updatedAt: now });
}

function recordingTransport() {
  const sent: Array<Record<string, unknown>> = [];
  const factory = () => ({ sendMail: async (m: Record<string, unknown>) => { sent.push(m); return {}; } }) as MailTransport;
  return { sent, factory };
}

const mail: SubmissionMail = { recipient: 'sales@acme.com', subject: 'New lead', formName: 'Contact', fields: { email: 'a@b.co' } };

beforeEach(async () => {
  db = await makeTestDb();
  projectId = randomUUID();
  const now = new Date();
  const orgId = randomUUID();
  await db.insert(organizations).values({ id: orgId, name: 'O', slug: `o-${projectId.slice(0, 8)}`, createdAt: now });
  await db.insert(projects).values({ id: projectId, orgId, name: 'P', slug: 'p', createdAt: now });
});

describe('ProjectSmtpMailer', () => {
  it('sends via the project SMTP, decrypting the stored password', async () => {
    await seedProjectSmtp({ host: 'smtp.proj.com', port: 587, secure: false, user: 'u', fromName: 'Proj', fromEmail: 'no-reply@proj.com', password: encryptSecret('proj-pw', KEY) });
    const { sent, factory } = recordingTransport();
    const mailer = new ProjectSmtpMailer(db, { getStored: async () => userSmtpOn }, KEY, factory);
    expect(await mailer.send(projectId, mail)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'sales@acme.com', from: { name: 'Proj', address: 'no-reply@proj.com' } });
  });

  it('returns false when the userSmtp mode is disabled instance-wide', async () => {
    await seedProjectSmtp({ host: 'h', port: 25, secure: false, fromEmail: 'a@b.co' });
    const { sent, factory } = recordingTransport();
    const off: InstanceSettingsStored = { formModes: { globalSmtp: false, userSmtp: false, contactPhp: false, thirdParty: false } };
    const mailer = new ProjectSmtpMailer(db, { getStored: async () => off }, KEY, factory);
    expect(await mailer.send(projectId, mail)).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('returns false when the project has no SMTP configured', async () => {
    const { factory } = recordingTransport();
    const mailer = new ProjectSmtpMailer(db, { getStored: async () => userSmtpOn }, KEY, factory);
    expect(await mailer.send(projectId, mail)).toBe(false);
  });

  it('returns false (not throw) when the password cannot be decrypted (wrong key)', async () => {
    await seedProjectSmtp({ host: 'h', port: 25, secure: false, user: 'u', fromEmail: 'a@b.co', password: encryptSecret('pw', KEY) });
    const { sent, factory } = recordingTransport();
    const mailer = new ProjectSmtpMailer(db, { getStored: async () => userSmtpOn }, randomBytes(32), factory); // different key
    expect(await mailer.send(projectId, mail)).toBe(false);
    expect(sent).toHaveLength(0);
  });
});
