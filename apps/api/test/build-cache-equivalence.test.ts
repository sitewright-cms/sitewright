import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import type { ProjectBundle } from '@sitewright/core';
import { buildSite } from '../src/publish/build.js';

// The build memoizes two pure-but-expensive steps that used to run once per ROUTE on identical input:
// clean-css over the platform stylesheet (measured ~45% of an 800-route build) and the validateTemplate
// source scan (~8% after that). Memoizing them is only safe if the artifact is unchanged, so these tests
// assert the OUTPUT, not the timing: same input ⇒ byte-identical bytes, changed input ⇒ changed bytes.
//
// The cache-poisoning failure mode is the one that matters: a stylesheet keyed too loosely would serve
// the PREVIOUS project's brand colours to the next build in the same process.

let out: string;

beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), 'sw-buildcache-'));
});
afterEach(async () => {
  await rm(out, { recursive: true, force: true });
});

const PUBLISHED_AT = '2026-08-16T00:00:00.000Z';

function bundleWith(opts: { primary: string; heading: string }): ProjectBundle {
  return {
    project: {
      formatVersion: 1,
      id: 'p1',
      name: 'Cache',
      slug: 'cache',
      identity: { name: 'Cache', colors: { primary: opts.primary } },
      settings: { defaultLocale: 'en', locales: ['en'] },
    },
    pages: [
      { id: 'home', path: '', title: 'Home', source: `<h1 class="text-3xl">${opts.heading}</h1>` },
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `p-${i}`,
        path: `p-${i}`,
        title: `Page ${i}`,
        source: `<article class="prose"><h2>${opts.heading} ${i}</h2><p>body</p></article>`,
      })),
    ],
    templates: [],
    datasets: [],
    entries: [],
  } as unknown as ProjectBundle;
}

/** Every built file as `relative path → contents`, so two builds can be compared byte for byte. */
async function snapshot(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const walk = async (d: string): Promise<void> => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.set(relative(dir, full).split(sep).join('/'), await readFile(full, 'utf8'));
    }
  };
  await walk(dir);
  return files;
}

const build = (dir: string, bundle: ProjectBundle): Promise<unknown> =>
  buildSite({ outDir: join(out, dir), bundle, publishedAt: PUBLISHED_AT, includeDrafts: true });

describe('build output is unaffected by the memoized minify/validate caches', () => {
  it('produces byte-identical output on a repeated build of the same content', async () => {
    const bundle = bundleWith({ primary: '#2563eb', heading: 'Hello' });

    await build('first', bundle); // cold: caches empty
    await build('second', bundle); // warm: every minify/validate is a cache hit

    const [a, b] = [await snapshot(join(out, 'first')), await snapshot(join(out, 'second'))];
    expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
    for (const [path, contents] of a) expect(b.get(path), `mismatch in ${path}`).toBe(contents);
  });

  it('emits the NEW brand colour after it changes — a warm cache must not serve the old stylesheet', async () => {
    await build('blue', bundleWith({ primary: '#2563eb', heading: 'Hello' }));
    await build('red', bundleWith({ primary: '#dc2626', heading: 'Hello' }));

    const blue = (await snapshot(join(out, 'blue'))).get('index.html') ?? '';
    const red = (await snapshot(join(out, 'red'))).get('index.html') ?? '';

    expect(blue).not.toBe(red);
    // The brand token is inlined in the document head; each build must carry its own.
    expect(blue.toLowerCase()).toContain('2563eb');
    expect(red.toLowerCase()).toContain('dc2626');
    expect(red.toLowerCase()).not.toContain('2563eb');
  });

  it('returns to identical output when the content returns (A → B → A)', async () => {
    const a = bundleWith({ primary: '#2563eb', heading: 'Alpha' });
    const b = bundleWith({ primary: '#16a34a', heading: 'Beta' });

    await build('a1', a);
    await build('b1', b);
    await build('a2', a);

    const [first, third] = [await snapshot(join(out, 'a1')), await snapshot(join(out, 'a2'))];
    for (const [path, contents] of first) expect(third.get(path), `mismatch in ${path}`).toBe(contents);
  });

  it('rejects an unsafe source on a REBUILD, not just the first time it is seen', async () => {
    // validateTemplate's verdict is cached. A cached rejection that decayed into a pass would let
    // unsafe markup through on the second publish of the same page — the one nobody re-checks.
    const unsafe = bundleWith({ primary: '#2563eb', heading: 'x' });
    (unsafe.pages as unknown as Array<{ source: string }>)[0]!.source = '<p>{{{ raw }}}</p>';

    await expect(build('unsafe1', unsafe)).rejects.toThrow();
    await expect(build('unsafe2', unsafe)).rejects.toThrow();
  });
});
