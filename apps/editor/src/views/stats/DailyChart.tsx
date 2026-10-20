import type { SiteStats } from '@sitewright/schema';
import { useChartTip } from './ChartTip';
import { counted, fmt, longDay, shortDay } from './format';

/**
 * Pageviews per day: human views as solid bars, bot views stacked above them in a lighter tone. Plain SVG —
 * one rect per day — so a year of days is 365 small rects and no charting library. Hovering a day shows the
 * editor's tooltip with that day's figures, one per line; the chart itself has a one-line summary for a
 * screen reader.
 */
export function DailyChart({ daily }: { daily: SiteStats['daily'] }) {
  const tip = useChartTip();
  const W = 720;
  const H = 160;
  const max = Math.max(1, ...daily.map((d) => d.views + d.botViews));
  const slot = W / Math.max(1, daily.length);
  const gap = slot > 6 ? Math.min(4, slot * 0.2) : 0;
  const bar = Math.max(0.5, slot - gap);
  const y = (v: number): number => (v / max) * (H - 4);
  const totalViews = daily.reduce((n, d) => n + d.views, 0);
  const totalBots = daily.reduce((n, d) => n + d.botViews, 0);
  const label =
    daily.length === 1
      ? `${fmt(totalViews)} human and ${fmt(totalBots)} bot pageviews today`
      : `Pageviews per day from ${shortDay(daily[0]!.day)} to ${shortDay(daily[daily.length - 1]!.day)}: ${fmt(totalViews)} human, ${fmt(totalBots)} bot`;
  // Up to six evenly spaced day labels along the bottom.
  const ticks = daily.length <= 1 ? daily.map((_, i) => i) : [...new Set(Array.from({ length: Math.min(6, daily.length) }, (_, i) => Math.round((i * (daily.length - 1)) / Math.max(1, Math.min(6, daily.length) - 1))))];
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-40 w-full" role="img" aria-label={label}>
        {daily.map((d, i) => {
          const human = y(d.views);
          const bots = y(d.botViews);
          const x = i * slot + gap / 2;
          return (
            <g
              key={d.day}
              data-day={d.day}
              // Anchored to the day's TOP bar (the last child: bots stack on the human bar), so the bubble
              // points at the data instead of floating at the chart's top edge.
              onMouseEnter={(e) =>
                tip.showAt(e.currentTarget.lastElementChild ?? e.currentTarget, [
                  longDay(d.day),
                  counted(d.views, 'pageview'),
                  counted(d.visitors, 'visitor'),
                  counted(d.botViews, 'bot pageview'),
                ])
              }
              onMouseLeave={tip.hide}
            >
              {/* A transparent full-height hit area, so a hover finds the day even when it had no traffic. */}
              <rect x={x} y={0} width={bar} height={H} fill="transparent" />
              <rect x={x} y={H - human} width={bar} height={human} rx={bar > 4 ? 2 : 0} className="fill-indigo-500 dark:fill-indigo-400" />
              {d.botViews > 0 && <rect x={x} y={H - human - bots} width={bar} height={bots} className="fill-slate-300 dark:fill-slate-600" />}
            </g>
          );
        })}
      </svg>
      {tip.bubble}
      <figcaption className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="relative h-4 flex-1">
          {ticks.map((i, n) => (
            <span
              key={i}
              // The end labels hug the edges instead of centring on their bar, so they never hang off the card;
              // on a phone only the two ends are shown, or six dates collide in 300 pixels.
              className={`absolute whitespace-nowrap tabular-nums ${ticks.length > 1 && n === 0 ? '' : ticks.length > 1 && n === ticks.length - 1 ? '-translate-x-full' : '-translate-x-1/2 max-sm:hidden'}`}
              style={{ left: ticks.length > 1 && n === 0 ? '0%' : ticks.length > 1 && n === ticks.length - 1 ? '100%' : `${((i + 0.5) / Math.max(1, daily.length)) * 100}%` }}
            >
              {/* eslint-disable-next-line security/detect-object-injection -- i is a computed in-range index */}
              {shortDay(daily[i]!.day)}
            </span>
          ))}
        </span>
      </figcaption>
      <p className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-indigo-500 dark:bg-indigo-400" /> Human pageviews
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-slate-300 dark:bg-slate-600" /> Bot pageviews
        </span>
      </p>
    </figure>
  );
}
