// Single source of truth for the CHROME runtimes — the first-party scripts driven by site SETTINGS and
// the shared chrome SLOTS (nav, footer, sidebars) rather than by page content. Sibling to
// effect-runtimes.ts, which owns the marker-gated BODY effects; the two together are every platform
// script a published page can link, except the color-scheme toggle (head, synchronous, no-flash — it
// cannot be bundled or deferred without reintroducing the flash it exists to prevent).
//
// WHY A REGISTRY. These eight used to be hand-wired twice — once in build.ts (write + per-page link)
// and once in app.ts (inline for the editor preview) — which is the exact setup that let the body
// effects drift until effect-runtimes.ts consolidated them. Same fix, same shape.
//
// WHY A BUNDLE. Chrome is, by definition, on every page. `sticky-header` ships unconditionally,
// back-to-top defaults on, button-effects follows it (the FAB is a `.btn`), and nav-active follows any
// nav — so four separate `<script defer>` fetches landed on essentially every page of every site, each
// small enough that per-file compression overhead was a significant fraction of it. Concatenating the
// site-wide ones into a single `core.js` cost 22–32% of their compressed bytes and 3–5 requests on the
// measured cases. It costs NOTHING in cache granularity, because the `?v=` token is already one digest
// over every runtime source: changing any one of them already busts all of their URLs.
//
// SITE-WIDE vs PER-PAGE. `siteWide` means "every page of this site needs it" — a setting is on, or a
// shared chrome slot trips the marker. Those are the members of core.js. A runtime that only SOME pages
// need (a page-local `<dialog>`, a one-off `sw-nav-sliding-pill` on a page's own `<ul>`) stays a
// standalone file linked by just those pages, so only-used-ships survives where it still means
// something. The order below is the order the scripts were linked in before the bundle existed, and it
// is preserved on both paths: concatenation order inside core.js, and link order for the leftovers.
import {
  NAV_LINK_JS,
  usesDialog,
  PRELOADER_JS,
  NAV_EFFECTS_JS,
  usesNavEffects,
  NAV_ACTIVE_JS,
  usesNavMenu,
  BUTTON_EFFECTS_JS,
  usesButtonEffects,
  BACK_TO_TOP_JS,
  STICKY_HEADER_JS,
  SCROLLSPY_JS,
  usesScrollSpy,
} from '@sitewright/blocks';
import {
  isLinkPage,
  navEffectUsesRuntime,
  buttonEffectUsesRuntime,
  scrollSpyUsesRuntime,
  stickyHeaderUsesRuntime,
  type Page,
} from '@sitewright/schema';

/** The published filename of the concatenated site-wide chrome bundle. */
export const CORE_SCRIPT = 'core.js';

/** Everything a `siteWide` predicate is allowed to look at: settings, the page list, the chrome slots. */
export interface ChromeContext {
  /** `project.website` — the settings half of every gate. */
  website?: {
    effects?: {
      preloaderEffect?: string;
      preloaderCode?: string;
      backToTop?: boolean;
      scrollSpy?: boolean;
      navEffect?: string;
      buttonEffect?: string;
    };
  };
  /** The published pages (a nav link PLACEHOLDER targeting a `#fragment` is a site-wide fact). */
  pages: readonly Page[];
  /** The rendered-on-every-page chrome slot sources (mainNav / sidebars / footer / bottom). */
  slotSources: readonly string[];
}

export interface ChromeRuntime {
  /** Stable key (also the parity-test id, and how build.ts reads a gate back out). */
  key: string;
  /** Filename when this ships standalone (only some pages need it). Members of core.js never use it. */
  script: string;
  /** The runtime IIFE. */
  js: string;
  /** Every page needs it → folded into core.js and linked everywhere. */
  siteWide: (ctx: ChromeContext) => boolean;
  /** A single page's scan trips it → that page links `script`. Absent = site-wide or nothing. */
  perPage?: (html: string | null | undefined) => boolean;
  /** Inline in the SINGLE-PAGE editor preview when this trips on the rendered HTML. Absent = chrome the
   *  canvas never renders (the preloader overlay and the back-to-top FAB are injected by the full build
   *  only), so the preview ships no runtime for it either. */
  preview?: (html: string | null | undefined) => boolean;
}

/** Back-to-top is ON BY DEFAULT — shared, because button-effects ships for the FAB's ripple. */
export const backToTopUsesRuntime = (ctx: ChromeContext): boolean => ctx.website?.effects?.backToTop !== false;

/** The registry, in link order (= concatenation order inside core.js). */
export const CHROME_RUNTIMES: readonly ChromeRuntime[] = [
  {
    // Opens a <dialog> (global modal) and smooth-scrolls #section links. Site-wide when a nav
    // PLACEHOLDER targets a fragment, a chrome slot embeds a dialog, or scrollspy governs the site
    // (a scrollspy nav is in-page section navigation, so its links must smooth-scroll).
    key: 'nav-link',
    script: 'nav-link.js',
    js: NAV_LINK_JS,
    siteWide: (ctx) =>
      ctx.pages.some((p) => isLinkPage(p) && (p.link?.target ?? '').includes('#')) ||
      ctx.slotSources.some((s) => usesDialog(s) || usesScrollSpy(s)) ||
      scrollSpyUsesRuntime(ctx.website?.effects?.scrollSpy),
    perPage: (html) => usesDialog(html) || usesScrollSpy(html),
    preview: (html) => usesDialog(html) || usesScrollSpy(html),
  },
  {
    // Overlay show/clear + scroll-lock + internal-link bridge. Settings-only, and site-wide whenever the
    // site shows an overlay AT ALL — a built-in effect OR custom code (the two conditions are exactly
    // opposite, and gating on the built-in alone once left every page sitting behind an overlay with
    // nothing to clear it).
    key: 'preloader',
    script: 'preloader.js',
    js: PRELOADER_JS,
    siteWide: (ctx) =>
      (ctx.website?.effects?.preloaderEffect ?? 'none') !== 'none' ||
      Boolean(ctx.website?.effects?.preloaderCode?.trim()),
  },
  {
    // Sliding indicator + cursor-following spotlight. Site-wide via the picker or a scheme class on a
    // chrome slot; per-page for a one-off class on a page's own nav <ul>.
    key: 'nav-effects',
    script: 'nav-effects.js',
    js: NAV_EFFECTS_JS,
    siteWide: (ctx) =>
      navEffectUsesRuntime(ctx.website?.effects?.navEffect) || ctx.slotSources.some(usesNavEffects),
    perPage: usesNavEffects,
    preview: usesNavEffects,
  },
  {
    // Moves `.active` to the nav link just clicked. The nav lives in a chrome slot, so this is
    // site-wide for any site with a menu; per-page only for a page that authors its own `.menu`.
    key: 'nav-active',
    script: 'nav-active.js',
    js: NAV_ACTIVE_JS,
    siteWide: (ctx) => ctx.slotSources.some(usesNavMenu),
    perPage: usesNavMenu,
    preview: usesNavMenu,
  },
  {
    // Ripple on every `.btn` (+ magnetic / spotlight). The back-to-top FAB is a platform-injected `.btn`
    // no scan can see, so its runtime pulls this one in with it.
    key: 'button-effects',
    script: 'button-effects.js',
    js: BUTTON_EFFECTS_JS,
    siteWide: (ctx) =>
      buttonEffectUsesRuntime(ctx.website?.effects?.buttonEffect) ||
      backToTopUsesRuntime(ctx) ||
      ctx.slotSources.some(usesButtonEffects),
    perPage: usesButtonEffects,
    preview: usesButtonEffects,
  },
  {
    // Show after the first viewport of scroll + scroll-to-top. The button markup is injected by
    // renderDocument, so the setting is the whole gate — and there is no per-page half.
    key: 'back-to-top',
    script: 'back-to-top.js',
    js: BACK_TO_TOP_JS,
    siteWide: backToTopUsesRuntime,
  },
  {
    // Scroll-state classes. ALWAYS site-wide: `html.sw-scrolled` is a universal authoring hook, not a
    // private detail of the two named modes (see stickyHeaderUsesRuntime).
    key: 'sticky-header',
    script: 'sticky-header.js',
    js: STICKY_HEADER_JS,
    siteWide: () => stickyHeaderUsesRuntime(),
    preview: () => stickyHeaderUsesRuntime(),
  },
  {
    // Highlights the nav link whose in-page section is in view. Site-wide via the toggle or a
    // `data-sw-scrollspy` on a chrome slot; per-page for the attribute on a page's own nav.
    key: 'scrollspy',
    script: 'scrollspy.js',
    js: SCROLLSPY_JS,
    siteWide: (ctx) =>
      scrollSpyUsesRuntime(ctx.website?.effects?.scrollSpy) || ctx.slotSources.some(usesScrollSpy),
    perPage: usesScrollSpy,
    preview: usesScrollSpy,
  },
];

/** The site-wide members, in registry order — the contents of core.js. Never empty (sticky-header). */
export function coreRuntimes(ctx: ChromeContext): readonly ChromeRuntime[] {
  return CHROME_RUNTIMES.filter((r) => r.siteWide(ctx));
}

/** The concatenated core bundle source. */
export function coreBundleJs(ctx: ChromeContext): string {
  return coreRuntimes(ctx)
    .map((r) => r.js)
    .join('\n');
}

/**
 * The runtimes NOT in core.js that at least one page still needs, so the build knows which standalone
 * files to write. `scan` answers "does any page/slot/snippet on this site trip this marker".
 */
export function standaloneRuntimes(
  ctx: ChromeContext,
  scan: (uses: (html: string | null | undefined) => boolean) => boolean,
): readonly ChromeRuntime[] {
  const core = new Set(coreRuntimes(ctx).map((r) => r.key));
  return CHROME_RUNTIMES.filter((r) => !core.has(r.key) && r.perPage !== undefined && scan(r.perPage));
}

/** Every chrome runtime source, for the `?v=` cache-bust digest — a new entry is covered automatically. */
export const CHROME_RUNTIME_SOURCES: readonly string[] = CHROME_RUNTIMES.map((r) => r.js);

/** The runtimes the SINGLE-PAGE editor preview inlines for this rendered HTML, in registry order. */
export function previewChromeScripts(html: string | null | undefined): string[] {
  return CHROME_RUNTIMES.filter((r) => r.preview?.(html) === true).map((r) => r.js);
}
