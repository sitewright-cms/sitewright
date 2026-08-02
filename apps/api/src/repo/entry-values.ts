/**
 * Accept a dataset entry whose field values were written FLAT.
 *
 * The write side nests a row's fields under `values`, while the render side reads them bare
 * (`{{question}}` inside the loop, no `values.` prefix). Sending them flat is the single most common
 * mistake against this API — the agent guide literally calls it "THE #1 MISTAKE", which is an admission
 * that the shape is surprising rather than a defence of it. The failure is also SILENT in the worst way:
 * unknown keys are stripped, the entry saves as `values:{}`, the write reports success, and the loop
 * renders nothing.
 *
 * There is no ambiguity to resolve here. `EntrySchema` has a closed set of envelope keys, so any OTHER
 * top-level key can only be a field value — folding it in is strictly better than discarding it.
 */

/** The envelope of an entry. Everything else at the top level is a field value. */
const ENTRY_KEYS = new Set(['id', 'dataset', 'locale', 'status', 'order', 'values']);

/**
 * Fold flat field values into `values`. An explicit `values` wins on key collision (the caller said
 * where that one belongs). Returns the body unchanged when there is nothing to fold, so the normal
 * path is untouched.
 */
export function normalizeEntryValues(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const obj = body as Record<string, unknown>;
  const stray = Object.keys(obj).filter((k) => !ENTRY_KEYS.has(k));
  if (stray.length === 0) return body;

  const existing =
    obj.values && typeof obj.values === 'object' && !Array.isArray(obj.values)
      ? (obj.values as Record<string, unknown>)
      : {};
  const folded: Record<string, unknown> = {};
  for (const k of stray) folded[k] = obj[k];

  const out: Record<string, unknown> = { values: { ...folded, ...existing } };
  for (const k of Object.keys(obj)) if (ENTRY_KEYS.has(k)) out[k] = obj[k];
  return out;
}
