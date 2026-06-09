import { z } from 'zod';
import { JsonObjectStoreSchema } from './json-store.js';

// Bounded to limit build-output amplification (these fields are injected into
// every page of a publish, up to MAX_BUNDLE.pages). CSS is smaller than the
// HTML head/footer blocks in practice.
const CSS_MAX = 10_000;
const HTML_MAX = 20_000;

// --- website.data: an editable, free-form JSON object the author manages in the CMS (a graphical
// tree editor), exposed in templates as {{ website.data.* }} and {{#each website.data.x}}. It is the
// LOCAL counterpart to `jsonDataUrl`/`json_data` (which is fetched from a URL at publish) and is
// available in BOTH preview and publish. Values are output-escaped like any binding; the namespace
// is bounded + prototype-safe. The validator + bounds are shared with page.data/template.data — see
// `json-store.ts`.
/** The `website.data` editable JSON store — a root OBJECT (the shared bounded, prototype-safe store). */
export const WebsiteDataSchema = JsonObjectStoreSchema;

/**
 * Project-wide website settings — the `website.*` namespace (contentBase's
 * WEBSITE tab). The raw HTML/CSS fields are the tenant's own content for their
 * own exported site; they are injected UNESCAPED at render time (see
 * `renderDocument` @security — owner/admin-set, sandboxed/exported only). More
 * fields (canonical url, container width, partial-slot assignments) arrive with
 * Phase 3 (partials).
 */
const WebsiteSettingsObject = z.object({
  // --- RAW owner-only slots: injected UNESCAPED, NOT run through the no-JS template validator.
  // They hold the tenant's own trusted head/CSS/script content for their own exported site — same
  // @security invariants as the `Html` block (owner/admin-set; rendered only inside the sandboxed
  // preview or written to the exported artifact, never as a same-origin text/html editor response).
  /** Project-wide CSS inlined in `<head>` after the brand styles (contentBase `critical_css`). */
  criticalCss: z
    .string()
    .max(CSS_MAX)
    // Inlined inside `<style>` — reject a `</style>` breakout. (head/scripts are
    // intentionally raw HTML and carry no such restriction.)
    .refine((v) => !/<\/style/i.test(v), 'criticalCss must not contain "</style"')
    .optional(),
  /** Raw HTML injected into `<head>` — analytics/meta (contentBase `global_head`; was `customHead`). */
  head: z.string().max(HTML_MAX).optional(),
  /** Raw HTML injected after the page body — 3rd-party scripts/widgets (contentBase `global_bottom`; was `customFooter`). */
  scripts: z.string().max(HTML_MAX).optional(),
  /**
   * Project-wide skeleton SLOTS — Handlebars partials rendered into every page at fixed
   * positions, so a multi-page site shares one header/footer authored once. They run through
   * the SAME no-JS template validator as a page `source` (HTML + Tailwind + DaisyUI) and get
   * the page render context PLUS `nav` — the auto-menu built from each page's nav settings:
   *   {{#each nav.header}}<a href="{{sw-url path}}">{{label}}</a>{{/each}}
   * Body source order: `topNav`, `mobileNav`, [page body], `sidebarLeft`, `sidebarRight`,
   * `footer`, `bottom`. Nav links use root-absolute paths (`{{sw-url path}}`); on a multilingual
   * site they are auto-prefixed with the current locale at publish.
   *
   * SEMANTIC LANDMARKS ARE PLATFORM-OWNED. The skeleton wraps each slot (and the page body) in a
   * semantic element with a fixed unique id — `<nav id="top-nav">`, `<nav id="mobile-nav">`,
   * `<main id="page-content">`, `<aside id="sidebar-left">`, `<aside id="sidebar-right">`,
   * `<footer id="footer">`, `<div id="bottom">`. So slot content (and page `source`) must NOT
   * itself use `<nav>`, `<main>`, `<footer>`, or `<aside>` — the validator rejects them to keep
   * each landmark unique. Use neutral `<div>`/`<section>`/`<ul>` (DaisyUI's `.footer`/`.navbar`
   * classes style any element).
   *
   * - `topNav` / `mobileNav` — main + mobile navigation, top of `<body>` (→ `<nav id="top-nav">` /
   *   `<nav id="mobile-nav">`).
   * - `sidebarLeft` / `sidebarRight` — rendered AFTER the page body (position via the slot's own
   *   Tailwind classes, e.g. fixed/absolute) so they don't disturb body flow (→ `<aside id="sidebar-left">` /
   *   `<aside id="sidebar-right">`).
   * - `footer` — below the page body and sidebars (→ `<footer id="footer">`).
   * - `bottom` — after the footer (global modals, schema.org *microdata* markup, etc.); usually a
   *   no-show (→ `<div id="bottom">`). (A `<script type="application/ld+json">` block is NOT allowed
   *   here — the no-JS slot validator rejects all `<script>`; the platform emits JSON-LD in `<head>`
   *   from company data.)
   */
  topNav: z.string().max(HTML_MAX).optional(),
  mobileNav: z.string().max(HTML_MAX).optional(),
  sidebarLeft: z.string().max(HTML_MAX).optional(),
  sidebarRight: z.string().max(HTML_MAX).optional(),
  footer: z.string().max(HTML_MAX).optional(),
  bottom: z.string().max(HTML_MAX).optional(),
  /**
   * URL to an external JSON file fetched once at PUBLISH time (SSRF-guarded, public-https-only) and
   * decoded into `{{ website.json_data }}` — e.g. a code-first page can render `{{ website.json_data.title }}`
   * or `{{#each website.json_data.items}}…{{/each}}`. The result is snapshotted into the static
   * output; the exported site never fetches it itself. Query strings are allowed (it is an API URL).
   */
  jsonDataUrl: z
    .string()
    .max(2048)
    .url()
    .refine((u) => /^https:\/\//i.test(u), 'jsonDataUrl must be an https URL')
    .refine((u) => !/\s/.test(u), 'jsonDataUrl must not contain whitespace')
    .optional(),
  /**
   * An editable, free-form JSON object the author manages in the CMS, exposed as `{{ website.data.* }}`
   * and `{{#each website.data.x}}`. Unlike `jsonDataUrl` (remote, publish-only) this is local and shows
   * in the preview too. Bounded + prototype-safe (see {@link WebsiteDataSchema}).
   */
  data: WebsiteDataSchema.optional(),
  /**
   * The site's production base URL (e.g. `https://acme.com`). Required for an
   * absolute-URL `sitemap.xml` + the `robots.txt` Sitemap line; omit to skip the
   * sitemap. No trailing slash needed (normalized at build time).
   */
  siteUrl: z
    .string()
    .max(2048)
    .url()
    .refine((u) => /^https?:\/\//i.test(u), 'siteUrl must be http(s)')
    .refine((u) => !/[#?]/.test(u), 'siteUrl must not contain a query or fragment')
    // Zod's `.url()` does NOT reject embedded whitespace; a literal newline here
    // would inject a directive into robots.txt / break the sitemap <loc>. Reject all.
    .refine((u) => !/\s/.test(u), 'siteUrl must not contain whitespace')
    // Defense-in-depth: `.url()` also permits `"<>'&` — harmless where the value is
    // escaped (hreflang/sitemap), but reject at the boundary so it can never reach a
    // future unescaped sink. Real site base URLs never contain these.
    .refine((u) => !/["<>'&]/.test(u), 'siteUrl must not contain HTML-significant characters')
    .optional(),
  /**
   * Redirect rules emitted to `.htaccess` (Apache) + `_redirects` (Netlify) on
   * publish. `from` is a path; `to` is a path or absolute URL.
   */
  redirects: z
    .array(
      z.object({
        from: z
          .string()
          .min(1)
          .max(2048)
          .regex(/^\/[^\s]*$/, 'from must be a path starting with "/" (no spaces)')
          // Percent-encoded CR/LF can't inject a directive (the file holds the literal
          // text) but yields a redirect that never matches a real request — reject it.
          .refine((v) => !/%0[ad]/i.test(v), 'from must not contain encoded newlines'),
        to: z
          .string()
          .min(1)
          .max(2048)
          .regex(/^(\/[^\s]*|https?:\/\/[^\s]+)$/i, 'to must be a path or http(s) URL (no spaces)')
          .refine((v) => !/%0[ad]/i.test(v), 'to must not contain encoded newlines'),
        status: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]).default(301),
      }),
    )
    .max(500)
    .optional(),
  // ── Publish options (the "PUBLISH" tab of the Publish & Deploy modal) ─────────────────────────
  /**
   * Local hosting at `/sites/<slug>/`. Enabled by default (an absent value = enabled). When set to
   * `false`, publish still BUILDS the artifact (so a configured deploy target can upload it) but the
   * platform stops SERVING it locally — `/sites/<slug>/…` returns 404.
   */
  localPublish: z.boolean().optional(),
  /**
   * Optional gate for the locally-hosted site: when set, `/sites/<slug>/…` requires `?token=<this>`
   * (an unguessable, owner-generated string) or returns 403. A soft "unlisted preview" control, not a
   * security boundary for secrets. Disabled by default (absent = no token required).
   */
  previewToken: z
    .string()
    .min(16)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, 'previewToken must be url-safe (A–Z, a–z, 0–9, _ or -)')
    .optional(),
  /** Minify each page's HTML at publish (collapse whitespace, drop comments). Off by default. */
  minifyHtml: z.boolean().optional(),
});

/**
 * Migrate the RETIRED raw-field names (`customHead`→`head`, `customFooter`→`scripts`) so settings
 * stored under the old schema keep their content on the next read/write. Idempotent: runs on every
 * parse, the new name wins if both are present, and the legacy keys are dropped. Safe to remove
 * once all stored settings have been re-saved. Non-object input passes through untouched.
 */
function migrateRetiredWebsiteFields(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const v = value as Record<string, unknown>;
  if (!('customHead' in v) && !('customFooter' in v)) return value; // fast path: already migrated
  const out: Record<string, unknown> = { ...v };
  if ('customHead' in out) {
    if (out.head === undefined) out.head = out.customHead;
    delete out.customHead;
  }
  if ('customFooter' in out) {
    if (out.scripts === undefined) out.scripts = out.customFooter;
    delete out.customFooter;
  }
  return out;
}

export const WebsiteSettingsSchema = z.preprocess(migrateRetiredWebsiteFields, WebsiteSettingsObject);
export type WebsiteSettings = z.infer<typeof WebsiteSettingsSchema>;
