import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectBundle } from '@sitewright/core';
import { buildSite } from '../src/publish/build.js';
import { statsRouteToken } from '../src/analytics/token.js';

// What the publisher writes for the built-in statistics — and, as importantly, what it does NOT write for a
// site that does not count visits: every site is built with a signing key, so a site without statistics must
// come out byte-for-byte what it was before the feature existed.

let dirs: string[] = [];
beforeEach(() => {
  dirs = [];
});
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

function bundle(website?: Record<string, unknown>): ProjectBundle {
  return {
    project: {
      formatVersion: 2 as const,
      id: 'p1',
      name: 'Acme',
      slug: 'acme',
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en', 'de'] },
      ...(website ? { website } : {}),
    },
    pages: [
      { id: 'home', path: '', title: 'Home', source: '<section><h1>Home</h1></section>' },
      { id: 'about', path: 'about', title: 'About', source: '<section><h1>About</h1></section>' },
      { id: 'home-de', path: 'de', parent: 'home', title: 'Start', locale: 'de', translationGroup: 'home', source: '<section><h1>Start</h1></section>' },
      { id: 'about-de', path: 'about', parent: 'home-de', title: 'Über', locale: 'de', source: '<section><h1>Über</h1></section>' },
      { id: 'raw', path: 'imported', title: 'Imported', rawHtml: true, source: '<section><h1>Imported</h1></section>' },
    ],
    datasets: [],
    entries: [],
  } as unknown as ProjectBundle;
}

async function build(b: ProjectBundle, opts: { stats?: { key: string }; publicBaseUrl?: string; previewRuntime?: string } = {}): Promise<Map<string, string>> {
  const outDir = await mkdtemp(join(tmpdir(), 'sw-stats-build-'));
  dirs.push(outDir, `${outDir}.tmp`);
  await buildSite({ outDir, bundle: b, publishedAt: '2026-10-19T00:00:00.000Z', ...opts });
  const files = new Map<string, string>();
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name !== 'release.json') files.set(relative(outDir, full), await readFile(full, 'utf8'));
    }
  };
  await walk(outDir);
  return files;
}

const payloadOf = (html: string): Record<string, string> | null => {
  const m = /data-sw-stats="([^"]+)"/.exec(html);
  return m ? (JSON.parse(Buffer.from(m[1]!, 'base64').toString('utf8')) as Record<string, string>) : null;
};

describe('the statistics tracker in a build', () => {
  it('★ a site WITHOUT statistics is byte-identical whether or not the build holds a signing key', async () => {
    const plain = await build(bundle());
    const keyed = await build(bundle(), { stats: { key: 'k' } });
    expect([...keyed.keys()].sort()).toEqual([...plain.keys()].sort());
    for (const [name, body] of plain) expect(keyed.get(name), name).toBe(body);
  });

  it('★ signs every page with the route it is served at — locale-prefixed and raw-HTML pages included', async () => {
    const files = await build(bundle({ statistics: { enabled: true } }), { stats: { key: 'k' }, publicBaseUrl: 'https://cms.example.com/' });
    expect(files.has('_assets/_sw/stats.js')).toBe(true);
    for (const [file, route] of [
      ['index.html', '/'],
      ['about/index.html', '/about/'],
      ['de/about/index.html', '/de/about/'],
      ['imported/index.html', '/imported/'],
    ] as const) {
      const p = payloadOf(files.get(file) ?? '');
      expect(p, file).toEqual({ b: 'https://cms.example.com', p: 'p1', r: route, k: statsRouteToken('k', route) });
    }
    // The collector is cross-origin from a hosted page, so the page's policy lets the beacon out.
    // (The policy rides in the platform's inert `sw-csp` meta, attribute-escaped; hosting promotes it to a header.)
    expect(files.get('index.html')).toMatch(/name="sw-csp" content="[^"]*connect-src [^"]*https:\/\/cms\.example\.com/);
    // Script paths are page-relative, like every other platform runtime.
    expect(files.get('de/about/index.html')).toContain('src="../../_assets/_sw/stats.js?v=');
  });

  it('beacons root-relative, and widens no policy, without a public base URL', async () => {
    const files = await build(bundle({ statistics: { enabled: true } }), { stats: { key: 'k' } });
    expect(payloadOf(files.get('index.html')!)?.b).toBe('');
  });

  it('★ never ships the tracker into the draft preview, nor without a key', async () => {
    const preview = await build(bundle({ statistics: { enabled: true } }), { stats: { key: 'k' }, previewRuntime: '/* bridge */' });
    expect([...preview.values()].some((html) => html.includes('data-sw-stats'))).toBe(false);
    expect(preview.has('_assets/_sw/stats.js')).toBe(false);
    const keyless = await build(bundle({ statistics: { enabled: true } }));
    expect([...keyless.values()].some((html) => html.includes('data-sw-stats'))).toBe(false);
  });
});
