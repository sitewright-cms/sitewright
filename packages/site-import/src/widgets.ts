// Detect KNOWN third-party WIDGET scripts in an imported site and turn each into a functional consent
// integration. The rebuilt site's strict `script-src 'self'` CSP only admits a 3rd-party script through the
// consent registry, which also gates it behind the cookie banner — the privacy-correct behaviour for foreign
// JS that phones home (a weather widget, a chat bubble, a reviews wall). A CURATED allow-list (like the embed
// allowlist) — NEVER a plain library CDN (jquery/bootstrap), a font host, or an analytics/tag-manager loader
// (those are not "functional widgets" and would be mis-categorised).
import { allByName, type Document } from './dom.js';
import { textContent } from 'domutils';
import type { ConsentIntegration } from '@sitewright/schema';

/** Base domains of embeddable-widget PROVIDERS (matched as the host or any subdomain). `name` is the display
 *  label. Add a provider here to support it; keep it to true drop-in widgets (a script that renders UI). */
export const WIDGET_PROVIDERS: readonly (readonly [base: string, name: string])[] = [
  ['weatherwidget.io', 'weatherwidget.io'], // weather forecast widget
  ['elfsight.com', 'Elfsight'], // all-in-one widget platform
  ['elfsightcdn.com', 'Elfsight'],
  ['tawk.to', 'Tawk.to'], // live chat
  ['tidiochat.com', 'Tidio'], // live chat
  ['tidio.co', 'Tidio'],
  ['crisp.chat', 'Crisp'], // live chat
  ['powr.io', 'POWR'], // widget platform
  ['curator.io', 'Curator.io'], // social wall
  ['sociablekit.com', 'SociableKit'], // social feed widgets
  ['commoninja.com', 'Common Ninja'], // widget platform
  ['trustindex.io', 'Trustindex'], // reviews widget
];

/** The widget provider a script URL belongs to (https only, host or subdomain match), else null. */
export function widgetProviderFor(url: string): { base: string; name: string } | null {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    host = u.hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [base, name] of WIDGET_PROVIDERS) if (host === base || host.endsWith(`.${base}`)) return { base, name };
  return null;
}

const slugHost = (h: string): string =>
  h.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 64).toLowerCase() || 'widget';

/**
 * Scan the imported docs for known 3rd-party widget scripts — an external `<script src>` OR an inline loader
 * that references one (`getScript("https://…")`, `s.src = "https://…"`, a bare `https://…widget.js` literal) —
 * and build ONE functional consent integration per provider (deduped by base domain, capped at 20). Registering
 * the provider's script `src` + host `origins` lets the consent runtime inject it (CSP-allowed) on consent.
 * Reads the docs (doesn't mutate); call BEFORE the transform strips `<script>`.
 */
export function collectWidgetIntegrations(docs: readonly Document[]): ConsentIntegration[] {
  const byBase = new Map<string, ConsentIntegration>();
  for (const doc of docs) {
    for (const s of allByName(doc.children, 'script')) {
      const urls: string[] = [];
      const src = (s.attribs?.src ?? '').trim();
      if (src) urls.push(src);
      const text = textContent(s);
      if (text) for (const m of text.matchAll(/["'`](https:\/\/[^"'`\s]+?\.js(?:[?#][^"'`\s]*)?)["'`]/gi)) urls.push(m[1]!);
      for (const url of urls) {
        const p = widgetProviderFor(url);
        if (!p || byBase.has(p.base) || byBase.size >= 20) continue;
        byBase.set(p.base, {
          id: slugHost(p.base),
          name: p.name,
          category: 'functional', // a drop-in widget is a functional (not analytics/marketing) integration
          src: url.slice(0, 2048),
          async: true,
          origins: [p.base], // script-src + connect-src for the provider's own fan-out (data/CDN on its host)
        });
      }
    }
  }
  return [...byBase.values()];
}
