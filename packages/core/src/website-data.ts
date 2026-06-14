/** JSON-store keys that must never index an object (prototype-pollution guard). */
const PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Immutably set a STRING leaf at a dotted `path` inside the `website.data` object, creating the
 * intermediate objects along the way — returning a NEW object (the input is never mutated). The single
 * write path behind the inline `{{sw-control target="website.data.<path>"}}` editor (a GLOBAL store, so
 * one edit applies site-wide). Prototype-pollution-safe: an empty/proto segment is a no-op (returns a
 * shallow copy unchanged). A non-object value encountered mid-path is overwritten with a fresh object so
 * the leaf can be set (the control deliberately targets that path). Mirrors {@link setTranslationCell}.
 */
export function setWebsiteDataLeaf(
  data: Record<string, unknown> | undefined,
  path: string,
  value: string,
): Record<string, unknown> {
  const root: Record<string, unknown> = { ...(data ?? {}) };
  const segs = path.split('.');
  if (segs.some((s) => s === '' || PROTO_KEYS.has(s))) return root;
  // Every seg is proto-guarded above; writes target fresh local objects only.
  let cur = root;
  for (let i = 0; i < segs.length - 1; i += 1) {
    const seg = segs[i]!;
    const existing = cur[seg];
    const next: Record<string, unknown> =
      existing !== null && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    cur[seg] = next;
    cur = next;
  }
  cur[segs[segs.length - 1]!] = value;
  return root;
}
