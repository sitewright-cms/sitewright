import { eq } from 'drizzle-orm';
import {
  InstanceSettingsStoredSchema,
  maskInstanceSettings,
  DEFAULT_FORM_MODES,
  type InstanceSettingsInput,
  type InstanceSettingsStored,
  type InstanceSettingsPublic,
  type SmtpStored,
  type HcaptchaStored,
  type StockKeysStored,
} from '@sitewright/schema';
import type { Database } from '../db/client.js';
import { instanceSettings, INSTANCE_SETTINGS_ID } from '../db/schema.js';
import { encryptSecret, decryptSecret } from '../crypto/secret.js';

/** Raised when a secret must be encrypted but no SW_ENCRYPTION_KEY is configured. */
export class EncryptionUnavailableError extends Error {
  constructor(message = 'secret storage is not configured (set SW_ENCRYPTION_KEY)') {
    super(message);
    this.name = 'EncryptionUnavailableError';
  }
}

/**
 * Reads and writes the instance-settings singleton. Secrets (SMTP password,
 * hCaptcha secret) are encrypted at rest with the operator's SW_ENCRYPTION_KEY;
 * the public read view masks them to presence flags. The encryption key is
 * optional: non-secret fields (host, ports, form modes, hCaptcha site key) can be
 * managed without it, but writing a secret without a key fails loudly.
 */
export class InstanceSettingsRepository {
  constructor(
    private readonly db: Database,
    private readonly encryptionKey?: Buffer,
  ) {}

  /** The persisted document (secrets still encrypted), or all-defaults if unset. */
  async getStored(): Promise<InstanceSettingsStored> {
    const [row] = await this.db
      .select()
      .from(instanceSettings)
      .where(eq(instanceSettings.id, INSTANCE_SETTINGS_ID));
    if (!row) return { formModes: { ...DEFAULT_FORM_MODES } };
    return InstanceSettingsStoredSchema.parse(row.data);
  }

  /** The masked read view — never exposes secret material. */
  async getPublic(): Promise<InstanceSettingsPublic> {
    return maskInstanceSettings(await this.getStored());
  }

  /** The enabled web-form mail modes (non-secret; for the project form-mode selector). */
  async getFormModes(): Promise<InstanceSettingsStored['formModes']> {
    return (await this.getStored()).formModes;
  }

  /**
   * Merges `input` onto the current document and persists it. Provided plaintext
   * secrets are encrypted; an omitted secret retains the stored one; a `null`
   * section clears it; an absent (undefined) section is left unchanged.
   */
  async put(input: InstanceSettingsInput): Promise<InstanceSettingsPublic> {
    const current = await this.getStored();
    const next: InstanceSettingsStored = {
      formModes: { ...current.formModes, ...(input.formModes ?? {}) },
    };

    if (input.smtp === null) {
      // cleared — leave next.smtp undefined
    } else if (input.smtp === undefined) {
      if (current.smtp) next.smtp = current.smtp;
    } else {
      const password =
        input.smtp.password !== undefined
          ? this.encrypt(input.smtp.password)
          : current.smtp?.password;
      const smtp: SmtpStored = {
        host: input.smtp.host,
        port: input.smtp.port,
        secure: input.smtp.secure,
        fromEmail: input.smtp.fromEmail,
        ...(input.smtp.user !== undefined ? { user: input.smtp.user } : {}),
        ...(input.smtp.fromName !== undefined ? { fromName: input.smtp.fromName } : {}),
        ...(password !== undefined ? { password } : {}),
      };
      next.smtp = smtp;
    }

    if (input.hcaptcha === null) {
      // cleared
    } else if (input.hcaptcha === undefined) {
      if (current.hcaptcha) next.hcaptcha = current.hcaptcha;
    } else {
      const secret =
        input.hcaptcha.secret !== undefined
          ? this.encrypt(input.hcaptcha.secret)
          : current.hcaptcha?.secret;
      const hcaptcha: HcaptchaStored = {
        siteKey: input.hcaptcha.siteKey,
        ...(secret !== undefined ? { secret } : {}),
      };
      next.hcaptcha = hcaptcha;
    }

    if (input.stock === null) {
      // cleared
    } else if (input.stock === undefined) {
      if (current.stock) next.stock = current.stock;
    } else {
      // Per-provider: a provided key is encrypted; an omitted one retains the stored.
      const unsplash =
        input.stock.unsplash !== undefined ? this.encrypt(input.stock.unsplash) : current.stock?.unsplash;
      const pexels =
        input.stock.pexels !== undefined ? this.encrypt(input.stock.pexels) : current.stock?.pexels;
      const stock: StockKeysStored = {
        ...(unsplash !== undefined ? { unsplash } : {}),
        ...(pexels !== undefined ? { pexels } : {}),
      };
      next.stock = stock;
    }

    // Validate the merged document before persisting (defense in depth).
    const validated = InstanceSettingsStoredSchema.parse(next);
    const now = new Date();
    await this.db
      .insert(instanceSettings)
      .values({ id: INSTANCE_SETTINGS_ID, data: validated, updatedAt: now })
      .onConflictDoUpdate({
        target: instanceSettings.id,
        set: { data: validated, updatedAt: now },
      });
    return maskInstanceSettings(validated);
  }

  /** Decrypted global SMTP password for server-side mail send, or null if unset. */
  async getSmtpPassword(): Promise<string | null> {
    const stored = await this.getStored();
    return stored.smtp?.password ? this.decrypt(stored.smtp.password) : null;
  }

  /** Decrypted hCaptcha secret for server-side verification, or null if unset. */
  async getHcaptchaSecret(): Promise<string | null> {
    const stored = await this.getStored();
    return stored.hcaptcha?.secret ? this.decrypt(stored.hcaptcha.secret) : null;
  }

  /** Decrypted stock-provider API key for server-side search/import, or null if unset. */
  async getStockKey(provider: 'unsplash' | 'pexels'): Promise<string | null> {
    const stored = await this.getStored();
    const enc = provider === 'unsplash' ? stored.stock?.unsplash : stored.stock?.pexels;
    return enc ? this.decrypt(enc) : null;
  }

  private encrypt(plaintext: string): ReturnType<typeof encryptSecret> {
    if (!this.encryptionKey) throw new EncryptionUnavailableError();
    return encryptSecret(plaintext, this.encryptionKey);
  }

  private decrypt(secret: Parameters<typeof decryptSecret>[0]): string {
    if (!this.encryptionKey) throw new EncryptionUnavailableError();
    return decryptSecret(secret, this.encryptionKey);
  }
}
