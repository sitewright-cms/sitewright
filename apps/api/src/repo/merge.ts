// Deep-merge for PATCH-style content writes (today: the `settings` singleton). An agent that only wants
// to change ONE slot (e.g. website.footer) can PUT just that fragment with `?merge=1` instead of resending
// the whole settings object — which, sent from a stale snapshot, silently reverts every other slot. The
// merged result is still run through the kind's Zod schema, so a bad patch is rejected the same as a
// full write.

/** Keys that, if merged from an untrusted patch, could poison `Object.prototype` — never copied/recursed. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** A JSON object (not an array, not null) we can recurse into. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Deep-merge `patch` INTO `base`, returning a NEW value (both inputs are left untouched). PATCH semantics:
 *  - both plain objects → merged key-by-key (recurse into nested objects).
 *  - anything else → `patch` REPLACES `base`. In particular ARRAYS replace wholesale: a positional
 *    array merge is ambiguous and would corrupt ordered lists (nav items, redirects, social links).
 *  - a patch value of `undefined` is IGNORED (the base value is kept), so a partial object can never
 *    clear a field just by carrying an explicit `undefined`. Use a full (non-merge) write to remove a key.
 *
 * Prototype-pollution-safe: `__proto__` / `constructor` / `prototype` keys in `patch` are skipped, and
 * recursion only descends into a key the base OWNS (never an inherited property).
 */
export function deepMerge(base: unknown, patch: unknown, depth = 0): unknown {
  // Defense-in-depth: recursion is already bounded by the BASE depth (a patch key absent from base is
  // assigned wholesale, never descended into) and stored settings are shallow (~4 levels). This cap guards
  // any future deeper schema — 32 is far above real settings, far below a stack-overflow. A RangeError maps
  // to a 400 ("input too large") in the app error handler rather than crashing the process.
  if (depth > 32) throw new RangeError('deepMerge: patch nesting exceeds the maximum depth');
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch === undefined ? base : patch;
  const out: Record<string, unknown> = { ...base };
  // Dynamic key access below is safe: FORBIDDEN_KEYS blocks the prototype-pollution vectors, and both
  // `key` and the values come from own-enumerable keys of plain objects (recursion descends only into
  // keys the base OWNS via Object.hasOwn) — never an attacker-chosen path into Object.prototype.
  for (const key of Object.keys(patch)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    // eslint-disable-next-line security/detect-object-injection -- own key of a plain object; proto keys filtered above
    const pv = patch[key];
    if (pv === undefined) continue;
    // eslint-disable-next-line security/detect-object-injection -- own key; proto vectors filtered; assignment builds a fresh object
    out[key] = Object.hasOwn(out, key) ? deepMerge(out[key], pv, depth + 1) : pv;
  }
  return out;
}
