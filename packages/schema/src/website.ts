import { z } from 'zod';
import { JsonObjectStoreSchema } from './json-store.js';
import { targetsPrivateHost, IdSchema } from './primitives.js';

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

// --- shop (MINI SHOP): front-end-driven cart configuration ---------------------------------------
// A "mini shop" is FRONT-END only: the browser builds a cart in localStorage and hands its contents
// to a submission CHANNEL (a WhatsApp / mailto deep link, or a payment link). There is NO server-side
// cart and NO payment capture — the submitted cart is an order INQUIRY and the prices are
// NON-AUTHORITATIVE (client-tamperable). The merchant confirms price + availability and collects
// payment out-of-band. Every field here is PUBLIC by nature (it is how a customer reaches the
// merchant) and is emitted into the published HTML on the cart mount for the first-party `cart.js`
// runtime to read — see packages/blocks/src/cart.ts and the `{{sw-cart}}` helper. PR-2 adds a `form`
// channel (cart → an order Form). A `Shop` block + a settings UI arrive in PR-3.
const SHOP_LABEL_MAX = 60;
const KNOWN_PAYMENT_PLACEHOLDERS = new Set(['{total}', '{currency}', '{items}']);

/** True if `value` contains an ASCII control char (CR/LF must not reach a mail Subject header). */
function shopHasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** Display currency for the cart subtotal. Formatting is client-side + display-only (non-authoritative). */
export const ShopCurrencySchema = z.object({
  /** ISO 4217 alphabetic code, e.g. `USD`, `EUR`, `JPY`. */
  code: z.string().regex(/^[A-Z]{3}$/, 'currency code must be a 3-letter ISO 4217 code (e.g. USD, EUR)'),
  /** Display symbol, e.g. `$`, `€`, `CHF`. */
  symbol: z.string().min(1).max(8),
  /** Symbol placement around the amount. */
  position: z.enum(['before', 'after']).default('before'),
  /** Fraction digits shown (0 for JPY, 2 for most). */
  decimals: z.number().int().min(0).max(4).default(2),
});
export type ShopCurrency = z.infer<typeof ShopCurrencySchema>;

const shopChannelLabel = z.string().min(1).max(SHOP_LABEL_MAX).optional();

/** Order via a WhatsApp deep link (`wa.me/<number>?text=<order>`) — zero backend. */
const WhatsappChannelSchema = z.object({
  kind: z.literal('whatsapp'),
  label: shopChannelLabel,
  /** Recipient in E.164 (`+` then 7–15 digits, no leading 0); cart.js strips the `+` for wa.me. */
  number: z.string().regex(/^\+[1-9]\d{6,14}$/, 'number must be E.164, e.g. +14155550123'),
  /** Optional intro line prepended to the auto-built order text (URL-encoded by cart.js). */
  intro: z.string().max(280).optional(),
});

/** Order via a `mailto:` deep link — zero backend. */
const MailtoChannelSchema = z.object({
  kind: z.literal('mailto'),
  label: shopChannelLabel,
  email: z.string().email().max(320),
  /** Optional subject; lands in a mail Subject header → reject control chars. */
  subject: z
    .string()
    .max(200)
    .refine((v) => !shopHasControlChars(v), 'subject must not contain control characters')
    .optional(),
});

/**
 * "Pay now" via a payment-provider deep link. `urlTemplate` may contain the placeholders `{total}`
 * / `{currency}` / `{items}`, substituted client-side before `window.open`. Works cleanly for
 * amount-bearing links (PayPal.me `…/{total}`); fixed-amount links (Stripe Payment Links) are also
 * valid (no placeholder). The opened amount is CLIENT-CONTROLLED and therefore non-authoritative —
 * the merchant must reconcile the paid amount against the order.
 */
const PaymentChannelSchema = z.object({
  kind: z.literal('payment'),
  label: shopChannelLabel,
  /** Informational provider tag (does not change behavior). */
  provider: z.enum(['paypal', 'stripe', 'custom']).optional(),
  urlTemplate: z
    .string()
    .max(2048)
    .url()
    .refine((u) => /^https:\/\//i.test(u), 'urlTemplate must be an https URL')
    // `.url()` trims leading/trailing C0/space before validating, so guard the raw value too.
    .refine((u) => !/\s/.test(u), 'urlTemplate must not contain whitespace')
    // Only the documented placeholders are allowed — an unknown `{…}` token (e.g. `{amount}`) is a
    // likely typo that would publish as a literal, so reject it loudly.
    .refine(
      (u) => (u.match(/\{[^}]*\}/g) ?? []).every((p) => KNOWN_PAYMENT_PLACEHOLDERS.has(p)),
      'urlTemplate placeholders must be {total}, {currency}, or {items}',
    )
    // A public host only (placeholders neutralized first so the URL parses). Defence-in-depth: the
    // link is opened client-side, not fetched server-side, but a private/loopback target is never valid.
    .refine((u) => !targetsPrivateHost(u.replace(/\{[^}]*\}/g, '0')), 'urlTemplate must be a public host'),
});

/**
 * Submit the order through a project Form. The cart drawer collects contact fields + the order, then
 * POSTs to the existing `/f/:projectId/:formId` pipeline (stored + emailed, honeypot/time-trap/rate-limit
 * guarded) — so the order lands in the merchant's inbox with the recipient configured on that Form.
 * `formId` must reference a real Form (the endpoint 404s otherwise). Unlike the deep-link channels this
 * one captures the buyer's contact details; it does NOT make the cart authoritative (still an inquiry).
 */
const FormChannelSchema = z.object({
  kind: z.literal('form'),
  label: shopChannelLabel,
  formId: IdSchema,
});

/** A submission channel the cart hands its contents to. */
export const ShopChannelSchema = z.discriminatedUnion('kind', [
  WhatsappChannelSchema,
  MailtoChannelSchema,
  PaymentChannelSchema,
  FormChannelSchema,
]);
export type ShopChannel = z.infer<typeof ShopChannelSchema>;

/** Per-project MINI SHOP configuration (front-end cart). Every field is optional. */
export const ShopSchema = z.object({
  currency: ShopCurrencySchema.optional(),
  channels: z.array(ShopChannelSchema).max(8).optional(),
  /** Override the default "Add to cart" button label (the {{sw-add-to-cart}} default). */
  addToCartLabel: z.string().min(1).max(SHOP_LABEL_MAX).optional(),
  /** Cart drawer heading (cart.js default: "Your cart"). */
  title: z.string().min(1).max(120).optional(),
});
export type Shop = z.infer<typeof ShopSchema>;

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
  /**
   * MINI SHOP — front-end-driven cart configuration (currency + submission channels). Exposed to
   * templates as `{{ website.shop }}` and emitted onto the cart mount by the `{{sw-cart}}` helper for
   * the first-party cart.js runtime. Front-end only: prices are NON-AUTHORITATIVE (see {@link ShopSchema}).
   */
  shop: ShopSchema.optional(),
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
