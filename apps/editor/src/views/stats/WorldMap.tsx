import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SiteStats } from '@sitewright/schema';
import { Panel } from './Breakdowns';
import { useChartTip } from './ChartTip';
import { counted, countryName, fmt } from './format';

type Paths = typeof import('./world-paths');

/** Shades from few to most visitors (literal class names, so the stylesheet keeps them). */
const SHADES = [
  'fill-indigo-100 dark:fill-indigo-950',
  'fill-indigo-200 dark:fill-indigo-900',
  'fill-indigo-300 dark:fill-indigo-800',
  'fill-indigo-400 dark:fill-indigo-600',
  'fill-indigo-600 dark:fill-indigo-400',
];

/** The shade for `v` visitors out of a busiest country's `max`, on a log scale (one big market would flatten the rest). */
export function shadeOf(v: number, max: number): number {
  if (v <= 0 || max <= 0) return -1;
  return Math.min(SHADES.length - 1, Math.max(0, Math.ceil((Math.log(v + 1) / Math.log(max + 1)) * SHADES.length) - 1));
}

/**
 * Visitors by country on a world map, shaded on a log scale. Clicking a country filters by it, like the
 * Countries list beside it — which stays the accessible way to do the same (the map is not a tab stop per
 * country). Hovering one shows the editor's tooltip at the pointer. The outlines (~76 KB) load on first
 * use, so the editor bundle does not carry them. `filter` is the active country filter's pill.
 */
export function WorldMap({
  countries,
  selected,
  onSelect,
  filter,
}: {
  countries: SiteStats['countries'];
  selected?: string;
  onSelect: (c: string | undefined) => void;
  filter?: ReactNode;
}) {
  const [paths, setPaths] = useState<Paths | null>(null);
  const { showAtPointer, hide, bubble } = useChartTip();
  useEffect(() => {
    let live = true;
    void import('./world-paths').then((m) => {
      if (live) setPaths(m);
    });
    return () => {
      live = false;
    };
  }, []);
  // The bubble quotes THESE figures: a refresh that brings new ones closes it rather than leave it stale.
  useEffect(() => hide(), [countries, hide]);

  // ★ Memoised: the bubble follows the pointer, so this component re-renders on every mouse move — and
  // without this, every move would rebuild ~200 country paths and their handlers.
  const shapes = useMemo(() => {
    if (!paths) return null;
    const visitors = new Map(countries.filter((c) => c.country !== 'ZZ').map((c) => [c.country, c.visitors]));
    const max = Math.max(0, ...visitors.values());
    return Object.entries(paths.WORLD_PATHS).map(([cc, d]) => {
      const v = visitors.get(cc) ?? 0;
      const shade = shadeOf(v, max);
      return (
        <path
          key={cc}
          d={d}
          data-country={cc}
          // eslint-disable-next-line security/detect-object-injection -- shade is an in-range index from shadeOf
          className={`${shade < 0 ? 'fill-slate-200 dark:fill-slate-700' : SHADES[shade]} stroke-white dark:stroke-slate-900 ${selected === cc ? 'stroke-indigo-700 dark:stroke-indigo-200' : ''} ${v ? 'cursor-pointer hover:opacity-80' : ''}`}
          strokeWidth={selected === cc ? 1.5 : 0.5}
          // A click changes what the bubble would say (and moves the map as the filter pill appears): close it.
          onClick={
            v
              ? () => {
                  hide();
                  onSelect(selected === cc ? undefined : cc);
                }
              : undefined
          }
          onMouseMove={(e) =>
            showAtPointer(e.clientX, e.clientY, [
              countryName(cc),
              v ? counted(v, 'visitor') : 'No visitors',
              ...(v ? [selected === cc ? 'Click to clear the filter' : 'Click to filter by it'] : []),
            ])
          }
          onMouseLeave={hide}
        />
      );
    });
  }, [paths, countries, selected, onSelect, showAtPointer, hide]);

  const known = countries.filter((c) => c.country !== 'ZZ');
  if (known.length === 0) return null;
  const top = known.slice(0, 3).map((c) => `${countryName(c.country)} ${fmt(c.visitors)}`).join(', ');
  return (
    <Panel title="Map" action={filter}>
      {paths ? (
        <svg viewBox={paths.WORLD_VIEWBOX} className="h-auto w-full" role="img" aria-label={`Visitors by country — busiest: ${top}`}>
          {shapes}
        </svg>
      ) : (
        <div className="aspect-[96/47] w-full animate-pulse rounded-lg bg-slate-100 dark:bg-white/5" />
      )}
      {bubble}
    </Panel>
  );
}
