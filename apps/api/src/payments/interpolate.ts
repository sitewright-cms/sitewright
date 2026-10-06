/**
 * Request-template interpolation for a stored gateway — and the boundary that keeps a gateway
 * definition from being a credential store.
 *
 * ★ `${CRED:key}` is substituted HERE, in the host, at request time. A stored gateway therefore never
 * holds, sees or returns a secret: an admin (or an agent) authoring one writes a placeholder, so the
 * editable body of the record is safe to read, diff, export and show in a UI.
 *
 * ★ The variable set is CLOSED. An unknown `${…}` token is an error, not an empty string — a typo in
 * a template would otherwise send a provider a request with a field silently blanked, and the most
 * likely field to blank is the amount.
 */

/** Everything a template may reference. Nothing outside this object is reachable. */
export interface InterpolationScope {
  /** Resolved credential values for the ACTIVE mode. Substituted but never logged. */
  cred: Readonly<Record<string, string>>;
  /** Amounts, already authoritative. `minor` is the integer the provider should charge. */
  amount: { minor: number; decimal: string; currency: string };
  /** Identity of the transaction being paid for. */
  txn: { id: string; publicToken: string; reference: string };
  /** Absolute URLs the HOST built — never anything the gateway chose. */
  url: { return: string; cancel: string; webhook: string };
  /** The buyer's submitted fields, by name. An absent key interpolates to ''. */
  field: Readonly<Record<string, string>>;
  /** Free-text order summary, pre-truncated by the caller. */
  text: Readonly<Record<string, string>>;
}

/** A template referenced something the scope does not define. */
export class InterpolationError extends Error {}

const TOKEN = /\$\{([A-Z]+):([A-Za-z0-9_.-]{1,64})\}/g;

/** Resolves one `${NS:key}`. Throws for an unknown namespace or a missing required value. */
function resolveToken(scope: InterpolationScope, ns: string, key: string): string {
  switch (ns) {
    case 'CRED': {
      // eslint-disable-next-line security/detect-object-injection -- own-property checked; scope.cred is a flat string map built by the host
      const v = Object.prototype.hasOwnProperty.call(scope.cred, key) ? scope.cred[key] : undefined;
      // A missing credential must NOT become an empty header. An unauthenticated request to a payment
      // provider is at best a confusing 401 and at worst an anonymous call that half-succeeds.
      if (v === undefined || v === '') throw new InterpolationError(`the credential "${key}" has no value for this mode`);
      return v;
    }
    case 'AMOUNT':
      if (key === 'minor') return String(scope.amount.minor);
      if (key === 'decimal') return scope.amount.decimal;
      if (key === 'currency') return scope.amount.currency;
      if (key === 'currency_lower') return scope.amount.currency.toLowerCase();
      throw new InterpolationError(`unknown amount field "${key}"`);
    case 'TXN':
      if (key === 'id') return scope.txn.id;
      if (key === 'token') return scope.txn.publicToken;
      if (key === 'reference') return scope.txn.reference;
      throw new InterpolationError(`unknown transaction field "${key}"`);
    case 'URL':
      if (key === 'return') return scope.url.return;
      if (key === 'cancel') return scope.url.cancel;
      if (key === 'webhook') return scope.url.webhook;
      throw new InterpolationError(`unknown url field "${key}"`);
    case 'FIELD':
      // A buyer field IS allowed to be absent — an optional input the buyer left blank.
      // eslint-disable-next-line security/detect-object-injection -- own-property checked; scope.field is a flat string map of submitted values
      return Object.prototype.hasOwnProperty.call(scope.field, key) ? (scope.field[key] ?? '') : '';
    case 'TEXT':
      // eslint-disable-next-line security/detect-object-injection -- own-property checked; scope.text is a flat string map built by the host
      return Object.prototype.hasOwnProperty.call(scope.text, key) ? (scope.text[key] ?? '') : '';
    default:
      throw new InterpolationError(`unknown template namespace "${ns}"`);
  }
}

/**
 * Interpolates a single string.
 *
 * A token that is the whole string still yields a string; numeric coercion is opt-in via the `#`
 * form in {@link interpolateValue}, so a provider field that must be a JSON number does not
 * accidentally become one everywhere.
 */
export function interpolateString(template: string, scope: InterpolationScope): string {
  return template.replace(TOKEN, (_m, ns: string, key: string) => resolveToken(scope, ns, key));
}

/**
 * Interpolates a whole JSON body.
 *
 * `${#AMOUNT:minor}` — a leading `#` on a token that is the entire string — yields a JSON NUMBER.
 * Providers differ on whether an amount is a number or a string, and a template must be able to say
 * which without the host guessing from the field name.
 */
export function interpolateValue(value: unknown, scope: InterpolationScope, depth = 0): unknown {
  // Bounds a maliciously or accidentally deep body; the schema stores arbitrary JSON.
  if (depth > 12) throw new InterpolationError('the request body is nested too deeply');
  if (typeof value === 'string') {
    const numeric = /^\$\{#([A-Z]+):([A-Za-z0-9_.-]{1,64})\}$/.exec(value);
    if (numeric) {
      const raw = resolveToken(scope, numeric[1]!, numeric[2]!);
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new InterpolationError(`"${value}" did not resolve to a number`);
      return n;
    }
    return interpolateString(value, scope);
  }
  if (Array.isArray(value)) return value.map((v) => interpolateValue(v, scope, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Keys are interpolated too (a provider wanting `metadata[<id>]`), but never allowed to
      // introduce a prototype key.
      const key = interpolateString(k, scope);
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      // eslint-disable-next-line security/detect-object-injection -- prototype keys excluded above; `out` is a fresh literal
      out[key] = interpolateValue(v, scope, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Reads a dotted/bracketed path out of a provider response.
 *
 * Deliberately tiny and prototype-safe rather than a JSONPath dependency: the schema already bounds
 * the path's characters and length, and all this needs to do is walk plain JSON.
 */
export function readPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const rawPart of path.split('.')) {
    for (const part of rawPart.split('[').map((p, i) => (i === 0 ? p : p.replace(/\]$/, '')))) {
      if (part === '') continue;
      if (part === '__proto__' || part === 'constructor' || part === 'prototype') return undefined;
      if (cur === null || cur === undefined) return undefined;
      if (Array.isArray(cur)) {
        if (!/^\d+$/.test(part)) return undefined;
        cur = cur[Number(part)];
        continue;
      }
      if (typeof cur !== 'object') return undefined;
      if (!Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
      // eslint-disable-next-line security/detect-object-injection -- prototype keys excluded above; own-property checked
      cur = (cur as Record<string, unknown>)[part];
    }
  }
  return cur;
}

/** {@link readPath}, as a string. Finite numbers are stringified; anything else yields undefined. */
export function readStringPath(root: unknown, path: string): string | undefined {
  const v = readPath(root, path);
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}
