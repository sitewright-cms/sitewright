import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, type LaunchedChrome } from 'chrome-launcher';
import lighthouse, { type Flags, type RunnerResult } from 'lighthouse';
import { chromium } from 'playwright-core';

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
}

export interface PagespeedAuditResult {
  url: string;
  formFactor: FormFactor;
  scores: PagespeedScores;
  metrics: PagespeedMetrics;
  /** Non-passing, non-informational audits, worst-first — the fix list. */
  findings: PagespeedFinding[];
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

/** Thrown when no headless browser could be launched — lets the route degrade to a clean 503. */
export class PagespeedUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PagespeedUnavailableError';
  }
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
 * Run Lighthouse against an already-served URL. Concurrency is NOT bounded here — the caller (the route)
 * wraps the whole build → serve → audit sequence in a single `withRenderSlot`, so that the expensive site
 * build is bounded too and this never nests slot acquisitions (which would dead-lock the 2-slot cap).
 */
/* v8 ignore start -- launches Chrome + runs Lighthouse in a spawned browser; not exercised under Node
   coverage. The pure reduction (summarize) and the served-site helper are unit-tested directly, and the
   route is exercised end-to-end when a browser is present (graceful 503 when it is not). */
export async function runPagespeedAudit(
  url: string,
  opts: { formFactor?: FormFactor } = {},
): Promise<PagespeedAuditResult> {
  const formFactor = opts.formFactor ?? 'mobile';
  let chrome: LaunchedChrome | undefined;
  try {
    try {
      chrome = await launch({ chromePath: resolveChromePath(), chromeFlags: CHROME_FLAGS });
    } catch (err) {
      // No installed/launchable Chromium — surface as a typed "unavailable" so the route returns 503,
      // never an opaque 500 (mirrors the screenshot path's best-effort browser handling).
      throw new PagespeedUnavailableError(
        `could not launch a headless browser: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const flags: Flags = {
      port: chrome.port,
      logLevel: 'error',
      output: ['json'],
      onlyCategories: [...CATEGORIES],
      formFactor,
      screenEmulation:
        formFactor === 'desktop'
          ? { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false }
          : { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false },
      // Desktop overrides the mobile-Slow-4G default (see DESKTOP_THROTTLING). Mobile keeps the
      // Lighthouse default (mobile Slow 4G + 4× CPU), which is the correct, representative mobile profile.
      ...(formFactor === 'desktop' ? { throttling: DESKTOP_THROTTLING } : {}),
    };
    const result = await lighthouse(url, flags);
    if (!result) throw new Error('lighthouse returned no result');
    return summarize(url, formFactor, result);
  } finally {
    // chrome-launcher's kill() may be sync (void) or return a promise depending on version;
    // treat teardown as best-effort either way.
    try {
      await chrome?.kill();
    } catch {
      /* ignore teardown failures */
    }
  }
}
/* v8 ignore stop */
