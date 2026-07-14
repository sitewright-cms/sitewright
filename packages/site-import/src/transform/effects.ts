// Detect dynamic BEHAVIORS in the crawled source (foreign CSS + JS + page markup) and MAP them onto the
// platform's NATIVE effect features, instead of silently deleting them. A static screenshot is blind to all
// of these — a scroll-shrink nav, a button ripple, a preloader overlay, scroll-motion — so the fidelity gate
// can never catch them; the ONLY place to recover them is here, at import. Everything is CONSERVATIVE: a
// field is set only on a clear signal, so we never invent an effect the source didn't have. All PURE +
// unit-tested; no DOM, no I/O.

/** The site-wide effect fields we can infer from the source (subset of WebsiteEffects). */
export interface DetectedEffects {
  stickyHeader?: 'pinned' | 'shrink';
  buttonEffect?: string;
  preloaderEffect?: 'spinner' | 'dots' | 'bars';
}

export interface EffectSignals {
  /** The foreign stylesheet text (class RULES — `.navbar-shrink{…}`, `.preloader{…}`). */
  cssText: string;
  /** The foreign `<script>` text/URLs, if captured (scroll-shrink toggles live here). */
  scripts?: string;
  /** Concatenated page markup (class USAGE — `class="waves-effect"`, `data-aos`). */
  pageHtml: string;
  /** The page transform already REMOVED a preloader overlay (diagnostic "preloader-removed") — a reliable
   *  signal even when its markup is gone from pageHtml and its class rule isn't in the retained CSS. */
  preloaderRemoved?: boolean;
}

/**
 * Map the source's dynamic behaviours to native `website.effects` fields.
 *  • preloader  → `preloaderEffect` (a loading overlay that hides on load) — the importer already REMOVES the
 *                 foreign overlay; this re-expresses it natively instead of dropping it.
 *  • waves/ripple → `buttonEffect:'fill-center'` (the nearest native reveal to a Material click-ripple).
 *  • scroll-shrink / fixed header → `stickyHeader:'shrink'` (shrink signal) or `'pinned'` (just fixed/sticky).
 */
export function detectImportedEffects(sig: EffectSignals): DetectedEffects {
  const css = sig.cssText.toLowerCase();
  const hay = `${css}\n${(sig.scripts ?? '').toLowerCase()}\n${sig.pageHtml.toLowerCase()}`;
  const out: DetectedEffects = {};

  // — Preloader: a full-screen loading overlay. The transform's own removal is the AUTHORITATIVE signal
  //   (its markup is gone from pageHtml by now); also match SPECIFIC markers in the retained CSS as a
  //   fallback (avoid a stray ".loader" utility). Infer the style from any surviving marker; default spinner.
  if (sig.preloaderRemoved || /\bpreloader\b|pre-loader|page-loader|pageloader|loading-overlay|loading-screen|site-loader|preload-wrapper|spinner-wrapper|loader-wrapper/.test(hay)) {
    out.preloaderEffect = /progress-bar|loading-bar|\bbars?\b/.test(hay) ? 'bars' : /\bdots?\b|three-dots|dot-/.test(hay) ? 'dots' : 'spinner';
  }

  // — Button ripple (Materialize/Material "waves", MDC ripple) → nearest native reveal effect.
  if (/\bwaves-effect\b|\bwaves-ripple\b|\bmdc-ripple\b|\bripple-effect\b/.test(hay)) {
    out.buttonEffect = 'fill-center';
  }

  // — Sticky / scroll-shrink header. 'shrink' when a shrink-on-scroll signal is present; else 'pinned' when
  //   the header is simply fixed/sticky. No signal → unset (a static header — don't invent stickiness).
  const shrink = /navbar-shrink|header-shrink|nav-shrink|shrink-on-scroll|sticky-shrink|\bheadroom\b|is-scrolled|nav-scrolled|header-scrolled|scrolled-nav|smaller-nav/.test(hay);
  const fixed =
    /navbar-fixed-top|fixed-top|sticky-top|is-sticky|sticky-header|fixed-header|\baffix\b|header--fixed|nav--fixed/.test(hay) ||
    // selector … `{` … `position:fixed|sticky` within the SAME rule block ([^}] crosses `{`, stops at `}`).
    /(?:#(?:main-)?nav|header|\.navbar|\.site-header|\.main-header|\.header)\b[^}]{0,200}position\s*:\s*(?:fixed|sticky)/.test(css);
  if (shrink) out.stickyHeader = 'shrink';
  else if (fixed) out.stickyHeader = 'pinned';

  return out;
}

// The `data-sw-animation` vocabulary (source of truth: packages/blocks/src/animations.ts ANIMATION_EFFECTS).
// Duplicated here as a tiny stable list so site-import needn't depend on the blocks runtime.
const SW_ANIMATIONS = new Set([
  'fade', 'fade-up', 'fade-down', 'fade-left', 'fade-right',
  'zoom-in', 'zoom-out', 'slide-up', 'slide-down', 'slide-right', 'slide-left',
  'flip-up', 'flip-down', 'flip-left', 'flip-right',
]);

function clampInt(raw: string | undefined, lo: number, hi: number): number | undefined {
  if (raw == null) return undefined;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return undefined;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Map a source element's AOS attributes (`data-aos`, `data-aos-duration`, `data-aos-delay`) to the native
 * `data-sw-animation` primitives. AOS's effect names overlap the sw vocabulary almost 1:1; compound AOS
 * directions (`fade-up-right`, `zoom-in-up`) collapse to the primary sw effect, and anything unknown falls
 * back to the base `fade`. Returns null when the element carries no AOS attribute.
 */
export function mapAosAnimation(attribs: Record<string, string | undefined>): { animation: string; duration?: string; delay?: string } | null {
  const raw = attribs['data-aos'];
  if (raw == null) return null;
  let v = raw.trim().toLowerCase();
  if (!SW_ANIMATIONS.has(v)) {
    if (v.startsWith('zoom-in')) v = 'zoom-in';
    else if (v.startsWith('zoom-out')) v = 'zoom-out';
    else if (v.startsWith('fade-up')) v = 'fade-up';
    else if (v.startsWith('fade-down')) v = 'fade-down';
    else if (v.startsWith('fade-left')) v = 'fade-left';
    else if (v.startsWith('fade-right')) v = 'fade-right';
    else if (v.startsWith('slide')) v = SW_ANIMATIONS.has(v) ? v : 'fade';
    else if (v.startsWith('flip')) v = SW_ANIMATIONS.has(v) ? v : 'fade';
    else v = 'fade';
  }
  const animation = SW_ANIMATIONS.has(v) ? v : 'fade';
  const out: { animation: string; duration?: string; delay?: string } = { animation };
  const dur = clampInt(attribs['data-aos-duration'], 100, 4000);
  if (dur != null) out.duration = String(dur);
  const delay = clampInt(attribs['data-aos-delay'], 0, 4000);
  if (delay != null) out.delay = String(delay);
  return out;
}

/** The AOS attribute names to strip from imported markup once mapped (so the foreign lib's attrs don't linger). */
export const AOS_ATTRS = ['data-aos', 'data-aos-duration', 'data-aos-delay', 'data-aos-easing', 'data-aos-offset', 'data-aos-once', 'data-aos-anchor', 'data-aos-anchor-placement', 'data-aos-mirror', 'data-aos-id'] as const;
