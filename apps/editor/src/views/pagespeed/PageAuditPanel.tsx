import { useEffect, useRef, useState } from 'react';
import { Smartphone, Monitor, Loader2, AlertCircle, CircleHelp, ImageOff } from 'lucide-react';
import { api, type PagespeedAuditResult, type PagespeedFinding } from '../../api';
import { primaryButton, gradientSurface } from '../../theme';

type FormFactor = 'mobile' | 'desktop';

/** SEO-relevant fields shown above the audit — read straight from the page editor's settings state. */
export interface PageSeo {
  title: string;
  path: string;
  description: string;
  image: string;
}

// ---- formatting + rating ------------------------------------------------------------------------

const secs = (ms: number | undefined): string => (ms === undefined ? '—' : `${(ms / 1000).toFixed(1)} s`);
const msFmt = (ms: number | undefined): string => (ms === undefined ? '—' : `${Math.round(ms)} ms`);
const clsFmt = (v: number | undefined): string => (v === undefined ? '—' : v.toFixed(3));

/** Lighthouse traffic-light for a 0–100 score (≥90 good, 50–89 needs work, <50 poor). */
function scoreHex(n: number | null): string {
  if (n === null) return '#94a3b8';
  if (n >= 90) return '#22c55e';
  if (n >= 50) return '#f59e0b';
  return '#ef4444';
}

type Rating = 'good' | 'ok' | 'poor' | 'none';
/** All lab metrics are lower-is-better: ≤good = green, ≤poor = amber, else red. */
function rate(value: number | undefined, good: number, poor: number): Rating {
  if (value === undefined) return 'none';
  if (value <= good) return 'good';
  if (value <= poor) return 'ok';
  return 'poor';
}
/** Text + dot colour for a rating (a switch, not a computed lookup, so the security linter stays quiet). */
function ratingClasses(r: Rating): { text: string; dot: string } {
  switch (r) {
    case 'good':
      return { text: 'text-emerald-600', dot: 'bg-emerald-500' };
    case 'ok':
      return { text: 'text-amber-600', dot: 'bg-amber-500' };
    case 'poor':
      return { text: 'text-rose-600', dot: 'bg-rose-500' };
    default:
      return { text: 'text-slate-400 dark:text-slate-500', dot: 'bg-slate-300' };
  }
}

interface MetricDef {
  key: keyof PagespeedAuditResult['metrics'];
  abbr: string;
  name: string;
  good: number;
  poor: number;
  fmt: (v: number | undefined) => string;
  tip: string;
}
const METRICS: readonly MetricDef[] = [
  { key: 'firstContentfulPaintMs', abbr: 'FCP', name: 'First Contentful Paint', good: 1800, poor: 3000, fmt: secs, tip: 'First Contentful Paint — time until the first text or image is painted. Good ≤ 1.8 s, poor > 3 s.' },
  { key: 'largestContentfulPaintMs', abbr: 'LCP', name: 'Largest Contentful Paint', good: 2500, poor: 4000, fmt: secs, tip: 'Largest Contentful Paint — time until the largest content element is visible (a Core Web Vital). Good ≤ 2.5 s, poor > 4 s.' },
  { key: 'totalBlockingTimeMs', abbr: 'TBT', name: 'Total Blocking Time', good: 200, poor: 600, fmt: msFmt, tip: 'Total Blocking Time — total time the main thread was blocked, delaying response to input. Good ≤ 200 ms, poor > 600 ms.' },
  { key: 'cumulativeLayoutShift', abbr: 'CLS', name: 'Cumulative Layout Shift', good: 0.1, poor: 0.25, fmt: clsFmt, tip: 'Cumulative Layout Shift — how much visible content unexpectedly shifts during load (a Core Web Vital). Good ≤ 0.10, poor > 0.25.' },
  { key: 'speedIndexMs', abbr: 'SI', name: 'Speed Index', good: 3400, poor: 5800, fmt: secs, tip: 'Speed Index — how quickly content is visually displayed during load. Good ≤ 3.4 s, poor > 5.8 s.' },
];

/** Category → a short, color-coded tag (PageSpeed-style). */
const CATEGORY: Record<PagespeedFinding['category'], { label: string; cls: string }> = {
  performance: { label: 'Perf', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  accessibility: { label: 'A11y', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  bestPractices: { label: 'Best', cls: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
  seo: { label: 'SEO', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
};

/** Strip Lighthouse's trailing "[Learn more](url)" markdown link → readable tooltip text. */
function adviceText(description: string | undefined): string {
  if (!description) return '';
  return description.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();
}

// ---- pieces -------------------------------------------------------------------------------------

/** A circular ring gauge with the 0–100 score in the middle (PageSpeed-style). */
function ScoreGauge({ label, value }: { label: string; value: number | null }) {
  const color = scoreHex(value);
  const R = 30;
  const CIRC = 2 * Math.PI * R;
  const offset = CIRC * (1 - (value ?? 0) / 100);
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative h-[72px] w-[72px]">
        <svg viewBox="0 0 72 72" className="h-[72px] w-[72px] -rotate-90">
          <circle cx="36" cy="36" r={R} fill="none" strokeWidth="6" className="stroke-slate-200 dark:stroke-white/10" />
          <circle
            cx="36"
            cy="36"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.7s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-xl font-bold tabular-nums" style={{ color }}>
          {value ?? '—'}
        </div>
      </div>
      <div className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</div>
    </div>
  );
}

function MetricCard({ def, value }: { def: MetricDef; value: number | undefined }) {
  const rc = ratingClasses(rate(value, def.good, def.poor));
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-slate-200/70 bg-white/60 p-3 dark:border-white/10 dark:bg-white/5">
      <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${rc.dot}`} aria-hidden />
        {def.abbr}
        <span className="tooltip tooltip-top before:z-20 before:max-w-[16rem] before:whitespace-normal before:text-left" data-tip={def.tip}>
          <CircleHelp className="h-3.5 w-3.5 cursor-help text-slate-400 dark:text-slate-500" aria-label={`${def.name}: ${def.tip}`} />
        </span>
      </div>
      <div className={`text-lg font-semibold tabular-nums ${rc.text}`}>{def.fmt(value)}</div>
    </div>
  );
}

function FindingRow({ f }: { f: PagespeedFinding }) {
  const cat = CATEGORY[f.category];
  const advice = adviceText(f.description);
  return (
    <li className="flex items-start gap-2.5 py-2">
      <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${cat.cls}`}>{cat.label}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-slate-700 dark:text-slate-200">{f.title}</div>
        {f.displayValue ? <div className="text-xs font-medium text-slate-400 dark:text-slate-500">{f.displayValue}</div> : null}
      </div>
      {advice ? (
        <span
          className="tooltip tooltip-left before:z-20 before:max-w-[20rem] before:whitespace-normal before:text-left"
          data-tip={advice}
        >
          <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 cursor-help text-slate-400 dark:text-slate-500" aria-label={advice} />
        </span>
      ) : null}
    </li>
  );
}

/** A generous, high-fidelity skeleton that mirrors the report layout while Lighthouse runs. */
function AuditSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="grid grid-cols-4 gap-2 rounded-xl bg-slate-900/5 p-4 dark:bg-white/5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div className="skeleton h-[72px] w-[72px] rounded-full" />
            <div className="skeleton h-3 w-10 rounded" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton h-16 rounded-xl" />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton h-8 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

function AuditReport({ result }: { result: PagespeedAuditResult }) {
  const { scores, metrics, findings } = result;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-4 gap-2 rounded-xl bg-slate-900/5 py-4 dark:bg-white/5">
        <ScoreGauge label="Performance" value={scores.performance} />
        <ScoreGauge label="Accessibility" value={scores.accessibility} />
        <ScoreGauge label="Best practices" value={scores.bestPractices} />
        <ScoreGauge label="SEO" value={scores.seo} />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {METRICS.map((def) => {
          const value = metrics[def.key];
          return <MetricCard key={def.key} def={def} value={value} />;
        })}
      </div>

      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {findings.length === 0 ? 'Opportunities & diagnostics' : `${findings.length} opportunit${findings.length === 1 ? 'y' : 'ies'} & diagnostics`}
        </h4>
        {findings.length === 0 ? (
          <p className="text-sm text-emerald-600">No failing audits — every scored check passed. 🎉</p>
        ) : (
          <ul className="divide-y divide-slate-200/60 dark:divide-white/10">
            {findings.map((f) => (
              <FindingRow key={f.id} f={f} />
            ))}
          </ul>
        )}
      </div>

      <p className="text-[11px] leading-snug text-slate-400 dark:text-slate-500">
        Lab audit (Lighthouse {result.lighthouseVersion}) on a deploy-equivalent build. Performance is a throttled
        lab score — directional; SEO, accessibility and best-practices are deterministic. No real-user field data.
      </p>
    </div>
  );
}

// ---- panel --------------------------------------------------------------------------------------

/**
 * PAGE AUDIT — the page editor's Lighthouse tab. Shows the page's SEO-relevant head fields, a
 * Desktop/Mobile run control, a generous skeleton while auditing, then a PageSpeed-style report:
 * ring gauges per category, core Web-Vitals metrics (each with an explanatory tooltip), and a ranked
 * list of failing audits (color-coded category tags + actionable-advice tooltips). The audit runs
 * server-side against a deploy-equivalent build (see the pagespeed-audit route).
 */
export function PageAuditPanel({
  projectId,
  pageId,
  seo,
  auditable = true,
  dirty = false,
}: {
  projectId: string;
  pageId: string;
  seo: PageSeo;
  /** False for page types the server refuses to audit (collection / dataset-template pages). */
  auditable?: boolean;
  /** The page has unsaved edits — the audit scores the last SAVED version, so warn about the mismatch. */
  dirty?: boolean;
}) {
  const [formFactor, setFormFactor] = useState<FormFactor>('mobile');
  const [result, setResult] = useState<PagespeedAuditResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgOk, setImgOk] = useState(true);

  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  // A prior result is stale the moment the device changes — clear it so nobody reads old numbers.
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [formFactor]);
  useEffect(() => setImgOk(true), [seo.image]);

  async function runAudit() {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const r = await api.pagespeedAudit(projectId, pageId, formFactor);
      if (mounted.current) setResult(r);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : 'Audit failed.');
      setResult(null);
    } finally {
      if (mounted.current) setRunning(false);
    }
  }

  const deviceToggle = (ff: FormFactor, Icon: typeof Smartphone, text: string) => (
    <button
      type="button"
      aria-pressed={formFactor === ff}
      onClick={() => setFormFactor(ff)}
      disabled={running}
      className={`waves-effect inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-60 ${
        formFactor === ff ? `${gradientSurface} font-bold` : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100'
      }`}
    >
      <Icon className="h-4 w-4" /> {text}
    </button>
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-2 sm:p-4">
        {/* SEO summary — the head fields this page will publish with. */}
        <section className="flex gap-4 rounded-2xl border border-white/60 bg-white/70 p-4 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
          <div className="min-w-0 flex-1">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">SEO preview</h3>
            <p className="mt-1 truncate text-base font-semibold text-slate-800 dark:text-slate-100">{seo.title || <span className="text-slate-400">Untitled page</span>}</p>
            <p className="truncate text-xs text-emerald-700 dark:text-emerald-400">{seo.path || '/'}</p>
            <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">
              {seo.description || <span className="italic text-slate-400 dark:text-slate-500">No meta description — add one in Page settings for better search snippets.</span>}
            </p>
          </div>
          <div className="flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200/70 bg-slate-50 text-slate-300 dark:border-white/10 dark:bg-white/5 dark:text-slate-600">
            {seo.image && imgOk ? (
              <img src={seo.image} alt="Social share thumbnail" className="h-full w-full object-cover" onError={() => setImgOk(false)} />
            ) : (
              <div className="flex flex-col items-center gap-1 text-[10px]">
                <ImageOff className="h-5 w-5" />
                {seo.image ? 'image missing' : 'no OG image'}
              </div>
            )}
          </div>
        </section>

        {!auditable ? (
          <p className="rounded-xl border border-dashed border-slate-300/70 p-6 text-center text-sm text-slate-400 dark:border-white/15">
            This page can’t be audited — collection / dataset-template pages have no standalone rendered route to score.
          </p>
        ) : (
          <>
            {dirty ? (
              <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  You have unsaved changes. The audit runs against the last <strong>saved</strong> version — save
                  first to score your latest edits.
                </span>
              </p>
            ) : null}

            {/* Controls: device toggle (styled like the Code/Content switch) + run button. */}
            <div className="flex flex-wrap items-center gap-3">
              <div
                role="group"
                aria-label="Audit device"
                className="flex items-center rounded-xl border border-white/60 bg-white/50 p-0.5 shadow-sm backdrop-blur-xl"
              >
                {deviceToggle('mobile', Smartphone, 'Mobile')}
                {deviceToggle('desktop', Monitor, 'Desktop')}
              </div>
              <button type="button" className={primaryButton} onClick={() => void runAudit()} disabled={running}>
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {running ? 'Running Lighthouse…' : 'Run Lighthouse audit'}
              </button>
            </div>

            {error ? (
              <p className="flex items-center gap-1.5 text-sm text-rose-500">
                <AlertCircle className="h-4 w-4 shrink-0" /> {error}
              </p>
            ) : null}

            {running ? (
              <AuditSkeleton />
            ) : result ? (
              <AuditReport result={result} />
            ) : !error ? (
              <p className="rounded-xl border border-dashed border-slate-300/70 p-6 text-center text-sm text-slate-400 dark:border-white/15">
                Run a Lighthouse speed + SEO audit of this page against a deploy-equivalent build.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
