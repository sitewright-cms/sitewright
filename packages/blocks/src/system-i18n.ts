import { SYSTEM_TRANSLATION_KEYS, RESERVED_TRANSLATION_DEFAULTS } from '@sitewright/schema';

/**
 * The resolved SYSTEM UI strings as a JSON string, stamped onto `<html data-sw-i18n="…">` for the
 * first-party component RUNTIMES (the modal close button's aria-label; the carousel's previous/next
 * labels, "Slide {n} of {total}" announce, "Go to slide {n}" dots, and "carousel" role description).
 * The runtimes can't read the server-side translation catalog, so we resolve it here and the runtimes
 * `JSON.parse(document.documentElement.getAttribute('data-sw-i18n'))`.
 *
 * An ATTRIBUTE, NOT an inline `<script>`: the published site's CSP is `default-src 'self'` (no
 * `script-src 'unsafe-inline'`), so an inline dict script is blocked — same reason the component
 * runtimes are external files. Per key the value is the page's catalog string (`t`, already
 * locale-resolved) flooring to the built-in English default — same precedence the cart helpers use.
 * `{n}`/`{total}` placeholders are substituted by the runtime. `JSON.stringify` + the render layer's
 * `escapeAttr` make it attribute-safe.
 */
export function systemI18nData(t: Record<string, unknown> | undefined): string {
  const dict = Object.fromEntries(
    SYSTEM_TRANSLATION_KEYS.map((key) => {
      // eslint-disable-next-line security/detect-object-injection -- key is a literal registry key (SYSTEM_TRANSLATION_KEYS), never user input
      const v = t && Object.prototype.hasOwnProperty.call(t, key) ? t[key] : undefined;
      // eslint-disable-next-line security/detect-object-injection -- key is a literal registry key; RESERVED_TRANSLATION_DEFAULTS is a frozen const registry
      const fallback = RESERVED_TRANSLATION_DEFAULTS[key] ?? '';
      return [key, typeof v === 'string' && v.trim() !== '' ? v : fallback] as const;
    }),
  );
  return JSON.stringify(dict);
}
