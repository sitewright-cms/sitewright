/**
 * `measure_header`: the fixed header's real height at every Tailwind breakpoint, against the
 * `--sw-header-h` token the page offset is laid out from — and the exact CSS that makes them agree.
 *
 * `--sw-header-h` is a hand-written constant (4.5rem mobile / 4.75rem desktop by default), so any
 * custom header has to declare its own height, per breakpoint, EXACTLY: under-declaring hides content
 * behind the bar, over-declaring paints a strip of background under it, and there is no safe rounding
 * direction (see header-height-token-is-hand-written). An agent building a two-row header (150px vs the
 * default) had to measure it with its own Playwright at four widths and hard-code the result. The header
 * probe that clone_audit already runs does that measurement properly — at rest, every scroller reset,
 * settled on the VALUE not the class — so this exposes it for any page, not just imported ones.
 *
 * Deliberately a measurement + advice, NOT a runtime that writes the height: a script that sets the
 * offset after paint shifts every page by (bar − token) on every load, and would override the sites that
 * set their own value on purpose.
 */

/**
 * The widths measured: the narrow phone, then each Tailwind breakpoint's MIN-WIDTH. A header changes
 * layout at a breakpoint (`md:flex`, `lg:h-24`), so measuring exactly at each min-width puts every
 * observed change on the breakpoint that caused it — and the emitted media queries use those same numbers.
 */
export const HEADER_MEASURE_WIDTHS = [390, 640, 768, 1024, 1280, 1536] as const;

/** The page never rendered on the draft site (an error / 404 document) — not "the site has no header". */
export class HeaderPageNotRendered extends Error {
  constructor() {
    super('the page did not render on the draft site');
    this.name = 'HeaderPageNotRendered';
  }
}

/** The caller went away mid-measurement; the render slot was released early. */
export class HeaderMeasureAborted extends Error {
  constructor() {
    super('measurement aborted');
    this.name = 'HeaderMeasureAborted';
  }
}

/** What the in-browser probe reports at one width (null fields = could not be measured there). */
export interface HeaderSample {
  width: number;
  /** Computed `position` of #main-nav, or null when the page has no #main-nav. */
  position: string | null;
  /** At-rest bar height (px) — null unless the header is fixed. */
  bar: number | null;
  /** What `--sw-header-h` resolves to at this width (px). */
  token: number | null;
  /** Computed padding-top of the first `.sw-top-padding`, if any. */
  spacerPad: number | null;
}

export type HeaderVerdict = 'ok' | 'too-small' | 'too-large' | 'not-fixed' | 'unmeasured';

export interface HeaderRow extends HeaderSample {
  verdict: HeaderVerdict;
  /** token − bar (px); negative = content hidden behind the bar. */
  delta: number | null;
}

export interface HeaderReport {
  rows: HeaderRow[];
  /** Paste-ready CSS for website.criticalCss, or null when nothing needs changing. */
  css: string | null;
  advice: string[];
}

/** A measured difference below this is sub-pixel noise, not a wrong token. */
const TOLERANCE_PX = 0.5;
/** Two bar heights this close are the same layout. */
const SAME_BAR_PX = 0.05;

const px = (n: number): string => `${Math.round(n * 10) / 10}px`;

function verdictOf(s: HeaderSample): { verdict: HeaderVerdict; delta: number | null } {
  if (s.position === null) return { verdict: 'unmeasured', delta: null };
  if (s.position !== 'fixed') return { verdict: 'not-fixed', delta: null };
  if (s.bar === null || s.token === null) return { verdict: 'unmeasured', delta: null };
  const delta = Math.round((s.token - s.bar) * 10) / 10;
  if (Math.abs(delta) <= TOLERANCE_PX) return { verdict: 'ok', delta };
  return { verdict: delta < 0 ? 'too-small' : 'too-large', delta };
}

/**
 * The exact `--sw-header-h` declarations for the measured bars: the first width's height unconditionally,
 * then one `min-width` query per breakpoint where the height CHANGES. Only fixed, measured rows count.
 */
export function headerTokenCss(rows: readonly HeaderSample[]): string | null {
  const fixed = rows.filter((r) => r.position === 'fixed' && r.bar !== null) as Array<HeaderSample & { bar: number }>;
  if (fixed.length === 0) return null;
  const lines: string[] = [`:root{--sw-header-h:${px(fixed[0]!.bar)}}`];
  let current = fixed[0]!.bar;
  for (const r of fixed.slice(1)) {
    if (Math.abs(r.bar - current) < SAME_BAR_PX) continue;
    lines.push(`@media (min-width:${r.width}px){:root{--sw-header-h:${px(r.bar)}}}`);
    current = r.bar;
  }
  return lines.join('\n');
}

/** Turn per-width samples into verdicts, the fixing CSS (when needed) and plain-language advice. */
export function headerReport(samples: readonly HeaderSample[]): HeaderReport {
  const rows: HeaderRow[] = samples.map((s) => ({ ...s, ...verdictOf(s) }));
  const advice: string[] = [];
  if (rows.length === 0 || rows.every((r) => r.verdict === 'unmeasured')) {
    advice.push('The header could not be measured — the page has no #main-nav, or the render failed.');
    return { rows, css: null, advice };
  }
  const fixedRows = rows.filter((r) => r.position === 'fixed');
  if (fixedRows.length === 0) {
    advice.push('The header is not fixed at any width — it scrolls with the page, so no offset token is needed.');
    return { rows, css: null, advice };
  }
  const wrong = rows.filter((r) => r.verdict === 'too-small' || r.verdict === 'too-large');
  const css = wrong.length > 0 ? headerTokenCss(rows) : null;
  // A fixed header whose height could not be read at some width: never call that "nothing to change".
  const gaps = rows.filter((r) => r.position === 'fixed' && r.verdict === 'unmeasured').map((r) => `${r.width}px`);
  if (gaps.length > 0) advice.push(`The bar could not be measured at ${gaps.join(', ')} — re-run measure_header before trusting those widths.`);
  if (wrong.length === 0) {
    if (gaps.length === 0) advice.push('--sw-header-h matches the bar at every measured width — nothing to change.');
  } else {
    const small = wrong.filter((r) => r.verdict === 'too-small').map((r) => `${r.width}px`);
    const large = wrong.filter((r) => r.verdict === 'too-large').map((r) => `${r.width}px`);
    if (small.length) advice.push(`Token SHORTER than the bar at ${small.join(', ')} — content starts hidden behind the header there.`);
    if (large.length) advice.push(`Token TALLER than the bar at ${large.join(', ')} — a strip of background shows under the header there.`);
    advice.push(
      'Put the css below in website.criticalCss as ONE named block — patch_critical_css({ block: "header-height", css }) — replacing any earlier --sw-header-h declarations. The values are exact; do not round them.',
    );
  }
  if (fixedRows.length < rows.filter((r) => r.position !== null).length) {
    advice.push('The header is fixed at some widths only; where it is not fixed the token has no visible effect, so the css can apply everywhere.');
  }
  // `.sw-top-padding` that silently computes something other than the token: a p-*/pt-* utility or
  // inline padding on the same element wins on source order (a 0 is a deliberate opt-out — not flagged).
  const defeated = fixedRows.filter((r) => r.spacerPad !== null && r.spacerPad > 0 && r.token !== null && Math.abs(r.spacerPad - r.token) > TOLERANCE_PX);
  if (defeated.length > 0) {
    advice.push(
      `.sw-top-padding computes ${px(defeated[0]!.spacerPad!)} at ${defeated[0]!.width}px instead of the token — a p-*/pt-*/inline padding on the same element overrides it. Use side-specific utilities (px-4 pb-4) or drop the class and set --sw-header-offset.`,
    );
  }
  advice.push('Widths are each Tailwind breakpoint\'s min-width; a header that changes at a CUSTOM breakpoint needs that query adjusted by hand.');
  return { rows, css, advice };
}
