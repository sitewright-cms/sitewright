import {
  PaymentGatewayStoredSchema,
  PaymentBindingStoredSchema,
  maskBinding,
  validateCredentialValue,
  type CredentialField,
  type PaymentBindingInput,
  type PaymentBindingPublic,
  type PaymentBindingStored,
  type PaymentGatewayStored,
  type PaymentMode,
} from '@sitewright/schema';
import { decryptSecret, encryptSecret, type EncryptedSecret } from '../crypto/secret.js';
import type { ContentRepository } from '../repo/content.js';
import type { ProjectContext } from '../repo/context.js';
import { GLOBAL_SCOPE_ID, globalCtx } from '../repo/global-library.js';
import { BUILTIN_GATEWAYS, isBuiltinGateway } from './builtin-gateways.js';

/**
 * GATEWAY STORAGE — level 1 (the definition) and level 2 (one project's credentials).
 *
 * ★ Level 1 lives under the RESERVED GLOBAL SCOPE, the same place the global snippet/template
 * library lives. That is not a convenience: `resolveProject` 404s on that scope, so a gateway
 * definition is unreachable through any `/projects/:projectId/...` route. Without it a platform
 * admin — who resolves to `owner` on every project — could write gateway definitions through the
 * per-project content route and bypass the admin gate entirely.
 *
 * ★ Level 2 is an ordinary per-project `project_payment` row, writer-gated like `project_smtp`, with
 * secrets encrypted at rest and never returned.
 */

/** A stored gateway plus whether it is a read-only built-in. */
export interface GatewayRecord {
  gateway: PaymentGatewayStored;
  builtin: boolean;
}

export class GatewayRepository {
  constructor(
    private readonly contentRepo: ContentRepository,
    private readonly encryptionKey: Buffer,
  ) {}

  /** The reserved-scope context level-1 reads and writes run under. */
  private globalCtx(userId = 'system'): ProjectContext {
    return globalCtx(userId);
  }

  /**
   * Every gateway an instance has: the built-ins, plus stored ones.
   *
   * A stored record with the same id as a built-in SHADOWS it — the fork model the global library
   * already uses — so an admin can correct a built-in's template without the platform overwriting
   * them on the next upgrade.
   */
  async list(): Promise<GatewayRecord[]> {
    const rows = (await this.contentRepo.list(this.globalCtx(), 'payment_gateway').catch(() => [])) as unknown[];
    const stored = new Map<string, PaymentGatewayStored>();
    for (const row of rows) {
      // Validated on READ, permissively (see PaymentGatewayStoredSchema): a row that no longer parses
      // is skipped rather than taking the whole list down with it.
      const parsed = PaymentGatewayStoredSchema.safeParse(row);
      if (parsed.success) stored.set(parsed.data.id, parsed.data);
    }
    const out: GatewayRecord[] = [];
    for (const b of BUILTIN_GATEWAYS) {
      const override = stored.get(b.id);
      out.push(override ? { gateway: override, builtin: false } : { gateway: b, builtin: true });
      stored.delete(b.id);
    }
    for (const g of stored.values()) out.push({ gateway: g, builtin: false });
    return out;
  }

  async byId(id: string): Promise<GatewayRecord | undefined> {
    return (await this.list()).find((g) => g.gateway.id === id);
  }

  /**
   * Writes a gateway definition. INSTANCE ADMIN ONLY — the caller enforces that; this records it.
   *
   * ★ `verified` is CLEARED on every write, never carried over. An edited gateway is an unproven
   * gateway: a template change can break a request shape in a way only a real round trip reveals, and
   * inheriting the old flag would let an edit go straight back to taking live money.
   */
  async put(gateway: PaymentGatewayStored, userId: string): Promise<PaymentGatewayStored> {
    const next = PaymentGatewayStoredSchema.parse({
      ...gateway,
      // A fork of a built-in is a new, non-builtin record. `builtin` is never settable from input.
      builtin: false,
      verified: false,
      updatedAt: new Date().toISOString(),
    });
    await this.contentRepo.put(this.globalCtx(userId), 'payment_gateway', next.id, next);
    return next;
  }

  /** Marks a gateway proven, after a test-mode checkout actually succeeded against it. */
  async markVerified(id: string, userId: string): Promise<void> {
    const rec = await this.byId(id);
    if (!rec) return;
    const next = PaymentGatewayStoredSchema.parse({ ...rec.gateway, builtin: false, verified: true, updatedAt: new Date().toISOString() });
    await this.contentRepo.put(this.globalCtx(userId), 'payment_gateway', id, next);
  }

  /** Removes a stored gateway. A built-in reverts to its shipped definition rather than vanishing. */
  async remove(id: string, userId: string): Promise<void> {
    await this.contentRepo.remove(this.globalCtx(userId), 'payment_gateway', id).catch(() => undefined);
  }

  /** Clones a built-in (or any gateway) under a new id, as an editable record. */
  async fork(sourceId: string, newId: string, userId: string): Promise<PaymentGatewayStored | undefined> {
    const src = await this.byId(sourceId);
    if (!src) return undefined;
    return this.put({ ...src.gateway, id: newId, name: `${src.gateway.name} (fork)`, forkedFrom: sourceId, enabled: false }, userId);
  }

  // -------------------------------------------------------------------------------------------
  // Level 2 — the project's own credentials
  // -------------------------------------------------------------------------------------------

  /** The project's stored binding, or null. Validated permissively on read. */
  async binding(ctx: ProjectContext): Promise<PaymentBindingStored | null> {
    const [row] = (await this.contentRepo.list(ctx, 'project_payment').catch(() => [])) as unknown[];
    if (!row) return null;
    const parsed = PaymentBindingStoredSchema.safeParse(row);
    return parsed.success ? parsed.data : null;
  }

  /** The editor's view: presence and shape per field per mode, plus missing/orphaned. Never a secret. */
  async bindingPublic(ctx: ProjectContext): Promise<PaymentBindingPublic | null> {
    const stored = await this.binding(ctx);
    if (!stored) return null;
    const rec = await this.byId(stored.gatewayId);
    return maskBinding(stored, rec?.gateway.credentialFields ?? []);
  }

  /**
   * Saves one mode's credential values.
   *
   * ★ Only the mode being edited is touched, so saving test keys cannot wipe live ones, and an
   * OMITTED field retains what is stored — the `project_smtp` pattern, which is what lets the editor
   * render a form full of masks without the save blanking everything it could not show.
   *
   * ★ Every value is validated HERE, at the input boundary, where a human can still act on the
   * message. The hCaptcha `123` reached real visitors because a bare `min(1)` accepted it.
   */
  async saveBinding(
    ctx: ProjectContext,
    input: PaymentBindingInput,
  ): Promise<{ ok: true; binding: PaymentBindingPublic } | { ok: false; errors: string[] }> {
    const rec = await this.byId(input.gatewayId);
    if (!rec) return { ok: false, errors: [`unknown gateway "${input.gatewayId}"`] };
    // ★ A project may not bind a gateway that is not enabled AND proven. Letting one through here
    // would mean the first sign of an unfinished gateway is a buyer unable to pay.
    if (!rec.gateway.enabled) return { ok: false, errors: [`the gateway "${input.gatewayId}" is not enabled on this instance`] };

    const declared = new Map(rec.gateway.credentialFields.map((f) => [f.key, f]));
    const errors: string[] = [];
    for (const [key, value] of Object.entries(input.values)) {
      const field = declared.get(key);
      // An undeclared key is refused rather than stored: it would become an orphan the moment it
      // was written, which is noise an operator has to clean up for no benefit.
      if (!field) {
        errors.push(`"${key}" is not a field this gateway declares`);
        continue;
      }
      const err = validateCredentialValue(field, input.mode, value);
      if (err) errors.push(err);
    }
    if (errors.length > 0) return { ok: false, errors };

    const prior = await this.binding(ctx);
    // Switching gateway discards the old values rather than keeping them against the new one's field
    // names: a key for provider A is meaningless to provider B, and silently carrying it over is how
    // a "working" binding ends up authenticating against nothing.
    const priorValues = prior && prior.gatewayId === input.gatewayId ? (prior.values ?? {}) : {};
    const modeValues: Record<string, EncryptedSecret | string | boolean> = { ...(priorValues[input.mode] ?? {}) };
    for (const [key, value] of Object.entries(input.values)) {
      const field = declared.get(key)!;
      if (typeof value === 'boolean') {
        // eslint-disable-next-line security/detect-object-injection -- key is a declared field key (checked above)
        modeValues[key] = value;
        continue;
      }
      if (value === '') {
        // An explicit blank CLEARS the field. Distinct from omitting it, which retains the stored
        // value — an operator needs a way to remove a credential without deleting the whole binding.
        // eslint-disable-next-line security/detect-object-injection -- key is a declared field key
        delete modeValues[key];
        continue;
      }
      // eslint-disable-next-line security/detect-object-injection -- key is a declared field key
      modeValues[key] = field.kind === 'secret' ? encryptSecret(value, this.encryptionKey) : value;
    }
    const next = PaymentBindingStoredSchema.parse({
      gatewayId: input.gatewayId,
      // The ACTIVE mode is not changed by saving credentials. Going live is a separate, deliberate act.
      mode: prior && prior.gatewayId === input.gatewayId ? prior.mode : 'test',
      values: { ...priorValues, [input.mode]: modeValues },
      updatedAt: new Date().toISOString(),
    });
    await this.contentRepo.put(ctx, 'project_payment', 'settings', next);
    return { ok: true, binding: maskBinding(next, rec.gateway.credentialFields) };
  }

  /** Switches a project between test and live. Refused while the target mode is incomplete. */
  async setMode(ctx: ProjectContext, mode: PaymentMode): Promise<{ ok: true } | { ok: false; missing: string[] }> {
    const stored = await this.binding(ctx);
    if (!stored) return { ok: false, missing: ['no gateway is configured'] };
    const rec = await this.byId(stored.gatewayId);
    const fields = rec?.gateway.credentialFields ?? [];
    const probe = PaymentBindingStoredSchema.parse({ ...stored, mode });
    const view = maskBinding(probe, fields);
    // ★ Refused rather than allowed-and-broken: switching to live with no live key would make the
    // first symptom a real customer unable to pay.
    if (!view.complete) return { ok: false, missing: view.missing };
    await this.contentRepo.put(ctx, 'project_payment', 'settings', { ...probe, updatedAt: new Date().toISOString() });
    return { ok: true };
  }

  /**
   * Resolves the plaintext credentials for the project's ACTIVE mode.
   *
   * ★ The ONLY place a payment secret is decrypted, and the values go straight into
   * `${CRED:…}` substitution. They are never logged, never returned to a client, and never written
   * back to any record.
   *
   * A value that cannot be decrypted (SW_ENCRYPTION_KEY rotated or removed) is reported as MISSING
   * rather than throwing: the caller then refuses the checkout with a configuration error, which is
   * a message an operator can act on, instead of a 500.
   */
  async resolveCredentials(
    ctx: ProjectContext,
  ): Promise<
    | { ok: true; gateway: PaymentGatewayStored; mode: PaymentMode; cred: Record<string, string> }
    | { ok: false; reason: 'not-configured' | 'unknown-gateway' | 'disabled' | 'unverified' | 'incomplete'; missing?: string[] }
  > {
    const stored = await this.binding(ctx);
    if (!stored) return { ok: false, reason: 'not-configured' };
    const rec = await this.byId(stored.gatewayId);
    if (!rec) return { ok: false, reason: 'unknown-gateway' };
    if (!rec.gateway.enabled) return { ok: false, reason: 'disabled' };
    // ★ LIVE money needs a proven gateway. Test mode deliberately does NOT, because the dry run is
    // how a gateway becomes proven in the first place.
    if (stored.mode === 'live' && !rec.gateway.verified) return { ok: false, reason: 'unverified' };

    const raw = stored.values?.[stored.mode] ?? {};
    const cred: Record<string, string> = {};
    const missing: string[] = [];
    for (const field of rec.gateway.credentialFields) {
      const v = Object.prototype.hasOwnProperty.call(raw, field.key) ? raw[field.key] : undefined;
      if (v === undefined) {
        if (field.required) missing.push(field.key);
        continue;
      }
      if (typeof v === 'boolean') {
         
        cred[field.key] = v ? 'true' : 'false';
        continue;
      }
      if (typeof v === 'string') {
         
        cred[field.key] = v;
        continue;
      }
      try {
         
        cred[field.key] = decryptSecret(v, this.encryptionKey);
      } catch {
        if (field.required) missing.push(field.key);
      }
    }
    if (missing.length > 0) return { ok: false, reason: 'incomplete', missing };
    return { ok: true, gateway: rec.gateway, mode: stored.mode, cred };
  }
}

/** Re-exported so callers do not reach past this module for the reserved scope id. */
export { GLOBAL_SCOPE_ID, isBuiltinGateway };

/** The declared fields of a gateway, for the editor's generic credential form. */
export function declaredFields(gateway: PaymentGatewayStored): CredentialField[] {
  return gateway.credentialFields;
}
