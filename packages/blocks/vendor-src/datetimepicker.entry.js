// DateTimePicker runtime ENTRY — bundled by scripts/gen-vendor.mjs into
// src/vendor/datetimepicker-runtime.ts. Air Datepicker (MIT) + first-party wiring. The authored
// contract stays declarative: the `data-sw-component="datetimepicker"` marker goes DIRECTLY on a
// text <input> and the picker mode + behavior come from `data-*` config attributes — the library
// is an implementation detail behind the marker (agents/tenants never call it).
//
// Authored markup (see COMPONENT_CATALOG): just `<input data-sw-component="datetimepicker">` for
// the 90% case (a date picker), `data-mode="range|datetime|time"` for the other modes, and the
// data-* attributes for full control (format, min/max, inline, locale, steps, buttons). With no
// JS the element stays a usable text <input> (type a value), so it degrades gracefully and the
// input's name/value still submit inside a form.
//
// gen-vendor rewrites Air Datepicker's "air-datepicker*" CSS class prefix to a vendor-neutral
// "sw-datepicker*" in BOTH this bundle and the stylesheet (the license banner keeps the real
// "air-datepicker@x" attribution), so no vendor name leaks into the published DOM/CSS.
import AirDatepicker from 'air-datepicker';
import enLocale from 'air-datepicker/locale/en';
import deLocale from 'air-datepicker/locale/de';
import esLocale from 'air-datepicker/locale/es';

// The locale modules are CJS with `exports.default`; esbuild's interop hands us the object
// directly, but tolerate either shape.
function loc(m) {
  return m && m.default ? m.default : m;
}
var LOCALES = { en: loc(enLocale), de: loc(deLocale), es: loc(esLocale) };

// The popup placements Air Datepicker accepts as a string (it also takes a callback, which is not
// author-facing). Used to validate data-position so a typo can't mis-place the popup.
var POSITIONS = {
  'bottom left': 1, 'bottom right': 1, 'bottom center': 1,
  'top left': 1, 'top right': 1, 'top center': 1,
  'left top': 1, 'left bottom': 1, 'left center': 1,
  'right top': 1, 'right bottom': 1, 'right center': 1,
};

function attr(el, name, fallback) {
  var v = el.getAttribute(name);
  return v === null || v === '' ? fallback : v;
}
// A boolean switch is true when present-and-empty (data-inline) or ="true".
function flag(el, name) {
  var v = el.getAttribute(name);
  return v === '' || v === 'true';
}
function intAttr(el, name) {
  var v = el.getAttribute(name);
  if (v === null || v === '') return undefined;
  var n = parseInt(v, 10);
  return isNaN(n) ? undefined : n;
}

// Resolve the picker language: an explicit data-locale wins, else the page's <html lang>, floored
// to English. Air Datepicker's locale object supplies the day/month names AND the Today/Clear
// button labels, so the picker is localized with no extra strings.
function pickLocale(el) {
  var want = (attr(el, 'data-locale', '') || (document.documentElement.getAttribute('lang') || '')).slice(0, 2).toLowerCase();
  return LOCALES[want] || LOCALES.en;
}

function enhance(el) {
  if (el.getAttribute('data-sw-enhanced') === 'true') return;
  el.setAttribute('data-sw-enhanced', 'true');

  // date (default) | datetime (date + time) | time (only the clock) | range (a start–end span).
  var mode = attr(el, 'data-mode', 'date');
  var isRange = mode === 'range';
  var withTime = mode === 'datetime' || mode === 'time';

  // A single-date pick closes the popup; a range needs two clicks, so it stays open unless the
  // author opts in. data-autoclose overrides either default.
  var ac = el.getAttribute('data-autoclose');
  var opts = {
    locale: pickLocale(el),
    range: isRange,
    timepicker: withTime,
    onlyTimepicker: mode === 'time',
    autoClose: ac === 'false' ? false : isRange ? ac === 'true' : true,
  };

  var fmt = attr(el, 'data-format', '');
  if (fmt) opts.dateFormat = fmt;
  var timeFmt = attr(el, 'data-time-format', '');
  if (timeFmt) opts.timeFormat = timeFmt;

  var min = attr(el, 'data-min', '');
  if (min) opts.minDate = min;
  var max = attr(el, 'data-max', '');
  if (max) opts.maxDate = max;

  if (flag(el, 'data-inline')) opts.inline = true;

  var firstDay = intAttr(el, 'data-first-day');
  if (firstDay !== undefined) opts.firstDay = firstDay;

  var multiple = attr(el, 'data-multiple', '');
  if (multiple === 'true') opts.multipleDates = true;
  else if (multiple) {
    var mn = parseInt(multiple, 10);
    // A cap of 0 would make every date click a no-op; only a positive cap is meaningful.
    if (!isNaN(mn) && mn > 0) opts.multipleDates = mn;
  }

  var step = intAttr(el, 'data-time-step');
  if (step !== undefined) opts.minutesStep = step;

  // Only the documented placements are accepted; a typo falls back to the vendor default rather
  // than producing a mis-positioned popup.
  var pos = attr(el, 'data-position', '');
  if (pos && POSITIONS[pos]) opts.position = pos;

  // Optional footer buttons — labels come from the locale object (locale.today / locale.clear).
  var buttons = [];
  if (flag(el, 'data-today')) buttons.push('today');
  if (flag(el, 'data-clear')) buttons.push('clear');
  if (buttons.length) opts.buttons = buttons;

  new AirDatepicker(el, opts);
}

function init() {
  Array.prototype.forEach.call(document.querySelectorAll('input[data-sw-component="datetimepicker"]'), enhance);
}
if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
