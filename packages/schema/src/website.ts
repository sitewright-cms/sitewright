import { z } from 'zod';
import { JsonObjectStoreSchema } from './json-store.js';
import { targetsPrivateHost, IdSchema, MAX_IDENTIFIER_LENGTH, safeRecord } from './primitives.js';

// Bounded to limit build-output amplification (these fields are injected into
// every page of a publish, up to MAX_BUNDLE.pages). CSS is smaller than the
// HTML head/footer blocks in practice.
const CSS_MAX = 10_000;
const HTML_MAX = 20_000;
// Chrome SLOTS (topNav/mobileNav/sidebars/footer/bottom) get a larger cap than the raw head/scripts:
// they hold a full shared header/footer — and a mechanically NATIVIZED chrome (ported from an imported
// site) is verbose (responsive variants + per-element utilities), so 20k is too tight for a real footer.
const SLOT_MAX = 64_000;

// --- website.data: an editable, free-form JSON object the author manages in the CMS (a graphical
// tree editor), exposed in templates as {{ website.data.* }} and {{#each website.data.x}}. It is the
// LOCAL counterpart to `jsonDataUrl`/`json_data` (which is fetched from a URL at publish) and is
// available in BOTH preview and publish. Values are output-escaped like any binding; the namespace
// is bounded + prototype-safe. The validator + bounds are shared with page.data/template.data — see
// `json-store.ts`.
/** The `website.data` editable JSON store — a root OBJECT (the shared bounded, prototype-safe store). */
export const WebsiteDataSchema = JsonObjectStoreSchema;

// --- website.translations: the project's i18n MESSAGE CATALOG — a dedicated, KEY-FIRST table
// (`key → { locale → string }`) kept SEPARATE from `website.data` (which is the author's free-form
// JSON, not a translation store). Key-first so it reads as a table (rows = keys, columns = locales)
// and the editor + "what's untranslated?" view fall out naturally. Resolved per render against
// `page.locale` (with the project defaultLocale as fallback) by `translate()` in @sitewright/core and
// the `{{sw-translate}}` helper / `data-sw-translate` directive. Bounded + prototype-safe.
export const TRANSLATION_VALUE_MAX = 2000;
/** Max catalog keys. Higher than the generic 256-record cap: a fully-translated multi-locale site
 *  (chrome + every page's strings) legitimately needs many keys; value/locale-count are still bounded. */
export const MAX_TRANSLATION_ENTRIES = 2000;
// Locale codes are the object keys of each cell map. Mirrors project.ts `LocaleSchema` (kept inline to
// avoid a website ↔ project import cycle — project.ts imports WebsiteSettingsSchema).
const TranslationLocaleKey = z.string().min(1).max(35).regex(/^[A-Za-z0-9-]+$/, 'invalid locale code');
/** One key's per-locale cells: `{ en: "…", de: "…" }`. */
const TranslationCellsSchema = safeRecord(z.string().max(TRANSLATION_VALUE_MAX), TranslationLocaleKey);
/**
 * A catalog key — a flat identifier OR a dotted SCOPE path (`home.headline`, `services.cta`). Scopes are
 * purely organizational: the catalog is looked up FLAT (`t["home.headline"]`), never path-traversed, so a
 * dotted key is just an opaque string the editor groups by its first segment. Each segment is a valid
 * identifier (linear regex, no ReDoS); `safeRecord` rejects a bare proto key, and flat lookup of a dotted
 * key can never resolve to a prototype property.
 */
export const TranslationKeySchema = z
  .string()
  .min(1)
  .max(MAX_IDENTIFIER_LENGTH)
  // Linear: an identifier, then dot-introduced identifier segments (the literal `.` makes the groups
  // non-overlapping → no backtracking); length-capped above (not ReDoS), like ColorTokenKeySchema.
  .regex(/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/, 'must be an identifier or dotted scope path'); // eslint-disable-line security/detect-unsafe-regex
/** The project translation table: `key → { locale → string }`. Sibling of `website.data`. */
export const TranslationsSchema = safeRecord(TranslationCellsSchema, TranslationKeySchema, MAX_TRANSLATION_ENTRIES);
export type Translations = z.infer<typeof TranslationsSchema>;

// --- shop (MINI SHOP): front-end-driven cart configuration ---------------------------------------
// A "mini shop" is FRONT-END only: the browser builds a cart in localStorage and hands its contents
// to a submission CHANNEL (a WhatsApp / mailto deep link, or a payment link). There is NO server-side
// cart and NO payment capture — the submitted cart is an order INQUIRY and the prices are
// NON-AUTHORITATIVE (client-tamperable). The merchant confirms price + availability and collects
// payment out-of-band. Every field here is PUBLIC by nature (it is how a customer reaches the
// merchant) and is emitted into the published HTML on the cart mount for the first-party `cart.js`
// runtime to read — see packages/blocks/src/cart.ts and the `{{sw-cart}}` helper. PR-2 adds a `form`
// channel (cart → an order Form). A `Shop` block + a settings UI arrive in PR-3.
/** Max buyer-input fields a single whatsapp/mailto channel may collect (the editor disables "Add field" here). */
export const SHOP_MAX_CHANNEL_FIELDS = 8;
const KNOWN_PAYMENT_PLACEHOLDERS = new Set(['{total}', '{currency}', '{items}']);

/** True if `value` contains an ASCII control char (CR/LF must not reach a mail Subject header). */
function shopHasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Currency FORMATTING for the cart total — symbol placement + fraction digits (client-side,
 * display-only, non-authoritative). The display SYMBOL + ISO CODE are translatable (per-locale) so they
 * live in the translation catalog under the reserved `cart_currency_symbol` / `cart_currency_code` keys,
 * NOT here — a multi-region site can show `$`/`USD` for one locale and `€`/`EUR` for another.
 */
export const ShopCurrencySchema = z.object({
  /** Symbol placement around the amount. */
  position: z.enum(['before', 'after']).default('before'),
  /** Fraction digits shown (0 for JPY, 2 for most). */
  decimals: z.number().int().min(0).max(4).default(2),
});
export type ShopCurrency = z.infer<typeof ShopCurrencySchema>;

/** Stable per-channel / per-field key — its display LABEL lives in the catalog under `shop.<key>` (translatable). */
const ShopItemKeySchema = z
  .string()
  .min(1)
  .max(MAX_IDENTIFIER_LENGTH)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'must be a valid identifier')
  // Defence-in-depth: a proto key would only ever form the dotted catalog key `shop.<key>` (a harmless
  // flat lookup), but reject it at the boundary so the key set stays clean.
  .refine((k) => k !== '__proto__' && k !== 'constructor' && k !== 'prototype', 'disallowed key');

/** Input types a buyer-collected order field may use — controls the rendered control + mobile keyboard. */
export const SHOP_FIELD_TYPES = ['text', 'textarea', 'tel', 'email'] as const;
export type ShopFieldType = (typeof SHOP_FIELD_TYPES)[number];

/**
 * A custom buyer-input field collected in the cart drawer BEFORE a WhatsApp / mailto order is sent.
 * The cart renders each as an input; on submit every FILLED field is appended to the order message as a
 * `Label: value` line BELOW the order (see packages/blocks/src/cart.ts). The display LABEL (the buyer
 * prompt + the `Label:` key in the message) is TRANSLATABLE — it lives in the catalog under `shop.<key>`;
 * the cart helper resolves it per locale (and the resolved text is URL-encoded by cart.js + escaped into
 * the mount attribute). Front-end only, like the rest of the mini shop — order context, not authoritative.
 */
export const ShopChannelFieldSchema = z.object({
  /** Stable key — the field's display LABEL (the buyer prompt + the `Label:` key in the order message)
   *  is translatable and lives in the catalog under `shop.<key>`. */
  key: ShopItemKeySchema,
  /** Input type — controls the rendered control + the mobile keyboard. Defaults to a single-line text input. */
  type: z.enum(SHOP_FIELD_TYPES).default('text'),
  /** Whether the buyer must fill this field before the order can be sent. */
  required: z.boolean().optional(),
});
export type ShopChannelField = z.infer<typeof ShopChannelFieldSchema>;

/** A per-channel list of buyer-input fields (collected before the deep link opens). Capped for sanity. */
const shopChannelFields = z.array(ShopChannelFieldSchema).max(SHOP_MAX_CHANNEL_FIELDS).optional();

/** Order via a WhatsApp deep link (`wa.me/<number>?text=<order>`) — zero backend. */
const WhatsappChannelSchema = z.object({
  kind: z.literal('whatsapp'),
  key: ShopItemKeySchema,
  /** Recipient in E.164 (`+` then 7–15 digits, no leading 0); cart.js strips the `+` for wa.me. */
  number: z.string().regex(/^\+[1-9]\d{6,14}$/, 'number must be E.164, e.g. +14155550123'),
  /** Optional intro line prepended to the auto-built order text (URL-encoded by cart.js). */
  intro: z.string().max(280).optional(),
  /** Buyer-input fields collected in the cart before the WhatsApp link opens; appended as `Label: value` lines. */
  fields: shopChannelFields,
});

/** Order via a `mailto:` deep link — zero backend. */
const MailtoChannelSchema = z.object({
  kind: z.literal('mailto'),
  key: ShopItemKeySchema,
  email: z.string().email().max(320),
  /** Optional subject; lands in a mail Subject header → reject control chars. */
  subject: z
    .string()
    .max(200)
    .refine((v) => !shopHasControlChars(v), 'subject must not contain control characters')
    .optional(),
  /** Buyer-input fields collected in the cart before the email opens; appended as `Label: value` lines. */
  fields: shopChannelFields,
});

/**
 * "Pay now" via a payment-provider deep link. `urlTemplate` may contain the placeholders `{total}`
 * / `{currency}` / `{items}`, substituted client-side before `window.open`. Works cleanly for
 * amount-bearing links (PayPal.me `…/{total}`); a FIXED-amount link (e.g. a Stripe Payment Link, which
 * can't take an arbitrary total in its URL) is also valid — use `provider: 'custom'` with no
 * placeholder. The opened amount is CLIENT-CONTROLLED and therefore non-authoritative — the merchant
 * must reconcile the paid amount against the order.
 */
const PaymentChannelSchema = z.object({
  kind: z.literal('payment'),
  key: ShopItemKeySchema,
  /** Informational provider tag (does not change behavior). `stripe` is folded into `custom` — Stripe
   *  Payment Links are fixed-amount, so they can't carry the cart total. A legacy stored `stripe` is
   *  COERCED to `custom` (back-compat: re-saving/importing an older config never errors). */
  provider: z.preprocess((v) => (v === 'stripe' ? 'custom' : v), z.enum(['paypal', 'custom'])).optional(),
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
  key: ShopItemKeySchema,
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
  /**
   * Master ON switch for the mini-shop. When not `true` the cart helpers ({{sw-cart}} /
   * {{sw-add-to-cart}}) render NOTHING — the shop is off site-wide regardless of any config below — and
   * the editor collapses the Shop settings section + hides its cart-string ghost rows. A fresh project
   * starts OFF; the operator opts in with the "Enable shop" toggle (the example seed sets it true).
   */
  enabled: z.boolean().optional(),
  currency: ShopCurrencySchema.optional(),
  channels: z.array(ShopChannelSchema).max(8).optional(),
  // NOTE: the cart's display TEXT (add-to-cart button, drawer title/note/etc., currency symbol/code, and
  // each channel/field label) is all TRANSLATABLE — it lives in the translation catalog (reserved cart_*
  // keys + per-channel/field `shop.<key>` keys), NOT here. Settings holds only non-text STRUCTURE.
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
/**
 * Curated NAV-LINK effect schemes — CSS `.sw-nav-<name>` utilities (see @sitewright/tailwind's
 * effect layer). Source-of-truth for the enum below, the editor picker label map, and a coverage
 * test. Most are pure CSS; the three in {@link JS_NAV_EFFECTS} are JS-backed (a shared sliding
 * indicator / a cursor-following spotlight) and make the platform ship the nav-effects runtime.
 */
export const NAV_EFFECTS = [
  'box-solid',
  'line-bottom',
  'line-sliding-bottom',
  'sliding-pill',
  'highlighter',
  'brackets',
  'brackets-curly',
  'box-fill-left',
  'box-draw',
  'glass-pill',
  'spotlight-sliding',
  'blob',
  'line-top-down',
  'line-squiggle',
  'box-fill-up',
  'dot-to-pill',
  'chevron',
  'corner-ticks',
  'box-shadow',
] as const;
export type NavEffect = (typeof NAV_EFFECTS)[number];

/** Display labels for the nav-effect picker (the "Family: Detail" names can't be derived from slugs). */
export const NAV_EFFECT_LABELS: Record<NavEffect, string> = {
  'box-solid': 'Box: Solid',
  'line-bottom': 'Line: Bottom',
  'line-sliding-bottom': 'Line: Sliding at Bottom',
  'sliding-pill': 'Sliding Pill',
  highlighter: 'Highlighter',
  brackets: 'Brackets',
  'brackets-curly': 'Brackets: Curly',
  'box-fill-left': 'Box: Fill Left',
  'box-draw': 'Box: Draw',
  'glass-pill': 'Glass Pill',
  'spotlight-sliding': 'Spotlight: Sliding',
  blob: 'Blob',
  'line-top-down': 'Line: Top-Down',
  'line-squiggle': 'Line: Squiggle',
  'box-fill-up': 'Box: Fill Up',
  'dot-to-pill': 'Dot-To-Pill',
  chevron: 'Chevron',
  'corner-ticks': 'Corner Ticks',
  'box-shadow': 'Box: Shadow',
};

/**
 * Nav schemes that need the nav-effects JS runtime: a shared indicator that *slides* between items
 * (the two sliding schemes) or a radial glow that *follows the cursor* (spotlight). The platform
 * ships `nav-effects.js` and the runtime injects the indicator + wires pointer tracking. Every other
 * scheme is pure CSS. Source-of-truth for the publish/preview runtime gate.
 */
export const JS_NAV_EFFECTS = ['line-sliding-bottom', 'sliding-pill', 'spotlight-sliding'] as const;

/** Whether a chosen nav effect needs the nav-effects JS runtime (a sliding indicator / spotlight). */
export function navEffectUsesRuntime(effect: string | null | undefined): boolean {
  return !!effect && (JS_NAV_EFFECTS as readonly string[]).includes(effect);
}

/** Curated BUTTON effect schemes — CSS `.sw-btn-<name>` utilities (layer on any daisyUI `.btn`). */
export const BUTTON_EFFECTS = ['lift', 'glow', 'sheen', 'press', 'pulse', 'ring'] as const;
export type ButtonEffect = (typeof BUTTON_EFFECTS)[number];

/**
 * Curated PRELOADER effects. The chosen one (≠ 'none') makes the platform inject a
 * `<div data-sw-preloader class="loading sw-preloader-<name>">` as the first body child and ship the
 * preloader runtime (overlay shown on load + during navigation, then cleared). 'logo-*' variants use
 * the site logo (company.logo), falling back to a built-in brand mark. Source-of-truth for the enum
 * below + the editor picker + the markup/CSS in @sitewright/blocks preloader.ts.
 */
export const PRELOADER_EFFECTS = [
  'spinner',
  'dual',
  'dots',
  'bars',
  'pulse',
  'progress',
  'logo-pulse',
  'logo-draw',
  'logo-sheen',
] as const;
export type PreloaderEffect = (typeof PRELOADER_EFFECTS)[number];

/**
 * Site-wide nav/button appearance (the no-code "effects" picker). 'none' (or absent) = no built-in
 * scheme — the author may instead supply their OWN effect as a custom-code blob (the `*Code` fields,
 * edited via the "None / Custom Code" option), or apply a scheme class per element. The chosen
 * built-in schemes become `<body>` classes at render (see {@link websiteEffectsClasses}); the custom
 * code is injected when its effect is 'none' (see {@link websiteEffectsCustomCode}).
 *
 * The `*Code` fields are RAW owner-only HTML (mixed `<style>`/`<script>`/markup), injected UNESCAPED
 * at render — same @security invariants as `website.head`/`scripts` (owner/admin-set; rendered only
 * inside the sandboxed preview or written to the exported artifact, never as a same-origin editor
 * text/html response).
 */
const NAV_EFFECT_CHOICES = ['none', ...NAV_EFFECTS] as const;
export const WebsiteEffectsSchema = z.object({
  navEffect: z.enum(NAV_EFFECT_CHOICES).optional(),
  buttonEffect: z.enum(['none', 'lift', 'glow', 'sheen', 'press', 'pulse', 'ring']).optional(),
  preloaderEffect: z
    .enum(['none', 'spinner', 'dual', 'dots', 'bars', 'pulse', 'progress', 'logo-pulse', 'logo-draw', 'logo-sheen'])
    .optional(),
  /** Custom nav effect — raw HTML (style/script) injected at body-end when navEffect is 'none'. */
  navCode: z.string().max(HTML_MAX).optional(),
  /** Custom button effect — raw HTML injected at body-end when buttonEffect is 'none'. */
  buttonCode: z.string().max(HTML_MAX).optional(),
  /** Custom preloader — raw HTML overlay injected as the first body child when preloaderEffect is 'none'. */
  preloaderCode: z.string().max(HTML_MAX).optional(),
});
export type WebsiteEffects = z.infer<typeof WebsiteEffectsSchema>;

/** The space-joined `<body>` effect classes for the website effects ('' when no effects are chosen). */
export function websiteEffectsClasses(effects: WebsiteEffects | undefined): string {
  if (!effects) return '';
  const nav = effects.navEffect && effects.navEffect !== 'none' ? `sw-nav-${effects.navEffect}` : '';
  const btn = effects.buttonEffect && effects.buttonEffect !== 'none' ? `sw-btn-${effects.buttonEffect}` : '';
  return [nav, btn].filter(Boolean).join(' ');
}

/**
 * The active custom effect code for a site: a nav/button effect's custom code applies only when that
 * effect is 'none' (or absent), and is injected at body-end (CSS + optional JS); a custom preloader is
 * injected as the first body child (the overlay). Returns empty/undefined when no custom code applies,
 * so a site with built-in (or no) effects emits byte-identical output. Used by publish + preview.
 */
export function websiteEffectsCustomCode(effects: WebsiteEffects | undefined): {
  bodyEnd: string;
  preloader: string | undefined;
} {
  if (!effects) return { bodyEnd: '', preloader: undefined };
  const navOn = (effects.navEffect ?? 'none') === 'none' && effects.navCode ? effects.navCode : '';
  const btnOn = (effects.buttonEffect ?? 'none') === 'none' && effects.buttonCode ? effects.buttonCode : '';
  const preOn = (effects.preloaderEffect ?? 'none') === 'none' && effects.preloaderCode ? effects.preloaderCode : undefined;
  return { bodyEnd: [navOn, btnOn].filter(Boolean).join('\n'), preloader: preOn };
}

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
   *   {{#each nav.header}}<a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}}>{{sw-label}}</a>{{/each}}
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
   *   no-show (→ `<div id="bottom">`). A `<dialog id="x">` placed here is a GLOBAL MODAL: a nav
   *   placeholder (a `kind:'link'` page) with `link.target` `#x` opens it from any menu (the
   *   platform's nav-link runtime calls `showModal()` on the matching `<dialog>`). (A
   *   `<script type="application/ld+json">` block is NOT allowed here — the no-JS slot validator
   *   rejects all `<script>`; the platform emits JSON-LD in `<head>` from company data.)
   */
  topNav: z.string().max(SLOT_MAX).optional(),
  mobileNav: z.string().max(SLOT_MAX).optional(),
  sidebarLeft: z.string().max(SLOT_MAX).optional(),
  sidebarRight: z.string().max(SLOT_MAX).optional(),
  footer: z.string().max(SLOT_MAX).optional(),
  bottom: z.string().max(SLOT_MAX).optional(),
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
   * The project i18n MESSAGE CATALOG — a key-first `{ key: { locale: string } }` table, separate from
   * `data`. Resolved per render against `page.locale` by `{{sw-translate}}` / the `data-sw-translate`
   * directive. See {@link TranslationsSchema}.
   */
  translations: TranslationsSchema.optional(),
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
  // NOTE: local-hosting publish options (enable, preview-token gate, HTML minify) are NO LONGER website
  // fields. Local hosting is now an opt-in `local` DEPLOY TARGET (see DeployTargetSchema) that carries
  // those serve options — a project is served at `/sites/<slug>/` only when a local target exists, and
  // assembly happens at deploy time.
  /**
   * MINI SHOP — front-end-driven cart configuration (currency + submission channels). Exposed to
   * templates as `{{ website.shop }}` and emitted onto the cart mount by the `{{sw-cart}}` helper for
   * the first-party cart.js runtime. Front-end only: prices are NON-AUTHORITATIVE (see {@link ShopSchema}).
   */
  shop: ShopSchema.optional(),
  /**
   * Nav/button EFFECT schemes applied site-wide (the no-code picker). Rendered as `<body>` classes;
   * the CSS tree-shakes per scheme. Authors keep full freedom (per-element scheme classes + custom
   * CSS via `criticalCss`). See {@link WebsiteEffectsSchema}.
   */
  effects: WebsiteEffectsSchema.optional(),
  /**
   * Opt-in light/dark THEMES. When true, the rendered site gains a dark variant (the theme tokens get
   * DaisyUI's curated dark neutrals; the brand accent is dark-tuned for legibility). OFF by default, so
   * existing single-theme sites are unaffected. Pairs with {@link defaultTheme}.
   */
  enableThemes: z.boolean().optional(),
  /**
   * When themes are enabled, the INITIAL theme: 'auto' follows the visitor's OS via
   * prefers-color-scheme; 'light'/'dark' pins it (server-rendered onto `<html data-sw-theme>`).
   * Defaults to 'auto'. Ignored when {@link enableThemes} is off.
   */
  defaultTheme: z.enum(['auto', 'light', 'dark']).optional(),
  /**
   * Site-wide CONTENT WIDTH — the max-width of the main content container in every section. Exposed as
   * the `--sw-container` CSS custom property and applied through the platform `.sw-container` helper, so
   * one knob aligns (and retunes) every section's content. A CSS px length (e.g. `1200px`) or `none`
   * for a full-bleed site. The editor offers presets (Narrow 960 / Normal 1200 / Wide 1440 / Full) plus
   * a custom px value. Unset → the platform default (1200px).
   */
  containerWidth: z
    .string()
    .regex(/^(none|\d{2,4}px)$/, 'containerWidth must be a px length (e.g. "1200px") or "none"')
    .optional(),
});

/** Resolve {@link WebsiteSettings.containerWidth} to the `--sw-container` value (`none` = full-bleed). */
export const DEFAULT_CONTAINER_WIDTH = '1200px';
export function containerWidthVar(containerWidth: string | undefined): string {
  return containerWidth && /^(none|\d{2,4}px)$/.test(containerWidth) ? containerWidth : DEFAULT_CONTAINER_WIDTH;
}
/** Editor presets → `--sw-container` value (`none` = Full); custom values are any px. */
export const CONTAINER_WIDTH_PRESETS: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'Narrow', value: '960px' },
  { label: 'Normal', value: '1200px' },
  { label: 'Wide', value: '1440px' },
  { label: 'Full', value: 'none' },
];

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
