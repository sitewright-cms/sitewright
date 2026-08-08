import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The editor must import the Tailwind reference's TYPES and constants from the `/meta` subpath, never
 * from the package root.
 *
 * The root re-exports `GENERATED_REFERENCE` — a 2.17 MB data literal that belongs on the server and
 * reaches the browser over `/authoring/tailwind/reference`. Rollup currently tree-shakes it out of
 * the SPA bundle because the module is side-effect free, but that is a bundler optimisation, not a
 * guarantee: one `export const` with a side effect, or a re-export shape rollup cannot prove pure,
 * and the editor bundle silently grows by 2 MB with nothing failing. This test makes the boundary a
 * rule rather than a hope.
 */
const SRC = join(import.meta.dirname, '../src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('tailwind-reference import boundary', () => {
  it('never imports the package root from editor source', () => {
    const offenders = sourceFiles(SRC).filter((file) =>
      /from '@sitewright\/tailwind-reference'/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });

  it('does import the meta subpath — the guard above would also pass if nothing imported it at all', () => {
    const importers = sourceFiles(SRC).filter((file) =>
      /from '@sitewright\/tailwind-reference\/meta'/.test(readFileSync(file, 'utf8')),
    );
    expect(importers.length).toBeGreaterThan(0);
  });
});
