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
