import type { JsonValue } from '@sitewright/schema';

// Editor-side helpers for the page.data store: routing `data.<path>` directive keys, reading/writing
// string leaves immutably, seeding template defaults, and the empty check. Mirrors the render-side
// resolver in @sitewright/blocks/directives. Pure + prototype-safe so it can be unit-tested directly.

/** Prototype-pollution-significant keys — never accepted as a region key nor a data path segment. */
export const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** The `data.` key prefix routes a directive to the page's own `page.data` object. */
const DATA_KEY_PREFIX = 'data.';

/** The page.data path a directive key targets (`data.a.b` → `a.b`), or null for a content/rich key. */
export function dataPathOf(key: string): string | null {
  return key.startsWith(DATA_KEY_PREFIX) ? key.slice(DATA_KEY_PREFIX.length) : null;
}

/**
 * A region key from the (untrusted) preview frame is safe to accept: not a bare prototype-pollution
 * key, and — for a `data.<path>` key — no reserved/empty path segment. Self-sufficient at the message
 * boundary (dataLeafSet also guards per segment; the server re-validates page.data on save).
 */
export function isSafeKey(key: string): boolean {
  if (DANGEROUS_KEYS.has(key)) return false;
  const p = dataPathOf(key);
  if (p === null) return true;
  return p.split('.').every((s) => s !== '' && !DANGEROUS_KEYS.has(s));
}

const isPlainObject = (v: JsonValue | undefined): v is Record<string, JsonValue> =>
  v != null && typeof v === 'object' && !Array.isArray(v);

/** Reads the STRING leaf at a dotted page.data path (own-property per segment), else undefined. */
export function dataLeafGet(data: JsonValue, path: string): string | undefined {
  let cur: JsonValue = data;
  for (const seg of path.split('.')) {
    if (seg === '' || DANGEROUS_KEYS.has(seg) || !isPlainObject(cur) || !Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
    // eslint-disable-next-line security/detect-object-injection -- own-property + DANGEROUS_KEYS guarded above
    cur = cur[seg]!;
  }
  return typeof cur === 'string' ? cur : undefined;
}

/**
 * Immutably sets the STRING leaf at a dotted page.data path, creating intermediate plain objects.
 * Prototype-safe: a no-op if any segment is empty or a prototype-pollution key (the server also
 * re-validates page.data on save).
 */
export function dataLeafSet(data: JsonValue, path: string, value: string): JsonValue {
  const segs = path.split('.');
  if (segs.some((s) => s === '' || DANGEROUS_KEYS.has(s))) return data;
  const asObj = (v: JsonValue | undefined): Record<string, JsonValue> => (isPlainObject(v) ? { ...v } : {});
  const root = asObj(data);
  let cur = root;
  /* eslint-disable security/detect-object-injection -- segments guarded against DANGEROUS_KEYS/'' above */
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i]!;
    const next = asObj(cur[seg]);
    cur[seg] = next;
    cur = next;
  }
  cur[segs[segs.length - 1]!] = value;
  /* eslint-enable security/detect-object-injection */
  return root;
}

/**
 * Fill-missing deep merge of a template's declared default `page.data` into the page's current data:
 * adds keys the page doesn't have (recursing into nested objects), never clobbering an existing value.
 * Prototype-safe (skips reserved keys; OWN-property check, not the prototype chain). Returns a NEW
 * object (immutable). A non-object `into` root (array/scalar) is preserved as-is — defaults only seed
 * an object store.
 */
export function mergeDefaults(into: JsonValue, defaults: JsonValue): JsonValue {
  if (!isPlainObject(defaults)) return into;
  if (into != null && !isPlainObject(into)) return into; // array/scalar root → don't clobber
  const base: Record<string, JsonValue> = isPlainObject(into) ? { ...into } : {};
  /* eslint-disable security/detect-object-injection -- keys from Object.entries (own) + DANGEROUS_KEYS-guarded */
  for (const [k, v] of Object.entries(defaults)) {
    if (DANGEROUS_KEYS.has(k)) continue;
    if (!Object.prototype.hasOwnProperty.call(base, k)) base[k] = v;
    else if (isPlainObject(v) && isPlainObject(base[k])) base[k] = mergeDefaults(base[k], v);
  }
  /* eslint-enable security/detect-object-injection */
  return base;
}

/** An empty page.data (absent/null or an empty object/array) — omitted from the saved/previewed page. */
export function isEmptyPageData(v: JsonValue): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}
