#!/usr/bin/env node
/**
 * Generates apps/editor/src/views/stats/world-paths.ts — the Statistics tab's world map — from world-atlas
 * (Natural Earth 1:110m). The map data is a committed, generated file so the editor carries no mapping
 * dependency; this script is only for regenerating it. Its tools are NOT workspace dependencies: install them
 * into a throwaway directory and point the script at it.
 *
 *   mkdir /tmp/mapgen && cd /tmp/mapgen && npm init -y && \
 *     npm install --ignore-scripts world-atlas@2.0.2 topojson-client@3.1.0 d3-geo@3.1.1 i18n-iso-countries@7.14.0
 *   node scripts/gen-world-paths.mjs /tmp/mapgen apps/editor/src/views/stats/world-paths.ts
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const root = process.argv[2];
const out = process.argv[3];
const require = createRequire(root + '/package.json');
const topo = require('world-atlas/countries-110m.json');
const { feature } = require('topojson-client');
const { geoNaturalEarth1, geoPath } = await import(root + '/node_modules/d3-geo/src/index.js');
const countries = require('i18n-iso-countries');
const W = 960, H = 470;
const fc = feature(topo, topo.objects.countries);
// Antarctica takes a fifth of the map and has no visitors.
fc.features = fc.features.filter((f) => f.properties.name !== 'Antarctica');
const projection = geoNaturalEarth1().fitExtent([[4, 4], [W - 4, H - 4]], fc);
const path = geoPath(projection);
const byName = { Kosovo: 'XK', 'N. Cyprus': 'CY', Somaliland: 'SO' };
const parts = new Map();
let unmapped = [];
for (const f of fc.features) {
  const cc = (f.id && countries.numericToAlpha2(f.id)) || byName[f.properties.name];
  if (!cc) { unmapped.push(f.properties.name); continue; }
  let d = path(f);
  if (!d) continue;
  // Whole units (about a pixel at the size the tab draws it), and no point repeated after rounding.
  // eslint-disable-next-line security/detect-unsafe-regex -- dev-time script over a vetted, fixed data file
  d = d.replace(/-?\d+(\.\d+)?/g, (n) => String(Math.round(Number(n))));
  d = d.replace(/L(-?\d+),(-?\d+)(?=L\1,\2(?!\d))/g, '');
  parts.set(cc, (parts.get(cc) ?? '') + d);
}
const entries = [...parts.entries()].sort(([a], [b]) => a.localeCompare(b));
const body = entries.map(([cc, d]) => `  ${cc}: '${d}',`).join('\n');
const src = `// GENERATED — do not edit. Country outlines for the Statistics tab's world map.
//
// Source: Natural Earth 1:110m admin-0 countries (public domain, naturalearthdata.com), via world-atlas 2.0.2
// (ISC), projected with d3-geo's Natural Earth projection to a ${W}×${H} box, Antarctica dropped, coordinates
// rounded to whole units. Keyed by ISO 3166-1 alpha-2 (Kosovo = XK; Northern Cyprus drawn as part of CY, Somaliland as
// part of SO). Regenerate with scripts/gen-world-paths.mjs.

export const WORLD_VIEWBOX = '0 0 ${W} ${H}';

export const WORLD_PATHS: Readonly<Record<string, string>> = {
${body}
};
`;
writeFileSync(out, src);
console.log('countries', entries.length, 'bytes', src.length, 'unmapped', unmapped);
