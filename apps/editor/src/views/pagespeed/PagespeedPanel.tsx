import { useEffect, useRef, useState } from 'react';
import { Gauge, Smartphone, Monitor, Loader2, AlertCircle } from 'lucide-react';
import { isLinkPage, type Page } from '@sitewright/schema';
import { SidePanel } from '../ui/SidePanel';
import { api, type PagespeedAuditResult, type PagespeedFinding } from '../../api';
import { primaryButton } from '../../theme';

/** Speedometer glyph for the Speed & SEO bottom-rail tab. */
function SpeedIcon() {
  return <Gauge aria-hidden className="h-4 w-4" />;
}

type FormFactor = 'mobile' | 'desktop';

/** 0–100 → Lighthouse's traffic-light colour (≥90 good, 50–89 needs work, <50 poor). */
function scoreColor(n: number | null): string {
  if (n === null) return 'text-slate-400';
  if (n >= 90) return 'text-emerald-500';
  if (n >= 50) return 'text-amber-500';
  return 'text-rose-500';
}

const CATEGORY_LABEL: Record<PagespeedFinding['category'], string> = {
  performance: 'Perf',
  accessibility: 'A11y',
  bestPractices: 'Best',
  seo: 'SEO',
};

function ScoreDial({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className={`text-2xl font-semibold tabular-nums ${scoreColor(value)}`}>{value ?? '—'}</div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

function secs(ms: number | undefined): string {
  return ms === undefined ? '—' : `${(ms / 1000).toFixed(1)} s`;
}

function AuditReport({ result }: { result: PagespeedAuditResult }) {
  const { scores, metrics, findings } = result;
  return (
    <div className="flex flex-col gap-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">
        {result.formFactor === 'desktop' ? 'Desktop' : 'Mobile'} · {result.url}
      </div>
      <div className="grid grid-cols-4 gap-2 rounded-lg bg-slate-900/5 py-3 dark:bg-white/5">
        <ScoreDial label="Perf" value={scores.performance} />
        <ScoreDial label="A11y" value={scores.accessibility} />
        <ScoreDial label="Best" value={scores.bestPractices} />
        <ScoreDial label="SEO" value={scores.seo} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <span>FCP {secs(metrics.firstContentfulPaintMs)}</span>
        <span>LCP {secs(metrics.largestContentfulPaintMs)}</span>
        <span>TBT {metrics.totalBlockingTimeMs === undefined ? '—' : `${Math.round(metrics.totalBlockingTimeMs)} ms`}</span>
        <span>CLS {(metrics.cumulativeLayoutShift ?? 0).toFixed(3)}</span>
        <span>SI {secs(metrics.speedIndexMs)}</span>
      </div>
      {findings.length === 0 ? (
        <p className="text-sm text-emerald-600">No failing audits — every scored check passed.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-200/60 dark:divide-white/10">
          {findings.map((f) => (
            <li key={f.id} className="flex items-start gap-2 py-1.5 text-sm">
              <span className="mt-0.5 shrink-0 rounded bg-slate-900/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-500 dark:bg-white/10">
                {CATEGORY_LABEL[f.category]}
              </span>
              <span className="text-slate-700 dark:text-slate-200">
                {f.title}
                {f.displayValue ? <span className="text-slate-400"> — {f.displayValue}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] leading-snug text-slate-400">
        Lab audit (Lighthouse {result.lighthouseVersion}) on a deploy-equivalent build. Performance is a throttled lab
        score — directional; SEO, accessibility and best-practices are deterministic. No real-user field data.
      </p>
    </div>
  );
}

function PagespeedBody({ projectId }: { projectId: string }) {
  const [pages, setPages] = useState<Page[] | null>(null);
  const [pageId, setPageId] = useState<string>('');
  const [formFactor, setFormFactor] = useState<FormFactor>('mobile');
  const [result, setResult] = useState<PagespeedAuditResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .listPages(projectId)
      .then((r) => {
        if (!alive) return;
        // Only pages with a real rendered route are auditable (link placeholders + collection pages aren't).
        const auditable = r.items.filter((p) => !isLinkPage(p) && !p.collection);
        setPages(auditable);
        setPageId((cur) => cur || auditable[0]?.id || '');
      })
      .catch(() => alive && setError('Could not load pages.'));
    return () => {
      alive = false;
    };
  }, [projectId]);

  // Track mount so an in-flight audit resolving after a project switch (PagespeedBody remounts on
  // `key={projectId}`) doesn't setState on an unmounted component.
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  // A prior result is stale the moment the page or device changes — clear it so nobody reads old numbers.
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [pageId, formFactor]);

  async function runAudit() {
    if (!pageId || running) return;
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

  const toggle = (ff: FormFactor, Icon: typeof Smartphone, text: string) => (
    <button
      type="button"
      onClick={() => setFormFactor(ff)}
      className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
        formFactor === ff ? 'bg-slate-900/10 text-slate-800 dark:bg-white/15 dark:text-white' : 'text-slate-500'
      }`}
      aria-pressed={formFactor === ff}
    >
      <Icon className="h-3.5 w-3.5" /> {text}
    </button>
  );

  const canRun = !!pageId && !running;

  return (
    <div className="flex w-[min(28rem,90vw)] flex-col gap-3 p-1">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="min-w-0 flex-1 rounded border border-slate-300/70 bg-transparent px-2 py-1 text-sm dark:border-white/15"
          value={pageId}
          onChange={(e) => setPageId(e.target.value)}
          disabled={!pages || running}
          aria-label="Page to audit"
        >
          {(pages ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.title || p.path || p.id}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-0.5 rounded bg-slate-900/5 p-0.5 dark:bg-white/5">
          {toggle('mobile', Smartphone, 'Mobile')}
          {toggle('desktop', Monitor, 'Desktop')}
        </div>
        <button type="button" className={primaryButton} onClick={() => void runAudit()} disabled={!canRun}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {running ? 'Auditing…' : 'Run audit'}
        </button>
      </div>

      {error ? (
        <p className="flex items-center gap-1.5 text-sm text-rose-500">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </p>
      ) : null}

      {running && !result ? (
        <p className="py-6 text-center text-sm text-slate-400">Running Lighthouse — this takes a few seconds…</p>
      ) : result ? (
        <AuditReport result={result} />
      ) : !error ? (
        <p className="py-6 text-center text-sm text-slate-400">
          Pick a page and run a Lighthouse speed + SEO audit against a deploy-equivalent build.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The SPEED &amp; SEO rail — an on-demand Lighthouse audit of any page. Renders four category scores
 * (performance / accessibility / best-practices / SEO), core lab metrics, and a ranked list of the
 * specific failing audits, so an author can spot and fix speed/SEO/accessibility issues before publishing.
 * The audit runs server-side against a deploy-equivalent build (see the pagespeed-audit route).
 */
export function PagespeedPanel({ projectId }: { projectId: string }) {
  return (
    <SidePanel side="right" align="end" label="Speed & SEO" icon={<SpeedIcon />}>
      <PagespeedBody key={projectId} projectId={projectId} />
    </SidePanel>
  );
}
