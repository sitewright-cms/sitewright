// Summary projection for content LIST responses.
//
// A list of pages carries every page's full Handlebars `source` (up to 256 KB each) plus its whole
// `page.data` store. On a real imported site that is enormous — a 22-page clone measured 337 KB in ONE
// response, past the MCP tool-output ceiling, which made `list_pages` (the FIRST call of the clone
// workflow) unusable. There was no summary mode, no field selection and no pagination, so the only way to
// see what pages existed was a call that could not complete.
//
// The projection drops the heavy BODY fields and replaces them with cheap descriptors, so a caller still
// learns what is there — which pages have code, how big, which data keys exist — and fetches the body for
// the one page it actually wants with `get_page`.

/** Heavy body fields per kind: dropped from a summary list and described instead. */
const HEAVY_FIELDS: Record<string, readonly string[]> = {
  page: ['source', 'data'],
  template: ['source'],
  snippet: ['source'],
  entry: ['values'],
  translation: ['entries'],
};

/** Kinds that have a heavy body worth summarising at all. */
export function kindHasSummary(kind: string): boolean {
  return Object.hasOwn(HEAVY_FIELDS, kind);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Byte length of a string field, as the agent would pay for it. */
const byteLen = (v: unknown): number => (typeof v === 'string' ? Buffer.byteLength(v, 'utf8') : 0);

/**
 * Project one content item to its summary form: every non-heavy field verbatim, plus a `_summary`
 * descriptor naming what was dropped and how to get it.
 *
 * `_summary` is deliberately a SINGLE reserved key rather than sibling `sourceBytes`/`dataKeys` fields —
 * it can't collide with a schema field, and a caller can tell a summarised item from a full one at a
 * glance (important: a summary must never be mistaken for the real entity and written back, which would
 * delete the very fields it omitted).
 */
export function summarizeContentItem(kind: string, item: unknown): unknown {
  const heavy = HEAVY_FIELDS[kind];
  if (!heavy || !isRecord(item)) return item;
  const out: Record<string, unknown> = {};
  const omitted: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) {
    if (!heavy.includes(k)) {
      out[k] = v;
      continue;
    }
    if (v === undefined || v === null) continue; // absent — nothing to describe
    if (typeof v === 'string') omitted[k] = { bytes: byteLen(v) };
    else if (Array.isArray(v)) omitted[k] = { items: v.length };
    else if (isRecord(v)) omitted[k] = { keys: Object.keys(v) };
    else omitted[k] = { present: true };
  }
  if (Object.keys(omitted).length > 0) {
    out._summary = { omitted, hint: `body fields omitted from this LIST — call get_${kind === 'page' ? 'page' : 'content'} for the full entity` };
  }
  return out;
}

/** Project a whole list. */
export function summarizeContentList(kind: string, items: readonly unknown[]): unknown[] {
  return items.map((i) => summarizeContentItem(kind, i));
}
