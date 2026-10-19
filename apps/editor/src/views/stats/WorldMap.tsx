import { useEffect, useState } from 'react';
import type { SiteStats } from '@sitewright/schema';
import { Panel } from './Breakdowns';
import { countryName, fmt } from './format';

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
 * country). The outlines (~76 KB) load on first use, so the editor bundle does not carry them.
 */
export function WorldMap({ countries, selected, onSelect }: { countries: SiteStats['countries']; selected?: string; onSelect: (c: string | undefined) => void }) {
  const [paths, setPaths] = useState<Paths | null>(null);
  useEffect(() => {
    let live = true;
    void import('./world-paths').then((m) => {
      if (live) setPaths(m);
    });
    return () => {
      live = false;
    };
  }, []);
  const known = countries.filter((c) => c.country !== 'ZZ');
  if (known.length === 0) return null;
  const visitors = new Map(known.map((c) => [c.country, c.visitors]));
  const max = Math.max(...known.map((c) => c.visitors));
  const top = known.slice(0, 3).map((c) => `${countryName(c.country)} ${fmt(c.visitors)}`).join(', ');
  return (
    <Panel title="Map">
      {paths ? (
        <svg viewBox={paths.WORLD_VIEWBOX} className="h-auto w-full" role="img" aria-label={`Visitors by country — busiest: ${top}`}>
          {Object.entries(paths.WORLD_PATHS).map(([cc, d]) => {
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
                onClick={v ? () => onSelect(selected === cc ? undefined : cc) : undefined}
              >
                <title>{`${countryName(cc)}: ${fmt(v)} visitors`}</title>
              </path>
            );
          })}
        </svg>
      ) : (
        <div className="aspect-[96/47] w-full animate-pulse rounded-lg bg-slate-100 dark:bg-white/5" />
      )}
    </Panel>
  );
}
