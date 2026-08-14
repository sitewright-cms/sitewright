import { z } from 'zod';

// A bounded, prototype-safe, free-form JSON store — the shared validator behind the editable
// `website.data`, `page.data`, and `template.data` namespaces. Authors build these objects in a
// graphical tree/JSON editor; they are exposed in templates as `{{ <ns>.* }}` / `{{#each <ns>.x }}`
// and output-escaped like any binding. The bounds limit build-output amplification (the value can be
// injected into every page of a publish) and the iterative validation keeps a deeply-nested
// adversarial blob from overflowing the stack on the settings/page write path.

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const JSON_STORE_MAX_DEPTH = 12;
const JSON_STORE_MAX_NODES = 5000;
// 256 KB per string: a page.data / website.data leaf may be rich HTML bound to a `data-sw-html`
// directive (this is the single editable store), so the per-value cap tracks the same authoring
// ceiling as a page/template/snippet `source`, a chrome slot and website.criticalCss — one number
// for "how much can an author put in one field", rather than a different one per field. The caps that
// actually bound cost are unchanged and sit above this: MAX_NODES/MAX_DEPTH here, and the 4 MB
// render-IPC guard on the total publish payload.
const JSON_STORE_MAX_STRING = 256 * 1024;
const JSON_STORE_MAX_KEY = 200;
const JSON_STORE_RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * ITERATIVE (stack-safe) validation of an editable JSON value: only JSON types, bounded depth/node-
 * count/string-length, and safe object keys (no prototype-pollution keys). Avoids Zod's recursive
 * parse so a deeply-nested adversarial blob can't overflow the stack on a write path.
 */
export function isJsonValue(root: unknown): boolean {
  const stack: Array<{ v: unknown; d: number }> = [{ v: root, d: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const { v, d } = stack.pop()!;
    if (d > JSON_STORE_MAX_DEPTH) return false;
    if ((nodes += 1) > JSON_STORE_MAX_NODES) return false;
    if (v === null) continue;
    const t = typeof v;
    if (t === 'string') {
      if ((v as string).length > JSON_STORE_MAX_STRING) return false;
      continue;
    }
    if (t === 'number') {
      if (!Number.isFinite(v)) return false;
      continue;
    }
    if (t === 'boolean') continue;
    if (Array.isArray(v)) {
      for (const item of v) stack.push({ v: item, d: d + 1 });
      continue;
    }
    if (t === 'object') {
      for (const [key, val] of Object.entries(v as object)) {
        if (JSON_STORE_RESERVED_KEYS.has(key) || key.length === 0 || key.length > JSON_STORE_MAX_KEY) return false;
        stack.push({ v: val, d: d + 1 });
      }
      continue;
    }
    return false; // function / symbol / bigint / undefined
  }
  return true;
}

const JSON_VALUE_MESSAGE =
  'must be JSON (objects/arrays/strings/numbers/booleans/null), bounded in depth/size, with safe keys';
const JSON_OBJECT_MESSAGE = 'must be a JSON object (key → value), bounded in depth/size, with safe keys';

// ★ These were `z.custom<T>(isJsonValue, …)`. zod 4's JSON Schema converter THROWS on `z.custom`
// ("Custom types cannot be represented in JSON Schema"), and `.meta()` does not rescue it — measured.
// That breaks the MCP server outright, not just typing: these schemas reach `page.data` /
// `template.data` / `website.data`, the SDK converts every tool's input schema for `tools/list`, and
// the whole listing fails with -32603, so EVERY tool disappears.
//
// `z.unknown()` / `z.record()` carry the identical `isJsonValue` check in a `superRefine` — same
// runtime validation, same message — but both convert cleanly. The object form even produces a more
// honest schema than before (`type: object`, string property names) instead of an opaque blob.
// The casts restore the narrow output types `z.custom<T>` used to give; the runtime value is the
// refined schema, which is what keeps it representable.

/** A bounded, prototype-safe editable JSON object/value (see {@link isJsonValue} for the bounds). */
export const JsonStoreSchema = z.unknown().superRefine((v, ctx) => {
  if (!isJsonValue(v)) ctx.addIssue({ code: 'custom', message: JSON_VALUE_MESSAGE });
}) as unknown as z.ZodType<JsonValue>;

/** A plain JSON OBJECT at the root — `website.data`/`page.data`/`template.data` are key→value stores. */
export type JsonObject = { [key: string]: JsonValue };
// `z.unknown()`, NOT `z.record(z.string(), …)`, even though the record form yields a nicer JSON
// Schema. zod 4 DROPS a `__proto__` own property during record iteration, so `isJsonValue` never
// sees it and the reserved-key rejection this store exists to enforce silently stops firing —
// measured, three prototype-pollution tests went green-to-vacuous. `z.unknown()` hands the raw
// value through untouched, which is what the deep walk needs.
export const JsonObjectStoreSchema = z.unknown().superRefine((v, ctx) => {
  if (v === null || typeof v !== 'object' || Array.isArray(v) || !isJsonValue(v)) {
    ctx.addIssue({ code: 'custom', message: JSON_OBJECT_MESSAGE });
  }
}) as unknown as z.ZodType<JsonObject>;
