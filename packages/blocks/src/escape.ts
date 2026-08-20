// HTML escaping for the pure renderer. A Map (not an object index) keeps lookups
// free of dynamic-key access warnings and prototype-pollution surface.

const HTML_ESCAPES = new Map<string, string>([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
]);

const ATTR_ESCAPES = new Map<string, string>([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
]);

/** Escapes text for an HTML element body (`&`, `<`, `>`). */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (ch) => HTML_ESCAPES.get(ch) ?? ch);
}

/** Escapes text for a double- or single-quoted attribute value. */
export function escapeAttr(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ATTR_ESCAPES.get(ch) ?? ch);
}

/**
 * Neutralizes a `</script` sequence in JS destined for an inline `<script>` block, so trusted bundled
 * code can't accidentally close the tag early. This is the EXACT transform renderDocument applies when
 * it emits an inline script — anything that needs the emitted bytes (e.g. computing a CSP `'sha256-…'`
 * hash for the inline preview runtime) MUST run the string through this first, or the hash won't match.
 */
export function neutralizeInlineScript(js: string): string {
  return js.replace(/<\/(script)/gi, '<\\/$1');
}

/**
 * Serializes a value for embedding inside a `<script>` ELEMENT BODY.
 *
 * A script body is RAW TEXT: the parser looks only for the closing tag, so nothing inside is
 * HTML-escaped and a single `</script>` in any string ends the element and drops whatever follows back
 * into HTML — the classic breakout. Escaping `<`, `>` and `&` as `\uXXXX` (valid JSON escapes, which
 * `JSON.parse` restores verbatim) makes `</script>`, `<!--` and `<script` unrepresentable while keeping
 * the payload byte-for-byte parseable.
 *
 * ★ U+2028 / U+2029 are escaped for a different reason: both are legal inside a JSON string but are
 * LINE TERMINATORS in JavaScript source, so a payload carrying one parses fine with `JSON.parse` and
 * turns into a syntax error the moment the same text is read as JS. They are written here as escape
 * sequences rather than as the literal characters, which are invisible in an editor and get silently
 * mangled by anything that normalizes whitespace.
 *
 * Returns `undefined` when the value cannot be serialized (a function, a symbol, a cycle, a BigInt) —
 * callers decide what to do about that rather than silently emitting the string "undefined".
 */
export function jsonForScript(value: unknown): string | undefined {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    return undefined; // circular, BigInt, or a throwing toJSON
  }
  if (typeof json !== 'string') return undefined; // a function/symbol stringifies to undefined
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
