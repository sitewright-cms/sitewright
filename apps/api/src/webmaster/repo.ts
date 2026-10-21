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

  /**
   * Applies one save: per service, store (`{secret, info}`) or remove (null); a service left out is untouched.
   * All of it in ONE transaction, and everything sealed before the first write, so a save lands whole or not at all.
   */
  async apply(changes: Partial<Record<WebmasterService, { secret: Record<string, string>; info: Record<string, string> } | null>>, now = new Date()): Promise<void> {
    const entries = Object.entries(changes) as Array<[WebmasterService, { secret: Record<string, string>; info: Record<string, string> } | null]>;
    const key = this.encryptionKey;
    if (!key && entries.some(([, c]) => c !== null)) throw new EncryptionUnavailableError();
    const sealed = entries.map(([service, c]) => [service, c && { secret: encryptSecret(JSON.stringify(c.secret), key!), info: c.info }] as const);
    await this.db.transaction(async (tx) => {
      for (const [service, c] of sealed) {
        if (c === null) await tx.delete(webmasterCredentials).where(eq(webmasterCredentials.service, service));
        else {
          await tx
            .insert(webmasterCredentials)
            .values({ service, secret: c.secret, info: c.info, updatedAt: now })
            .onConflictDoUpdate({ target: webmasterCredentials.service, set: { secret: c.secret, info: c.info, updatedAt: now } });
        }
      }
    });
  }
}
