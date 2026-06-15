import { SYSTEM_TRANSLATION_KEYS, RESERVED_TRANSLATION_DEFAULTS } from '@sitewright/schema';

/**
 * Inline script that publishes the resolved SYSTEM UI strings as `window.__SW_T__` for the
 * first-party component RUNTIMES (the modal close button's aria-label; the carousel's previous/next
 * labels, "Slide {n} of {total}" announce, "Go to slide {n}" dots, and "carousel" role description).
 * The runtimes can't read the server-side translation catalog, so we resolve it here and hand them a
 * tiny global ahead of their scripts.
 *
 * Per key the value is the page's catalog string (`t`, already locale-resolved) flooring to the
 * built-in English default — same precedence the cart helpers use. `{n}`/`{total}` placeholders are
 * substituted by the runtime. Emitted ONCE per page, only when interactive components ship
 * (only-used-ships). Injection-safe: `JSON.stringify` quotes the values and the render layer escapes
 * any `</script>` in inline scripts. `Object.assign` is defensive against a double-include.
 */
export function systemI18nScript(t: Record<string, unknown> | undefined): string {
  const dict = Object.fromEntries(
    SYSTEM_TRANSLATION_KEYS.map((key) => {
      // eslint-disable-next-line security/detect-object-injection -- key is a literal registry key (SYSTEM_TRANSLATION_KEYS), never user input
      const v = t && Object.prototype.hasOwnProperty.call(t, key) ? t[key] : undefined;
      // eslint-disable-next-line security/detect-object-injection -- key is a literal registry key; RESERVED_TRANSLATION_DEFAULTS is a frozen const registry
      const fallback = RESERVED_TRANSLATION_DEFAULTS[key] ?? '';
      return [key, typeof v === 'string' && v.trim() !== '' ? v : fallback] as const;
    }),
  );
  return `window.__SW_T__=Object.assign(window.__SW_T__||{},${JSON.stringify(dict)});`;
}
