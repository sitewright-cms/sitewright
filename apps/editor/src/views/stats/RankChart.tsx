import { useEffect } from 'react';
import type { RankPoint } from '@sitewright/schema';
import { useChartTip } from './ChartTip';
import { longDay } from './format';

/**
 * A keyword's POSITION over time. Up is better: position 1 is the top of the chart, the depth read is the bottom.
 * A check where the site was not in the results read is a hollow mark on the bottom line, and the line breaks
 * there rather than pretending the site was at the last position. A miss in a check that got back FEWER results
 * than it asked for — Google's answers ended there, or the check stopped short of them — is a dashed hollow mark just
 * below those results: the site is somewhere under them, not necessarily out of the top 100 (Google answers some
 * searches from a shorter list than others). The site's featured snippet is ringed. Hovering a check shows its day
 * and position.
 */

const W = 640;
const H = 180;
const PAD = { left: 36, right: 12, top: 10, bottom: 22 };

const dayIndex = (from: string, day: string): number => Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Round ticks for a position axis that runs from 1 to `bottom`. */
function ticks(bottom: number): number[] {
  const step = bottom <= 10 ? 3 : bottom <= 30 ? 5 : bottom <= 60 ? 10 : 25;
  const out = [1];
  for (let t = step; t < bottom; t += step) out.push(t);
  out.push(bottom);
  return [...new Set(out)];
}

/**
 * The lowest position the axis shows. Zoomed to the keyword's own range (rounded up, at least the first page)
 * so a move from 18 to 3 reads as one — unless a check was outside the results, which needs the full depth.
 */
export function axisBottom(series: readonly RankPoint[], depth: number): number {
  const worst = Math.max(0, ...series.map((p) => p.position ?? belowShort(p) ?? 0));
  const nice = worst <= 10 ? 10 : worst <= 20 ? 20 : worst <= 30 ? 30 : worst <= 50 ? 50 : 100;
  // A check outside the results needs the depth read — or more, when an older check read deeper and ranked lower.
  return series.some((p) => p.position === null && belowShort(p) === undefined) ? Math.max(depth, nice) : nice;
}

/** Where a miss in a short list is drawn: the place just below the results that came back. Undefined for any other check. */
const belowShort = (p: RankPoint): number | undefined => (p.position === null && p.resultsRead !== undefined ? p.resultsRead + 1 : undefined);

/**
 * "Position 4", "Position 1 (featured snippet)", "Not in the top 100" (without a depth: "Not in the results read").
 * A miss in fewer results than the depth: "Not in the 29 results Google returned" when Google's answers ended there,
 * "Not in the first 29 results (the check stopped there)" when the check stopped short of them, and "Not in the 29
 * results read" for a check made before the reason was recorded.
 */
export function positionText(position: number | null, depth?: number, detail: Pick<RankPoint, 'featured' | 'resultsRead' | 'listEnded'> = {}): string {
  if (position !== null) return detail.featured ? `Position ${position} (featured snippet)` : `Position ${position}`;
  const read = detail.resultsRead;
  if (read !== undefined && detail.listEnded === true) return `Not in the ${read} results Google returned`;
  if (read !== undefined && detail.listEnded === false) return `Not in the first ${read} results (the check stopped there)`;
  if (read !== undefined) return `Not in the ${read} results read`;
  return depth ? `Not in the top ${depth}` : 'Not in the results read';
}

const checks = (n: number): string => `${n} check${n === 1 ? '' : 's'}`;

export function RankChart({
  keyword,
  series,
  from,
  to,
  depth,
}: {
  keyword: string;
  series: readonly RankPoint[];
  from: string;
  to: string;
  depth: number;
}) {
  const tip = useChartTip();
  const { hide } = tip;
  useEffect(() => hide(), [series, hide]);

  const span = Math.max(1, dayIndex(from, to));
  const floor = axisBottom(series, depth);
  const x = (day: string): number => PAD.left + (Math.min(span, Math.max(0, dayIndex(from, day))) / span) * (W - PAD.left - PAD.right);
  const y = (pos: number): number => PAD.top + ((Math.min(pos, floor) - 1) / Math.max(1, floor - 1)) * (H - PAD.top - PAD.bottom);
  const bottom = H - PAD.bottom;

  // Ranked runs become separate line segments: a check outside the results breaks the line.
  const segments: string[] = [];
  let run: string[] = [];
  for (const p of series) {
    if (p.position === null) {
      if (run.length > 1) segments.push(run.join(' '));
      run = [];
    } else {
      run.push(`${x(p.day).toFixed(1)},${y(p.position).toFixed(1)}`);
    }
  }
  if (run.length > 1) segments.push(run.join(' '));

  const ranked = series.filter((p) => p.position !== null).map((p) => p.position as number);
  const summary = ranked.length
    ? `${keyword}: ${checks(series.length)}, best position ${Math.min(...ranked)}, latest ${positionText(series.at(-1)?.position ?? null, undefined, series.at(-1)).toLowerCase()}`
    : `${keyword}: ${checks(series.length)}, not in the results read in this period`;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={summary} onMouseLeave={hide}>
        {ticks(floor).map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-slate-200 dark:stroke-white/10" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" className="fill-slate-500 text-[9px] dark:fill-slate-400">
              {t}
            </text>
          </g>
        ))}
        <text x={PAD.left} y={H - 6} className="fill-slate-500 text-[9px] dark:fill-slate-400">
          {longDay(from)}
        </text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" className="fill-slate-500 text-[9px] dark:fill-slate-400">
          {longDay(to)}
        </text>
        {segments.map((points, i) => (
          <polyline key={i} points={points} fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-[var(--sw-brand-1)]" />
        ))}
        {series.map((p) => {
          const cx = x(p.day);
          const below = belowShort(p);
          const short = below !== undefined;
          const cy = p.position !== null ? y(p.position) : below !== undefined ? y(below) : bottom;
          // A past check may have read a different depth than today's setup, so a plain miss is not given a number.
          const lines = [longDay(p.day), positionText(p.position, undefined, p)];
          return (
            <circle
              key={p.day}
              data-day={p.day}
              {...(short ? { 'data-short': '' } : {})}
              {...(p.featured ? { 'data-featured': '' } : {})}
              cx={cx}
              cy={cy}
              r={p.position === null ? 3.5 : p.featured ? 5 : 4}
              strokeWidth={p.position === null || p.featured ? 1.5 : 0}
              strokeDasharray={short ? '2 2' : undefined}
              className={
                p.position === null
                  ? 'fill-white stroke-slate-400 dark:fill-slate-900'
                  : p.featured
                    ? 'fill-[var(--sw-brand-1)] stroke-slate-900 dark:stroke-white'
                    : 'fill-[var(--sw-brand-1)]'
              }
              onMouseEnter={(e) => tip.showAt(e.currentTarget, lines)}
            />
          );
        })}
      </svg>
      {tip.bubble}
    </div>
  );
}

/**
 * A small trend line for the table: up is better, nothing but the shape — scaled to the keyword's own range, with
 * a check outside the results at the bottom (a miss in a short list just below what came back, as on the chart). A
 * keyword that never ranked has no shape to show.
 */
export function RankSparkline({ series, depth }: { series: readonly RankPoint[]; depth: number }) {
  const w = 96;
  const h = 24;
  const ranked = series.filter((p) => p.position !== null).map((p) => p.position as number);
  if (series.length < 2 || ranked.length === 0) return <span className="text-xs text-slate-400 dark:text-slate-500" aria-hidden>—</span>;
  // Where each check sits: its position; a miss in a short list just below the results that came back (as on the
  // chart); a real miss at the depth read.
  const level = (p: RankPoint): number | null => p.position ?? belowShort(p) ?? null;
  const top = Math.min(...ranked);
  const levels = series.map(level);
  const bottom = levels.includes(null) ? depth : Math.max(...levels.filter((l): l is number => l !== null));
  const range = Math.max(1, bottom - top);
  const span = Math.max(1, series.length - 1);
  const pts = levels.map((l, i) => `${((i / span) * (w - 4) + 2).toFixed(1)},${(2 + ((Math.min(l ?? bottom, bottom) - top) / range) * (h - 4)).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden className="overflow-visible">
      <polyline points={pts.join(' ')} fill="none" strokeWidth={1.5} strokeLinejoin="round" className="stroke-[var(--sw-brand-1)]" />
    </svg>
  );
}
