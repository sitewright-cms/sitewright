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
