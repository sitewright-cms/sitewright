import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { launch, type LaunchedChrome } from 'chrome-launcher';
// TYPES only: Lighthouse itself runs in a worker thread (runLighthouseIsolated), never in this heap.
import type { Flags, RunnerResult } from 'lighthouse';
import { chromium } from 'playwright-core';
import type { HeadingOutline } from './heading-outline.js';

/**
 * Server-side page-speed + SEO audit via Lighthouse. Drives the SAME headless Chromium the rest of
 * the render pipeline uses (the on-disk Playwright build) through chrome-launcher's CDP port, so no
 * second browser binary is downloaded. Runs against an already-served URL (the signed draft preview
 * or the published `/sites/<slug>/`), scoped by {@link withRenderSlot} to the shared 2-way render cap.
 *
 * Lab-only (no CrUX field data). The performance score is directional in a container; the SEO,
 * accessibility, and best-practices categories are deterministic and the primary value here.
 */

export type FormFactor = 'mobile' | 'desktop';

/** The four Lighthouse categories we run, 0–100 (null when a category could not be scored). */
export interface PagespeedScores {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
}

/** Core Web Vitals-ish lab metrics, in the audit's native units (ms, or unitless for CLS). */
export interface PagespeedMetrics {
  firstContentfulPaintMs?: number;
  largestContentfulPaintMs?: number;
  totalBlockingTimeMs?: number;
  cumulativeLayoutShift?: number;
  speedIndexMs?: number;
}

/**
 * One concrete resource/element a finding points at — the "which file / which node" detail that turns a
 * generic audit into an actionable fix (mirrors the per-row tables in Google PageSpeed's opportunities).
 * All fields optional: a network opportunity carries a `url` + byte/ms costs; an accessibility audit
 * carries a DOM `label` instead. Only primitive, bounded values are copied out — never a raw Lighthouse
 * node object — so the payload stays small and safe to render as plain text.
 */
export interface PagespeedResourceItem {
  /** The resource URL — origin-relative for the site's own assets (the loopback origin is stripped), absolute for third-party. */
  url?: string;
  /** A short label when the item is a DOM node / source location rather than a plain URL. */
  label?: string;
  /** Total transfer/resource size in bytes, when the audit reports one. */
  totalBytes?: number;
  /** Bytes that could be saved by fixing this item, when the audit reports one. */
  wastedBytes?: number;
  /** Milliseconds that could be saved by fixing this item, when the audit reports one. */
  wastedMs?: number;
}

/** A single actionable audit (a failing/opportunity check the author can fix). */
export interface PagespeedFinding {
  id: string;
  title: string;
  category: keyof PagespeedScores;
  /** 0–1 (null for opportunity-style audits without a pass/fail score). */
  score: number | null;
  /** Human-readable value, e.g. "Potential savings of 320 KiB" or "3 links". */
  displayValue?: string;
  /** Lighthouse's explanation of WHAT the check means + how to fix it (markdown; the UI shows it as the
   *  finding's actionable-advice tooltip). May carry a trailing "[Learn more](url)" the client can strip. */
  description?: string;
  /** Estimated page-load time saved by fixing this (opportunity audits), in ms. */
  overallSavingsMs?: number;
  /** Estimated transfer saved by fixing this (opportunity audits), in bytes. */
  overallSavingsBytes?: number;
  /** The specific resources/elements this finding points at — worst-first, capped. */
  items?: PagespeedResourceItem[];
  /** How many further items exist beyond the capped {@link items} (so the UI can say "+N more"). */
  moreItems?: number;
}

/** One long main-thread task (≥ 50 ms) — what the blocking time is made of. */
export interface PagespeedLongTask {
  /** The script (or page) Lighthouse attributes the task to — origin-relative for the site's own files. */
  url?: string;
  /** Lighthouse's own attribution when there is no URL: "Unattributable", "Browser", "Browser GC". */
  label?: string;
  durationMs: number;
  /** When it started, ms into the (simulated) load. */
  startMs?: number;
}

/** One element whose animation Chrome could not run on the compositor (it repaints on the main thread). */
export interface PagespeedAnimationIssue {
  /** The element, as Lighthouse labels it (its text or a short snippet). */
  label?: string;
  /** The CSS animation names involved, when the animation is named. */
  animations?: string[];
  /** The animated CSS properties the compositor refused (parsed from Lighthouse's reasons). */
  properties?: string[];
  /** Lighthouse's failure reasons, verbatim. */
  reasons: string[];
}

/**
 * WHY the main thread was busy — present only when blocking time or the performance score is poor.
 *
 * Lighthouse's `long-tasks` and `non-composited-animations` are INFORMATIVE audits (no pass/fail score),
 * so the failing-findings list never shows them, and its scored stand-ins (`bootup-time`,
 * `mainthread-work-breakdown`) only say "Other: 2 s". An author whose blocking time jumped from 0 to
 * 790 ms after adding a few CSS effects had no way to learn which ones. These two lists name the task
 * and the animated element. Bounded like every other list here.
 */
export interface PagespeedMainThread {
  /** Longest tasks first, capped. */
  longTasks: PagespeedLongTask[];
  moreLongTasks?: number;
  /** In Lighthouse's (document) order, capped. */
  nonCompositedAnimations: PagespeedAnimationIssue[];
  moreNonCompositedAnimations?: number;
}

export interface PagespeedAuditResult {
  url: string;
  formFactor: FormFactor;
  scores: PagespeedScores;
  metrics: PagespeedMetrics;
  /** Non-passing, non-informational audits, worst-first — the fix list. */
  findings: PagespeedFinding[];
  /** Main-thread attribution (long tasks, non-composited animations) — only when blocking time or performance is poor. */
  mainThread?: PagespeedMainThread;
  /**
   * Lighthouse's own run warnings (e.g. "the tested device appears to have a slower CPU"). Surfaced so a
   * low LAB score can be understood as an environment constraint, not mistaken for a page defect. Absent
   * when Lighthouse raised none.
   */
  runWarnings?: string[];
  /**
   * Chrome's CPU/perf benchmark for the audit HOST (Lighthouse `environment.benchmarkIndex`). A low value
   * means the container CPU throttled the lab run — the perf score is host-limited and would be higher on a
   * faster machine / a real device. Absent when Lighthouse did not report one.
   */
  benchmarkIndex?: number;
  /**
   * The page's heading (h1–h6) outline with SEO/accessibility recommendations. Filled in by the route
   * (parsed from the served HTML), not by {@link summarize} — absent when the HTML could not be read.
   */
  outline?: HeadingOutline;
  lighthouseVersion: string;
  fetchedAt: string;
}

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const;
type LhCategory = (typeof CATEGORIES)[number];

/** Map Lighthouse's kebab category id to our camelCase score key. */
const SCORE_KEY: Record<LhCategory, keyof PagespeedScores> = {
  performance: 'performance',
  accessibility: 'accessibility',
  'best-practices': 'bestPractices',
  seo: 'seo',
};

/**
 * Reuse the Playwright-managed Chromium so we don't ship a second browser.
 * 1. playwright-core's pinned full-chromium build, if it happens to be installed (dev boxes / CI).
 * 2. Scan PLAYWRIGHT_BROWSERS_PATH. The PRODUCTION image installs ONLY `chromium-headless-shell` (the
 *    same binary the screenshot path launches) — its directory is `chromium_headless_shell-<rev>` with
 *    the executable at `chrome-headless-shell-linux64/chrome-headless-shell` — so we look for that FIRST,
 *    then a full `chromium-<rev>/chrome-linux64/chrome` as a dev-box fallback. Newest revision first.
 * 3. undefined → let chrome-launcher discover a system Chrome.
 */
/* v8 ignore start -- filesystem/env-dependent browser discovery, exercised only when a real browser runs */
const BROWSER_LAYOUTS: ReadonlyArray<{ prefix: string; binaries: readonly string[] }> = [
  { prefix: 'chromium_headless_shell-', binaries: ['chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-headless-shell-linux/chrome-headless-shell'] },
  { prefix: 'chromium-', binaries: ['chrome-linux64/chrome', 'chrome-linux/chrome'] },
];

function resolveChromePath(): string | undefined {
  try {
    const pinned = chromium.executablePath();
    if (existsSync(pinned)) return pinned;
  } catch {
    /* playwright-core could not compute a path; fall through */
  }
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root && existsSync(root)) {
    const dirs = readdirSync(root);
    for (const layout of BROWSER_LAYOUTS) {
      const revisions = dirs.filter((d) => d.startsWith(layout.prefix)).sort().reverse();
      for (const rev of revisions) {
        for (const binary of layout.binaries) {
          const candidate = join(root, rev, binary);
          if (existsSync(candidate)) return candidate;
        }
      }
    }
  }
  return undefined;
}
/* v8 ignore stop */

function toPercent(score: number | null | undefined): number | null {
  return score == null ? null : Math.round(score * 100);
}

// ---- concrete finding detail (files / nodes / savings) ------------------------------------------

/** Most concrete rows we surface per finding; the UI shows the rest as "+N more". */
const MAX_ITEMS_PER_FINDING = 6;
const MAX_URL_LEN = 300;
const MAX_LABEL_LEN = 160;

function nonEmptyStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
function finiteNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function cap(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * Derive a resource identifier for one Lighthouse table/opportunity row. Opportunity rows carry a plain
 * `url` string; table rows may instead hold a typed value object (a DOM `node`, a `source-location`, a
 * `link`, a `url`, or a `code` snippet) under some column key — so we scan the row's values for the first
 * such object. Only bounded primitives are extracted; no object is passed through.
 */
function itemIdentity(item: Record<string, unknown>): { url?: string; label?: string } {
  const directUrl = nonEmptyStr(item.url);
  if (directUrl) return { url: cap(directUrl, MAX_URL_LEN) };

  // A typed `text` cell (the insight tables' "Unattributed" bucket) is the weakest identity: used only
  // when no URL/node/code cell and no plain string field names the row.
  let textCell: string | undefined;
  for (const v of Object.values(item)) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    switch (o.type) {
      case 'source-location': {
        const u = nonEmptyStr(o.url);
        if (u) {
          const line = finiteNum(o.line);
          return { url: cap(line !== undefined ? `${u}:${line + 1}` : u, MAX_URL_LEN) };
        }
        break;
      }
      case 'url': {
        const u = nonEmptyStr(o.value);
        if (u) return { url: cap(u, MAX_URL_LEN) };
        break;
      }
      case 'link': {
        const u = nonEmptyStr(o.url);
        const txt = nonEmptyStr(o.text);
        if (u) return { url: cap(u, MAX_URL_LEN), ...(txt ? { label: cap(txt, MAX_LABEL_LEN) } : {}) };
        if (txt) return { label: cap(txt, MAX_LABEL_LEN) };
        break;
      }
      case 'node': {
        const lbl = nonEmptyStr(o.nodeLabel) ?? nonEmptyStr(o.snippet) ?? nonEmptyStr(o.selector);
        if (lbl) return { label: cap(lbl.replace(/\s+/g, ' ').trim(), MAX_LABEL_LEN) };
        break;
      }
      case 'code': {
        const c = nonEmptyStr(o.value);
        if (c) return { label: cap(c.replace(/\s+/g, ' ').trim(), MAX_LABEL_LEN) };
        break;
      }
      case 'text':
        textCell ??= nonEmptyStr(o.value);
        break;
      default:
        break;
    }
  }

  // Common string identifiers on non-URL table rows: `groupLabel` (main-thread work breakdown),
  // `statistic` (DOM-size), plus generic label/source/name fields.
  const lbl =
    nonEmptyStr(item.label) ??
    nonEmptyStr(item.source) ??
    nonEmptyStr(item.name) ??
    nonEmptyStr(item.statistic) ??
    nonEmptyStr(item.groupLabel) ??
    textCell;
  return lbl ? { label: cap(lbl, MAX_LABEL_LEN) } : {};
}

/** Common Lighthouse table byte/time column names beyond the byte-efficiency set (totalBytes/wastedBytes/
 *  wastedMs) — so diagnostics like `bootup-time` ({url,total,scripting}), `mainthread-work-breakdown`
 *  ({groupLabel,duration}) and `forced-reflow-insight` ({source,reflowTime}) surface their figures instead
 *  of rendering an empty row. */
const BYTES_KEYS = ['totalBytes', 'transferSize', 'resourceSize'] as const;
const MS_KEYS = ['wastedMs', 'duration', 'total', 'blockingTime', 'mainThreadTime', 'reflowTime'] as const;

/** First finite number among the given keys of an item, else undefined. */
function firstNum(item: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const k of keys) {
    const n = finiteNum(item[k]);
    if (n !== undefined) return n;
  }
  return undefined;
}

interface FindingDetail {
  items?: PagespeedResourceItem[];
  moreItems?: number;
  overallSavingsMs?: number;
  overallSavingsBytes?: number;
}

/** A details object's rows, when it is a row-bearing type (`opportunity` / `table`). */
function tableRows(d: unknown): unknown[] | null {
  if (!d || typeof d !== 'object') return null;
  const t = d as { type?: unknown; items?: unknown };
  if (t.type !== 'opportunity' && t.type !== 'table') return null;
  return Array.isArray(t.items) ? t.items : [];
}

/**
 * The rows of a `list` details object: the insight audits (e.g. `forced-reflow-insight`) wrap SEVERAL
 * tables in one list — optionally inside a `list-section` — so the rows are the concatenation of each
 * table's. Anything that is not a table (a node, a checklist) carries no rows.
 */
function listRows(items: unknown): unknown[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap((sub) => {
    const inner = sub && typeof sub === 'object' && (sub as { type?: unknown }).type === 'list-section' ? (sub as { value?: unknown }).value : sub;
    return tableRows(inner) ?? [];
  });
}

/** First occurrence of each url/label pair, order kept. A row with neither is not a "place", so never merged. */
function dedupeByIdentity(items: readonly PagespeedResourceItem[]): PagespeedResourceItem[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    if (!it.url && !it.label) return true;
    const key = `${it.url ?? ''}\u0000${it.label ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Extract the concrete file/node list + savings totals from a Lighthouse audit's `details`, if any. */
function findingDetail(details: unknown): FindingDetail {
  if (!details || typeof details !== 'object') return {};
  const d = details as {
    type?: unknown;
    items?: unknown;
    overallSavingsMs?: unknown;
    overallSavingsBytes?: unknown;
    summary?: { wastedMs?: unknown; wastedBytes?: unknown };
  };
  const isList = d.type === 'list';
  const rawItems = isList ? listRows(d.items) : tableRows(d);
  if (!rawItems) return {};

  const parsed: PagespeedResourceItem[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const id = itemIdentity(item);
    const totalBytes = firstNum(item, BYTES_KEYS);
    const wastedBytes = finiteNum(item.wastedBytes);
    const wastedMs = firstNum(item, MS_KEYS);
    // A row with no identifier AND no figure carries nothing actionable → drop it.
    if (!id.url && !id.label && totalBytes === undefined && wastedBytes === undefined && wastedMs === undefined) continue;
    parsed.push({
      ...id,
      ...(totalBytes !== undefined ? { totalBytes } : {}),
      ...(wastedBytes !== undefined ? { wastedBytes } : {}),
      ...(wastedMs !== undefined ? { wastedMs } : {}),
    });
  }
  // Worst first: biggest byte saving, then time saving, then largest resource.
  parsed.sort(
    (a, b) =>
      (b.wastedBytes ?? 0) - (a.wastedBytes ?? 0) ||
      (b.wastedMs ?? 0) - (a.wastedMs ?? 0) ||
      (b.totalBytes ?? 0) - (a.totalBytes ?? 0),
  );
  // A list's tables overlap — forced-reflow's "top function call" is usually also its biggest bottom-up
  // row — so keep each location once (the worst copy, since this runs after the sort).
  const rows = isList ? dedupeByIdentity(parsed) : parsed;
  const items = rows.slice(0, MAX_ITEMS_PER_FINDING);
  const moreItems = rows.length - items.length;

  const overallSavingsMs = finiteNum(d.overallSavingsMs) ?? finiteNum(d.summary?.wastedMs);
  const overallSavingsBytes = finiteNum(d.overallSavingsBytes) ?? finiteNum(d.summary?.wastedBytes);

  return {
    ...(items.length ? { items } : {}),
    ...(moreItems > 0 ? { moreItems } : {}),
    ...(overallSavingsMs !== undefined ? { overallSavingsMs } : {}),
    ...(overallSavingsBytes !== undefined ? { overallSavingsBytes } : {}),
  };
}

/**
 * Strip the internal loopback origin out of every finding item (immutable). Lighthouse's per-resource
 * tables carry the served origin (`http://127.0.0.1:<port>`) for the site's OWN assets; we must never leak
 * that ephemeral host:port — the same invariant {@link redactOrigin} keeps for run-warnings and the route
 * keeps for `url`. A same-site `url` becomes origin-relative; third-party URLs (fonts, external images)
 * don't start with the origin and are left as-is. As defense-in-depth a `label` (a DOM snippet / code
 * value, which a future Lighthouse audit could conceivably interpolate a resolved URL into) has EVERY
 * occurrence of the origin removed. Pure — unit-tested.
 */
export function rebaseFindingUrls(findings: readonly PagespeedFinding[], origin: string): PagespeedFinding[] {
  if (!origin) return findings.slice();
  const carriesOrigin = (it: PagespeedResourceItem): boolean =>
    (it.url?.includes(origin) ?? false) || (it.label?.includes(origin) ?? false);
  return findings.map((f) => {
    if (!f.items?.some(carriesOrigin)) return f;
    return {
      ...f,
      items: f.items.map((it) => {
        if (!carriesOrigin(it)) return it;
        return {
          ...it,
          ...(it.url?.includes(origin) ? { url: rebaseUrl(it.url, origin) } : {}),
          ...(it.label?.includes(origin) ? { label: it.label.split(origin).join('') } : {}),
        };
      }),
    };
  });
}

/**
 * A same-site URL made origin-relative; an origin anywhere else in it (a `blob:` URL, a redirect
 * parameter) is removed too — a URL only STARTING with the origin is not the only shape that carries it.
 */
function rebaseUrl(url: string, origin: string): string {
  return url.startsWith(origin) ? url.slice(origin.length) || '/' : url.split(origin).join('');
}

/**
 * Scrub the internal loopback origin (`http://127.0.0.1:<port>`) out of Lighthouse run-warnings before
 * they leave the server. Lighthouse interpolates the navigated URL into some warnings (e.g. its redirect
 * notice), and the audit navigates the ephemeral loopback server — so a warning can carry the internal
 * host:port. The route already reports the LOGICAL page path for `url`; this keeps the same "never leak
 * the ephemeral URL" invariant for warnings. Pure — unit-tested.
 */
export function redactOrigin(
  warnings: readonly string[] | undefined,
  origin: string,
): string[] | undefined {
  if (!warnings) return undefined;
  return warnings.map((w) => (origin ? w.split(origin).join('') : w));
}

/**
 * {@link rebaseFindingUrls} for the main-thread section (immutable): a long task's `url` is the served
 * script or page — the loopback origin for the site's own files — and a label or reason is scrubbed of
 * every occurrence as defense-in-depth, exactly like a finding's label. Pure — unit-tested.
 */
export function rebaseMainThread(mt: PagespeedMainThread | undefined, origin: string): PagespeedMainThread | undefined {
  if (!mt || !origin) return mt;
  const scrub = (s: string): string => s.split(origin).join('');
  return {
    ...mt,
    longTasks: mt.longTasks.map((t) => ({
      ...t,
      ...(t.url !== undefined ? { url: rebaseUrl(t.url, origin) } : {}),
      ...(t.label !== undefined ? { label: scrub(t.label) } : {}),
    })),
    nonCompositedAnimations: mt.nonCompositedAnimations.map((a) => ({
      ...a,
      ...(a.label !== undefined ? { label: scrub(a.label) } : {}),
      reasons: a.reasons.map(scrub),
    })),
  };
}

// ---- main-thread attribution (long tasks / non-composited animations) ---------------------------

/** Lighthouse's own "poor" band: a metric or category score under 0.5 renders red. */
const POOR_SCORE = 0.5;
const MAX_LONG_TASKS = 5;
const MAX_ANIMATED_ELEMENTS = 5;
const MAX_REASONS_PER_ELEMENT = 4;
const MAX_NAMES_PER_ELEMENT = 4;
const MAX_PROPERTIES_PER_ELEMENT = 8;
const MAX_PROPERTY_LEN = 64;

/** The long-tasks `url` column also carries Lighthouse's attribution words ("Unattributable", "Browser GC"). */
function looksLikeUrl(s: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || s.startsWith('/');
}

/** Rows of an audit's table details, or none. */
function auditRows(audit: { details?: unknown } | undefined): unknown[] {
  return tableRows(audit?.details) ?? [];
}

function parseLongTasks(rows: readonly unknown[]): PagespeedLongTask[] {
  const tasks: PagespeedLongTask[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const duration = finiteNum(row.duration);
    if (duration === undefined) continue; // a task with no duration is not a task
    const start = finiteNum(row.startTime);
    const where = nonEmptyStr(row.url) ?? 'Unattributed';
    tasks.push({
      ...(looksLikeUrl(where) ? { url: cap(where, MAX_URL_LEN) } : { label: cap(where, MAX_LABEL_LEN) }),
      durationMs: Math.round(duration),
      ...(start !== undefined ? { startMs: Math.round(start) } : {}),
    });
  }
  return tasks.sort((a, b) => b.durationMs - a.durationMs);
}

/** "Unsupported CSS Properties: box-shadow, filter" → the property names (en-US Lighthouse strings). */
const UNSUPPORTED_PROPS = /^(?:Unsupported CSS Propert(?:y|ies)|Custom CSS properties cannot be animated on the compositor): (.+)$/;
function unsupportedProperties(reason: string): string[] {
  const m = UNSUPPORTED_PROPS.exec(reason);
  return m ? String(m[1]).split(/,\s*/) : [];
}

/** Unique, non-empty strings, in order, capped in count and length. */
function uniqueCapped(values: readonly string[], max: number, len: number): string[] {
  return [...new Set(values.filter((v) => v.length > 0))].slice(0, max).map((v) => cap(v, len));
}

function parseAnimationIssues(rows: readonly unknown[]): PagespeedAnimationIssue[] {
  const out: PagespeedAnimationIssue[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as { node?: unknown; subItems?: { items?: unknown } };
    const subItems = row.subItems?.items;
    const subs: unknown[] = Array.isArray(subItems) ? subItems : [];
    const reasons: string[] = [];
    const names: string[] = [];
    for (const s of subs) {
      if (!s || typeof s !== 'object') continue;
      const reason = nonEmptyStr((s as { failureReason?: unknown }).failureReason);
      if (!reason) continue;
      reasons.push(reason);
      const name = nonEmptyStr((s as { animation?: unknown }).animation);
      if (name) names.push(name);
    }
    if (reasons.length === 0) continue; // nothing to say about this element
    const properties = reasons.flatMap(unsupportedProperties);
    const { label } = itemIdentity({ node: row.node });
    const animations = uniqueCapped(names, MAX_NAMES_PER_ELEMENT, MAX_LABEL_LEN);
    const props = uniqueCapped(properties, MAX_PROPERTIES_PER_ELEMENT, MAX_PROPERTY_LEN);
    out.push({
      ...(label ? { label } : {}),
      ...(animations.length ? { animations } : {}),
      ...(props.length ? { properties: props } : {}),
      reasons: uniqueCapped(reasons, MAX_REASONS_PER_ELEMENT, MAX_LABEL_LEN),
    });
  }
  return out;
}

/**
 * The main-thread section, or undefined when the page is not poor on blocking time / performance, or
 * Lighthouse found nothing to attribute. Gated on "poor" so a healthy page's report carries no noise.
 */
function mainThreadDiagnostics(
  audits: Record<string, { score?: number | null; details?: unknown } | undefined>,
  performanceScore: number | null | undefined,
): PagespeedMainThread | undefined {
  const tbtScore = audits['total-blocking-time']?.score;
  const poor =
    (typeof tbtScore === 'number' && tbtScore < POOR_SCORE) ||
    (typeof performanceScore === 'number' && performanceScore < POOR_SCORE);
  if (!poor) return undefined;
  const tasks = parseLongTasks(auditRows(audits['long-tasks']));
  const anims = parseAnimationIssues(auditRows(audits['non-composited-animations']));
  if (tasks.length === 0 && anims.length === 0) return undefined;
  const longTasks = tasks.slice(0, MAX_LONG_TASKS);
  const nonCompositedAnimations = anims.slice(0, MAX_ANIMATED_ELEMENTS);
  return {
    longTasks,
    ...(tasks.length > longTasks.length ? { moreLongTasks: tasks.length - longTasks.length } : {}),
    nonCompositedAnimations,
    ...(anims.length > nonCompositedAnimations.length
      ? { moreNonCompositedAnimations: anims.length - nonCompositedAnimations.length }
      : {}),
  };
}

// ---- failure plumbing ---------------------------------------------------------------------------

const MAX_RUN_ERROR_LEN = 400;
const MAX_RUN_ERROR_CODE_LEN = 64;

/** Thrown when no headless browser could be launched — lets the route degrade to a clean 503. */
export class PagespeedUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PagespeedUnavailableError';
  }
}

/**
 * What the client is told when the failure is NOT a Lighthouse verdict — a Chrome crash, a refused
 * DevTools connection, a filesystem error. Their own text names a debug port, a temp path or a Node
 * error code, so it stays in the server log (the error's `cause`) and this fixed sentence goes out.
 */
export const GENERIC_RUN_FAILURE =
  'Lighthouse stopped before it could audit the page: the headless browser or its DevTools connection failed. ' +
  'Retry; if it keeps failing, look for scripts or animated backgrounds heavy enough to stall a browser.';

const FILE_URL = /\bfile:\/\/[^\s'"()<>]*/gi;
/** An absolute POSIX path standing on its own — NOT the path part of a URL (those follow a host or port).
 *  One character class, no nested quantifier: linear on any input. */
const POSIX_PATH = /(?<![\w.:/~%-])\/[^\s'"()<>,;]+/g;
const WINDOWS_PATH = /\b[A-Za-z]:\\[^\s'"()<>]*/g;
/** Any loopback endpoint other than the served origin: the Chrome debug port, a dev server. No nested
 *  quantifier (the linter's ReDoS rule); the scheme in front of one is dropped by a second pass. */
const LOOPBACK = /\b127\.\d{1,3}\.\d{1,3}\.\d{1,3}:?\d*|\blocalhost:\d+|\[::1\]:?\d*/gi;
const LOCAL_PLACEHOLDER = '[local]';
const SCHEME_BEFORE_LOCAL = /\b[a-z][\w+.-]*:\/\/(?=\[local\])/gi;

/**
 * Make a Lighthouse sentence safe to send: filesystem paths and `file:` URLs removed, the served
 * origin removed (its URLs become the site paths the author knows), any other loopback endpoint
 * replaced. Paths go FIRST, while a site path is still visibly part of its loopback URL and so is not
 * mistaken for a file. Applied BEFORE the length cap — a cap first could cut an origin in half, and a
 * half-origin no longer matches anything. Pure — unit-tested.
 */
export function scrubRunMessage(text: string, origin = ''): string {
  const noPaths = text.replace(FILE_URL, '').replace(WINDOWS_PATH, '').replace(POSIX_PATH, '');
  const noOrigin = origin ? noPaths.split(origin).join('') : noPaths;
  return noOrigin.replace(LOOPBACK, LOCAL_PLACEHOLDER).replace(SCHEME_BEFORE_LOCAL, '');
}

/**
 * Failures of the BROWSER rather than verdicts on the PAGE — a crashed tab, a stalled DevTools socket, our
 * own run deadline, no result at all. Worth retrying as they are; a verdict (NO_FCP, NOT_HTML, …) is not.
 */
const RETRYABLE_RUN_CODES: ReadonlySet<string> = new Set(['TARGET_CRASHED', 'LIGHTHOUSE_FAILED', 'PROTOCOL_TIMEOUT', 'TIMEOUT', 'NO_RESULT']);

/**
 * What a code means HERE, appended to Lighthouse's own sentence. "Browser tab has unexpectedly crashed"
 * is, on a memory-capped instance, the renderer being killed for memory — the shared 768MB instance's
 * logs show it right next to the container's own OOM kills. Said plainly, so it is not read as a bug in
 * the page.
 */
const RUN_ERROR_HINTS: Readonly<Record<string, string>> = {
  TARGET_CRASHED:
    'On this server that almost always means the browser ran out of memory on a heavy page: retry, auditing one device at a time.',
};

/**
 * Lighthouse ran but could not audit the page — a fatal `runtimeError` on the result (NO_FCP, PAGE_HUNG,
 * …) or a thrown error. The route answers 502 with `code` + `message` instead of the opaque global 500,
 * so the author learns WHAT failed — "the page never painted" is actionable; "internal error" is not.
 * Only a Lighthouse verdict's own sentence is ever passed on, scrubbed ({@link scrubRunMessage}) and
 * then bounded: both fields reach the client verbatim. `cause` keeps the original for the server log.
 * `retryable` says whether running the same audit again can succeed (see RETRYABLE_RUN_CODES).
 */
export class PagespeedRunError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, message: string, opts: { origin?: string; cause?: unknown } = {}) {
    // A machine-readable token, so normalised to Lighthouse's own SHOUTED_SNAKE shape and hard-capped.
    const normalised = code.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, MAX_RUN_ERROR_CODE_LEN);
    const hint = RUN_ERROR_HINTS[normalised];
    const scrubbed = scrubRunMessage(message, opts.origin);
    super(cap(hint ? `${scrubbed} ${hint}` : scrubbed, MAX_RUN_ERROR_LEN), { cause: opts.cause });
    this.name = 'PagespeedRunError';
    this.code = normalised;
    this.retryable = RETRYABLE_RUN_CODES.has(normalised);
  }
}

/**
 * A fatal Lighthouse `runtimeError` (or no result at all) as a typed error; null when the run is usable.
 * `origin` is the served loopback origin, removed from the message so its URLs read as site paths. Pure.
 */
export function lighthouseRuntimeError(result: RunnerResult | undefined, origin = ''): PagespeedRunError | null {
  if (!result) return new PagespeedRunError('NO_RESULT', 'Lighthouse returned no result');
  const rt = result.lhr.runtimeError as { code?: unknown; message?: unknown } | undefined;
  if (!rt) return null;
  const code = nonEmptyStr(rt.code) ?? 'LIGHTHOUSE_FAILED';
  // `errorStack` is deliberately NOT carried — it names server paths.
  return new PagespeedRunError(code, nonEmptyStr(rt.message) ?? `Lighthouse failed with ${code}`, { origin });
}

/**
 * A thrown error as a typed {@link PagespeedRunError} (kept as-is if it already is one). Only a real
 * LighthouseError — a `code` plus its `friendlyMessage` sentence — passes its text on; anything else (a
 * Chrome crash, a refused DevTools socket, a Node fs error) gets {@link GENERIC_RUN_FAILURE}. Pure.
 */
export function toPagespeedRunError(err: unknown, origin = ''): PagespeedRunError {
  if (err instanceof PagespeedRunError) return err;
  const lh = err instanceof Error ? (err as Error & { code?: unknown; friendlyMessage?: unknown }) : undefined;
  // `message` of a LighthouseError is just its code; `friendlyMessage` is the sentence — a plain string,
  // or an un-formatted ICU message object carrying its English text in `formattedDefault`.
  const friendly =
    nonEmptyStr(lh?.friendlyMessage) ??
    nonEmptyStr((lh?.friendlyMessage as { formattedDefault?: unknown } | undefined)?.formattedDefault);
  const code = nonEmptyStr(lh?.code);
  if (friendly && code) return new PagespeedRunError(code, friendly, { origin, cause: err });
  return new PagespeedRunError('LIGHTHOUSE_FAILED', GENERIC_RUN_FAILURE, { cause: err });
}

/**
 * Settle with `work` — unless `signal` aborts first: then run `onAbort` (kill the browser) and reject AT
 * ONCE with the signal's reason, rather than waiting for Lighthouse to notice its browser died. The
 * work's own late rejection (it fails BECAUSE the browser was killed) is swallowed so it can't surface
 * as an unhandled rejection. Pure plumbing — unit-tested; the browser side is v8-ignored.
 */
export function abortable<T>(work: Promise<T>, signal: AbortSignal | undefined, onAbort: () => void): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) {
    work.catch(() => {});
    onAbort();
    return Promise.reject(signal.reason as Error);
  }
  return new Promise<T>((resolve, reject) => {
    // The work's late rejection lands in the `then` below (a no-op once this has rejected).
    const abort = (): void => {
      onAbort();
      reject(signal.reason as Error);
    };
    signal.addEventListener('abort', abort, { once: true });
    work.then(
      (v) => {
        signal.removeEventListener('abort', abort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(e as Error);
      },
    );
  });
}

/** Reduce a raw Lighthouse result to our compact score/metrics/findings shape. Pure — unit-tested directly. */
export function summarize(url: string, formFactor: FormFactor, result: RunnerResult): PagespeedAuditResult {
  const lhr = result.lhr;
  const audits = lhr.audits;
  const num = (id: string): number | undefined => audits[id]?.numericValue ?? undefined;

  const findings: PagespeedFinding[] = [];
  for (const cat of CATEGORIES) {
    const category = lhr.categories[cat];
    if (!category) continue;
    for (const ref of category.auditRefs) {
      const audit = audits[ref.id];
      if (!audit) continue;
      const mode = audit.scoreDisplayMode;
      // Only surface scored, non-passing checks the author can act on.
      if (mode === 'informative' || mode === 'manual' || mode === 'notApplicable') continue;
      if (audit.score == null || audit.score >= 0.9) continue;
      findings.push({
        id: audit.id,
        title: audit.title,
        category: SCORE_KEY[cat],
        score: audit.score,
        displayValue: audit.displayValue || undefined,
        description: audit.description || undefined,
        ...findingDetail(audit.details),
      });
    }
  }
  findings.sort((a, b) => (a.score ?? 1) - (b.score ?? 1));

  // Transparency: Lighthouse's environment notices explain a host-constrained lab number (slow CPU /
  // heavy throttling) so the reader doesn't chase a "problem" the page can't fix.
  const runWarnings = Array.isArray(lhr.runWarnings)
    ? lhr.runWarnings.filter((w): w is string => typeof w === 'string' && w.length > 0)
    : [];
  const benchmarkIndex = lhr.environment?.benchmarkIndex;
  const mainThread = mainThreadDiagnostics(audits, lhr.categories.performance?.score);

  return {
    url,
    formFactor,
    scores: {
      performance: toPercent(lhr.categories.performance?.score),
      accessibility: toPercent(lhr.categories.accessibility?.score),
      bestPractices: toPercent(lhr.categories['best-practices']?.score),
      seo: toPercent(lhr.categories.seo?.score),
    },
    metrics: {
      firstContentfulPaintMs: num('first-contentful-paint'),
      largestContentfulPaintMs: num('largest-contentful-paint'),
      totalBlockingTimeMs: num('total-blocking-time'),
      cumulativeLayoutShift: num('cumulative-layout-shift'),
      speedIndexMs: num('speed-index'),
    },
    findings,
    ...(mainThread ? { mainThread } : {}),
    ...(runWarnings.length ? { runWarnings } : {}),
    ...(typeof benchmarkIndex === 'number' ? { benchmarkIndex } : {}),
    lighthouseVersion: lhr.lighthouseVersion,
    fetchedAt: lhr.fetchTime,
  };
}

/** Chromium flags matching the rest of the render pipeline (non-root container, no /dev/shm, CPU render). */
const CHROME_FLAGS = ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];

/**
 * Lighthouse's standard DESKTOP throttling preset (`desktopDense4G`): a fast link and — crucially — NO
 * CPU slowdown (multiplier 1). It MUST be set explicitly: passing only `formFactor`/`screenEmulation`
 * leaves throttling at Lighthouse's default, which is the MOBILE "Slow 4G" profile (RTT 150ms, ~1.6Mbps,
 * 4× CPU). Without this, a `formFactor:'desktop'` run gets a desktop-sized viewport but a phone's network
 * AND a 4× CPU penalty — badly (and misleadingly) under-scoring desktop performance. Uses the default
 * `throttlingMethod: 'simulate'` (Lantern), for which only rtt / throughput / cpuSlowdownMultiplier apply.
 */
const DESKTOP_THROTTLING = {
  rttMs: 40,
  throughputKbps: 10 * 1024,
  cpuSlowdownMultiplier: 1,
  requestLatencyMs: 0,
  downloadThroughputKbps: 0,
  uploadThroughputKbps: 0,
} as const;

/**
 * The Lighthouse settings for one run. Pure — unit-tested.
 *
 * ★ `disableFullPageScreenshot`. Lighthouse's full-page-screenshot gatherer resizes the emulated viewport
 * to the WHOLE page (up to 16,383px) and rasterises it — at 1350px wide on desktop, every lazy image
 * loading at once. MEASURED on a 13,000px page: desktop Chrome peaked at 557-652MB with it and 334-371MB
 * without (mobile 387-401 vs 304-317). On a 768MB container that is the difference between an audit and
 * an OOM kill: the shared instance's logs show 8 of 9 desktop and 14 of 19 both-devices audits dying
 * with the whole API, which the reverse proxy then answered as a 502. It only feeds the HTML report's
 * element thumbnails, which nothing here reads.
 */
export function lighthouseFlags(formFactor: FormFactor, port: number): Flags {
  return {
    port,
    logLevel: 'error',
    output: ['json'],
    onlyCategories: [...CATEGORIES],
    formFactor,
    disableFullPageScreenshot: true,
    screenEmulation:
      formFactor === 'desktop'
        ? { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false }
        : { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false },
    // Desktop overrides the mobile-Slow-4G default (see DESKTOP_THROTTLING). Mobile keeps the
    // Lighthouse default (mobile Slow 4G + 4× CPU), which is the correct, representative mobile profile.
    ...(formFactor === 'desktop' ? { throttling: DESKTOP_THROTTLING } : {}),
  };
}

/**
 * Run `run` with a deadline: at `ms` its signal aborts (which kills the run's Chrome) and the failure is
 * a retryable TIMEOUT — distinct from the CALLER leaving, which passes through untouched so the route can
 * stay silent. Lighthouse bounds its own page load, but not its gatherers or a stalled browser, and the
 * editor's request has no deadline of its own: without this an audit could hold a render slot forever.
 */
export async function runWithDeadline<T>(ms: number, signal: AbortSignal, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error('lighthouse run deadline')), ms);
  timer.unref?.();
  try {
    return await run(AbortSignal.any([signal, deadline.signal]));
  } catch (err) {
    if (deadline.signal.aborted && !signal.aborted) {
      throw new PagespeedRunError(
        'TIMEOUT',
        `Lighthouse did not finish auditing this page within ${Math.round(ms / 1000)}s, so the run was stopped. Retry once; if it times out again the page is likely too heavy to load (check its scripts and animated backgrounds).`,
        { cause: err },
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Old-generation heap the Lighthouse worker may use. MEASURED on a heavy 13,000px page: a desktop run
 * needs 96-128MB (it fails at 96, completes at 128); this is twice that, for script-heavy sites.
 */
export const LIGHTHOUSE_HEAP_MB = 256;

/**
 * The worker's whole program: import Lighthouse, run it, post back the result as JSON text — or the
 * error as plain fields, because a LighthouseError (its code, its ICU `friendlyMessage`) does not survive
 * a structured clone as itself. CommonJS, `eval`'d: no separate entry file to ship or to resolve from
 * TypeScript sources under test.
 */
const LIGHTHOUSE_WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  try {
    const { default: lighthouse } = await import(workerData.moduleUrl);
    const result = await lighthouse(workerData.url, workerData.flags);
    parentPort.postMessage({ ok: true, lhr: result ? JSON.stringify(result.lhr) : null });
  } catch (e) {
    const fm = e && e.friendlyMessage;
    parentPort.postMessage({
      ok: false,
      code: e && typeof e.code === 'string' ? e.code : undefined,
      friendlyMessage: typeof fm === 'string' ? fm : fm && typeof fm.formattedDefault === 'string' ? fm.formattedDefault : undefined,
      message: String((e && e.message) || e),
    });
  }
})();
`;

type WorkerReply =
  | { ok: true; lhr: string | null }
  | { ok: false; code?: string; friendlyMessage?: string; message: string };

let lighthouseModuleUrl: string | undefined;
function defaultLighthouseModuleUrl(): string {
  lighthouseModuleUrl ??= pathToFileURL(createRequire(import.meta.url).resolve('lighthouse')).href;
  return lighthouseModuleUrl;
}

/**
 * Run Lighthouse in a WORKER THREAD with a heap of its own, capped at {@link LIGHTHOUSE_HEAP_MB}.
 *
 * WHY. Lighthouse used to run in the API's own heap, and its trace processing is the heaviest thing the
 * API ever did there: MEASURED +100-240MB of V8 heap per run, held until the next GC. The shared 768MB
 * instance (heap ceiling ~491MB) died repeatedly with "JavaScript heap out of memory" mid-audit — the
 * whole API, every in-flight request, and a bare 502 from the proxy while it restarted. A memory ledger
 * that reads the cgroup cannot prevent that: the cgroup had room, the heap did not.
 *
 * In a worker the run's heap is its own isolate. MEASURED with the same page: the API's heap moved
 * 8→12MB during a run (it was +100-240MB), the process gave the memory back when the worker ended, and a
 * run pushed past its cap died ALONE with ERR_WORKER_OUT_OF_MEMORY — reported here as a typed
 * OUT_OF_MEMORY failure while the server carried on. Chrome stays launched and killed by the caller; the
 * worker only drives it over its DevTools port, so a terminated worker leaves no browser behind.
 *
 * `moduleUrl` (tests) substitutes the module the worker imports for `lighthouse`.
 */
export function runLighthouseIsolated(
  url: string,
  flags: Flags,
  opts: { signal?: AbortSignal; onAbort?: () => void; heapMb?: number; moduleUrl?: string } = {},
): Promise<RunnerResult | undefined> {
  const heapMb = opts.heapMb ?? LIGHTHOUSE_HEAP_MB;
  const worker = new Worker(LIGHTHOUSE_WORKER_SOURCE, {
    eval: true,
    workerData: { moduleUrl: opts.moduleUrl ?? defaultLighthouseModuleUrl(), url, flags },
    resourceLimits: { maxOldGenerationSizeMb: heapMb },
    // Lighthouse's own console output stays out of the server log: captured, and DRAINED below — an
    // unread stream would buffer every line of it in this process for the life of the run. stderr is
    // left to the server's stderr: what Lighthouse reports there is worth keeping.
    stdout: true,
  });
  worker.stdout.resume();
  const work = new Promise<RunnerResult | undefined>((resolve, reject) => {
    worker.once('message', (reply: WorkerReply) => {
      if (reply.ok) resolve(reply.lhr === null ? undefined : ({ lhr: JSON.parse(reply.lhr) } as RunnerResult));
      else reject(Object.assign(new Error(reply.message), { code: reply.code, friendlyMessage: reply.friendlyMessage }));
    });
    worker.once('error', (err: Error & { code?: string }) => {
      if (err.code === 'ERR_WORKER_OUT_OF_MEMORY') {
        reject(
          new PagespeedRunError(
            'OUT_OF_MEMORY',
            `Lighthouse needed more than its ${heapMb}MB memory allowance to audit this page, so the run was stopped — the server is unaffected. A page this heavy to trace usually runs very large or very many scripts or long animations; slim those down and audit again.`,
            { cause: err },
          ),
        );
      } else {
        reject(err);
      }
    });
    worker.once('exit', (code) => reject(new Error(`the Lighthouse worker exited (${code}) before answering`)));
  });
  return abortable(work, opts.signal, () => {
    opts.onAbort?.();
    void worker.terminate();
  }).finally(() => {
    void worker.terminate();
  });
}

/**
 * Run Lighthouse against an already-served URL. Concurrency is NOT bounded here — the caller (the route)
 * wraps the whole build → serve → audit sequence in a single `withRenderSlot`, so that the expensive site
 * build is bounded too and this never nests slot acquisitions (which would dead-lock the 2-slot cap).
 */
/* v8 ignore start -- launches Chrome + runs Lighthouse in a spawned browser; not exercised under Node
   coverage. The pure reduction (summarize) and the served-site helper are unit-tested directly, and the
   route is exercised end-to-end when a browser is present (graceful 503 when it is not). */
export async function runPagespeedAudit(
  url: string,
  opts: { formFactor?: FormFactor; signal?: AbortSignal } = {},
): Promise<PagespeedAuditResult> {
  const formFactor = opts.formFactor ?? 'mobile';
  const { signal } = opts;
  let chrome: LaunchedChrome | undefined;
  // Idempotent: the abort path and the `finally` below may both get here.
  let killed = false;
  const killChrome = (): void => {
    if (killed || !chrome) return;
    killed = true;
    try {
      chrome.kill();
    } catch {
      /* best-effort teardown */
    }
  };
  try {
    signal?.throwIfAborted();
    try {
      chrome = await launch({ chromePath: resolveChromePath(), chromeFlags: CHROME_FLAGS });
    } catch (err) {
      // No installed/launchable Chromium — surface as a typed "unavailable" so the route returns 503,
      // never an opaque 500 (mirrors the screenshot path's best-effort browser handling).
      throw new PagespeedUnavailableError(
        `could not launch a headless browser: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // The caller left while Chrome was starting: don't start an audit for nobody.
    signal?.throwIfAborted();
    const flags = lighthouseFlags(formFactor, chrome.port);
    // Kill Chrome the moment the caller leaves: Lighthouse otherwise runs its full ~30-90 s pass (and
    // the route holds its render slot) for a response nobody will read.
    // The served origin: removed from any Lighthouse sentence passed on, so its URLs read as site paths.
    const origin = new URL(url).origin;
    let result: RunnerResult | undefined;
    try {
      result = await runLighthouseIsolated(url, flags, { signal, onAbort: killChrome });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw toPagespeedRunError(err, origin);
    }
    // A fatal page-load error (NO_FCP, PAGE_HUNG, …) comes back as a RESULT with every score null, not
    // a throw — report it as the failure it is rather than as a page that scored nothing.
    const failed = lighthouseRuntimeError(result, origin);
    if (failed) throw failed;
    return summarize(url, formFactor, result as RunnerResult);
  } finally {
    killChrome();
  }
}
/* v8 ignore stop */
