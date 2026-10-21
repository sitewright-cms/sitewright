import { eq } from 'drizzle-orm';
import type { WebmasterService } from '@sitewright/schema';
import type { Database } from '../db/client.js';
import { webmasterCredentials } from '../db/schema.js';
import { decryptSecret, encryptSecret } from '../crypto/secret.js';
import { EncryptionUnavailableError } from '../repo/instance-settings.js';

export interface WebmasterAccountRow {
  service: WebmasterService;
  /** What the admin view may show; never a secret. */
  info: Record<string, string>;
  updatedAt: Date;
}

/** The platform's search engine accounts: the secret encrypted at rest, beside what may be shown of it. */
export class WebmasterRepository {
  constructor(
    private readonly db: Database,
    private readonly encryptionKey?: Buffer,
  ) {}

  /** Every stored account, without decrypting anything. */
  async list(): Promise<WebmasterAccountRow[]> {
    const rows = await this.db
      .select({ service: webmasterCredentials.service, info: webmasterCredentials.info, updatedAt: webmasterCredentials.updatedAt })
      .from(webmasterCredentials);
    return rows.map((r) => ({ service: r.service as WebmasterService, info: r.info, updatedAt: r.updatedAt }));
  }

  /** The decrypted secret fields, or null when none are stored. */
  async getSecret(service: WebmasterService): Promise<Record<string, string> | null> {
    const [row] = await this.db.select({ secret: webmasterCredentials.secret }).from(webmasterCredentials).where(eq(webmasterCredentials.service, service));
    if (!row) return null;
    if (!this.encryptionKey) throw new EncryptionUnavailableError();
    const parsed = JSON.parse(decryptSecret(row.secret, this.encryptionKey)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'));
  }

  async put(service: WebmasterService, secret: Record<string, string>, info: Record<string, string>, now = new Date()): Promise<void> {
    if (!this.encryptionKey) throw new EncryptionUnavailableError();
    const sealed = encryptSecret(JSON.stringify(secret), this.encryptionKey);
    await this.db
      .insert(webmasterCredentials)
      .values({ service, secret: sealed, info, updatedAt: now })
      .onConflictDoUpdate({ target: webmasterCredentials.service, set: { secret: sealed, info, updatedAt: now } });
  }

  async remove(service: WebmasterService): Promise<void> {
    await this.db.delete(webmasterCredentials).where(eq(webmasterCredentials.service, service));
  }
}
