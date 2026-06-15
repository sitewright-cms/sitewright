// RESERVED translation keys — platform-owned UI strings whose ENGLISH defaults ship with the
// platform, and whose other-locale values the operator supplies in the translation catalog
// (`website.translations`). This registry is the SINGLE SOURCE OF TRUTH for three consumers:
//   1. the render-time fallback in the cart helpers (@sitewright/blocks — `RESERVED_TRANSLATION_DEFAULTS`),
//   2. the example seed (apps/api — its EN chrome cart strings are pinned to these defaults), and
//   3. the editor's translation table, which SURFACES a group's keys as editable "ghost rows" (with the
//      English default shown as a placeholder) once the gating feature is active (apps/editor).
//
// ENGLISH ONLY: the platform does NOT bundle non-English defaults. A locale with no operator-supplied
// value falls back to English (the render helpers resolve catalog → … → these defaults). The editor
// ghost rows are how the operator discovers + fills the other-locale cells — no need to know the key
// names by heart, and the catalog table stays clean (only operator-entered overrides are stored).
//
// Mirrors the codebase's "one registry + drift guard" pattern (COMPONENT_CATALOG / GLOBAL_WIDGETS /
// authoring-reference). Keys MUST be KeyNameSchema-valid (letter/underscore start, then [A-Za-z0-9_]).

/** One reserved catalog key: its stable name, an editor-facing label, and the built-in English default. */
export interface ReservedTranslation {
  /** The catalog key (KeyNameSchema-valid). Read by the render helpers + surfaced as a ghost row. */
  key: string;
  /** Human label for the editor's translation table (what the string is FOR). */
  label: string;
  /** The built-in ENGLISH default the platform ships — the render-time fallback + the ghost-row placeholder. */
  default: string;
}

/** A named group of reserved keys, gated on a website feature for editor surfacing. */
export interface ReservedTranslationGroup {
  /** Stable group id (also a documentation handle). */
  id: string;
  /** Section heading shown in the editor's translation table. */
  label: string;
  /**
   * The website feature that must be ACTIVE for this group's ghost rows to surface in the editor
   * (`shop` → `website.shop.enabled`). The render-time fallback always applies regardless; this gate
   * only controls editor SURFACING, so a disabled feature never clutters the translation table.
   * OMIT for a SYSTEM group (always surfaced — built-in component UI strings that every site has).
   */
  feature?: 'shop';
  keys: readonly ReservedTranslation[];
}

/** The reserved-translation registry. Add a group here to make its keys auto-localizable + discoverable. */
export const RESERVED_TRANSLATION_GROUPS: readonly ReservedTranslationGroup[] = [
  {
    // SYSTEM group (no `feature` → always surfaced): built-in accessibility / UI strings the
    // first-party component RUNTIMES emit. Resolved per locale and injected as `window.__SW_T__`
    // ahead of the component scripts (see @sitewright/blocks `systemI18nScript`); the runtimes read
    // it with the English default as the floor. `{n}`/`{total}` are substituted by the runtime.
    id: 'system',
    label: 'System · Components',
    keys: [
      { key: 'close', label: 'Close button (aria-label)', default: 'Close' },
      { key: 'slide_prev', label: 'Slider — previous (aria-label)', default: 'Previous slide' },
      { key: 'slide_next', label: 'Slider — next (aria-label)', default: 'Next slide' },
      { key: 'slide_x_of_y', label: 'Slider — position announce', default: 'Slide {n} of {total}' },
      { key: 'go_to_slide', label: 'Slider — dot (aria-label)', default: 'Go to slide {n}' },
      { key: 'carousel_label', label: 'Slider — role description', default: 'carousel' },
    ],
  },
  {
    id: 'shop_cart',
    label: 'Shop · Cart',
    feature: 'shop',
    keys: [
      { key: 'cart_add', label: 'Add-to-cart button', default: 'Add to cart' },
      { key: 'cart_title', label: 'Cart drawer heading', default: 'Your cart' },
      {
        key: 'cart_note',
        label: 'Cart disclaimer note',
        default:
          'Prices are indicative. This sends an order request — the seller confirms availability and final price.',
      },
      { key: 'cart_added', label: '“Added” confirmation', default: 'Added' },
      { key: 'cart_empty', label: 'Empty-cart message', default: 'Your cart is empty.' },
      { key: 'cart_subtotal', label: 'Subtotal label', default: 'Subtotal' },
      { key: 'cart_clear', label: 'Clear-cart button', default: 'Clear cart' },
      { key: 'cart_sent', label: 'Order-sent confirmation', default: 'Order sent — we will be in touch.' },
      { key: 'cart_order_lead', label: 'Order message lead-in', default: 'I’d like to order:' },
      { key: 'cart_currency_symbol', label: 'Currency symbol', default: '$' },
      { key: 'cart_currency_code', label: 'Currency code (ISO 4217)', default: 'USD' },
    ],
  },
];

/** Flat `key → English default` — the render-time fallback the cart helpers apply last. Proto-safe (no inherited keys). */
export const RESERVED_TRANSLATION_DEFAULTS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(RESERVED_TRANSLATION_GROUPS.flatMap((g) => g.keys.map((k) => [k.key, k.default] as const))),
);

/** The SYSTEM group's keys — the component-runtime UI strings injected as `window.__SW_T__` per page. */
const SYSTEM_GROUP = RESERVED_TRANSLATION_GROUPS.find((g) => g.id === 'system');
if (!SYSTEM_GROUP) throw new Error('reserved-translations: the `system` group is required'); // fail loud on a rename/typo
export const SYSTEM_TRANSLATION_KEYS: readonly string[] = Object.freeze(SYSTEM_GROUP.keys.map((k) => k.key));
