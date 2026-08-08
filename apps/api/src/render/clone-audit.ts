// clone_audit: the COMPREHENSIVE clone-acceptance gate — three legs, each an objective PASS/FAIL, so the
// nativize/clone loop terminates only when the WHOLE clone is faithful, not just its computed styles.
//   • STRUCTURE (repo data): datasets deduped + named, media out of the transient imported/ tree, the page's
//     content client-EDITABLE (data-sw-*).
//   • BEHAVIOUR (a live build render): sliders actually enhance, modals present, the heading+body fonts truly
//     LOAD (not just declared), the mobile menu is reachable at a phone width.
//   • VISUAL (fidelity_check, folded in): body + chrome computed-style fidelity are BOTH ADVISORY — reported
//     to steer the agent, NOT gated. Computed-style COVERAGE is blind to the defect class that actually breaks
//     a clone visually: letter-casing, missing divider rules, plain-vs-badged icons, a wrong sub-band colour, a
//     wrong section height, a wrong repeated-item count — the words/fonts/colours all match, so coverage reads
//     ~90% while the page is visibly off. So the computed-style number is NOT a terminator (optimising it is a
//     trap). The RELIABLE visual gate is the agent-judged `visual_audit` SIDE-BY-SIDE vs the live original,
//     enumerated region-by-region to zero blocker+major — that lives with the driving agent, not in this gate.
// clone_audit therefore gates ONLY the OBJECTIVE facts a screenshot can't show and coverage can't game:
// datasets deduped+named, media out of imported/, content editable, sliders enhance, modals present, fonts
// truly LOAD, mobile menu reachable. Those never move a computed-style number and never show in a thumbnail.
// The pure scorers live here (unit-tested); the browser-driving capture lives in compare.ts.

import { diffClips, describeClips, type ClipFinding } from './clip-diff.js';

/** One audit check. `leg` groups them; `id` is a stable key; `detail` is the human/agent-readable evidence. */
export interface AuditCheck {
  leg: 'structure' | 'behaviour' | 'visual';
  id: string;
  label: string;
  pass: boolean;
  detail: string;
  /** ADVISORY checks are reported (so the agent sees + fixes them) but do NOT gate the audit's PASS. Used for
   *  chrome element-fidelity: 85% computed-style COVERAGE of structurally-different chrome (the original exposes
   *  counter-skewed inner label spans where the clone exposes tab wrappers; its rich footer has no clone
   *  counterpart) is not reliably reachable, so a hard gate there would never terminate the loop. */
  advisory?: boolean;
  /** N/A: the check passed because there was NOTHING TO CHECK — no sliders on either side, no modal
   *  triggers in the original, no nav to reach on mobile. Counted separately from a real pass, because
   *  "8/8" on a page where three checks were vacuous reads as far stronger evidence than it is. A single-
   *  page site with no menu, no slider and no modal scored a perfect 8/8 while only five things had
   *  actually been verified. Reported as `na`, and excluded from `passed`/`total`. */
  na?: boolean;
}

/** Behavioural facts extracted from a live render of the BUILD (desktop probe + mobile nav reachability). */
export interface BehaviourFacts {
  carousels: number;
  carouselsEnhanced: number;
  dialogs: number;
  headingFont: string;
  bodyFont: string;
  headingFontLoaded: boolean;
  bodyFontLoaded: boolean;
  /** Why the font check passed: a SYSTEM face had nothing to load; a `loaded` one is a real @font-face. */
  headingFontKind?: 'system' | 'loaded' | 'missing';
  bodyFontKind?: 'system' | 'loaded' | 'missing';
  navExpected: number;
  navReachableMobile: number;
  hasModalTrigger: boolean;
  /**
   * Elements VISUALLY CUT OFF by an ancestor's overflow (from CLIP_PROBE). Empty when nothing is
   * clipped. Reported because a rect measurement CANNOT see this: getBoundingClientRect returns the
   * layout box whether or not an ancestor clips it, so the element measures full-size while the visitor
   * sees half of it — and when the clipper is injected by a component runtime it is absent from the
   * authored source too. Both an agent and a reviewer have shipped this while holding a measurement
   * that looked right, which is exactly why it belongs in the deterministic gate rather than in advice.
   */
  clipped?: readonly ClipFinding[];
  /**
   * The SAME probe run against the imported page's original URL. `undefined`/`null` means no comparison
   * was possible (no import provenance, or the source render failed) — which is NOT the same as "the
   * original clips nothing", and the check stays advisory in that case rather than gating on a finding
   * it cannot justify.
   */
  originalClipped?: readonly ClipFinding[] | null;
  /**
   * Fixed-header clearance at each measured viewport (from HEADER_PROBE), or null where there was
   * nothing to judge — no landmark, a header in flow, or a landmark that measures ~0 because the
   * author's own bar inside it is itself position:fixed.
   */
  header?: { readonly desktop: HeaderFacts | null; readonly mobile: HeaderFacts | null };
}

/** One viewport's fixed-header measurements. All lengths in CSS px at that viewport. */
export interface HeaderFacts {
  /** The landmark's real rendered height. */
  bar: number;
  /** What `--sw-header-h` resolves to here — measured, not parsed (it may be rem or calc()). */
  token: number;
  /** Computed padding-top of the first `.sw-top-padding` element, or null when the page has none. */
  spacerPad: number | null;
  /** That element's class list, so a report can name the utility that beat the spacer. */
  spacerClass: string | null;
  /** Viewport-relative top of the topmost PAINTED text in #page-content (sr-only excluded). */
  firstTextTop: number | null;
  firstText: string;
  /** Scroll position when the measurement was taken; non-zero means the at-rest unscroll did not take. */
  scrollYAtMeasure?: number;
}

/** A token shorter than the bar by more than this puts content under the header. */
const TOKEN_SHORT_TOLERANCE = 0.5;
/**
 * Over-declaring is reported but never gates. The excess paints a strip of whatever is behind the
 * content just below the bar — invisible when those backgrounds match (which is why the platform's own
 * stock default rounds up ~1.4px and is fine), a visible coloured edge when they don't. The check cannot
 * tell those apart, so it describes the risk instead of failing on it.
 */
const TOKEN_OVER_TOLERANCE = 2;

/** The viewports HEADER_PROBE runs at, for a report that says WHERE a header defect appears. */
const HEADER_VIEWPORTS = ['desktop', 'mobile'] as const;

/** Per-viewport header findings, as sentences a report can print directly. */
function headerFindings(
  header: BehaviourFacts['header'],
): { short: string[]; over: string[]; overridden: string[]; measured: string[] } {
  const short: string[] = [];
  const over: string[] = [];
  const overridden: string[] = [];
  const measured: string[] = [];
  for (const vp of HEADER_VIEWPORTS) {
    const f = header?.[vp];
    if (!f) continue;
    measured.push(`${vp} bar ${f.bar}px / token ${f.token}px`);
    if (f.token < f.bar - TOKEN_SHORT_TOLERANCE) {
      short.push(`${vp}: the bar is ${f.bar}px but --sw-header-h resolves to ${f.token}px, so anything padded from the token sits ${Math.round((f.bar - f.token) * 10) / 10}px under the header`);
    } else if (f.token > f.bar + TOKEN_OVER_TOLERANCE) {
      over.push(`${vp}: --sw-header-h (${f.token}px) over-declares the ${f.bar}px bar by ${Math.round((f.token - f.bar) * 10) / 10}px, which paints a strip of the background behind your content just below the bar`);
    }
    // The spacer is only meaningful against the token it is supposed to read. A deliberate 0 is an
    // opt-out ("this page clears the bar itself") and is not reported.
    if (f.spacerPad !== null && f.spacerPad > 0 && Math.abs(f.spacerPad - f.token) > TOKEN_SHORT_TOLERANCE) {
      overridden.push(`${vp}: .sw-top-padding computed ${f.spacerPad}px, not the ${f.token}px token — another padding rule wins on that element${f.spacerClass ? ` (class="${f.spacerClass}")` : ''}`);
    }
  }
  return { short, over, overridden, measured };
}

const GENERIC_DS = /^(list( ?\d+)?|items?\d*)$/i;

/** A client-edit directive: what makes rendered content editable in the client editor.
 *
 *  A DATASET LOOP counts. The content inside `{{#each dataset.rooms}}` is edited in the dataset
 *  editor, row by row — it is client-editable, just not through a `data-sw-*` leaf, and the import
 *  guide REQUIRES the loop fields to stay bare. So a page that is correctly 100% dataset-driven (a
 *  gallery, an activities list) used to score zero and fail this check. One agent passed it by adding
 *  `data-sw-text` to a screen-reader-only `<h1>` and said outright that this was gaming the check
 *  rather than improving the page. The check was measuring the wrong thing, not the page. */
const EDIT_DIRECTIVE =
  /data-sw-(?:text|html|control|bg|src|href)|\{\{\s*sw-control|data-sw-entry|\{\{\s*#each\s+dataset\.|\{\{\s*#sw-pick-entry/g;

/** A static `{{> name}}` / `{{#> name}}` partial include (mirrors publish's PARTIAL_REF). */
const PARTIAL_REF = /\{\{~?\s*#?>\s*([a-zA-Z][a-zA-Z0-9_-]*)/g;

/**
 * Count client-edit directives across the page's EFFECTIVE authored source: the passed source (which the
 * caller has already template-resolved) PLUS every `{{> snippet}}` it composes, expanded transitively.
 *
 * Counting the page's OWN stored `source` alone is wrong and used to fail the gate for exactly the
 * structures the import guide MANDATES: a page rendered from a `template` has an essentially empty
 * `source` (its directives live in the template), and a page composing a `{{> snippet}}` keeps its
 * directives in the snippet. Both render fully editable, and both used to score 0 and FAIL.
 */
export function countEditDirectives(source: string | null | undefined, snippets: Readonly<Record<string, string>> = {}): number {
  let total = 0;
  const seen = new Set<string>();
  const queue: string[] = [];
  const scan = (src: string | null | undefined): void => {
    if (!src) return;
    total += (src.match(EDIT_DIRECTIVE) || []).length;
    for (const m of src.matchAll(PARTIAL_REF)) {
      const name = m[1]!;
      // Guard on `seen` (not on the queue) so a diamond/cyclic composition terminates and is counted once.
      if (name in snippets && !seen.has(name)) {
        seen.add(name);
        queue.push(name);
      }
    }
  };
  scan(source);
  while (queue.length) scan(snippets[queue.shift()!]);
  return total;
}

/**
 * Every LITERAL root-relative reference in a source that points at a file — `src`, `href`, `data`,
 * `poster`, `data-full`. Dynamic refs (`{{sw-url photo}}`) are not literal and are skipped: they
 * resolve at render, and whether they resolve is the dataset's business, not this check's.
 */
const LITERAL_REF = /\b(?:src|href|data|poster|data-full|data-src)\s*=\s*["'](\/[^"'{}\s]+\.[A-Za-z0-9]{2,5})(?:[?#][^"']*)?["']/g;

/** The two root prefixes a published site actually serves. Anything else root-relative is nothing. */
const SERVED_PREFIX = /^\/(?:media|authoring)\//;

/**
 * Root-relative references in `source` that nothing will serve. Two shapes, both seen shipped:
 * a path left pointing at the SOURCE site's own tree (`/_data/assets/report.pdf` — the importer hosts
 * what it crawls, but a page authored from the original's markup can carry the original's paths
 * straight through), and a `/media/...` path whose asset is gone. Both 404 in silence: the page
 * renders, the link is there, and it is dead only for whoever clicks it.
 */
export function deadRefs(source: string | null | undefined, mediaUrls: ReadonlySet<string>): string[] {
  if (!source) return [];
  const dead = new Set<string>();
  for (const m of source.matchAll(LITERAL_REF)) {
    const ref = m[1]!;
    if (!SERVED_PREFIX.test(ref)) dead.add(ref);
    else if (ref.startsWith('/media/') && !mediaUrls.has(ref)) dead.add(ref);
  }
  return [...dead];
}


/** The platform's own class namespace. An author defining one of these is redefining the platform. */
const PLATFORM_CLASS = /\.(sw-[a-z0-9-]+)/;

/** Iterate a stylesheet's top-level `prelude { … }` blocks, descending into at-rules. */
function* cssRules(css: string, depth = 0): Generator<{ selector: string; body: string }> {
  if (depth > 8) return;
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) return;
    let level = 1;
    let j = open + 1;
    while (j < css.length && level > 0) {
      if (css[j] === '{') level += 1;
      else if (css[j] === '}') level -= 1;
      j += 1;
    }
    const prelude = css.slice(i, open).trim();
    const body = css.slice(open + 1, j - 1);
    if (prelude.startsWith('@')) yield* cssRules(body, depth + 1);
    else if (prelude) yield { selector: prelude, body };
    i = j;
  }
}

/**
 * Author selectors that REDEFINE a platform class rather than keying off one.
 *
 * The distinction is the rule's SUBJECT — its last compound. `html.sw-scrolled .my-header{…}` is
 * exactly how a scroll response is meant to be authored and is fine; `.sw-container{width:1200px}` is
 * not, because the platform's own rule for that class lives in `@layer sw-normalize` and UNLAYERED
 * author CSS beats any layer whatever its specificity. The platform rule simply stops applying — and
 * with it the setting that drives it. Measured on a real site: a redeclared `.sw-container` left the
 * Website → Content width control inert, with nothing anywhere saying so.
 */
export function platformClassOverrides(css: string | null | undefined): string[] {
  if (!css) return [];
  const hits = new Set<string>();
  for (const { selector } of cssRules(css)) {
    for (const one of selector.split(',')) {
      const subject = one.trim().split(/[\s>+~]+/).pop() ?? '';
      const m = PLATFORM_CLASS.exec(subject);
      if (m) hits.add(m[1]!);
    }
  }
  return [...hits];
}

/** The CSS an author owns on this page: the site-wide critical sheet + the page's own <style> blocks. */
export function authorCss(criticalCss: string | null | undefined, pageSource: string | null | undefined): string {
  const inline = [...(pageSource ?? '').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1] ?? '');
  return [criticalCss ?? '', ...inline].join('\n');
}

/** STRUCTURE leg — pure over repo data (datasets, media, the audited page's EFFECTIVE source + snippets). */
export function structuralChecks(input: {
  datasets: Array<{ id?: string; name?: string; slug?: string }>;
  media: Array<{ folder?: string; url?: string }>;
  /** The page's TEMPLATE-RESOLVED source (the `page.code` binding), not its raw stored `source`. */
  pageSource: string | null;
  /** Every snippet available to the page, by name — so composed `{{> partial}}` directives count. */
  snippets?: Readonly<Record<string, string>>;
  /** `website.criticalCss` — scanned with the page's own <style> for platform classes it redefines. */
  criticalCss?: string | null;
}): AuditCheck[] {
  // Test the USER-FACING name + slug (what rename_dataset actually changes) — NOT the immutable `id`, which
  // the importer sets ("items") and rename keeps, so a properly-renamed dataset (name "Featured Listings",
  // slug "featured_listings") whose id is still "items" must PASS.
  const generic = input.datasets.filter((d) => GENERIC_DS.test((d.name || '').trim()) || GENERIC_DS.test((d.slug || '').trim()));
  const imported = input.media.filter((m) => String(m.folder || '').startsWith('imported'));
  const edits = countEditDirectives(input.pageSource, input.snippets ?? {});
  const dead = deadRefs(input.pageSource, new Set(input.media.map((m) => m.url ?? '').filter(Boolean)));
  const shadowed = platformClassOverrides(authorCss(input.criticalCss, input.pageSource));
  return [
    { leg: 'structure', id: 'datasets', label: 'datasets deduped + meaningfully named', pass: input.datasets.length === 0 || generic.length === 0, detail: `${generic.length} generic-named ("List"/"items") of ${input.datasets.length}` },
    { leg: 'structure', id: 'media-folders', label: 'media out of the transient imported/ tree', pass: imported.length === 0, detail: `${imported.length}/${input.media.length} assets still under imported/` },
    { leg: 'structure', id: 'platform-classes', label: 'no platform class redefined out from under its setting', pass: shadowed.length === 0, detail: shadowed.length === 0 ? 'no author rule redefines an sw-* class' : `redefined: ${shadowed.map((c) => `.${c}`).join(', ')} — unlayered author CSS beats @layer, so the platform rule (and any setting driving it) stops applying; rename to your own class` },
    { leg: 'structure', id: 'assets-resolve', label: 'every file this page links is actually served', pass: dead.length === 0, detail: dead.length === 0 ? 'no dead root-relative references' : `${dead.length} dead: ${dead.slice(0, 5).join(', ')}${dead.length > 5 ? ' …' : ''}` },
    { leg: 'structure', id: 'editable', label: 'page content client-editable (data-sw-* or a dataset loop)', pass: edits > 0, detail: `${edits} edit affordances on this page (template-resolved, including composed snippets and dataset loops)` },
  ];
}

/**
 * How a font slot resolved, for the check's detail line. `kind` is absent on facts captured before it
 * existed, so fall back to the boolean and read as before.
 */
function fontState(family: string, ok: boolean, kind?: 'system' | 'loaded' | 'missing'): string {
  if (!kind) return ok ? 'loaded' : 'MISSING';
  return kind === 'system' ? (family ? 'system face (nothing to load)' : 'unset') : kind === 'loaded' ? 'loaded' : 'MISSING';
}

/** BEHAVIOUR leg — pure over the extracted facts. modals only required when the original HAS modal triggers. */
export function behaviouralChecks(b: BehaviourFacts): AuditCheck[] {
  // Only clips the ORIGINAL does not also make are candidate defects; see clip-diff.ts.
  const clip = diffClips(b.clipped, b.originalClipped);
  const hdr = headerFindings(b.header);
  const headerMeasured = hdr.measured.length > 0;
  return [
    { leg: 'behaviour', id: 'sliders', label: 'sliders actually enhance (working, not a dead snapshot)', pass: b.carousels === 0 || b.carouselsEnhanced === b.carousels, na: b.carousels === 0, detail: b.carousels === 0 ? 'no carousels on the page — n/a' : `${b.carouselsEnhanced}/${b.carousels} carousels enhanced` },
    { leg: 'behaviour', id: 'modals', label: 'modals present (original has modal triggers)', pass: !b.hasModalTrigger || b.dialogs > 0, na: !b.hasModalTrigger, detail: b.hasModalTrigger ? `${b.dialogs} dialog(s) for the original's modal trigger(s)` : 'original has no modals — n/a' },
    {
      leg: 'behaviour',
      id: 'fonts',
      // A SYSTEM face (a generic keyword, or a named one like Verdana/Georgia) declares no @font-face, so
      // there is nothing to load and nothing to miss — it reports `system`, not `loaded`, so the sentence
      // an agent reads matches what actually happened.
      label: 'heading + body fonts actually load',
      pass: b.headingFontLoaded && b.bodyFontLoaded,
      detail: `heading "${b.headingFont}"=${fontState(b.headingFont, b.headingFontLoaded, b.headingFontKind)}, body "${b.bodyFont}"=${fontState(b.bodyFont, b.bodyFontLoaded, b.bodyFontKind)}`,
    },
    { leg: 'behaviour', id: 'mobile-menu', label: 'mobile menu reachable at phone width', pass: b.navExpected === 0 || b.navReachableMobile >= b.navExpected, na: b.navExpected === 0, detail: b.navExpected === 0 ? 'the original has no nav to reach — n/a' : `${b.navReachableMobile}/${b.navExpected} nav items reachable at 390px` },
    {
      leg: 'behaviour',
      id: 'header-height-token',
      label: '--sw-header-h matches the real height of the fixed header',
      // GATES on UNDER-declaring only, because that has exactly one honest fix (set the real height) and
      // one certain consequence (content behind the bar). The token is a hardcoded constant sized for the
      // stock recipe, so it is wrong for essentially every imported header — and it is normally wrong at
      // ONE breakpoint, which is why this measures desktop AND phone: a single unconditional
      // `:root{--sw-header-h:…}` beats the platform's own media-query pair on source order and then
      // applies at every width. Over-declaring is reported in the detail but never fails; see
      // TOKEN_OVER_TOLERANCE.
      //
      // This gated, then briefly did not: the first probe measured a bar the author could not reproduce
      // (91.1px where both the published page and the draft preview read 66.8px). That was three bugs in
      // the PROBE, not a disagreement between surfaces — it measured while the page was still scrolled,
      // reset only the window when the preview shell scrolls the BODY, and read the height one frame
      // after the state class flipped rather than after the collapse transition finished. With those
      // fixed the three renders agree exactly, so the gate is back. See HEADER_PROBE.
      pass: hdr.short.length === 0,
      na: !headerMeasured,
      detail: !headerMeasured
        ? 'no fixed header landmark to measure — n/a'
        : hdr.short.length > 0
          ? `${hdr.short.join('; ')}. Set the real bar height per breakpoint in website.criticalCss; use --sw-header-offset (NOT this token) if what you actually want is a different amount of clearance.`
          : `${hdr.measured.join(', ')}${hdr.over.length > 0 ? ` — but ${hdr.over.join('; ')}` : ''}`,
    },
    {
      leg: 'behaviour',
      id: 'header-spacer-applies',
      label: '.sw-top-padding actually applies (not overridden by another padding rule)',
      // ADVISORY, deliberately. The measurement is certain but the INTENT is not: an author may mean to
      // override the spacer, and gating on the clone alone is what drove agents to damage pages to turn
      // `not-clipped` green. So this reports the one fact an agent cannot otherwise see — that the class
      // they added did nothing — and names the element, leaving the judgement with them.
      pass: hdr.overridden.length === 0,
      advisory: true,
      na: !headerMeasured || hdr.overridden.length === 0,
      detail:
        hdr.overridden.length === 0
          ? 'no .sw-top-padding element is being overridden'
          : `${hdr.overridden.join('; ')}. The spacer is a single-class rule in the platform sheet and Tailwind's utilities load after it, so a p-*/pt-*/py-* class, a custom rule with padding, or an inline style on the SAME element silently wins. Move the competing padding (e.g. p-4 → px-4 pb-4) or set --sw-header-offset instead.`,
    },
    {
      leg: 'behaviour',
      id: 'not-clipped',
      label: clip.compared
        ? 'no element is cut off that the ORIGINAL does not also cut off'
        : 'no element is visually cut off by an ancestor overflow (ADVISORY — no original to compare against)',
      pass: clip.novel.length === 0,
      // GATING ONLY WHEN THE ORIGINAL WAS PROBED. The measurement was always sound; what it lacked was
      // intent. Gating on the clone alone demonstrably damaged real clones — to turn it green, agents
      // replaced every `<img>` in a carousel with a background-image div (measured: 41 alt texts down to
      // 6 on one page, 18 down to 4 on another), swapped an accordion's `max-width:0` slide-open — which
      // is what the ORIGINAL does — for a `display:none` toggle, and shrank icons the original
      // deliberately bleeds past a tile edge. Four fidelity regressions, no real defect among them.
      //
      // With the original probed, "is this intended?" stops being a guess: a clip the SOURCE also makes
      // is the design being ported, and is subtracted. What survives is a cut the original does not
      // make, which is a genuine defect and is worth failing on. Without a source (no import provenance,
      // or the source render failed) there is still no basis to judge, so the check stays advisory —
      // reported for the agent to weigh, never forcing the guess that caused the damage.
      advisory: !clip.compared,
      detail:
        clip.novel.length === 0
          ? clip.compared
            ? `nothing clipped that the original doesn't also clip${clip.matchedOriginal > 0 ? ` (${clip.matchedOriginal} matched the original and were ignored)` : ''}`
            : 'nothing clipped'
          : describeClips(clip.novel) +
            (clip.compared
              ? ` — the ORIGINAL does not clip these${clip.matchedOriginal > 0 ? ` (${clip.matchedOriginal} other clips DO match the original and were ignored)` : ''}`
              : ' — ADVISORY: check whether the ORIGINAL clips it too before "fixing" it; a deliberate bleed is not a defect'),
    },
  ];
}

/** VISUAL leg — fold in fidelity_check's already-measured body + chrome result. BOTH are ADVISORY (see
 *  AuditCheck.advisory): computed-style COVERAGE is blind to casing / divider rules / plain-vs-badged icons /
 *  sub-band colour / section height / repeated-item count, so a green coverage number routinely coexists with a
 *  visibly-wrong page. They are REPORTED to steer the agent (fonts, gradients, skew), never gated. The real
 *  visual terminator is the agent-judged `visual_audit` side-by-side, driven region-by-region to zero
 *  blocker+major — NOT this number. Optimising coverage to 100% proves nothing about visual fidelity. */
export function visualChecks(fid: { body?: { pass?: boolean; coverage?: number; score?: number }; chrome?: { pass?: boolean; coverage?: number; styleOff?: number; metaOff?: number } } | null): AuditCheck[] {
  const b = fid?.body, c = fid?.chrome;
  return [
    { leg: 'visual', id: 'body-fidelity', label: 'body computed-style fidelity vs original (ADVISORY — the agent-judged visual_audit side-by-side is the real visual gate)', pass: b?.pass === true, advisory: true, detail: b ? `coverage ${((b.coverage ?? 0) * 100).toFixed(0)}%, score ${(b.score ?? 1).toFixed(3)} — coverage is BLIND to casing/dividers/icon-style/section-height; judge visual_audit, don't chase this number` : 'no fidelity result' },
    { leg: 'visual', id: 'chrome-fidelity', label: 'chrome computed-style fidelity vs original (ADVISORY)', pass: c?.pass === true, advisory: true, detail: c ? `coverage ${((c.coverage ?? 0) * 100).toFixed(0)}%, styleOff ${c.styleOff ?? '?'}, metaOff ${c.metaOff ?? '?'} — use compare_regions to close remaining chrome gaps` : 'no fidelity result' },
  ];
}

export interface CloneAuditResult {
  pass: boolean;
  passed: number;
  total: number;
  /** How many gating checks were N/A — nothing on the page for them to test. Kept out of `total` so the
   *  score states what was actually verified. */
  na: number;
  checks: AuditCheck[];
}

/** Assemble the full audit. RED (pass:false) if any GATING (non-advisory) check fails. Advisory checks are
 *  still in `checks` (reported to the agent) but excluded from pass/passed/total.
 *
 *  N/A checks are excluded too. A check that passes because the page has no sliders, no modals and no nav
 *  is not evidence of anything, and folding it into the score overstates the result: a single-page site
 *  scored "8/8" with three of the eight vacuous, which reads as a far stronger verdict than five verified
 *  checks. They stay in `checks` (so the agent can see they were considered) and are counted in `na`. */
export function assembleAudit(legs: AuditCheck[][]): CloneAuditResult {
  const checks = legs.flat();
  const gating = checks.filter((c) => !c.advisory && !c.na);
  const na = checks.filter((c) => !c.advisory && c.na).length;
  const passed = gating.filter((c) => c.pass).length;
  return { pass: passed === gating.length && gating.length > 0, passed, total: gating.length, na, checks };
}
