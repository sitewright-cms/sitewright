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
//
// ★ EXTENSIONS. Since vanilla-calendar-pro 3.4.0 the multi-month view (`type: 'multiple'`) and the time
// editor (`selectionTimeMode`) are opt-in extensions that must be REGISTERED at construction; using the
// option without its extension throws on init ("The 'type' option requires months"). That arrived in a
// MINOR bump and broke range mode, data-months >= 2, datetime and time while plain date kept working.
// `extensionsFor` below derives the list from the options actually built, covering the two options this
// entry sets that need one. Setting a motion / weeks / annotations option later (animation, week numbers,
// popups…) means adding that extension there too. datetimepicker.behavior.test.ts constructs every mode.
import { Calendar, months, time } from 'vanilla-calendar-pro';

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

// Is a COMPUTED colour darker than mid-grey (#808080)? Browsers serialise a legacy colour (hex, rgb,
// hsl, named) as rgb()/rgba(), but keep a CSS Color 4 one in its own space — Chromium reports the
// platform's dark token as `oklch(0.2533 0.016 252.42)` and a color-mix() as `color(srgb …)`. Reading
// the first three numbers of those as r,g,b made EVERY such colour "dark" (a light oklch surface
// included), so each form is read on its own scale: gamma-encoded RGB channels by luma (0–255 for
// rgb(), 0–1 inside color()), the L of oklab/oklch (0–1) and lab/lch (0–100) against mid-grey's, and
// the LIGHT-LINEAR spaces against mid-grey's linear luminance (0.214): srgb-linear by its luminance,
// xyz / xyz-d50 / xyz-d65 by Y, which IS luminance. A (near-)transparent or unknown colour tells us
// nothing → false (light).
var RGB_SPACES = { rgb: 255, rgba: 255, srgb: 1, 'display-p3': 1, 'a98-rgb': 1, rec2020: 1, 'prophoto-rgb': 1 };
var MID_GREY_LINEAR = 0.214;
function isDarkColor(css) {
  var m = /^([a-z]+)\((.*)\)$/.exec(String(css || '').trim().toLowerCase());
  if (!m) return false;
  var fn = m[1];
  var halves = m[2].split('/');
  var v = halves[0].replace(/,/g, ' ').trim().split(/\s+/);
  if (fn === 'color') fn = v.shift();
  var alpha = halves.length > 1 ? halves[1] : fn === 'rgba' ? v[3] : '1';
  if (parseFloat(alpha) * (/%/.test(alpha) ? 0.01 : 1) < 0.05) return false;
  var L = parseFloat(v[0]);
  if (fn === 'oklch' || fn === 'oklab') return (/%/.test(v[0]) ? L / 100 : L) < 0.6;
  if (fn === 'lch' || fn === 'lab') return L < 53.6;
  if (fn === 'srgb-linear') return 0.2126 * +v[0] + 0.7152 * +v[1] + 0.0722 * +v[2] < MID_GREY_LINEAR;
  if (fn === 'xyz' || fn === 'xyz-d50' || fn === 'xyz-d65') return +v[1] < MID_GREY_LINEAR;
  var max = RGB_SPACES[fn];
  if (!max) return false;
  return (0.2126 * +v[0] + 0.7152 * +v[1] + 0.0722 * +v[2]) / max < 0.5;
}

// Pick the vendor's light or dark theme to match the SITE as it is painted right now. The active
// palette is whatever --sw-color-base-100 resolves to — opt-in themes flip it with <html
// data-sw-theme> (the server default + the visitor toggle) or prefers-color-scheme ('auto'), and a
// themes-off site can still be dark by its own palette — so we probe that surface colour and choose
// dark for a dark surface. Falls back to light on any failure.
function siteTheme() {
  try {
    var probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;background:var(--sw-color-base-100,#fff)';
    document.body.appendChild(probe);
    var bg = getComputedStyle(probe).backgroundColor;
    probe.parentNode.removeChild(probe);
    return isDarkColor(bg) ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

// Every enhanced calendar on the page ({ cal, el }: the instance + its marker element), so a site
// theme flip re-themes them all at once. `lastTheme` is the theme they were last put on.
var calendars = [];
var lastTheme = null;

// Put one calendar on `theme`. `selectedTheme` is what the library applies whenever it (re)builds the
// calendar — an input's popup is only built on its FIRST open — so keep it current, and flip the
// attribute on a calendar that is already built. Only the calendar root carries data-vc-theme: before
// that first open an input picker's mainElement is the <input> itself, which must not get one.
function applyTheme(cal, theme) {
  cal.selectedTheme = theme;
  var root = cal.context && cal.context.mainElement;
  if (root && root.hasAttribute('data-vc-theme') && root.getAttribute('data-vc-theme') !== theme) {
    root.setAttribute('data-vc-theme', theme);
  }
}
// Re-read the site theme and move every picker onto it. One probe, and a no-op when the theme did not
// change. A picker whose element has left the page is dropped here, so the list never pins removed
// calendars in memory or keeps re-theming them.
function syncThemes() {
  for (var i = calendars.length - 1; i >= 0; i--) {
    if (!calendars[i].el.isConnected) calendars.splice(i, 1);
  }
  var theme = siteTheme();
  if (theme === lastTheme) return;
  lastTheme = theme;
  for (var j = 0; j < calendars.length; j++) applyTheme(calendars[j].cal, theme);
}

// <html> classes outside the platform's own `sw-*` namespace, normalised for comparison. The sticky
// header toggles sw-scrolled / sw-nav-hidden / sw-header-offtop / sw-measure on <html> at every
// scroll-direction change, and the other runtimes add their own sw-* state classes — none of them
// changes the palette. A class outside it (an author's own `dark` switch) might.
function foreignClasses(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(function (c) {
      return c !== '' && c.indexOf('sw-') !== 0;
    })
    .sort()
    .join(' ');
}

// Does this batch of <html> attribute changes possibly change the palette? data-sw-theme to a NEW
// value, or a non-sw-* class appearing / disappearing. Compared against the CURRENT value, so a
// change that was undone within the batch counts as no change.
function themeMayHaveChanged(records) {
  var root = document.documentElement;
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    if (r.attributeName === 'class') {
      if (foreignClasses(r.oldValue) !== foreignClasses(root.getAttribute('class'))) return true;
    } else if (r.oldValue !== root.getAttribute(r.attributeName)) {
      return true;
    }
  }
  return false;
}

// Follow the site LIVE, not just at load: the theme toggle flips <html data-sw-theme> after the
// pickers are built, an 'auto' site changes with the OS preference, and an author's own switch may
// toggle a class on <html>. Without this a picker kept the theme it was built in — a light calendar
// on a page the visitor had just switched to dark. Wired once, by the first picker. Only a change
// that can move the palette costs a probe (see themeMayHaveChanged).
var watching = false;
function watchSiteTheme() {
  if (watching) return;
  watching = true;
  if (typeof MutationObserver === 'function') {
    new MutationObserver(function (records) {
      if (themeMayHaveChanged(records)) syncThemes();
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-sw-theme', 'class'],
      attributeOldValue: true,
    });
  }
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', syncThemes);
    else if (mq.addListener) mq.addListener(syncThemes);
  }
}

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

// Pin an open popup to its input, in VIEWPORT coordinates.
//
// Vanilla Calendar Pro places the popup once, from `window.scrollY` / `document.documentElement
// .scrollLeft` alone (its getOffset + getWindowScrollPosition). Neither reads `document.body
// .scrollTop` — so on any page whose SCROLLER is not the window the popup is positioned in
// viewport coordinates against a container that never scrolls: it detaches from the field the
// moment the page moves and strands itself down the page. That is not an exotic layout — the
// platform's own preview shell sets html{overflow:hidden} + body{overflow-y:auto}, so every
// author reviewing a picker in preview sees it break. Measured before this fix: field at y=312,
// popup still painting at y=660.
//
// So we position it ourselves: `fixed`, from the input's live rect, re-run on scroll (capture:true,
// which is what catches a scroll on the body or any wrapper — a bubbling listener on window never
// sees those) and on resize, until the popup hides.
function pinToInput(input, popup) {
  if (!popup) return function () {};
  var place = function () {
    var r = input.getBoundingClientRect();
    var h = popup.offsetHeight;
    var w = popup.offsetWidth;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var vw = window.innerWidth || document.documentElement.clientWidth;
    // Below the field; flip above when the popup would not fit and there IS room above; then clamp
    // into the viewport so a short screen still shows the whole calendar.
    var top = r.bottom + 4;
    if (top + h > vh && r.top - h - 4 >= 0) top = r.top - h - 4;
    top = Math.max(4, Math.min(top, vh - h - 4));
    var left = Math.max(4, Math.min(r.left, vw - w - 4));
    popup.style.position = 'fixed';
    popup.style.top = top + 'px';
    popup.style.left = left + 'px';
    popup.style.right = 'auto';
    popup.style.bottom = 'auto';
  };
  place();
  // The popup can be measured at zero height on the same tick it is inserted; re-place once laid out.
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(place);
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);
  return function () {
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
  };
}

// The extensions the built options need (see the EXTENSIONS note at the top). Registered per picker,
// not globally, so a plain date picker constructs exactly as it did before.
function extensionsFor(opts) {
  var list = [];
  if (opts.type === 'multiple') list.push(months);
  if (opts.selectionTimeMode) list.push(time);
  return list;
}

function enhance(el) {
  if (el.getAttribute('data-sw-enhanced') === 'true') return;
  el.setAttribute('data-sw-enhanced', 'true');

  var isInput = el.tagName === 'INPUT';
  // date (default) | range (dual-panel span) | datetime (date + time) | time (only the clock).
  var mode = attr(el, 'data-mode', 'date');
  var withTime = mode === 'datetime' || mode === 'time';
  var tf = attr(el, 'data-time-format', '');
  // Bring lastTheme (and every picker already built) up to date before this one is built on it.
  syncThemes();

  var opts = {
    // An <input> gets a popup; any other element renders the calendar inline, in place.
    inputMode: isInput,
    locale: pickLocale(el),
    selectionTimeMode: withTime ? (/a/i.test(tf) ? 12 : 24) : false,
    // Match the site: light or dark theme by the page surface luminance (components.ts paints the dark
    // theme from the site's own tokens and recolours the accent to the CI primary in BOTH). VCP would
    // otherwise follow prefers-color-scheme, which can mismatch a site whose palette ignores the OS
    // setting. Kept in step afterwards by watchSiteTheme.
    selectedTheme: lastTheme,
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
    // Keep the popup ON its field. See pinToInput: the library reads window scroll only, so a page
    // whose scroller is not the window strands the popup mid-page.
    var unpin = null;
    opts.onShow = function (self) {
      // Re-read the theme on every open too: one probe, and it catches a palette change no observer
      // saw (re-theming every picker, not just this one, when it did change).
      syncThemes();
      if (unpin) unpin();
      unpin = pinToInput(el, self && self.context && self.context.mainElement);
    };
    opts.onHide = function () {
      if (unpin) unpin();
      unpin = null;
    };
  }

  // SECURITY: we deliberately pass NO HTML-accepting options (popups / labels /
  // onCreateDateRangeTooltip / custom non-time layouts). Vanilla Calendar Pro's `sanitizerHTML`
  // default is the identity function, so its innerHTML paths are only reachable through those
  // options — none of which carry tenant data here. Do NOT add any of them without also wiring a
  // real sanitizer (the published-site CSP blocks inline scripts, but stored HTML could still XSS).
  opts.extensions = extensionsFor(opts);
  var cal = new Calendar(el, opts);
  cal.init();
  calendars.push({ cal: cal, el: el });
  watchSiteTheme();
}

function init() {
  Array.prototype.forEach.call(document.querySelectorAll('[data-sw-component="datetimepicker"]'), enhance);
}
if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
