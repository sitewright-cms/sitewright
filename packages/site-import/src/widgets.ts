// Detect KNOWN third-party WIDGET scripts in an imported site and turn each into a functional consent
// integration. The rebuilt site's strict `script-src 'self'` CSP only admits a 3rd-party script through the
// consent registry, which also gates it behind the cookie banner — the privacy-correct behaviour for foreign
// JS that phones home (a weather widget, a chat bubble, a reviews wall). A CURATED allow-list (like the embed
// allowlist) — NEVER a plain library CDN (jquery/bootstrap), a font host, or an analytics/tag-manager loader
// (those are not "functional widgets" and would be mis-categorised).
import { allByName, type Document } from './dom.js';
import { textContent } from 'domutils';
import type { ConsentIntegration } from '@sitewright/schema';

interface WidgetProvider {
  /** Display label (editor + consent UI + docs). */
  name: string;
  /** Base domains that identify this provider — matched as the host OR any subdomain. */
  hosts: readonly string[];
  /** Does the widget inject its OWN `<iframe>` (chat bubble / social wall)? Then it also needs `frame-src`. */
  framed?: boolean;
}

/** Embeddable-widget PROVIDERS. Add one here to support it; keep to true drop-in widgets (a script that
 *  renders UI), not libraries / analytics. Multi-domain providers list ALL their domains in one entry so a
 *  single consent integration widens the CSP for the whole SDK fan-out. */
export const WIDGET_PROVIDERS: readonly WidgetProvider[] = [
  { name: 'weatherwidget.io', hosts: ['weatherwidget.io'] }, // renders inline, no iframe
  { name: 'Elfsight', hosts: ['elfsight.com', 'elfsightcdn.com'], framed: true },
  { name: 'Tawk.to', hosts: ['tawk.to'], framed: true }, // chat bubble is a *.tawk.to iframe
  { name: 'Tidio', hosts: ['tidiochat.com', 'tidio.co'], framed: true }, // chat
  { name: 'Crisp', hosts: ['crisp.chat'], framed: true }, // chat
  { name: 'POWR', hosts: ['powr.io'], framed: true },
  { name: 'Curator.io', hosts: ['curator.io'], framed: true }, // social wall
  { name: 'SociableKit', hosts: ['sociablekit.com'], framed: true }, // social feed
  { name: 'Common Ninja', hosts: ['commoninja.com'], framed: true },
  { name: 'Trustindex', hosts: ['trustindex.io'], framed: true }, // reviews
];

/** The widget provider a script URL belongs to (https only; host or subdomain of any of its domains), else null. */
export function widgetProviderFor(url: string): WidgetProvider | null {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    host = u.hostname.toLowerCase();
  } catch {
    return null;
  }
  return WIDGET_PROVIDERS.find((p) => p.hosts.some((h) => host === h || host.endsWith(`.${h}`))) ?? null;
}

const slugName = (n: string): string =>
  n.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 64).toLowerCase() || 'widget';

/** apex + wildcard for each of a provider's domains → covers the SDK's whole subdomain fan-out in the CSP. */
const cspHosts = (p: WidgetProvider): string[] => p.hosts.flatMap((h) => [h, `*.${h}`]);

/**
 * Scan the imported docs for known 3rd-party widget scripts — an external `<script src>` OR an inline loader
 * that references one (`getScript("https://…")`, `s.src = "https://…"`, a bare `https://…` literal) — and build
 * ONE functional consent integration per PROVIDER (deduped, capped at 20). The provider's own domains go to
 * `origins` (script-src + connect-src) and, for a widget that injects its own iframe, `frameOrigins` (frame-src)
 * so the consent runtime can inject the script AND its widget iframe (CSP-allowed) on consent. Reads the docs
 * (doesn't mutate); call BEFORE the transform strips `<script>`.
 */
export function collectWidgetIntegrations(docs: readonly Document[]): ConsentIntegration[] {
  const byProvider = new Map<string, ConsentIntegration>();
  for (const doc of docs) {
    for (const s of allByName(doc.children, 'script')) {
      const urls: string[] = [];
      const src = (s.attribs?.src ?? '').trim();
      if (src) urls.push(src);
      const text = textContent(s).slice(0, 50_000); // cap a huge minified inline script (ReDoS defence-in-depth)
      // Any quoted https URL in an inline loader (no `.js` requirement — a chat loader like
      // `s.src='https://embed.tawk.to/ID/1abc'` has none); the allow-list below filters non-widgets.
      if (text) for (const m of text.matchAll(/["'`](https:\/\/[^"'`\s]{8,})["'`]/gi)) urls.push(m[1]!);
      for (const url of urls) {
        const p = widgetProviderFor(url);
        if (!p || byProvider.has(p.name) || byProvider.size >= 20) continue;
        const origins = cspHosts(p);
        byProvider.set(p.name, {
          id: slugName(p.name),
          name: p.name,
          category: 'functional', // a drop-in widget is a functional (not analytics/marketing) integration
          src: url.slice(0, 2048),
          async: true,
          origins,
          ...(p.framed ? { frameOrigins: origins } : {}),
        });
      }
    }
  }
  return [...byProvider.values()];
}
