// VISUAL ACCEPTANCE GATE (deterministic) — renders the clone + the LIVE original side-by-side (desktop +
// mobile, full-page) and hands the DRIVING agent a structured RUBRIC to judge against. There is NO
// server-side AI here: the model already doing the clone (a CLI / MCP agent with its own vision) judges
// the pixels itself. So a cheap-token CLI clone never triggers a second, platform-billed vision call —
// the CLI lane and the on-platform lane stay separate. The strong signal is preserved (real side-by-side
// vs the LIVE original, full-page not clipped, real rendered fonts/images — getComputedStyle lies about
// loaded fonts and can't see layout/images); only the JUDGE moves to the caller.
import type { Shot, ViewportName } from './screenshot.js';

/** Defect categories the driving model tags each divergence with (aligned with the recurring-gap checklist). */
export const VISUAL_DEFECT_CATEGORIES = [
  'layout',
  'spacing',
  'typography',
  'color',
  'image',
  'component',
  'content',
  'chrome',
  'responsive',
] as const;
export type VisualDefectCategory = (typeof VISUAL_DEFECT_CATEGORIES)[number];

export const VISUAL_DEFECT_SEVERITIES = ['blocker', 'major', 'minor'] as const;
export type VisualDefectSeverity = (typeof VISUAL_DEFECT_SEVERITIES)[number];

/**
 * The rubric the DRIVING model judges the side-by-side against. It is returned WITH the images so the
 * caller's own vision produces the verdict — the platform never calls an AI here.
 */
export const VISUAL_AUDIT_RUBRIC = [
  'You are shown, for each viewport, the ORIGINAL then your CLONE. Judge whether the CLONE is a FAITHFUL, near-pixel reproduction of the ORIGINAL — from the PIXELS, not from your own memory of what you authored.',
  'Compare REGION BY REGION, top to bottom: header/nav, hero, each content section in order, and the footer — at BOTH desktop and mobile. For every real divergence, note: region · category · severity · a specific description.',
  'categories: layout | spacing | typography | color | image | component | content | chrome | responsive',
  'severity: blocker (section missing/empty/unstyled/fundamentally wrong) · major (clearly wrong: wrong or missing images, wrong layout, a missing component, wrong fonts/colors) · minor (subtle: a few px, a slight shade).',
  'Watch especially for what measured/computed-style checks CANNOT see: missing or wrong images/illustrations/logos, dead or empty components (a slider/modal that is static where the original moves), wrong section layout, and wrong per-element fonts (a computed font-family reads the requested NAME even when the file never loaded — trust the glyphs you SEE here).',
  'The page is FAITHFUL only when there are ZERO blocker and ZERO major defects (minors are advisory). Fix every blocker + major, re-render, and check again. Do NOT declare it done from your own render — judge against these side-by-sides.',
].join('\n');

/** Route payload for the deterministic visual gate: the captured side-by-sides + the rubric to judge them. */
export interface VisualAuditImages {
  sourceUrl: string;
  route: string;
  rubric: string;
  categories: readonly string[];
  severities: readonly string[];
  /** The CLONE (loopback build) shots, keyed by viewport. */
  build: Partial<Record<ViewportName, Shot>>;
  /** The LIVE original shots (fresh, SSRF-pinned), keyed by viewport. */
  source: Partial<Record<ViewportName, Shot>>;
}
