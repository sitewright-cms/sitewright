import { eq } from 'drizzle-orm';
import {
  InstanceSettingsStoredSchema,
  maskInstanceSettings,
  DEFAULT_AGENT_INSTRUCTIONS,
  DEFAULT_AGENT_SESSION_HOURS,
  DEFAULT_REVISION_COALESCE_MS,
  DEFAULT_REVISION_RETENTION_DAYS,
  DEFAULT_FORM_MODES,
  DEFAULT_PLATFORM_NAME,
  type InstanceSettingsInput,
  type InstanceSettingsStored,
  type InstanceSettingsPublic,
  type SmtpStored,
  type HcaptchaStored,
  type StockKeysStored,
  type OidcProviderStored,
  type PlatformLogo,
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

/** Apply the merge semantics for a NON-secret optional field: `null` clears, `undefined` keeps, value sets. */
function mergeNullable<T>(input: T | null | undefined, current: T | undefined, set: (v: T) => void): void {
  if (input === null) return; // cleared → leave unset (read falls back to the default)
  if (input === undefined) {
    if (current !== undefined) set(current);
  } else {
    set(input);
  }
}

/** Raised when an OIDC provider config is internally inconsistent (e.g. PKCE off on a public client). */
export class InvalidOidcConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOidcConfigError';
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

  /** The agent (MCP) instructions actually served to bridges — the admin override or the default. */
  async getEffectiveAgentInstructions(): Promise<string> {
    return (await this.getStored()).agentInstructions ?? DEFAULT_AGENT_INSTRUCTIONS;
  }

  /** The absolute agent-session (OAuth refresh) cap in ms — the admin setting or the 8h default. */
  async getAgentSessionMs(): Promise<number> {
    return ((await this.getStored()).agentSessionHours ?? DEFAULT_AGENT_SESSION_HOURS) * 60 * 60 * 1000;
  }

  /** The effective revision-history policy (admin settings or the built-in defaults) — read by the
   *  RevisionsRepository on each record/sweep so an admin change takes effect without a restart. */
  async getRevisionPolicy(): Promise<{ coalesceWindowMs: number; retentionDays: number }> {
    const s = await this.getStored();
    return {
      coalesceWindowMs: s.revisionCoalesceMs ?? DEFAULT_REVISION_COALESCE_MS,
      retentionDays: s.revisionRetentionDays ?? DEFAULT_REVISION_RETENTION_DAYS,
    };
  }

  /** The configured platform name, or the built-in default — for TOTP/passkey prompts + the chrome. */
  async getPlatformName(): Promise<string> {
    return (await this.getStored()).platformName ?? DEFAULT_PLATFORM_NAME;
  }

  /** The uploaded logo (mime + base64), or null — for the `GET /branding/logo` serving route. */
  async getLogo(): Promise<PlatformLogo | null> {
    return (await this.getStored()).platformLogo ?? null;
  }

  /**
   * The stored document AND the row's last-modified time (ms) from a SINGLE read — so a caller that
   * needs both (e.g. `/auth/config`, which derives the cache-busted logo URL) sees one consistent
   * snapshot. `updatedAtMs` is 0 when the row has never been written.
   */
  async getStoredWithUpdatedAt(): Promise<{ stored: InstanceSettingsStored; updatedAtMs: number }> {
    const [row] = await this.db
      .select()
      .from(instanceSettings)
      .where(eq(instanceSettings.id, INSTANCE_SETTINGS_ID));
    if (!row) return { stored: { formModes: { ...DEFAULT_FORM_MODES } }, updatedAtMs: 0 };
    return { stored: InstanceSettingsStoredSchema.parse(row.data), updatedAtMs: row.updatedAt.getTime() };
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

    // Agent instructions: a string sets the override, `null` clears it (revert to default),
    // and undefined keeps whatever was stored.
    if (input.agentInstructions === null) {
      // cleared — leave next.agentInstructions undefined
    } else if (input.agentInstructions === undefined) {
      if (current.agentInstructions !== undefined) next.agentInstructions = current.agentInstructions;
    } else {
      next.agentInstructions = input.agentInstructions;
    }

    // Agent session cap (hours): a number sets it, `null` reverts to the 8h default, undefined keeps.
    if (input.agentSessionHours === null) {
      // cleared — leave next.agentSessionHours undefined (→ default at read time)
    } else if (input.agentSessionHours === undefined) {
      if (current.agentSessionHours !== undefined) next.agentSessionHours = current.agentSessionHours;
    } else {
      next.agentSessionHours = input.agentSessionHours;
    }

    // Revision coalesce window (ms): a number sets it, `null` reverts to the 0 default, undefined keeps.
    if (input.revisionCoalesceMs === null) {
      // cleared — undefined → default at read time
    } else if (input.revisionCoalesceMs === undefined) {
      if (current.revisionCoalesceMs !== undefined) next.revisionCoalesceMs = current.revisionCoalesceMs;
    } else {
      next.revisionCoalesceMs = input.revisionCoalesceMs;
    }

    // Revision retention (days): a number sets it, `null` reverts to the 90-day default, undefined keeps.
    if (input.revisionRetentionDays === null) {
      // cleared — undefined → default at read time
    } else if (input.revisionRetentionDays === undefined) {
      if (current.revisionRetentionDays !== undefined) next.revisionRetentionDays = current.revisionRetentionDays;
    } else {
      next.revisionRetentionDays = input.revisionRetentionDays;
    }

    // Default locale for new projects: a tag sets it, `null` reverts to `en`, undefined keeps.
    if (input.defaultLocale === null) {
      // cleared — leave next.defaultLocale undefined (→ `en` at project creation)
    } else if (input.defaultLocale === undefined) {
      if (current.defaultLocale !== undefined) next.defaultLocale = current.defaultLocale;
    } else {
      next.defaultLocale = input.defaultLocale;
    }

    // OIDC providers: an array REPLACES the whole set; a provider's omitted secret is preserved by
    // matching id against the current set; `null` clears all; undefined leaves the set unchanged.
    if (input.oidcProviders === null) {
      // cleared
    } else if (input.oidcProviders === undefined) {
      if (current.oidcProviders) next.oidcProviders = current.oidcProviders;
    } else {
      const byId = new Map((current.oidcProviders ?? []).map((p) => [p.id, p]));
      next.oidcProviders = input.oidcProviders.map((p): OidcProviderStored => {
        const clientSecret = p.clientSecret !== undefined ? this.encrypt(p.clientSecret) : byId.get(p.id)?.clientSecret;
        // PKCE is the ONLY code-theft protection for a public client (no secret). Refuse to disable it
        // unless the client is confidential — checked here, where the effective (possibly preserved) secret
        // is known, rather than in the schema (which can't see an already-stored secret).
        if (!p.usePkce && clientSecret === undefined) {
          throw new InvalidOidcConfigError(`OIDC provider "${p.id}": PKCE can only be disabled for a confidential client (a client secret is required).`);
        }
        return {
          id: p.id,
          label: p.label,
          issuer: p.issuer,
          clientId: p.clientId,
          scopes: p.scopes && p.scopes.length > 0 ? p.scopes : ['openid', 'profile', 'email'],
          enabled: p.enabled,
          autoRegister: p.autoRegister,
          usePkce: p.usePkce,
          ...(clientSecret !== undefined ? { clientSecret } : {}),
        };
      });
    }

    // Self-registration: a boolean sets it; undefined keeps the stored value (which may itself be
    // undefined → the route falls back to the deploy-time factory default).
    const allowSelfRegistration = input.allowSelfRegistration ?? current.allowSelfRegistration;
    if (allowSelfRegistration !== undefined) next.allowSelfRegistration = allowSelfRegistration;

    // Branding (non-secret): a value sets it, `null` clears it (revert to default), undefined keeps.
    // Same null/undefined/value pattern as agentInstructions; nothing here is encrypted.
    mergeNullable(input.platformName, current.platformName, (v) => { next.platformName = v; });
    mergeNullable(input.brandPrimary, current.brandPrimary, (v) => { next.brandPrimary = v; });
    mergeNullable(input.brandSecondary, current.brandSecondary, (v) => { next.brandSecondary = v; });
    mergeNullable(input.platformLogo, current.platformLogo, (v) => { next.platformLogo = v; });

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

  /** Enabled OIDC providers for the unauthenticated login screen (id + label only, no secrets). */
  async listEnabledOidcProviders(): Promise<{ id: string; label: string }[]> {
    const stored = await this.getStored();
    return (stored.oidcProviders ?? []).filter((p) => p.enabled).map((p) => ({ id: p.id, label: p.label }));
  }

  /**
   * A decrypted, ENABLED OIDC provider by id for the login flow (clientSecret decrypted, or undefined
   * for a public/PKCE-only client). Null if no such enabled provider.
   */
  async getEnabledOidcProvider(
    id: string,
  ): Promise<{
    id: string;
    label: string;
    issuer: string;
    clientId: string;
    clientSecret?: string;
    scopes: string[];
    autoRegister: boolean;
    usePkce: boolean;
  } | null> {
    const stored = await this.getStored();
    const p = stored.oidcProviders?.find((x) => x.id === id && x.enabled);
    if (!p) return null;
    return {
      id: p.id,
      label: p.label,
      issuer: p.issuer,
      clientId: p.clientId,
      scopes: p.scopes,
      autoRegister: p.autoRegister,
      usePkce: p.usePkce,
      ...(p.clientSecret ? { clientSecret: this.decrypt(p.clientSecret) } : {}),
    };
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
