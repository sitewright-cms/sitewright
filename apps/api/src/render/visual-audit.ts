// VISUAL ACCEPTANCE GATE — the reliable fidelity signal the clone loop was missing.
//
// The computed-style scorers (fidelity_check / clone_audit body leg) measure font/gradient/coverage of
// TEXT elements — blind to layout, images, section design, and modals, and gameable (a hollow page can
// score "green"). The ONLY thing that captures "faithful" is a per-region side-by-side of the LIVE
// original vs the clone, judged by a vision model. This module is that gate: it hands full-page
// screenshots (desktop + mobile) of the ORIGINAL and the CLONE to the project's configured AI provider
// and gets back a STRUCTURED, TAGGED defect list — RED (pass:false) until the blocking defects are zero.
//
// It inherently sidesteps the lying metrics: it SEES the rendered fonts/images (not
// getComputedStyle().fontFamily, which returns the requested name even when the font never loaded), and
// the shots are full-page (captureBeyondViewport), not clipped. The ORIGINAL is captured FRESH (pinned,
// SSRF-guarded), not from the degraded import-time cache.
//
// Pure `parseVisualAudit` is unit-tested; the provider call is exercised live (needs a configured model).
import type { AgentProvider, AgentAttachment } from '../ai/agent-provider.js';
import type { AiUsage } from '../ai/provider.js';
import type { Shot } from './screenshot.js';

/** Defect categories — aligned with the recurring-gap checklist + docs/nativize/defect-taxonomy.md. */
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

export interface VisualDefect {
  /** Short region label, e.g. "header", "hero", "services section", "footer", "mobile menu". */
  region: string;
  category: VisualDefectCategory;
  severity: VisualDefectSeverity;
  /** Specific, actionable divergence description. */
  description: string;
}

export interface VisualAuditResult {
  /** GREEN only when there are zero blocker + zero major defects (minors are advisory). */
  pass: boolean;
  defects: VisualDefect[];
  summary: string;
  blockers: number;
  majors: number;
  minors: number;
  /** Which sides were actually captured — a missing side makes the audit inconclusive (pass:false). */
  captured: { clone: boolean; original: boolean };
  model: string;
}

/** One viewport's original + clone pair (either may be absent if a capture failed). */
export interface AuditViewport {
  name: string;
  original?: Shot;
  clone?: Shot;
}

const MAX_DEFECTS = 40;
const DEFAULT_MAX_TOKENS = 2048;

const AUDIT_SYSTEM = `You are a meticulous web QA reviewer. You are shown full-page screenshots of an ORIGINAL website and a CLONE that is meant to be a FAITHFUL, near-pixel reproduction of it. Your job is to find every way the CLONE fails to faithfully reproduce the ORIGINAL.

Compare them REGION BY REGION, top to bottom: header/nav, hero, each content section in order, and the footer — at BOTH desktop and mobile widths. Judge the CLONE against the ORIGINAL, not against your taste.

For each real divergence, emit a defect with:
- region: a short label (e.g. "header", "hero", "services section", "footer", "mobile menu")
- category: one of layout | spacing | typography | color | image | component | content | chrome | responsive
    layout = wrong structure/columns/order/alignment/width
    spacing = padding/margin/gap noticeably off
    typography = wrong font family/size/weight, or the wrong font on an element the original styles differently
    color = wrong colors, gradients, or backgrounds
    image = a missing, wrong, or broken image/illustration/logo (e.g. original has an illustration, clone has a plain icon or nothing)
    component = a missing/dead interactive piece (carousel/slider, modal, tabs, accordion, form) — clone shows static/empty/dead where the original has it
    content = missing or wrong text/headings/labels
    chrome = header/nav/footer differences (nav labels, missing icon tabs, footer content/links)
    responsive = a defect that only appears at mobile width (horizontal overflow, broken stacking, missing mobile menu)
- severity: blocker | major | minor
    blocker = the section is missing, empty, unstyled, or fundamentally wrong
    major = clearly noticeable and wrong (wrong images, wrong layout, missing component, wrong fonts/colors)
    minor = subtle (a few px, a slight shade, minor spacing)
- description: specific and actionable — say WHAT differs and WHERE.

Be strict but HONEST: report only divergences you can actually SEE in the images. Do NOT invent defects and do NOT report things that already match. If a region is faithful, say nothing about it. If the whole clone is faithful, return an empty defects array.

Respond with ONLY a single JSON object, no prose and no code fences:
{"summary":"one-sentence overall verdict","defects":[{"region":"hero","category":"image","severity":"major","description":"Original hero has a full-width photo with the tagline overlaid; the clone shows a plain blue box with centered text and no image."}]}`;

/** Map a captured screenshot to a provider image attachment. */
function shotToAttachment(shot: Shot): AgentAttachment {
  return { kind: 'image', mimeType: shot.mimeType, data: shot.base64 };
}

/**
 * Build the ordered image attachments + the legend that tells the model which image is which. Order is
 * ORIGINAL then CLONE within each viewport, so the model always compares an adjacent pair. Viewports with
 * a missing side are skipped (can't compare one-sided).
 */
export function buildAuditPrompt(viewports: AuditViewport[]): { attachments: AgentAttachment[]; legend: string } {
  const attachments: AgentAttachment[] = [];
  const lines: string[] = [];
  let n = 0;
  for (const vp of viewports) {
    if (!vp.original || !vp.clone) continue;
    attachments.push(shotToAttachment(vp.original));
    lines.push(`Image ${++n} = ORIGINAL (${vp.name})`);
    attachments.push(shotToAttachment(vp.clone));
    lines.push(`Image ${++n} = CLONE (${vp.name})`);
  }
  const legend =
    `Compare the CLONE against the ORIGINAL and list every faithfulness defect as JSON.\n` +
    `The images, in order:\n${lines.join('\n')}`;
  return { attachments, legend };
}

/** Coerce an unknown value to a valid defect, or null if it isn't shaped like one. */
function normalizeDefect(raw: unknown): VisualDefect | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const description = typeof r.description === 'string' ? r.description.trim() : '';
  if (!description) return null;
  const region = typeof r.region === 'string' && r.region.trim() ? r.region.trim().slice(0, 60) : 'page';
  const category = (VISUAL_DEFECT_CATEGORIES as readonly string[]).includes(String(r.category))
    ? (r.category as VisualDefectCategory)
    : 'content';
  const severity = (VISUAL_DEFECT_SEVERITIES as readonly string[]).includes(String(r.severity))
    ? (r.severity as VisualDefectSeverity)
    : 'major';
  return { region, category, severity, description: description.slice(0, 400) };
}

/**
 * PURE: extract + validate the defect JSON a vision model returns. Tolerant of surrounding prose and
 * ```json fences (the model is told to emit bare JSON, but weaker models wrap it). Returns a normalized,
 * capped defect list + a summary; on unparseable output returns a single blocker defect so the gate fails
 * LOUD (an unreadable audit must never be treated as green).
 */
export function parseVisualAudit(text: string): { defects: VisualDefect[]; summary: string } {
  const obj = extractJsonObject(text);
  if (!obj) {
    return {
      defects: [{ region: 'page', category: 'content', severity: 'blocker', description: 'The visual audit response could not be parsed as JSON — treat as not-yet-verified and re-run.' }],
      summary: 'audit response unparseable',
    };
  }
  const rawDefects = Array.isArray(obj.defects) ? obj.defects : [];
  const defects = rawDefects.map(normalizeDefect).filter((d): d is VisualDefect => d !== null).slice(0, MAX_DEFECTS);
  const summary = typeof obj.summary === 'string' ? obj.summary.trim().slice(0, 300) : '';
  return { defects, summary };
}

/** Best-effort extraction of the first JSON object from model text (handles fences + surrounding prose). */
function extractJsonObject(text: string): Record<string, unknown> | null {
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(s);
      return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const trimmed = text.trim();
  const direct = tryParse(trimmed);
  if (direct) return direct;
  // ```json … ``` (or bare ``` … ```) fence
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence) {
    const fenced = tryParse((fence[1] ?? '').trim());
    if (fenced) return fenced;
  }
  // First balanced {...} object anywhere in the text.
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const slice = tryParse(trimmed.slice(start, end + 1));
    if (slice) return slice;
  }
  return null;
}

/** PURE: derive the pass/fail summary counts from a defect list (blocker+major gate; minors advisory). */
export function tallyDefects(defects: VisualDefect[]): { blockers: number; majors: number; minors: number; pass: boolean } {
  const blockers = defects.filter((d) => d.severity === 'blocker').length;
  const majors = defects.filter((d) => d.severity === 'major').length;
  const minors = defects.filter((d) => d.severity === 'minor').length;
  return { blockers, majors, minors, pass: blockers === 0 && majors === 0 };
}

/**
 * Run the visual acceptance gate: hand the original/clone screenshot pairs to the provider's vision model
 * and return a tagged defect list + pass/fail. A missing capture on either side makes the audit
 * inconclusive → pass:false with a blocker (never silently green on a blank capture).
 */
/* v8 ignore start -- drives a live AI provider; exercised by the deploy-time e2e with a configured model.
   The pure parse/tally/prompt-build helpers above ARE unit-tested. */
export async function visualAudit(opts: {
  provider: AgentProvider;
  viewports: AuditViewport[];
  signal?: AbortSignal;
  maxTokens?: number;
  onUsage?: (usage: AiUsage) => void | Promise<void>;
}): Promise<VisualAuditResult> {
  const model = opts.provider.model;
  const captured = {
    clone: opts.viewports.some((v) => v.clone),
    original: opts.viewports.some((v) => v.original),
  };
  const { attachments, legend } = buildAuditPrompt(opts.viewports);
  if (attachments.length === 0) {
    // No comparable pair (a capture failed on one side) → fail loud, don't call the model.
    const defect: VisualDefect = {
      region: 'page',
      category: 'content',
      severity: 'blocker',
      description: !captured.original
        ? 'Could not capture the original site to compare against — check the source URL / network.'
        : 'Could not render the clone page to compare — check the page renders without errors.',
    };
    const t = tallyDefects([defect]);
    return { pass: t.pass, defects: [defect], summary: 'capture failed', blockers: t.blockers, majors: t.majors, minors: t.minors, captured, model };
  }

  let text = '';
  let usage: AiUsage = { inputTokens: 0, outputTokens: 0 };
  for await (const ev of opts.provider.runTurn({
    system: AUDIT_SYSTEM,
    messages: [{ role: 'user', content: legend, attachments }],
    tools: [],
    maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    signal: opts.signal,
  })) {
    if (ev.type === 'text_delta') text += ev.text;
    else if (ev.type === 'usage') usage = ev.usage;
  }
  await opts.onUsage?.(usage);

  const { defects, summary } = parseVisualAudit(text);
  const tally = tallyDefects(defects);
  return { pass: tally.pass, defects, summary, blockers: tally.blockers, majors: tally.majors, minors: tally.minors, captured, model };
}
/* v8 ignore stop */
