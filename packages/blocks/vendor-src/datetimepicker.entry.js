// DateTimePicker runtime ENTRY — bundled by scripts/gen-vendor.mjs into
// src/vendor/datetimepicker-runtime.ts. Vanilla Calendar Pro (MIT) + first-party wiring. The
// authored contract stays declarative: the `data-sw-component="datetimepicker"` marker goes on a
// text <input> (popup) or a block element (inline calendar), and the picker mode + behavior come
// from `data-*` config attributes — the library is an implementation detail behind the marker.
//
// Why Vanilla Calendar Pro: it renders multiple months side by side (data-mode="range" → a
// DUAL-PANEL two-month range view), localises via Intl (no bundled locale files), and its colours
// are themed entirely by our own CI stylesheet (components.ts) against its data-vc-* state hooks.
//
// With no JS the element stays a usable text <input> (type a value); the input's name/value still
// submit inside a form. The runtime writes the chosen value back into the input itself.
import { Calendar } from 'vanilla-calendar-pro';

function attr(el, name, fallback) {
  var v = el.getAttribute(name);
  return v === null || v === '' ? fallback : v;
}
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

// Picker language: explicit data-locale wins, else the page <html lang>, floored to English. Passed
// straight to Vanilla Calendar Pro, which localises month/weekday names through the Intl API.
var SUPPORTED = { en: 'en', de: 'de', es: 'es' };
function pickLocale(el) {
  var want = (attr(el, 'data-locale', '') || (document.documentElement.getAttribute('lang') || '')).slice(0, 2).toLowerCase();
  return SUPPORTED[want] || 'en';
}

var Y_POS = { top: 1, bottom: 1 };
var X_POS = { left: 1, right: 1, center: 1 };

// Reflect the selection into the host <input> (and keep it form-submittable). Dates come back as
// ISO 'YYYY-MM-DD'; we show a locale-formatted string (range = start – end, multiple = comma list)
// with the time appended when in a time mode.
function makeWriter(el, mode, withTime) {
  var loc = pickLocale(el);
  var fmt = null;
  try {
    fmt = new Intl.DateTimeFormat(loc === 'en' ? 'en-US' : loc, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    fmt = null;
  }
  function one(s) {
    var dt = new Date(s + 'T00:00:00');
    return fmt && !isNaN(dt.getTime()) ? fmt.format(dt) : s;
  }
  return function (self) {
    var dates = (self.context && self.context.selectedDates) || [];
    var time = (self.context && self.context.selectedTime) || '';
    var out = '';
    if (dates.length) {
      out = mode === 'range' && dates.length > 1 ? one(dates[0]) + ' – ' + one(dates[dates.length - 1]) : dates.map(one).join(', ');
    }
    if (withTime && time) out = out ? out + ', ' + time : time;
    el.value = out;
  };
}

function enhance(el) {
  if (el.getAttribute('data-sw-enhanced') === 'true') return;
  el.setAttribute('data-sw-enhanced', 'true');

  var isInput = el.tagName === 'INPUT';
  // date (default) | range (dual-panel span) | datetime (date + time) | time (only the clock).
  var mode = attr(el, 'data-mode', 'date');
  var withTime = mode === 'datetime' || mode === 'time';
  var tf = attr(el, 'data-time-format', '');

  var opts = {
    // An <input> gets a popup; any other element renders the calendar inline, in place.
    inputMode: isInput,
    locale: pickLocale(el),
    selectionTimeMode: withTime ? (/a/i.test(tf) ? 12 : 24) : false,
  };

  if (mode === 'range') {
    opts.type = 'multiple';
    opts.selectionDatesMode = 'multiple-ranged';
    // Dual-panel by default; data-months (2–12) overrides how many months show side by side.
    var rm = intAttr(el, 'data-months');
    opts.displayMonthsCount = rm && rm >= 2 ? rm : 2;
    opts.monthsToSwitch = 1;
  } else if (mode === 'time') {
    opts.selectionDatesMode = false;
    // Strip the calendar grid — render only the time control.
    opts.layouts = { default: '<#ControlTime />' };
  } else {
    // date | datetime
    opts.selectionDatesMode = flag(el, 'data-multiple') ? 'multiple' : 'single';
    var dm = intAttr(el, 'data-months');
    if (dm && dm >= 2) {
      opts.type = 'multiple';
      opts.displayMonthsCount = dm;
      opts.monthsToSwitch = 1; // navigate one month at a time, same as range mode
    }
  }

  var min = attr(el, 'data-min', '');
  if (min) opts.dateMin = min;
  var max = attr(el, 'data-max', '');
  if (max) opts.dateMax = max;

  var firstDay = intAttr(el, 'data-first-day');
  if (firstDay !== undefined) opts.firstWeekday = firstDay;

  var step = intAttr(el, 'data-time-step');
  if (step !== undefined) opts.timeStepMinute = step;

  // Popup placement relative to the input: "bottom left" → ['bottom','left']; a bare X ("center")
  // or "auto" is passed through. A typo is ignored (library default).
  var pos = attr(el, 'data-position', '');
  if (pos) {
    var parts = pos.split(/\s+/);
    if (parts.length === 2 && Y_POS[parts[0]] && X_POS[parts[1]]) opts.positionToInput = [parts[0], parts[1]];
    else if (pos === 'auto' || X_POS[pos]) opts.positionToInput = pos;
  }

  if (isInput) {
    var write = makeWriter(el, mode, withTime);
    opts.onChangeToInput = write;
    // Time-only changes don't fire onChangeToInput, so mirror time edits too.
    if (withTime) opts.onChangeTime = write;
  }

  // SECURITY: we deliberately pass NO HTML-accepting options (popups / labels /
  // onCreateDateRangeTooltip / custom non-time layouts). Vanilla Calendar Pro's `sanitizerHTML`
  // default is the identity function, so its innerHTML paths are only reachable through those
  // options — none of which carry tenant data here. Do NOT add any of them without also wiring a
  // real sanitizer (the published-site CSP blocks inline scripts, but stored HTML could still XSS).
  new Calendar(el, opts).init();
}

function init() {
  Array.prototype.forEach.call(document.querySelectorAll('[data-sw-component="datetimepicker"]'), enhance);
}
if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
