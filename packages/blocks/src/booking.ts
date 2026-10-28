import Handlebars from 'handlebars';
import { RESERVED_TRANSLATION_DEFAULTS, RESERVED_TRANSLATION_GROUPS, type BookingConfig } from '@sitewright/schema';
import { escapeAttr, escapeHtml } from './escape.js';

/**
 * BOOKING on the published site: `{{sw-booking "<offering>"}}` mounts the booking widget, and
 * `{{sw-booking-status}}` the page where a customer sees their booking and cancels it. Both are filled by
 * booking.js, which ships only on a page carrying one of them, and which reaches the platform's public
 * `/b/…` routes through `window.__swb` (render.ts): the address never sits in the markup.
 *
 * ★ White-label: every link a customer gets points at the business's own site. The status page is a page
 * of the site (`statusPath` in the booking set-up), and booking.js reads the booking's reference from its
 * `?t=` parameter.
 */

/** The widget's mount; its value is the offering id. */
export const BOOKING_MARKER = 'data-sw-booking';
/** The status page's mount. */
export const BOOKING_STATUS_MARKER = 'data-sw-booking-status';

const BOOKING_USE_RE = /\{\{[#~\s]*sw-booking(?:-status)?\b|\sdata-sw-booking(?:-status)?[\s=>]/;

/** True when a source or a rendered page carries either mount, so booking.js has something to fill. */
export function usesBooking(html: string | null | undefined): boolean {
  // The helpers in a source (`{{sw-booking …}}`, `{{#sw-booking-status}}`, whitespace control too) or a mount
  // in rendered markup — not any text that happens to mention them.
  return typeof html === 'string' && BOOKING_USE_RE.test(html);
}

/** What the helpers need from the project's booking set-up, and nothing a visitor may not see. */
export interface RenderBooking {
  /** The offerings a widget can mount, by id. */
  offerings: Record<string, { name: string }>;
  pow: boolean;
  /**
   * The project's captcha when the set-up asks for one: its provider and public site key, or `'missing'`
   * when the set-up asks and the project has none (the API then refuses every booking).
   */
  captcha?: { provider: string; siteKey: string } | 'missing';
  statusPath?: string;
}

/**
 * The render-context projection of a booking set-up, or undefined when it offers nothing. The captcha is the
 * PROJECT's (provider and public site key, as a form gets it); it is carried only when the set-up asks.
 */
export function bookingRenderContext(
  config: BookingConfig | null | undefined,
  captcha?: { provider: string; siteKey: string },
): RenderBooking | undefined {
  if (!config || config.offerings.length === 0) return undefined;
  return {
    offerings: Object.fromEntries(config.offerings.map((o) => [o.id, { name: o.name }])),
    pow: config.pow === true,
    ...(config.captcha ? { captcha: captcha ?? 'missing' } : {}),
    ...(config.statusPath ? { statusPath: config.statusPath } : {}),
  };
}

// The email strings (`booking.mail_*`) are the server's; no page needs them.
const BOOKING_KEYS: readonly string[] = (RESERVED_TRANSLATION_GROUPS.find((g) => g.id === 'booking')?.keys ?? [])
  .map((k) => k.key)
  .filter((k) => !k.startsWith('booking.mail_'));
/** Strings only the status page shows; the widget gets the rest, and both get the shared failure strings. */
const STATUS_ONLY_RE = /^booking\.(?:status_|cancel|started$)/;
const SHARED_KEYS = ['booking.busy', 'booking.failed', 'booking.preview'];
const WIDGET_KEYS = BOOKING_KEYS.filter((k) => !STATUS_ONLY_RE.test(k));
const STATUS_KEYS = BOOKING_KEYS.filter((k) => STATUS_ONLY_RE.test(k) || SHARED_KEYS.includes(k));

/**
 * The strings a runtime shows, resolved for the page's language, as one attribute value. Unicode-escapes
 * the characters dom-serializer leaves raw in an attribute (`<`, `>`, `&`), so the JSON survives the
 * directive pass's parse and serialize unchanged, as the cart's channel list does.
 */
function labelsAttr(keys: readonly string[], tr: (key: string) => string): string {
  // eslint-disable-next-line security/detect-object-injection -- keys come from the frozen registry above
  const labels = Object.fromEntries(keys.map((k) => [k, tr(k) || RESERVED_TRANSLATION_DEFAULTS[k] || '']));
  return escapeAttr(JSON.stringify(labels).replace(/[<>&]/g, (c) => `\\u00${c.charCodeAt(0).toString(16)}`));
}

interface HelperRoot {
  booking?: RenderBooking;
  preview?: boolean;
}

/**
 * Registers `{{sw-booking}}` and `{{sw-booking-status}}`. `tr` reads a reserved catalog key for the page's
 * language ('' when unset); template.ts passes its own, so the two helpers localize exactly as the cart's do.
 */
export function registerBookingHelpers(
  hb: typeof Handlebars,
  tr: (root: unknown, key: string) => string,
): void {
  /**
   * {{sw-booking "<offering>"}} → the booking widget for one offering of the project's booking set-up.
   * An offering that does not exist renders nothing on the site and a note in the editor's preview.
   */
  hb.registerHelper('sw-booking', function swBooking(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const h = (options.hash ?? {}) as Record<string, unknown>;
    const root = (options.data?.root ?? {}) as HelperRoot;
    const id = typeof args[0] === 'string' && args.length > 1 ? args[0] : typeof h.offering === 'string' ? h.offering : '';
    const booking = root.booking;
    const offering = booking && id && Object.prototype.hasOwnProperty.call(booking.offerings, id) ? booking.offerings[id] : undefined;
    if (!booking || !offering) {
      if (!root.preview) return new Handlebars.SafeString('');
      const what = id ? `There is no booking offering “${escapeHtml(id)}”.` : 'Name the offering: {{sw-booking "offering-id"}}.';
      return new Handlebars.SafeString(`<p data-sw-booking-missing>${what} Offerings are set up under Booking in the project settings.</p>`);
    }
    const t = (key: string): string => tr(root, key);
    let attrs = `${BOOKING_MARKER}="${escapeAttr(id)}" role="group" aria-label="${escapeAttr(offering.name)}" data-sw-labels="${labelsAttr(WIDGET_KEYS, t)}"`;
    if (booking.pow) attrs += ' data-sw-pow';
    if (booking.captcha === 'missing') attrs += ' data-sw-captcha-missing';
    else if (booking.captcha) {
      attrs += ` data-sw-captcha="${escapeAttr(booking.captcha.provider)}" data-captcha-sitekey="${escapeAttr(booking.captcha.siteKey)}"`;
    }
    if (booking.statusPath) attrs += ` data-status-path="${escapeAttr(booking.statusPath)}"`;
    if (typeof h.class === 'string' && h.class) attrs += ` class="${escapeAttr(h.class)}"`;
    const loading = escapeHtml(t('booking.loading') || RESERVED_TRANSLATION_DEFAULTS['booking.loading'] || '');
    const noScript = escapeHtml(t('booking.unavailable') || RESERVED_TRANSLATION_DEFAULTS['booking.unavailable'] || '');
    return new Handlebars.SafeString(`<div ${attrs}><p data-sw-part="loading">${loading}</p><noscript><p>${noScript}</p></noscript></div>`);
  });

  /**
   * {{sw-booking-status}} / {{#sw-booking-status}}…{{/sw-booking-status}} → the booking's own page, where
   * the link in a customer's emails lands. Block form: your own copy and layout, with `data-sw-part` names
   * booking.js fills (see BOOKING_STATUS_PARTS); the inline form emits a plain default.
   */
  hb.registerHelper('sw-booking-status', function swBookingStatus(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    const root = (options.data?.root ?? {}) as HelperRoot;
    // With no offering there is no booking to show.
    if (!root.booking) return new Handlebars.SafeString('');
    const t = (key: string): string => tr(root, key) || RESERVED_TRANSLATION_DEFAULTS[key] || '';
    const inner = typeof options.fn === 'function' ? options.fn(this) : defaultStatusMarkup(t);
    return new Handlebars.SafeString(`<div ${BOOKING_STATUS_MARKER} data-sw-labels="${labelsAttr(STATUS_KEYS, (k) => tr(root, k))}">${inner}</div>`);
  });
}

/** Parts an authored status page can declare. Text goes in with textContent only. */
export const BOOKING_STATUS_PARTS = Object.freeze({
  loading: 'status-loading',
  booked: 'status-booked',
  pending: 'status-pending',
  /** A booking held while its payment is made. */
  payment: 'status-payment',
  cancelled: 'status-cancelled',
  unknown: 'status-unknown',
  /** Shown with the booking; holds `data-sw-field="offering"` and `data-sw-field="when"`. */
  details: 'details',
  /** The cancel button, shown while the booking can still be cancelled. */
  cancel: 'cancel',
  /** Shown after the cancel button is pressed; holds the `cancel-yes` and `cancel-no` buttons. */
  cancelConfirm: 'cancel-confirm',
  cancelYes: 'cancel-yes',
  cancelNo: 'cancel-no',
  /** Where a refusal or a failure is written. */
  message: 'message',
} as const);

function defaultStatusMarkup(t: (key: string) => string): string {
  const p = (part: string, key: string, hidden = true): string =>
    `<p data-sw-part="${part}"${hidden ? ' hidden' : ''}>${escapeHtml(t(key))}</p>`;
  return (
    p('status-loading', 'booking.status_loading', false) +
    `<noscript><p>${escapeHtml(t('booking.failed'))}</p></noscript>` +
    p('status-booked', 'booking.status_booked') +
    p('status-pending', 'booking.status_pending') +
    p('status-payment', 'booking.status_payment') +
    p('status-cancelled', 'booking.status_cancelled') +
    p('status-unknown', 'booking.status_unknown') +
    `<p data-sw-part="details" hidden><strong data-sw-field="offering"></strong><br><span data-sw-field="when"></span></p>` +
    `<p><button type="button" class="btn" data-sw-part="cancel" hidden>${escapeHtml(t('booking.cancel'))}</button></p>` +
    `<div data-sw-part="cancel-confirm" hidden><p>${escapeHtml(t('booking.cancel_confirm'))}</p>` +
    `<button type="button" class="btn btn-primary" data-sw-part="cancel-yes">${escapeHtml(t('booking.cancel_yes'))}</button> ` +
    `<button type="button" class="btn" data-sw-part="cancel-no">${escapeHtml(t('booking.cancel_no'))}</button></div>` +
    `<p data-sw-part="message" role="status"></p>`
  );
}

/**
 * The widget's and the status page's styles. Every look is zero-specificity (`:where`), so any rule an
 * author writes wins; only the hiding of `[hidden]` parts is firm, since an author's `display` on a part
 * would otherwise show a step the runtime meant to hide.
 */
export const BOOKING_CSS = [
  '[data-sw-booking] [hidden],[data-sw-booking-status] [hidden]{display:none!important}',
  ':where([data-sw-booking]){display:block;max-width:44rem}',
  ':where([data-sw-booking] [data-sw-part="note"]){font-size:.875rem;opacity:.75;margin:0 0 .75rem}',
  ':where([data-sw-booking] [data-sw-part="nav"]){display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin:0 0 .5rem}',
  ':where([data-sw-booking] [data-sw-part="range-label"]){font-weight:600}',
  ':where([data-sw-booking] [data-sw-part="nav"] button){padding:.375rem .75rem;border:1px solid color-mix(in oklab,var(--sw-color-base-content,#000) 20%,transparent);border-radius:.375rem;background:transparent;color:inherit;font:inherit;cursor:pointer}',
  ':where([data-sw-booking] [data-sw-part="days"]){display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:.375rem;margin:0 0 .75rem}',
  ':where([data-sw-booking] [data-sw-part="weekday"]){font-size:.75rem;text-align:center;opacity:.7}',
  ':where([data-sw-booking] [data-sw-part="day"],[data-sw-booking] [data-sw-part="time"]){display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:2.75rem;padding:.375rem .25rem;border:1px solid color-mix(in oklab,var(--sw-color-base-content,#000) 18%,transparent);border-radius:.5rem;background:transparent;color:inherit;font:inherit;line-height:1.2;cursor:pointer}',
  ':where([data-sw-booking] [data-sw-part="day"] small){font-size:.7rem;opacity:.75}',
  ':where([data-sw-booking] [data-sw-part="day"]:disabled,[data-sw-booking] [data-sw-part="nav"] button:disabled){opacity:.35;cursor:default}',
  ':where([data-sw-booking] [aria-pressed="true"],[data-sw-booking] [data-sw-part="day"][data-sw-in-range]){background:var(--sw-color-primary,#0a7a5a);border-color:var(--sw-color-primary,#0a7a5a);color:var(--sw-color-primary-content,#fff)}',
  ':where([data-sw-booking] [data-sw-part="day"][data-sw-in-range]:not([aria-pressed="true"])){opacity:.8}',
  ':where([data-sw-booking] [data-sw-part="filler"]){visibility:hidden}',
  ':where([data-sw-booking] [data-sw-part="times"]){display:grid;grid-template-columns:repeat(auto-fill,minmax(5.5rem,1fr));gap:.375rem;margin:0 0 .75rem}',
  ':where([data-sw-booking] label[data-sw-part="field"]){display:block;margin:0 0 .75rem}',
  ':where([data-sw-booking] [data-sw-part="label"]){display:block;font-size:.875rem;margin-bottom:.25rem}',
  ':where([data-sw-booking] input:not([type=checkbox]):not([type=radio]),[data-sw-booking] textarea,[data-sw-booking] select){width:100%;padding:.5rem .625rem;border:1px solid color-mix(in oklab,var(--sw-color-base-content,#000) 20%,transparent);border-radius:.375rem;background:transparent;color:inherit;font:inherit}',
  ':where([data-sw-booking] [data-sw-part="choices"]){display:grid;grid-template-columns:repeat(auto-fit,minmax(10rem,1fr));gap:0 .75rem}',
  ':where([data-sw-booking] [data-sw-part="summary"]){font-weight:600;margin:0 0 .75rem}',
  ':where([data-sw-booking] [data-sw-part="actions"]){display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-top:.5rem}',
  ':where([data-sw-booking] [data-sw-part="message"]:empty,[data-sw-booking-status] [data-sw-part="message"]:empty){display:none}',
  ':where([data-sw-booking] [data-sw-part="message"],[data-sw-booking-status] [data-sw-part="message"]){margin:.75rem 0 0}',
  ':where([data-sw-booking] [data-sw-part="captcha"]){margin:0 0 .75rem}',
  ':where([data-sw-booking] [data-sw-part="done-message"]){font-weight:600;margin:0 0 .25rem}',
  ':where([data-sw-booking] [data-sw-part="manage"]){display:inline-block;margin:0 0 .75rem;color:var(--sw-color-primary,#0a7a5a);text-decoration:underline;text-underline-offset:.15em}',
  ':where([data-sw-booking-status] > *){margin:0 0 .75rem}',
  ':where([data-sw-booking-status] [data-sw-part="cancel-confirm"] p){margin:0 0 .5rem}',
  ':where([data-sw-booking-status] [data-sw-part="cancel-confirm"]){display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}',
  ':where([data-sw-booking-status] [data-sw-part="cancel-confirm"] p){flex-basis:100%}',
  '[data-sw-booking] button[disabled]{cursor:progress}',
  // Honeypot: off-screen and out of the accessibility tree, not display:none (some bots skip hidden fields).
  '[data-sw-booking] [data-sw-part="hp"]{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}',
].join('');
