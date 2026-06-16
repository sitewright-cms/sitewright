import type { Page } from '@sitewright/schema';
import { icon } from '../../helpers.js';

// ------------------------------------------------------ DATE & TIME PICKER showcase (child of Components)
// The DateTimePicker component: data-sw-component="datetimepicker" on a text <input> upgrades it
// into an Air Datepicker popup, CI-themed. Shows the one-line 90% case, all four data-mode variants,
// an inline always-open calendar + full data-* control, and the no-JS fallback.
// Visible copy is bound via page.data (data-sw-text + {{page.data}} placeholders) so it translates
// (the seed-content i18n guard requires it); the <pre><code> samples stay untranslated.
export function pageComponentsDateTimePicker(): Page {
  return {
    id: 'comp-datetimepicker',
    path: 'datetimepicker',
    title: 'Date & time picker',
    description: 'A CI-themed calendar + slider time picker on a plain text input — date, range, datetime, and time modes, all from one attribute, with full data-* control and a no-JS fallback.',
    parent: 'components',
    order: 7,
    data: {
      dtp_intro: 'Put one attribute on a text input and it becomes a branded calendar with a slider time picker. Date, date-range, datetime, and time — each is a single data-mode value, and the colours, font, and transition come from your site’s CI automatically.',
      sec_basic_t: 'One line for the common case',
      sec_basic_d: 'A date picker is just data-sw-component="datetimepicker" on a text input — no configuration. Click the field to open the calendar; the selected day uses your primary colour.',
      lbl_date: 'Appointment date',
      ph_date: 'Select a date…',
      sec_modes_t: 'Four modes, one attribute',
      sec_modes_d: 'data-mode switches the picker: a single date, a start–end range in one field, a date with a time slider, or just the time. Everything else stays automatic.',
      lbl_range: 'Date range',
      ph_range: 'Check-in – Check-out',
      lbl_datetime: 'Date & time',
      ph_datetime: 'Pick a day and time…',
      lbl_time: 'Time only',
      ph_time: 'Pick a time…',
      sec_full_t: 'Full control when you need it',
      sec_full_d: 'For the other cases there are data-* attributes: bounds (data-min / data-max), display format, week start, minute step, Today / Clear buttons, locale, and data-inline for an always-open calendar embedded in the page — shown here.',
      lbl_inline: 'Always-open calendar',
      sec_nojs_t: 'Without JavaScript',
      sec_nojs_d: 'If scripts don’t run, every field stays an ordinary text input — the visitor can still type a value and it still submits inside a form. Only the calendar popup is unavailable.',
    },
    source: `<section class="mx-auto max-w-6xl px-6 pb-8 pt-24">
  <a class="nw-underline inline-flex items-center gap-1.5 text-sm font-semibold text-primary no-underline" href="{{sw-url page.parent.path}}">${icon('arrow-left', 'h-4 w-4')} {{page.parent.title}}</a>
  <h1 class="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">{{page.title}}</h1>
  <p class="mt-5 max-w-2xl text-lg leading-relaxed text-base-content/60" data-sw-text="dtp_intro">Put one attribute on a text input and it becomes a branded calendar.</p>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_basic_t">One line for the common case</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_basic_d">A date picker is just the marker on a text input — no configuration.</p>
  <pre class="mt-3 inline-block max-w-full overflow-x-auto text-xs"><code>&lt;input type="text" data-sw-component="datetimepicker"&gt;</code></pre>
  <div class="mt-6 max-w-sm">
    <label class="block">
      <span class="mb-1.5 block text-sm font-semibold" data-sw-text="lbl_date">Appointment date</span>
      <input type="text" name="date" data-sw-component="datetimepicker" placeholder="{{page.data.ph_date}}" class="input input-bordered w-full" />
    </label>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_modes_t">Four modes, one attribute</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_modes_d">data-mode switches the picker; everything else stays automatic.</p>
  <pre class="mt-3 inline-block max-w-full overflow-x-auto text-xs"><code>data-mode="date | range | datetime | time"</code></pre>
  <div class="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
    <label class="block">
      <span class="mb-1.5 block text-sm font-semibold" data-sw-text="lbl_range">Date range</span>
      <input type="text" name="range" data-sw-component="datetimepicker" data-mode="range" data-clear="true" placeholder="{{page.data.ph_range}}" class="input input-bordered w-full" />
    </label>
    <label class="block">
      <span class="mb-1.5 block text-sm font-semibold" data-sw-text="lbl_datetime">Date &amp; time</span>
      <input type="text" name="datetime" data-sw-component="datetimepicker" data-mode="datetime" data-time-step="15" data-time-format="HH:mm" placeholder="{{page.data.ph_datetime}}" class="input input-bordered w-full" />
    </label>
    <label class="block">
      <span class="mb-1.5 block text-sm font-semibold" data-sw-text="lbl_time">Time only</span>
      <input type="text" name="time" data-sw-component="datetimepicker" data-mode="time" data-time-format="HH:mm" placeholder="{{page.data.ph_time}}" class="input input-bordered w-full" />
    </label>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_full_t">Full control when you need it</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_full_d">Bounds, format, week start, minute step, Today / Clear buttons, locale, and an always-open inline calendar.</p>
  <pre class="mt-3 inline-block max-w-full overflow-x-auto text-xs"><code>data-min  data-max  data-format  data-first-day  data-time-step  data-today  data-clear  data-locale  data-inline</code></pre>
  <div class="mt-6 max-w-sm">
    <span class="mb-1.5 block text-sm font-semibold" data-sw-text="lbl_inline">Always-open calendar</span>
    <input type="text" name="inline" data-sw-component="datetimepicker" data-inline="true" data-today="true" />
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-28">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_nojs_t">Without JavaScript</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_nojs_d">Every field stays an ordinary text input — the visitor can still type a value and it still submits inside a form.</p>
</section>`,
  };
}
