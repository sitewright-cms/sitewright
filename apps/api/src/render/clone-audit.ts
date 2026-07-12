// clone_audit: the COMPREHENSIVE clone-acceptance gate — three legs, each an objective PASS/FAIL, so the
// nativize/clone loop terminates only when the WHOLE clone is faithful, not just its computed styles.
//   • STRUCTURE (repo data): datasets deduped + named, media out of the transient imported/ tree, the page's
//     content client-EDITABLE (data-sw-*).
//   • BEHAVIOUR (a live build render): sliders actually enhance, modals present, the heading+body fonts truly
//     LOAD (not just declared), the mobile menu is reachable at a phone width.
//   • VISUAL (fidelity_check, folded in): body computed-style fidelity GATES; chrome element-fidelity is
//     ADVISORY (reported, not gated — structurally-different chrome can't reliably reach 85% correspondence).
// fidelity_check alone passes a clone whose datasets are duplicated, whose modals were dropped, whose slider
// is dead, or whose mobile menu is missing — none of which move a computed-style number. This gate closes that.
// The pure scorers live here (unit-tested); the browser-driving capture lives in compare.ts.

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
  navExpected: number;
  navReachableMobile: number;
  hasModalTrigger: boolean;
}

const GENERIC_DS = /^(list( ?\d+)?|items?\d*)$/i;

/** STRUCTURE leg — pure over repo data (datasets, media, the audited page's source). */
export function structuralChecks(input: {
  datasets: Array<{ id?: string; name?: string; slug?: string }>;
  media: Array<{ folder?: string }>;
  pageSource: string | null;
}): AuditCheck[] {
  // Test the USER-FACING name + slug (what rename_dataset actually changes) — NOT the immutable `id`, which
  // the importer sets ("items") and rename keeps, so a properly-renamed dataset (name "Featured Listings",
  // slug "featured_listings") whose id is still "items" must PASS.
  const generic = input.datasets.filter((d) => GENERIC_DS.test((d.name || '').trim()) || GENERIC_DS.test((d.slug || '').trim()));
  const imported = input.media.filter((m) => String(m.folder || '').startsWith('imported'));
  const edits = ((input.pageSource || '').match(/data-sw-(?:text|html|control|bg|src|href)|\{\{\s*sw-control|data-sw-entry/g) || []).length;
  return [
    { leg: 'structure', id: 'datasets', label: 'datasets deduped + meaningfully named', pass: input.datasets.length === 0 || generic.length === 0, detail: `${generic.length} generic-named ("List"/"items") of ${input.datasets.length}` },
    { leg: 'structure', id: 'media-folders', label: 'media out of the transient imported/ tree', pass: imported.length === 0, detail: `${imported.length}/${input.media.length} assets still under imported/` },
    { leg: 'structure', id: 'editable', label: 'page content client-editable (data-sw-*)', pass: edits > 0, detail: `${edits} edit directives on this page` },
  ];
}

/** BEHAVIOUR leg — pure over the extracted facts. modals only required when the original HAS modal triggers. */
export function behaviouralChecks(b: BehaviourFacts): AuditCheck[] {
  return [
    { leg: 'behaviour', id: 'sliders', label: 'sliders actually enhance (working, not a dead snapshot)', pass: b.carousels === 0 || b.carouselsEnhanced === b.carousels, detail: `${b.carouselsEnhanced}/${b.carousels} carousels enhanced` },
    { leg: 'behaviour', id: 'modals', label: 'modals present (original has modal triggers)', pass: !b.hasModalTrigger || b.dialogs > 0, detail: b.hasModalTrigger ? `${b.dialogs} dialog(s) for the original's modal trigger(s)` : 'original has no modals — n/a' },
    { leg: 'behaviour', id: 'fonts', label: 'heading + body fonts actually load', pass: b.headingFontLoaded && b.bodyFontLoaded, detail: `heading "${b.headingFont}"=${b.headingFontLoaded ? 'loaded' : 'MISSING'}, body "${b.bodyFont}"=${b.bodyFontLoaded ? 'loaded' : 'MISSING'}` },
    { leg: 'behaviour', id: 'mobile-menu', label: 'mobile menu reachable at phone width', pass: b.navExpected === 0 || b.navReachableMobile >= b.navExpected, detail: `${b.navReachableMobile}/${b.navExpected} nav items reachable at 390px` },
  ];
}

/** VISUAL leg — fold in fidelity_check's already-measured body + chrome result. body-fidelity GATES (text-
 *  anchored, reliable); chrome element-fidelity is ADVISORY (structurally-different chrome can't reliably reach
 *  85% element-style coverage — see AuditCheck.advisory — so it's reported to steer the agent, not gated). */
export function visualChecks(fid: { body?: { pass?: boolean; coverage?: number; score?: number }; chrome?: { pass?: boolean; coverage?: number; styleOff?: number; metaOff?: number } } | null): AuditCheck[] {
  const b = fid?.body, c = fid?.chrome;
  return [
    { leg: 'visual', id: 'body-fidelity', label: 'body computed-style fidelity vs original', pass: b?.pass === true, detail: b ? `coverage ${((b.coverage ?? 0) * 100).toFixed(0)}%, score ${(b.score ?? 1).toFixed(3)}` : 'no fidelity result' },
    { leg: 'visual', id: 'chrome-fidelity', label: 'chrome computed-style fidelity vs original', pass: c?.pass === true, advisory: true, detail: c ? `coverage ${((c.coverage ?? 0) * 100).toFixed(0)}%, styleOff ${c.styleOff ?? '?'}, metaOff ${c.metaOff ?? '?'} — use compare_regions to close remaining chrome gaps` : 'no fidelity result' },
  ];
}

export interface CloneAuditResult {
  pass: boolean;
  passed: number;
  total: number;
  checks: AuditCheck[];
}

/** Assemble the full audit. RED (pass:false) if any GATING (non-advisory) check fails. Advisory checks are
 *  still in `checks` (reported to the agent) but excluded from pass/passed/total. */
export function assembleAudit(legs: AuditCheck[][]): CloneAuditResult {
  const checks = legs.flat();
  const gating = checks.filter((c) => !c.advisory);
  const passed = gating.filter((c) => c.pass).length;
  return { pass: passed === gating.length && gating.length > 0, passed, total: gating.length, checks };
}
