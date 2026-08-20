import { z } from 'zod';
import { JsonObjectStoreSchema } from './json-store.js';
import { targetsPrivateHost, MAX_IDENTIFIER_LENGTH, safeRecord } from './primitives.js';

// Bounded to limit build-output amplification: these fields are injected into every page of a publish
// (up to MAX_BUNDLE.pages). That is a real concern, but it applies EQUALLY to the chrome slots below —
// and those are 256 KB each. So 32 KB of CSS was never a principled ceiling next to 1.25 MB of slots;
// it was just the number nobody revisited, and it is the field an author edits most.
//
// ★ IT WAS A DEADLINE, NOT A LIMIT. `website.criticalCss` is where a site's SIGNATURE chrome CSS has to
// live — a chrome slot rejects <style>, so every header/footer rule an author writes lands here and the
// sheet only ever grows. One real site reached 31,866 of 32,000 characters (99.6%) in normal use, at
// which point a ONE-LINE rule was refused: `.ph-bar{width:var(--ph-w,100%)}` (31 chars) failed to save.
// A ceiling you reach by using the product as intended is a bug with a countdown on it.
//
// Now uniform with SLOT_MAX and the page/template/snippet `source` caps — ONE authoring ceiling across
// every field an author types into, instead of four different numbers with no story between them.
// The real backstops are unchanged and are the ones that actually bound cost: the HTTP body limit, the
// per-bundle page count, and the export/decompression caps.
const CSS_MAX = 256 * 1024;
const HTML_MAX = 256 * 1024;
// Chrome SLOTS (mainNav/sidebars/footer/bottom) get a larger cap than the raw head/scripts:
// they hold a full shared header/footer — and a mechanically NATIVIZED chrome (ported from an imported
// site) is verbose (responsive variants + per-element utilities). A real footer already strained 20k; a
// nativized site-wide `bottom` also holds every DEDUPED global modal (multi-step forms etc.), which blows
// past 64k — so the slot cap now tracks the page/template SOURCE cap (256 KB). Exported so the nativizer
// gates what it writes into a slot on the same cap the schema enforces.
export const SLOT_MAX = 256 * 1024;

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
 * live in the translation catalog under the reserved `cart.currency_symbol` / `cart.currency_code` keys,
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

/**
 * Input types a buyer-collected order field may use — controls the rendered control + mobile keyboard.
 *
 * Scoped to what a deep-link order can actually carry: every one of these produces a `Label: value` line
 * a merchant can act on. Deliberately ABSENT — `file` (there is no upload; a wa.me/mailto link cannot
 * attach anything), `password` (an order is not a credential), and `color`/`range`/`month`/`week` (a hex
 * triplet or a raw slider number is not an order instruction).
 *
 * CHOICE types (`select`, `radio`) read their options from the catalog key `shop.<key>.options` as a
 * comma-separated list, so the choices localize with everything else — see SHOP_CHOICE_FIELD_TYPES.
 */
export const SHOP_FIELD_TYPES = [
  'text',
  'textarea',
  'tel',
  'email',
  'number',
  'url',
  'date',
  'time',
  'select',
  'radio',
  'checkbox',
] as const;
export type ShopFieldType = (typeof SHOP_FIELD_TYPES)[number];

/** The field types that need a `shop.<key>.options` CSV row (one ghost row per choice list). */
export const SHOP_CHOICE_FIELD_TYPES: readonly ShopFieldType[] = ['select', 'radio'];

/** Suffix appended to a choice field's `shop.<key>` catalog key to hold its comma-separated options. */
export const SHOP_OPTIONS_KEY_SUFFIX = '.options';

/**
 * Split a `shop.<key>.options` catalog value into choices. Trims each and drops empties, so trailing
 * commas and stray whitespace are forgiving. A comma cannot appear INSIDE a choice label — that is the
 * documented cost of a one-line, translator-friendly format (the editor row says so).
 */
export function parseShopFieldOptions(csv: unknown): string[] {
  if (typeof csv !== 'string') return [];
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

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

/** Max buyer-input fields on an ORDER form. Higher than the deep-link cap: a whatsapp/mailto message
 *  is a URL and must stay short, whereas this is a real posted form (address, PO number, delivery
 *  notes) and its only cost is the length of the page. */
export const SHOP_MAX_ORDER_FIELDS = 12;

/**
 * The id of the Form the platform provisions for a `form` channel. DERIVED from the channel key, not
 * stored: one source of truth (the shop config) and no id to keep in sync. Prefixed so the Forms tab
 * and the inbox can recognise a shop-owned form on sight.
 */
export function shopOrderFormId(channelKey: string): string {
  return `shop-${channelKey}`;
}

/**
 * SEND THE ORDER TO AN EMAIL ADDRESS, server-side.
 *
 * The buyer fills a form in the cart and it is POSTed to the ordinary `/f/:projectId/:formId`
 * pipeline: stored in the Submissions inbox, emailed to `email`, and guarded by the same honeypot,
 * time-trap, interaction gate, rate limit and (optionally) captcha as any contact form.
 *
 * ★ It still says "form", and that is deliberate: orders land in the Submissions inbox, so calling it
 * anything else would hide where to look for them.
 *
 * ★ The operator gives an ADDRESS, not a Form. It used to take a hand-picked `formId`, which was the
 * wrong shape twice over: the cart rendered a FIXED set of buyer fields and ignored the chosen form's
 * own, so a form with any required field the cart did not send rejected every order with the buyer
 * seeing only "something went wrong" — and it made the operator build and maintain an entity that is
 * really an implementation detail. Now the fields are declared HERE and the platform provisions a
 * managed Form ({@link shopOrderFormId}) from this config on save, so the two cannot disagree.
 */
const FormChannelSchema = z.object({
  kind: z.literal('form'),
  key: ShopItemKeySchema,
  /** Where orders are emailed. SERVER-SIDE ONLY — it reaches the managed Form, never the markup. */
  email: z.string().email().max(320),
  /** Optional subject; lands in a mail Subject header → reject control chars. */
  subject: z
    .string()
    .max(200)
    .refine((v) => !shopHasControlChars(v), 'subject must not contain control characters')
    .optional(),
  /** The buyer fields the cart collects. Freely definable; labels live in the catalog as `shop.<key>`. */
  fields: z.array(ShopChannelFieldSchema).max(SHOP_MAX_ORDER_FIELDS).optional(),
  /** Require a captcha solve, exactly as a contact form can. WHICH captcha is a project setting. */
  captcha: z.boolean().default(false),
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
  /**
   * ★ A legacy `form` channel — one that named a hand-picked `formId` instead of carrying an address —
   * is DROPPED here, not rejected.
   *
   * The field is gone, so such a channel no longer validates. Letting it fail would fail
   * `SettingsSchema`, and that takes the WHOLE settings document down with it: every other setting,
   * on a project whose only sin is not having been re-saved since the shape changed. Dropping the one
   * dead channel loses a checkout button and nothing else — the operator re-adds it with an address,
   * and every order already taken is still in the inbox.
   */
  channels: z
    .preprocess(
      (v) => (Array.isArray(v) ? v.filter((c) => !(c && typeof c === 'object' && (c as { kind?: unknown }).kind === 'form' && typeof (c as { email?: unknown }).email !== 'string')) : v),
      z.array(ShopChannelSchema).max(8),
    )
    .optional(),
  // NOTE: the cart's display TEXT (add-to-cart button, drawer title/note/etc., currency symbol/code, and
  // each channel/field label) is all TRANSLATABLE — it lives in the translation catalog (reserved cart_*
  // keys + per-channel/field `shop.<key>` keys), NOT here. Settings holds only non-text STRUCTURE.
});
export type Shop = z.infer<typeof ShopSchema>;

/** The OPTIONAL consent categories (Necessary is implicit + always granted). */
export const CONSENT_CATEGORY_VALUES = ['functional', 'analytics', 'marketing'] as const;

/** The third-party integration presets the registry understands. `custom` = an arbitrary external script. */
export const CONSENT_INTEGRATION_PRESETS = ['ga4', 'gtm', 'custom'] as const;

/** A bare hostname, optionally one leading `*.` wildcard. NO scheme/path/port/bare-`*` (the CSP builder prepends https://). */
const CSP_HOST_RE = /^(\*\.)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

/**
 * One consent-gated third-party integration. The runtime loads it ONLY after the visitor consents to
 * its `category`; publish derives the per-site CSP origin allow-list from these (curated preset bundles
 * + the `src` host + any extra `origins`). Owner-set, schema-bounded — never attacker-injectable.
 */
export const ConsentIntegrationSchema = z
  .object({
    /** Stable slug — the runtime de-dupe key + the data attribute on the injected <script>. */
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/i, 'id must be a slug (letters/digits/-, ≤64 chars)'),
    /** Display name (editor + docs), e.g. "Google Analytics". */
    name: z.string().min(1).max(80),
    /** The consent category that gates it (Necessary can't gate — it is always granted). */
    category: z.enum(CONSENT_CATEGORY_VALUES),
    /** Integration kind. Omit = `custom` (an arbitrary external script via `src`). */
    preset: z.enum(CONSENT_INTEGRATION_PRESETS).optional(),
    /** ga4: the `G-XXXX` measurement id. gtm: the `GTM-XXXX` container id. */
    measurementId: z.string().max(40).optional(),
    /** custom: the external script URL to inject on consent (HTTPS only). */
    src: z.string().max(2048).optional(),
    /** custom: load the script async (default true). */
    async: z.boolean().optional(),
    /**
     * ADVANCED — extra CSP hosts beyond the preset bundle + the `src` host (e.g. a chatbot's
     * websocket/CDN origin). Bare hostnames or a single `*.` wildcard; NO scheme/path/port/bare-`*`
     * (the publisher prepends `https://`). Added to script-src + connect-src.
     */
    origins: z
      .array(z.string().max(253).regex(CSP_HOST_RE, 'each origin is a bare hostname (optionally *.), no scheme/path'))
      .max(20)
      .optional(),
    /**
     * ADVANCED — extra `frame-src` hosts for a script SDK that injects its OWN `<iframe>` widget (e.g. a
     * chat bubble / support panel). Without this a consented SDK's script loads but its widget iframe is
     * CSP-blocked. Bare hostnames or a single `*.` wildcard; NO scheme/path/port/bare-`*` (the publisher
     * prepends `https://`). Added to frame-src (gated by the integration's category like the script).
     */
    frameOrigins: z
      .array(z.string().max(253).regex(CSP_HOST_RE, 'each origin is a bare hostname (optionally *.), no scheme/path'))
      .max(20)
      .optional(),
  })
  .superRefine((v, ctx) => {
    const preset = v.preset ?? 'custom';
    if (preset === 'custom') {
      if (!v.src) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['src'], message: 'a custom integration needs a script src' });
      } else {
        let httpsHost = false;
        try {
          httpsHost = new URL(v.src).protocol === 'https:';
        } catch {
          httpsHost = false;
        }
        if (!httpsHost) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['src'], message: 'src must be a valid https:// URL' });
        else if (targetsPrivateHost(v.src)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['src'], message: 'src must not point to a private/loopback host' });
      }
    } else if (!v.measurementId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['measurementId'], message: `${preset} needs a measurementId` });
    } else {
      const re = preset === 'ga4' ? /^G-[A-Z0-9]+$/i : /^GTM-[A-Z0-9]+$/i;
      if (!re.test(v.measurementId))
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['measurementId'], message: `${preset} measurementId must look like ${preset === 'ga4' ? 'G-XXXXXXX' : 'GTM-XXXXXX'}` });
    }
  });
export type ConsentIntegration = z.infer<typeof ConsentIntegrationSchema>;

/**
 * CONSENT MANAGER configuration (front-end cookie-consent). Like {@link ShopSchema}, this holds only
 * non-text STRUCTURE — all banner/category COPY is TRANSLATABLE and lives in the catalog (reserved
 * `consent_*` keys). `integrations` is the registry of third-party code the runtime gates by category.
 */
export const ConsentSchema = z.object({
  /**
   * Master ON switch. When not `true` no consent banner is auto-injected and the {{sw-consent-settings}} button renders
   * NOTHING (no banner site-wide, so `consent.js` is never shipped) and the editor hides the consent
   * translation ghost rows. A fresh project starts OFF; the operator opts in.
   */
  enabled: z.boolean().optional(),
  /**
   * Consent VERSION. Bump it to re-prompt every visitor — a stored decision below this version is
   * treated as absent (e.g. after adding a new tracker). Defaults to 1.
   */
  version: z.number().int().min(1).max(1_000_000).optional(),
  /** Banner placement: `bar` (centered bottom bar, default) or `box` (bottom-left card). */
  layout: z.enum(['bar', 'box']).optional(),
  /** Which optional categories to offer (Necessary is always implicit/on). Default: all three. */
  categories: z.array(z.enum(CONSENT_CATEGORY_VALUES)).max(3).optional(),
  /** Show an explicit "Reject all" button on the first-layer banner (GDPR-recommended). Default true. */
  denyButton: z.boolean().optional(),
  /** Privacy-policy link shown in the banner — an internal page path or absolute URL (render-sanitized). */
  privacyHref: z.string().max(2048).optional(),
  /**
   * Default consent category for an auto-gated author `<iframe>` (a cross-origin embed: YouTube/Vimeo/
   * Maps/Calendly/…) that carries no explicit `data-sw-consent="<category>"` marker. Third-party iframes
   * are held click-to-load whenever the manager is `enabled`; this is the bucket they fall into. Default
   * `functional`.
   */
  defaultEmbedCategory: z.enum(CONSENT_CATEGORY_VALUES).optional(),
  /**
   * Managed third-party INTEGRATIONS (analytics / chatbots / scripts). Each is loaded ONLY after its
   * category is consented; publish derives the per-site CSP origin allow-list from them. See
   * {@link ConsentIntegrationSchema}.
   */
  integrations: z.array(ConsentIntegrationSchema).max(20).optional(),
});
export type Consent = z.infer<typeof ConsentSchema>;

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

/**
 * Curated BUTTON effect flourishes — CSS `.sw-btn-fx-<name>` utilities. Each layers a signature
 * motion on top of the always-on `.btn` baseline (ripple + hover lift/shadow + fill-to-accent). The
 * SAME class is used as the site-wide default (on `<body>`, via {@link websiteEffectsClasses}) or as a
 * per-button override (on the `.btn` itself); the effect CSS guards with `:not([class*="sw-btn-fx-"])`
 * so a per-button choice cleanly replaces the site default. Source-of-truth for the editor picker, the
 * `@utility sw-btn-fx-<name>` blocks in @sitewright/tailwind effects.ts, and the JS runtime markers.
 */
export const BUTTON_EFFECTS = [
  // motion — pure hover / motion / glint; NEVER paints the resting face, so it layers on ANY face
  'lift', 'glow', 'pulse', 'ring', 'magnetic', 'arrow', 'bounce', 'jelly',
  'icon-spin', 'long-shadow', 'width-expand',
  'sheen', 'spotlight', 'shine', 'sparkle',
  // reveal — an accent animation reveals on hover; rests as the AUTHOR'S face (shines on a hollow
  // btn-outline / btn-ghost, but composes over a solid variant too — the effect never forces a face)
  'fill-center', 'fill-slide', 'fill-up', 'fill-down', 'skew-sweep', 'bubble',
  'border-draw', 'outline-fill', 'text-link',
  // face — the effect DEFINES the resting face by design (the chosen variant is a colour input)
  'frost', 'gradient-move', 'two-tone', 'ghost-gradient',
] as const;
export type ButtonEffect = (typeof BUTTON_EFFECTS)[number];

/**
 * The two ORTHOGONAL axes of a button:
 *   FACE   — the resting look, chosen by the author as a daisyUI variant class (`btn-primary`,
 *            `btn-secondary`, `btn-ghost` = transparent, `btn-outline` = hollow, `btn-soft`, …) or a
 *            bare `.btn`. Owns the resting background / text / border.
 *   EFFECT — the `sw-btn-fx-<name>` hover / motion treatment. A `ButtonEffectKind` says how it relates
 *            to the face:
 *     - `motion` — pure hover / motion / glint. Composes on ANY face; never touches the resting look.
 *     - `reveal` — an accent overlay animates in on hover. Rests as the author's face (does NOT force
 *                  one); designed to shine on a hollow `btn-outline` / `btn-ghost`, composes over solid.
 *     - `face`   — the effect DEFINES the resting face (a gradient / two-tone / frosted / clipped-text
 *                  button). Picking it IS the look; the variant supplies a colour, it isn't overridden.
 * A `motion` / `reveal` effect + any FACE variant compose freely — that is the whole point of the split.
 */
export type ButtonEffectKind = 'motion' | 'reveal' | 'face';

/** Per-effect kind — source of truth for the editor pickers, the docs, and the CSS drift-guard test. */
export const BUTTON_EFFECT_KIND: Record<ButtonEffect, ButtonEffectKind> = {
  lift: 'motion', glow: 'motion', pulse: 'motion', ring: 'motion', magnetic: 'motion',
  arrow: 'motion', bounce: 'motion', jelly: 'motion', 'icon-spin': 'motion',
  'long-shadow': 'motion', 'width-expand': 'motion', sheen: 'motion', spotlight: 'motion',
  shine: 'motion', sparkle: 'motion',
  'fill-center': 'reveal', 'fill-slide': 'reveal', 'fill-up': 'reveal', 'fill-down': 'reveal',
  'skew-sweep': 'reveal', bubble: 'reveal', 'border-draw': 'reveal', 'outline-fill': 'reveal',
  'text-link': 'reveal',
  frost: 'face', 'gradient-move': 'face', 'two-tone': 'face', 'ghost-gradient': 'face',
};

/** Human hint for the pickers: which FACE an effect is designed to pair with. */
export function buttonEffectFacePairing(effect: ButtonEffect): 'any' | 'hollow' | 'defines' {
  const kind = BUTTON_EFFECT_KIND[effect];
  return kind === 'face' ? 'defines' : kind === 'reveal' ? 'hollow' : 'any';
}

/** Display labels for the button-effect picker ("Family: Detail" style where useful). */
export const BUTTON_EFFECT_LABELS: Record<ButtonEffect, string> = {
  lift: 'Lift',
  glow: 'Glow',
  pulse: 'Pulse',
  ring: 'Ring Expand',
  magnetic: 'Magnetic',
  arrow: 'Arrow',
  bounce: 'Bounce',
  jelly: 'Jelly',
  'icon-spin': 'Icon Spin',
  'long-shadow': 'Long Shadow',
  frost: 'Frost',
  'width-expand': 'Width Expand',
  sheen: 'Sheen',
  spotlight: 'Spotlight',
  shine: 'Shine',
  sparkle: 'Sparkle',
  'fill-center': 'Fill: Center',
  'fill-slide': 'Fill: Slide',
  'border-draw': 'Border Draw',
  'outline-fill': 'Outline Fill',
  'fill-up': 'Fill: Up',
  'fill-down': 'Fill: Down',
  'skew-sweep': 'Skew Sweep',
  bubble: 'Bubble',
  'text-link': 'Text Link',
  'gradient-move': 'Gradient Move',
  'two-tone': 'Two-Tone',
  'ghost-gradient': 'Ghost Gradient',
};

/** Button effects that need the button-effects JS runtime (pointer-driven). Ripple is always-on baseline. */
export const JS_BUTTON_EFFECTS = ['magnetic', 'spotlight'] as const;

/** Whether a chosen button effect needs the pointer-driven JS runtime (magnetic / spotlight). */
export function buttonEffectUsesRuntime(effect: string | null | undefined): boolean {
  return !!effect && (JS_BUTTON_EFFECTS as readonly string[]).includes(effect);
}

/**
 * Button SHAPE — the corner/silhouette axis (`.sw-btn-shape-<name>`). Radius shapes set
 * `--sw-btn-radius`; clip shapes (cut/skewed) use `clip-path` (a drop-shadow replaces the box-shadow,
 * so they don't combine with the outer-glow effects); icon shapes (square/circle) are 1:1, label-less.
 * Like effects, the class doubles as a site default (on `<body>`) or a per-button override.
 */
export const BUTTON_SHAPES = ['rounded', 'soft', 'sharp', 'pill', 'cut', 'skewed', 'square', 'circle'] as const;
export type ButtonShape = (typeof BUTTON_SHAPES)[number];

/** Display labels for the shape picker. */
export const BUTTON_SHAPE_LABELS: Record<ButtonShape, string> = {
  rounded: 'Rounded',
  soft: 'Soft',
  sharp: 'Sharp',
  pill: 'Pill',
  cut: 'Cut',
  skewed: 'Skewed',
  square: 'Square (icon)',
  circle: 'Circle (icon)',
};

/** Shapes valid as a SITE-WIDE default (excludes the icon-only square/circle, which make no sense for every button). */
export const BUTTON_DEFAULT_SHAPES = ['rounded', 'soft', 'sharp', 'pill', 'cut', 'skewed'] as const;
export type ButtonDefaultShape = (typeof BUTTON_DEFAULT_SHAPES)[number];

/** Button ACCENT — the hover/fill/glow colour role (`.sw-btn-accent-<role>`), default secondary. */
export const BUTTON_ACCENTS = ['primary', 'secondary', 'accent', 'neutral'] as const;
export type ButtonAccent = (typeof BUTTON_ACCENTS)[number];

/** Baseline defaults for a bare `.btn` (no override classes) — emitted as `<body>` classes only when a non-default is chosen. */
export const DEFAULT_BUTTON_ACCENT: ButtonAccent = 'secondary';
export const DEFAULT_BUTTON_SHAPE: ButtonDefaultShape = 'rounded';

/**
 * Curated PRELOADER effects. The chosen one (≠ 'none') makes the platform inject a
 * `<div data-sw-preloader class="sw-loading sw-preloader-<name>">` as the first body child and ship the
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
 * STICKY (fixed) TOP-HEADER modes — the no-code "make the `#main-nav` landmark stick to the top"
 * picker. These are POSITIONAL only. 'none' (or absent) = a static in-flow header (scrolls away with
 * the page). The other modes set `position:fixed` and emit the `.sw-top-padding` spacer (clears
 * content under the fixed header) + `scroll-padding-top` (in-page anchors land below it).
 *   - pinned         — fixed + always visible.
 *   - hide-on-scroll — fixed; slides up out of view on scroll-down, back in on scroll-up.
 *
 * The platform deliberately ships NO "how the bar looks once you scroll" mode. Such an effect can only
 * be generic if it is STRUCTURE-INDEPENDENT — sliding the whole landmark is; condensing it is not,
 * since that requires knowing which row collapses. Any visual scroll response (shrink, colour change,
 * shadow, logo swap) is therefore AUTHORED, keyed on `html.sw-scrolled` — a hook the runtime now sets
 * on EVERY site regardless of mode. `--sw-header-h` is likewise emitted everywhere as the published
 * bar height. See {@link LEGACY_STICKY_HEADER_MODES} for the retired `shrink` mode, and the
 * CSS/runtime in @sitewright/blocks sticky-header.ts.
 */
export const STICKY_HEADER_MODES = ['pinned', 'hide-on-scroll'] as const;
export type StickyHeaderMode = (typeof STICKY_HEADER_MODES)[number];

/**
 * RETIRED mode values. Still ACCEPTED by the schema — never reject stored settings, because a
 * `WebsiteSettingsSchema.parse` failure takes the whole project down, not just the header — but NOT
 * offered in the picker, and normalized away at render by {@link normalizeStickyHeader}.
 *
 * `shrink` condensed a DaisyUI `.navbar`'s padding past a scroll threshold. That privileged ONE header
 * recipe: the platform can only ship a scroll effect that is STRUCTURE-INDEPENDENT, and "condense"
 * isn't — it needs to know which row collapses. On a hand-authored header the mode was selected, named
 * "shrink", and did nothing, which read as a platform bug rather than as "this is your job". Sliding
 * the whole landmark (`hide-on-scroll`) IS structure-independent, so it stays. Visual response to
 * scrolling is now uniformly the author's, keyed on the universal `html.sw-scrolled` hook.
 */
export const LEGACY_STICKY_HEADER_MODES = ['shrink'] as const;

const STICKY_HEADER_CHOICES = ['none', ...STICKY_HEADER_MODES, ...LEGACY_STICKY_HEADER_MODES] as const;

/**
 * A `stickyHeader` value AS STORED — the offered modes plus 'none' plus any retired value still
 * accepted by the schema. Render-side entry points take THIS (they run {@link normalizeStickyHeader}
 * themselves); use {@link StickyHeaderMode} only for a value already known to be live.
 */
export type StickyHeaderSetting = (typeof STICKY_HEADER_CHOICES)[number];

export const STICKY_HEADER_LABELS: Record<StickyHeaderMode, string> = {
  pinned: 'Pinned (always visible)',
  'hide-on-scroll': 'Hide on scroll down',
};

/**
 * Resolve a stored `stickyHeader` value to a live mode. A retired value keeps its POSITIONING (the
 * part the platform legitimately owns) and loses only its recipe-specific styling: `shrink` → `pinned`.
 * So an existing site stays fixed and keeps `html.sw-scrolled`; it just no longer gets the built-in
 * `.navbar` condense, which it could only ever have used with the stock recipe anyway.
 */
export function normalizeStickyHeader(
  mode: string | null | undefined,
): StickyHeaderMode | 'none' | undefined {
  if (!mode) return undefined;
  if (mode === 'shrink') return 'pinned';
  return (STICKY_HEADER_MODES as readonly string[]).includes(mode) || mode === 'none'
    ? (mode as StickyHeaderMode | 'none')
    : undefined;
}

/**
 * Whether to ship the sticky-header JS runtime. ALWAYS TRUE — `html.sw-scrolled` is a UNIVERSAL
 * authoring hook, not a private detail of two named modes.
 *
 * It used to ship only for `hide-on-scroll`/`shrink`, which made "is the page scrolled" silently
 * unavailable to every other site. That mattered because the platform's built-in `shrink` styling
 * condenses a DaisyUI `.navbar` — so a CUSTOM header gets nothing from the mode and has to author its
 * own collapse against `html.sw-scrolled`. Authors hit a dead end: the hook they needed existed only
 * if they selected a mode whose visible behaviour did not apply to them. Now any header, in any mode
 * (including a static one), can key scroll-state styling off the class.
 *
 * The runtime is rAF-throttled with a passive listener and degrades by itself: it reads the body class
 * to decide whether to also track the hide-on-scroll direction, so with no mode selected it only
 * toggles `sw-scrolled`. Takes NO argument — the decision no longer depends on the mode, and a call
 * site passing one would imply otherwise. Kept as a named predicate so re-gating stays a one-line change.
 */
export function stickyHeaderUsesRuntime(): boolean {
  return true;
}

/**
 * Whether the site-wide SCROLLSPY toggle is on (`website.effects.scrollSpy`). When true the runtime
 * ships and governs `#main-nav` (its desktop + mobile menus). A per-element `data-sw-scrollspy`
 * attribute is detected separately by the publish/preview source scan (`usesScrollSpy`), so a custom
 * on-page nav opts in without this flag. Source-of-truth for the publish/preview runtime gate.
 */
export function scrollSpyUsesRuntime(enabled: boolean | null | undefined): boolean {
  return enabled === true;
}

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
const BUTTON_EFFECT_CHOICES = ['none', ...BUTTON_EFFECTS] as const;
export const WebsiteEffectsSchema = z.object({
  navEffect: z.enum(NAV_EFFECT_CHOICES).optional(),
  /** Site-wide DEFAULT button flourish (a bare `.btn` inherits it; 'none' = baseline only). */
  buttonEffect: z.enum(BUTTON_EFFECT_CHOICES).optional(),
  /** Site-wide DEFAULT button hover/fill accent role (a bare `.btn` inherits it; baseline = secondary). */
  buttonAccent: z.enum(BUTTON_ACCENTS).optional(),
  /** Site-wide DEFAULT button shape (a bare `.btn` inherits it; baseline = rounded). Icon shapes are per-button only. */
  buttonShape: z.enum(BUTTON_DEFAULT_SHAPES).optional(),
  preloaderEffect: z
    .enum(['none', 'spinner', 'dual', 'dots', 'bars', 'pulse', 'progress', 'logo-pulse', 'logo-draw', 'logo-sheen'])
    .optional(),
  /** Show a BACK-TO-TOP button (a `.btn sw-btn-shape-square` that appears after the first viewport of scroll). */
  backToTop: z.boolean().optional(),
  /**
   * STICKY top-header mode — POSITIONING only; fixes the `#main-nav` landmark to the top ('none' = a
   * static header). Sets `position:fixed` + the `.sw-top-padding` spacer + the anchor offset. The
   * `--sw-header-h` token and the `html.sw-scrolled` runtime ship for EVERY site regardless of this
   * value, so any header can author its own scroll response. Accepts the retired `shrink` (normalized
   * to `pinned`). See {@link STICKY_HEADER_MODES} and {@link LEGACY_STICKY_HEADER_MODES}.
   */
  stickyHeader: z.enum(STICKY_HEADER_CHOICES).optional(),
  /**
   * SCROLLSPY — highlight the main + mobile nav link whose in-page section (`<a href="#about">` →
   * `<section id="about">`) is currently scrolled into view. Emits the `sw-scrollspy` body class; the
   * runtime then governs the `#main-nav` landmark. A per-element `data-sw-scrollspy` attribute opts a
   * custom on-page nav in independently (no flag needed). See {@link scrollSpyUsesRuntime}.
   */
  scrollSpy: z.boolean().optional(),
  /** Custom nav effect — raw HTML (style/script) injected at body-end when navEffect is 'none'. */
  navCode: z.string().max(HTML_MAX).optional(),
  /** Custom button effect — raw HTML injected at body-end when buttonEffect is 'none'. */
  buttonCode: z.string().max(HTML_MAX).optional(),
  /** Custom preloader — raw HTML overlay injected as the first body child when preloaderEffect is 'none'. */
  preloaderCode: z.string().max(HTML_MAX).optional(),
  /**
   * Paint the platform's solid brand backdrop behind CUSTOM preloader markup. Only meaningful with
   * `preloaderCode` (the built-in effects always carry it). Off by default: custom code owns its own
   * look, and some overlays are deliberately transparent — opting in gives a custom spinner the same
   * flash-free field the built-ins have without hand-rolling a full-bleed layer.
   */
  preloaderBackdrop: z.boolean().optional(),
});
export type WebsiteEffects = z.infer<typeof WebsiteEffectsSchema>;

/**
 * The space-joined `<body>` effect classes for the website effects ('' when all-default). Buttons use
 * three per-axis default classes — `sw-btn-fx-<effect>` / `sw-btn-accent-<role>` / `sw-btn-shape-<shape>`
 * — each only emitted for a NON-default choice (the baseline `.btn` already covers secondary accent +
 * rounded shape + no flourish), so a default site stays byte-identical. The same class names double as
 * per-button override classes; the effect CSS guards with `:not([class*="sw-btn-<axis>-"])` so a
 * per-button override on a `.btn` cleanly replaces the body default.
 */
export function websiteEffectsClasses(effects: WebsiteEffects | undefined): string {
  if (!effects) return '';
  const nav = effects.navEffect && effects.navEffect !== 'none' ? `sw-nav-${effects.navEffect}` : '';
  const btnFx = effects.buttonEffect && effects.buttonEffect !== 'none' ? `sw-btn-fx-${effects.buttonEffect}` : '';
  const btnAccent =
    effects.buttonAccent && effects.buttonAccent !== DEFAULT_BUTTON_ACCENT ? `sw-btn-accent-${effects.buttonAccent}` : '';
  const btnShape =
    effects.buttonShape && effects.buttonShape !== DEFAULT_BUTTON_SHAPE ? `sw-btn-shape-${effects.buttonShape}` : '';
  // The sticky-header mode rides on `<body>` too — the JS runtime reads it to pick its scroll behavior
  // (the CSS is emitted by renderDocument, keyed on the mode, not on this class). NORMALIZED first, so a
  // stored retired value emits the class of the mode it resolves to (`shrink` → `sw-header-pinned`)
  // rather than a dead `sw-header-shrink` that nothing styles or reads.
  const headerMode = normalizeStickyHeader(effects.stickyHeader);
  const header = headerMode && headerMode !== 'none' ? `sw-header-${headerMode}` : '';
  // The site-wide scrollspy flag rides on `<body>` too — the runtime reads `sw-scrollspy` to govern the
  // `#main-nav` landmark (its desktop + mobile menus). A custom on-page nav uses the per-element attribute.
  const spy = effects.scrollSpy ? 'sw-scrollspy' : '';
  return [nav, btnFx, btnAccent, btnShape, header, spy].filter(Boolean).join(' ');
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
  /** Whether that custom preloader asked for the platform backdrop. False when there is no custom code. */
  preloaderBackdrop: boolean;
} {
  if (!effects) return { bodyEnd: '', preloader: undefined, preloaderBackdrop: false };
  const navOn = (effects.navEffect ?? 'none') === 'none' && effects.navCode ? effects.navCode : '';
  const btnOn = (effects.buttonEffect ?? 'none') === 'none' && effects.buttonCode ? effects.buttonCode : '';
  const preOn = (effects.preloaderEffect ?? 'none') === 'none' && effects.preloaderCode ? effects.preloaderCode : undefined;
  return {
    bodyEnd: [navOn, btnOn].filter(Boolean).join('\n'),
    preloader: preOn,
    // Tied to the code actually being emitted, so the flag can't leak onto a built-in effect.
    preloaderBackdrop: preOn !== undefined && effects.preloaderBackdrop === true,
  };
}

/**
 * Validate a site base URL (`website.siteUrl`), returning a human-readable error message or `null`
 * when it's acceptable. Shared by the schema refinement (server, on save) AND the editor's inline
 * field validation (client) so both enforce the SAME rules with the SAME message.
 *
 * Accepts an absolute http(s) URL, with or without a path, and WITH OR WITHOUT a trailing slash (the
 * slash is normalized away at build time — see `siteBase`). Rejects a missing scheme, a query or
 * fragment, embedded whitespace, and HTML-significant characters.
 */
export function siteUrlIssue(value: string): string | null {
  // Specific, format-oriented checks first (so the message names the exact problem); the generic
  // URL-parse catch-all runs LAST — otherwise `new URL()` would reject e.g. an embedded space with
  // a vague "not a valid URL" before the precise "remove the spaces" message could fire.
  if (value.length > 2048) return 'URL is too long (max 2048 characters).';
  if (!/^https?:\/\//i.test(value)) return 'Enter an absolute URL that starts with https:// (or http://) — for example https://acme.com';
  if (/\s/.test(value)) return 'Remove the spaces from the URL.';
  if (/[?#]/.test(value)) return 'Use the base URL only — no "?" query or "#" fragment.';
  if (/["<>'&]/.test(value)) return `Remove special characters from the URL (" < > ' &).`;
  try {
    new URL(value);
  } catch {
    return 'That is not a valid URL — for example https://acme.com';
  }
  return null;
}

/** Expiry windows offered for the security.txt `Expires` field (RFC 9116 §2.5.5). */
export const SECURITY_TXT_EXPIRY_YEARS = [1, 2, 5] as const;
export type SecurityTxtExpiryYears = (typeof SECURITY_TXT_EXPIRY_YEARS)[number];
/**
 * Default expiry window. RFC 9116 RECOMMENDS under a year, but that recommendation assumes a file
 * someone maintains; an agency site is finalized and then left alone for years, and the contact we
 * emit is the site's OWN contact page — it keeps working for exactly as long as the site does. A
 * one-year default would lapse on a live, perfectly reachable site. Author-selectable (1/2/5).
 */
export const DEFAULT_SECURITY_TXT_EXPIRY_YEARS: SecurityTxtExpiryYears = 5;

/**
 * Validate a security.txt link field (`Policy` / `Acknowledgments`), returning a human-readable
 * error or `null`. Shared by the schema (server, on save) and the editor's inline field check so
 * both enforce the SAME rule with the SAME message — mirroring {@link siteUrlIssue}.
 *
 * https only: RFC 9116 §2.5.3 requires it for web URIs, and these values are published verbatim in
 * a machine-read file, so an http link would downgrade whoever follows it.
 */
export function securityLinkIssue(value: string): string | null {
  if (value.length > 2048) return 'URL is too long (max 2048 characters).';
  if (!/^https:\/\//i.test(value)) return 'Enter an absolute URL that starts with https:// — RFC 9116 requires https here.';
  if (/\s/.test(value)) return 'Remove the spaces from the URL.';
  if (/["<>'&]/.test(value)) return `Remove special characters from the URL (" < > ' &).`;
  try {
    new URL(value);
  } catch {
    return 'That is not a valid URL — for example https://acme.com/security-policy/';
  }
  return null;
}

const SecurityLinkSchema = z.string().superRefine((u, ctx) => {
  const issue = securityLinkIssue(u);
  if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
});

/**
 * Opt-in RFC 9116 `security.txt`, published at `/.well-known/security.txt`.
 *
 * Contacts are SELECTED from identity the project already holds rather than retyped, so they can't
 * drift from the site's real contact details. At least one selection is required — a security.txt
 * with no `Contact` is invalid per RFC 9116 §2.5.3, so "enabled with nothing picked" is rejected
 * here at the boundary rather than producing a broken file at publish time.
 */
export const WebsiteSecuritySchema = z
  .object({
    /** Emit `.well-known/security.txt` on publish. Off unless the author turns it on. */
    enabled: z.boolean().optional(),
    /** Page whose URL is published as the preferred `Contact` (typically the contact-form page). */
    contactPageId: z.string().max(200).optional(),
    /** Publish `company.telephone` as a `tel:` contact (requires an E.164 number). */
    usePhone: z.boolean().optional(),
    /** Publish `company.email` as a `mailto:` contact. Off by default — a public file gets harvested. */
    useEmail: z.boolean().optional(),
    /** Years until `Expires`, recomputed on every publish. Unset → {@link DEFAULT_SECURITY_TXT_EXPIRY_YEARS}. */
    expiryYears: z.union([z.literal(1), z.literal(2), z.literal(5)]).optional(),
    /** Optional `Policy` link — the disclosure policy for this site. */
    policyUrl: SecurityLinkSchema.optional(),
    /** Optional `Acknowledgments` link — a page thanking past reporters. */
    acknowledgmentsUrl: SecurityLinkSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.enabled && !v.contactPageId && !v.usePhone && !v.useEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['enabled'],
        message: 'security.txt needs at least one contact — choose a contact page, or the company phone or email.',
      });
    }
  });
export type WebsiteSecurity = z.infer<typeof WebsiteSecuritySchema>;

/**
 * Site-search settings. Normalization must match on BOTH sides — the build indexes with it and the
 * browser queries with it — so the resolved value is written INTO the emitted index rather than read
 * separately by the runtime, which could not otherwise know it.
 */
export const SearchSettingsSchema = z.object({
  /**
   * Fold Latin diacritics so `Müller` matches `Muller` (default true). Turn OFF for a language where
   * accented characters are distinct letters rather than decorated ones — Swedish `å`/`ä`/`ö` — where
   * folding trades away precision an author may want to keep. Marks over NON-Latin bases (Thai tone
   * marks, Devanagari matras, Hebrew niqqud) are never folded either way: there a mark is a letter.
   */
  foldDiacritics: z.boolean().optional(),
});
export type SearchSettings = z.infer<typeof SearchSettingsSchema>;

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
   * Body source order: `mainNav`, [page body], `sidebarLeft`, `sidebarRight`,
   * `footer`, `bottom`. Nav links use root-absolute paths (`{{sw-url path}}`); on a multilingual
   * site they are auto-prefixed with the current locale at publish.
   *
   * SEMANTIC LANDMARKS ARE PLATFORM-OWNED. The skeleton wraps each slot (and the page body) in a
   * semantic element with a fixed unique id — `<nav id="main-nav">`,
   * `<main id="page-content">`, `<aside id="sidebar-left">`, `<aside id="sidebar-right">`,
   * `<footer id="footer">`, `<div id="bottom">`. So slot content (and page `source`) must NOT
   * itself use `<nav>`, `<main>`, `<footer>`, or `<aside>` — the validator rejects them to keep
   * each landmark unique. Use neutral `<div>`/`<section>`/`<ul>` (DaisyUI's `.footer`/`.navbar`
   * classes style any element).
   *
   * - `mainNav` — the site navigation (desktop bar + mobile drawer, one recipe), top of `<body>`
   *   (→ `<nav id="main-nav">`).
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
  mainNav: z.string().max(SLOT_MAX).optional(),
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
  // One shared validator (siteUrlIssue) so the server rejection and the editor's inline field error
  // report the SAME rule + message. It covers: absolute http(s), valid URL, no query/fragment (would
  // break robots.txt / the sitemap <loc>), no whitespace, and no HTML-significant chars (defense in
  // depth — harmless where escaped, but rejected at the boundary so it can't reach a future raw sink).
  siteUrl: z
    .string()
    .superRefine((u, ctx) => {
      const issue = siteUrlIssue(u);
      if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
    })
    .optional(),
  /**
   * DATA FILES emitted as `.json` next to the pages at publish.
   *
   * The counterpart to the on-page `{{sw-json-data}}` island. An island is inlined into the HTML of
   * every page that renders it and re-sent on every visit; a data file ships ONCE, is cached by the
   * browser like any other asset, and can be fetched lazily — which is what a list too large to inline
   * (a 3,000-image gallery, a whole archive) actually needs.
   *
   * Each entry names exactly ONE source:
   *   · `dataset` — that dataset's PUBLISHED entries (drafts are never emitted), optionally projected
   *     to `fields` so a file carries the three columns a grid needs rather than every column.
   *   · `folder` — the images in that media folder, as `{url,alt,width,height}`.
   *
   * `path` is a plain filename ending in `.json`; the file is emitted at `data/<path>` and fetched from
   * there. It is deliberately NOT a free path — a traversal could overwrite a generated file during
   * publish — and the `data/` prefix is not cosmetic: `.json` is NOT a servable root extension, because
   * the build manifest `release.json` sits at the root and must stay unreachable.
   */
  dataFiles: z
    .array(
      z
        .object({
          path: z
            .string()
            .min(1)
            .max(128)
            .regex(/^[A-Za-z0-9][\w.-]*\.json$/, 'path must be a plain filename ending in .json (no directories)')
            // `..` can't appear given the pattern above, but assert it: this value names a WRITE target.
            .refine((v) => !v.includes('..'), 'path must not contain ".."'),
          /** Emit this dataset's published entries. Mutually exclusive with `folder`. */
          dataset: z.string().min(1).max(64).optional(),
          /** Emit this media folder's images. Mutually exclusive with `dataset`. */
          folder: z.string().min(1).max(256).optional(),
          /** Keep only these fields from each row (dataset sources only). Empty/absent = every field. */
          fields: z.array(z.string().min(1).max(64)).max(32).optional(),
          /**
           * Thumbnail size the emitted image URLs point at. Default `md`.
           *
           * Applies to BOTH sources: a folder listing is all images, and a dataset row carries them
           * too (a product photo, an `<img>` in a rich-text cell) — those are rewritten to published
           * URLs at this size.
           *
           * ★ This is what the export MATERIALIZES for every image in the folder — the published site
           * bundles only referenced variants, so a data file has to declare which one it references or
           * its URLs point at files the export never produced.
           */
          size: z.enum(['xs', 'sm', 'md', 'lg', 'xl']).optional(),
          /**
           * ALSO emit a `full` URL per row at this larger size (folder sources only).
           *
           * ★ A gallery needs TWO urls per image and one size cannot be both: the tile renders at a
           * few hundred pixels and the lightbox opens full-screen. With one size an author must pick a
           * side — a soft lightbox, or a grid that ships megabytes of oversized tiles. Measured on a
           * 3,384-image folder: `sm` tiles are 19 MB where `md` is 58 MB, and the `lg` a lightbox
           * wants is 133 MB — but only for the photos someone actually opens, one at a time.
           *
           * Both sizes are materialized, so the export grows by the second variant.
           */
          full: z.enum(['xs', 'sm', 'md', 'lg', 'xl']).optional(),
        })
        .superRefine((v, ctx) => {
          if (!v.dataset === !v.folder) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'each data file needs exactly one source: dataset or folder',
            });
          }
          if (v.folder && v.fields?.length) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'fields= applies to a dataset source, not a folder' });
          }
          if (v.dataset && v.full) {
            // A dataset row's URLs are rewritten IN PLACE inside whatever field holds them, so there
            // is no second slot to put a `full` in — accepting it here would silently do nothing.
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'full= applies to a folder source, not a dataset' });
          }
        }),
    )
    .max(20)
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
   * CONSENT MANAGER — front-end cookie-consent (banner + per-category preferences). Exposed to templates
   * as `{{ website.consent }}` and emitted onto the AUTO-INJECTED consent mount for the
   * first-party consent.js runtime. Copy is translatable (reserved `consent_*` keys). See {@link ConsentSchema}.
   */
  consent: ConsentSchema.optional(),
  /**
   * SITE SEARCH — how the `Search` component's index normalizes words (docs/site-search.md §4).
   * The index itself is emitted by every build; this only tunes matching.
   */
  search: SearchSettingsSchema.optional(),
  /**
   * EXTRA CSP ORIGINS the published site may load from / talk to, beyond the strict `'self'` floor.
   *
   * Only meaningful on a PLATFORM-HOSTED origin, which is the one place the policy is actually enforced
   * (as a response header — an exported site ships no enforcing CSP at all). Use it when the site talks to
   * a third party that is NOT a consent-gated tracker: a custom form endpoint, a captcha, a fonts/CDN host,
   * a maps embed.
   *
   * Before this existed the only ways to widen the policy were to enable the whole CONSENT MANAGER (which
   * injects a cookie banner site-wide — a heavy, visible change to make for a CSP entry) or to plant tags
   * whose sole purpose was to be scanned: a `<script type="text/plain" data-sw-consent src>` for
   * script/connect, and an `<iframe>` INSIDE AN HTML COMMENT for frame-src, since the scanner is a regex
   * over the raw HTML. Both worked and neither was defensible.
   *
   * Bare hostnames, optionally one leading `*.` — no scheme, path or port (the publisher prepends
   * `https://`). Merged unconditionally, independent of the consent manager.
   */
  cspOrigins: z
    .object({
      /** `script-src` — a third-party script host (also allow-listed for `connect-src`). */
      script: z.array(z.string().max(253).regex(CSP_HOST_RE, 'each origin is a bare hostname (optionally *.), no scheme/path')).max(20).optional(),
      /** `connect-src` — fetch/XHR/WebSocket targets: your own API, a form endpoint, an analytics beacon. */
      connect: z.array(z.string().max(253).regex(CSP_HOST_RE, 'each origin is a bare hostname (optionally *.), no scheme/path')).max(20).optional(),
      /** `frame-src` — embedded iframes: a captcha challenge, a map, a video player, a booking widget. */
      frame: z.array(z.string().max(253).regex(CSP_HOST_RE, 'each origin is a bare hostname (optionally *.), no scheme/path')).max(20).optional(),
      /** `font-src` — a web-font host (self-hosted fonts need nothing here). */
      font: z.array(z.string().max(253).regex(CSP_HOST_RE, 'each origin is a bare hostname (optionally *.), no scheme/path')).max(20).optional(),
      /** `style-src` — an external stylesheet host. */
      style: z.array(z.string().max(253).regex(CSP_HOST_RE, 'each origin is a bare hostname (optionally *.), no scheme/path')).max(20).optional(),
      /** `media-src` — externally hosted video/audio. */
      media: z.array(z.string().max(253).regex(CSP_HOST_RE, 'each origin is a bare hostname (optionally *.), no scheme/path')).max(20).optional(),
    })
    .optional(),
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
  /**
   * Delivery format for {{sw-image}}: `avif` emits a `<picture>` with an AVIF `<source>` above the WebP
   * one (smaller bytes on supporting browsers, at ~2× the materialized files); unset/`webp` emits a
   * single WebP `<img>`. Thumbnails are generated on demand regardless; this only governs which SOURCE
   * tiers the responsive markup references. Unset → the instance default (admin `defaultImageFormat`).
   */
  imageDelivery: z.enum(['webp', 'avif']).optional(),
  /**
   * Cap uploaded image ORIGINALS to this width (downscaled + re-encoded to WebP when the cap bites, like
   * the importer). Unset → uncapped: the retained original keeps full resolution. Either way, delivery
   * thumbnails top out at `xl` (2400px), so this only bounds the on-disk retained-original footprint.
   */
  imageUploadCap: z.number().int().min(200).max(10000).optional(),
  /**
   * Opt-in RFC 9116 security.txt, emitted to `.well-known/security.txt` on publish.
   * See {@link WebsiteSecuritySchema}.
   */
  security: WebsiteSecuritySchema.optional(),
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
