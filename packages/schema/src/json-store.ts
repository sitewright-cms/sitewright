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
const JSON_STORE_MAX_STRING = 20_000;
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

/** A bounded, prototype-safe editable JSON object/value (see {@link isJsonValue} for the bounds). */
export const JsonStoreSchema = z.custom<JsonValue>(isJsonValue, {
  message: 'must be JSON (objects/arrays/strings/numbers/booleans/null), bounded in depth/size, with safe keys',
});

/** A plain JSON OBJECT at the root — `website.data`/`page.data`/`template.data` are key→value stores. */
export type JsonObject = { [key: string]: JsonValue };
export const JsonObjectStoreSchema = z.custom<JsonObject>(
  (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && isJsonValue(v),
  { message: 'must be a JSON object (key → value), bounded in depth/size, with safe keys' },
);
