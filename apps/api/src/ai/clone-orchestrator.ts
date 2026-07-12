// CLONE ORCHESTRATOR — the missing automation layer. The tools (foundation import, author loop,
// visual_audit, clone_audit) were all there, but NOTHING drove them: a human (or the model in claude.ai)
// had to hand-stitch import → author → audit → fix → repeat, and the loop terminated on the agent's own
// optimistic "looks done" instead of a real gate. This drives it: for each imported page it runs the
// authoring agent, then runs an AUTHORITATIVE server-side gate (the agent's claim is IGNORED), feeds the
// concrete defect list back, and iterates until the gate passes or the round budget is spent.
//
// The gate combines the three signals the retrospective identified: the VISION diff vs the LIVE original
// (the reliable fidelity signal), the STRUCTURE/BEHAVIOUR facts (datasets/editable/sliders/modals/fonts/
// mobile-nav), and an anti-lie MARKER check on the STORED source (subagents flip a "done" flag over a raw
// foreign import — so we re-read the source and count native vs foreign markers ourselves).
import type { AgentMessage, AgentProvider, AgentToolDef } from './agent-provider.js';
import type { AiUsage } from './provider.js';
import type { McpToolBridge } from './tool-bridge.js';
import { runAgentLoop } from './agent-loop.js';

/** One page the orchestrator must bring to green. */
export interface ClonePageTask {
  pageId: string;
  slug: string;
  title?: string;
}

/**
 * The result of the authoritative per-page gate. It is DETERMINISTIC — no server-side AI. It combines
 * clone_audit's non-advisory STRUCTURE / BEHAVIOUR / computed-style-visual checks with an anti-lie MARKER
 * check on the stored source. The full VISUAL fidelity (layout/images/sections vs the live original) is the
 * driving agent's own job: it self-judges the deterministic `visual_audit` side-by-sides while authoring —
 * the platform never runs a second AI judgement (keeps the CLI + on-platform lanes separate).
 */
export interface CloneGateResult {
  pass: boolean;
  /** Non-advisory clone_audit failures (structure / behaviour / computed-style visual), as "label — detail". */
  structuralFails: string[];
  markers: { native: number; foreign: number; ok: boolean };
}

export type OrchestratorEvent =
  | { type: 'page-start'; pageId: string; slug: string; index: number; total: number }
  | { type: 'round'; pageId: string; round: number }
  | { type: 'tool'; pageId: string; name: string }
  | { type: 'gate'; pageId: string; round: number; pass: boolean; structuralFails: string[]; markersOk: boolean }
  | { type: 'page-done'; pageId: string; pass: boolean; rounds: number }
  | { type: 'done'; total: number; passed: number }
  | { type: 'error'; pageId?: string; message: string };

// Foreign framework markers left behind by a raw import (Materialize / Bootstrap / FontAwesome / the
// importer's own modal + grid idioms). A faithfully-authored native page has ~0 of these; a lied-about
// "done" page that's still the raw foreign import has them in the hundreds.
const FOREIGN_MARKERS = [
  /\bfa fa-/g,
  /\bfas fa-/g,
  /\bfab fa-/g,
  /\bwaves-effect\b/g,
  /\bd-flex\b/g,
  /\bcb-modal\b/g,
  /\bcenter-gradient\b/g,
  /\bgrid-md-/g,
  /\bsoft-corner\b/g,
  /\bmaterialize\b/gi,
  /\bcol-md-\d/g,
  /\bcol-sm-\d/g,
];
// Native platform markers a faithful authored page uses.
const NATIVE_MARKERS = [/data-sw-[a-z]/g, /\bsw-container\b/g, /\{\{sw-/g, /\{\{#each dataset\./g, /data-sw-component=/g];

function countMatches(source: string, patterns: RegExp[]): number {
  let n = 0;
  for (const re of patterns) n += (source.match(re) ?? []).length;
  return n;
}

/**
 * PURE anti-lie check on the STORED page source: a genuinely native page has native markers and
 * essentially no foreign framework markers; a raw foreign import (with only a `rewritten:true` flag
 * flipped) has foreign markers in the dozens/hundreds. `ok` requires native present AND foreign below a
 * small tolerance (a stray class name is fine; a raw import is not).
 */
export function checkNativeMarkers(source: string | null | undefined): { native: number; foreign: number; ok: boolean } {
  const src = typeof source === 'string' ? source : '';
  const native = countMatches(src, NATIVE_MARKERS);
  const foreign = countMatches(src, FOREIGN_MARKERS);
  return { native, foreign, ok: foreign <= 5 && native >= 1 };
}

/** PURE: the per-page authoring instruction handed to the agent for its first round. */
export function buildAuthorPrompt(task: ClonePageTask): string {
  const label = task.title ? `“${task.title}” (${task.slug || 'home'})` : `“${task.slug || 'home'}”`;
  return [
    `Author the imported page ${label} — page id: ${task.pageId} — as a FAITHFUL, near-pixel clone of its original.`,
    '',
    'Process (do it in this order):',
    `1. Call get_guide("import") for the full authoring rules if you have not already this session.`,
    `2. Call compare_to_source("${task.pageId}") to SEE the original vs your current build.`,
    '3. Map every element to a REAL platform primitive first (get_components / get_reference / widgets / website.effects) — only hand-write HTML when no primitive fits. Use Tailwind utilities for layout, CSS vars for the correct per-element fonts, {{#each dataset.x}} for repeated lists, real <dialog data-sw-component="modal"> for modals, and make text editable with data-sw-* / {{sw-control}}.',
    `4. put_page the native source.`,
    `5. Run visual_audit("${task.pageId}") — it returns the ORIGINAL vs your CLONE side-by-side (desktop + mobile) plus a defect rubric. JUDGE the pixels yourself against the rubric and FIX every blocker + major (wrong/missing images, wrong layout, dead components, wrong fonts/colors). Also run clone_audit("${task.pageId}") for the measured structure/behaviour checks.`,
    '',
    'Do NOT declare the page done from your own render alone — judge against the visual_audit side-by-sides, and the server re-runs the deterministic acceptance gate (structure/behaviour + a raw-import marker check) after your turn and hands you back any remaining failures. Keep going until both are clean.',
  ].join('\n');
}

/** PURE: the feedback message fed back to the agent when the authoritative (deterministic) gate still fails. */
export function buildGateFeedback(gate: CloneGateResult): string {
  const lines = ['The deterministic acceptance gate still FAILS for this page. You MUST fix these before it is considered done:', ''];
  if (!gate.markers.ok) {
    lines.push(
      `- STILL A RAW IMPORT: the stored source has ${gate.markers.foreign} foreign framework markers (Materialize/Bootstrap/FontAwesome) and only ${gate.markers.native} native markers. Re-author the body in native primitives (data-sw-*, {{#each dataset}}, real components) — do not leave the imported markup.`,
    );
  }
  for (const f of gate.structuralFails) lines.push(`- ${f}`);
  lines.push(
    '',
    'Also re-run visual_audit and fix any blocker/major VISUAL defect you can see in the side-by-side (wrong/missing images, wrong layout, dead components, wrong fonts) — the server gate above does not judge those, YOU must.',
    'Then put_page the corrected source; it will be re-checked automatically.',
  );
  return lines.join('\n');
}

/** True when a page passes the deterministic gate (structure/behaviour + not-a-raw-import). */
export function gatePasses(gate: CloneGateResult): boolean {
  return gate.structuralFails.length === 0 && gate.markers.ok;
}

export interface OrchestrationOptions {
  provider: AgentProvider;
  bridge: McpToolBridge;
  system: string;
  tools: AgentToolDef[];
  pages: ClonePageTask[];
  /** Authoritative gate: re-read + re-render the page server-side, IGNORING the agent's claim. */
  runGate: (pageId: string) => Promise<CloneGateResult>;
  maxIterations?: number;
  maxTokens?: number;
  /** Author→gate→fix rounds per page before giving up on that page (default 4). */
  maxRounds?: number;
  signal?: AbortSignal;
  onUsage?: (usage: AiUsage) => Promise<void> | void;
}

/**
 * Drive the whole clone: author each page, gate it authoritatively, feed defects back, iterate to green.
 * Yields progress events; never throws for a single-page failure (it reports and moves on) so one bad page
 * can't abort the whole run.
 */
/* v8 ignore start -- drives the live agent loop + provider; exercised by the deploy-time e2e with a
   configured model. The pure helpers above (markers/prompt/feedback/gate) ARE unit-tested. */
export async function* runCloneOrchestration(opts: OrchestrationOptions): AsyncGenerator<OrchestratorEvent, void> {
  const maxRounds = opts.maxRounds ?? 4;
  let passed = 0;
  for (let i = 0; i < opts.pages.length; i++) {
    if (opts.signal?.aborted) return;
    const task = opts.pages[i]!;
    yield { type: 'page-start', pageId: task.pageId, slug: task.slug, index: i, total: opts.pages.length };
    let messages: AgentMessage[] = [{ role: 'user', content: buildAuthorPrompt(task) }];
    let gate: CloneGateResult | null = null;
    let round = 0;
    for (; round < maxRounds; round++) {
      if (opts.signal?.aborted) return;
      yield { type: 'round', pageId: task.pageId, round };
      // Run the authoring agent for this page (bounded internally by maxIterations + flail guards).
      try {
        const loop = runAgentLoop({
          provider: opts.provider,
          bridge: opts.bridge,
          system: opts.system,
          tools: opts.tools,
          messages,
          maxIterations: opts.maxIterations ?? 60,
          maxTokens: opts.maxTokens,
          signal: opts.signal,
          onUsage: opts.onUsage,
        });
        let next = await loop.next();
        while (!next.done) {
          const ev = next.value;
          if (ev.type === 'tool') yield { type: 'tool', pageId: task.pageId, name: ev.name };
          next = await loop.next();
        }
        messages = next.value.messages;
      } catch (err) {
        yield { type: 'error', pageId: task.pageId, message: err instanceof Error ? err.message : 'author loop failed' };
      }
      if (opts.signal?.aborted) return;
      // AUTHORITATIVE gate — the agent's own "done" is ignored; we re-render + re-read ourselves.
      try {
        gate = await opts.runGate(task.pageId);
      } catch (err) {
        yield { type: 'error', pageId: task.pageId, message: `gate failed: ${err instanceof Error ? err.message : 'error'}` };
        break;
      }
      yield {
        type: 'gate',
        pageId: task.pageId,
        round,
        pass: gate.pass,
        structuralFails: gate.structuralFails,
        markersOk: gate.markers.ok,
      };
      if (gate.pass) break;
      // Feed the concrete defects back for the next round.
      messages.push({ role: 'user', content: buildGateFeedback(gate) });
    }
    const pagePass = !!gate?.pass;
    if (pagePass) passed++;
    yield { type: 'page-done', pageId: task.pageId, pass: pagePass, rounds: round + 1 };
  }
  yield { type: 'done', total: opts.pages.length, passed };
}
/* v8 ignore stop */
