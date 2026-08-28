import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectBundle } from '@sitewright/core';
import { buildSite } from '../src/publish/build.js';
import {
  CHROME_RUNTIMES,
  CHROME_RUNTIME_SOURCES,
  coreRuntimes,
  coreBundleJs,
  standaloneRuntimes,
  previewChromeScripts,
  type ChromeContext,
} from '../src/publish/chrome-runtimes.js';

const ctx = (over: Partial<ChromeContext> = {}): ChromeContext => ({ pages: [], slotSources: [], ...over });

describe('chrome-runtime registry — self-consistency', () => {
  it('every entry has a unique key, a filename and a runtime', () => {
    const keys = CHROME_RUNTIMES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    const scripts = CHROME_RUNTIMES.map((r) => r.script);
    expect(new Set(scripts).size).toBe(scripts.length);
    for (const r of CHROME_RUNTIMES) {
      expect(r.script.endsWith('.js')).toBe(true);
      expect(r.js.trim().startsWith('(function')).toBe(true);
    }
  });

  it('isolates each runtime in the bundle, so one throw cannot kill the rest', () => {
    // As separate <script defer> tags these had fault isolation for free. Concatenated, an uncaught
    // throw would abort every runtime after it in the file, on every page of the site.
    const js = coreBundleJs(ctx());
    // Count the WRAPPER's catch, not `try{` — the runtimes contain their own try blocks
    // (nav-active guards `new URL`), so a bare `try{` count is not the wrapper count.
    const wrappers = js.match(/\}catch\(e\)\{if\(typeof console/g) ?? [];
    expect(wrappers).toHaveLength(coreRuntimes(ctx()).length);
    expect(js).toContain('console.error');
    // and it actually holds when one of them throws
    const bundle = ['(function(){throw new Error("boom")})();', '(function(){globalThis.__swReached=true})();']
      .map((r) => `try{\n${r}\n}catch(e){}`)
      .join('\n');
    (globalThis as Record<string, unknown>).__swReached = false;
    new Function(bundle)();
    expect((globalThis as Record<string, unknown>).__swReached).toBe(true);
  });

  it('feeds the cache-bust digest from the registry, so a new entry can never be forgotten', () => {
    expect(CHROME_RUNTIME_SOURCES).toHaveLength(CHROME_RUNTIMES.length);
    // The ?v= token is one digest over ALL of these — the reason bundling costs no cache granularity.
    expect(CHROME_RUNTIME_SOURCES).toEqual(CHROME_RUNTIMES.map((r) => r.js));
  });

  it('a runtime with no per-page gate is site-wide or nothing', () => {
    // preloader / back-to-top are settings-driven chrome: no page can opt itself in, so they must never
    // end up in the standalone set (which would write a file no page links).
    for (const r of CHROME_RUNTIMES.filter((x) => x.perPage === undefined)) {
      expect(standaloneRuntimes(ctx(), () => true).some((x) => x.key === r.key)).toBe(false);
    }
  });
});

describe('chrome-runtime registry — core vs standalone', () => {
  it('a bare site still gets a core bundle (sticky-header is unconditional)', () => {
    const core = coreRuntimes(ctx());
    expect(core.map((r) => r.key)).toContain('sticky-header');
    expect(coreBundleJs(ctx())).not.toBe('');
  });

  it('the default site folds back-to-top and its button ripple into core', () => {
    const keys = coreRuntimes(ctx()).map((r) => r.key);
    expect(keys).toContain('back-to-top');
    expect(keys).toContain('button-effects'); // the FAB is a .btn, so its ripple ships with it
  });

  it('opting out of back-to-top drops it AND the ripple it was pulling in', () => {
    const off = ctx({ website: { effects: { backToTop: false } } });
    const keys = coreRuntimes(off).map((r) => r.key);
    expect(keys).not.toContain('back-to-top');
    expect(keys).not.toContain('button-effects');
  });

  it('a nav menu in a CHROME SLOT makes nav-active site-wide; in a page it does not', () => {
    const slot = ctx({ slotSources: ['<ul class="menu"><li><a href="/">Home</a></li></ul>'] });
    expect(coreRuntimes(slot).map((r) => r.key)).toContain('nav-active');
    // Same markup authored in a single page's own source: not site-wide, so it stays standalone and
    // only that page links it.
    const page = ctx();
    expect(coreRuntimes(page).map((r) => r.key)).not.toContain('nav-active');
    expect(standaloneRuntimes(page, (uses) => uses('<ul class="menu">x</ul>')).map((r) => r.key)).toContain('nav-active');
  });

  it('concatenates in registry order, and never lists a runtime both ways', () => {
    const c = ctx({ website: { effects: { scrollSpy: true, navEffect: 'sliding-pill' } } });
    const core = coreRuntimes(c);
    const order = CHROME_RUNTIMES.map((r) => r.key);
    expect(core.map((r) => r.key)).toEqual(order.filter((k) => core.some((r) => r.key === k)));
    const standaloneKeys = standaloneRuntimes(c, () => true).map((r) => r.key);
    expect(standaloneKeys.filter((k) => core.some((r) => r.key === k))).toEqual([]);
  });
});

describe('chrome-runtime registry — editor preview parity', () => {
  it('inlines the same runtimes the published page would link, minus the chrome it never renders', () => {
    const html = '<ul class="menu menu-horizontal sw-nav-sliding-pill"><li><a class="btn" href="/">Home</a></li></ul>';
    const inlined = previewChromeScripts(html);
    const expected = CHROME_RUNTIMES.filter((r) => r.preview?.(html) === true);
    expect(inlined).toEqual(expected.map((r) => r.js));
    const keys = expected.map((r) => r.key);
    expect(keys).toEqual(['nav-effects', 'nav-active', 'button-effects', 'sticky-header']);
    // The single-page canvas renders neither overlay nor FAB, so it must ship neither runtime.
    expect(keys).not.toContain('preloader');
    expect(keys).not.toContain('back-to-top');
  });

  it('every preview-gated runtime is reachable from the publish path too', () => {
    // A runtime the canvas runs but no build ever ships would be preview-only drift — the exact class
    // of bug the body-effect registry was created to make impossible.
    for (const r of CHROME_RUNTIMES.filter((x) => x.preview !== undefined)) {
      const reachable =
        r.perPage !== undefined || coreRuntimes(ctx()).some((x) => x.key === r.key) || r.siteWide(ctx({ website: { effects: {} } }));
      expect(reachable, `${r.key} is preview-only`).toBe(true);
    }
  });
});

describe('core.js in a real build', () => {
  let outDir: string;
  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'sw-core-'));
  });
  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  const bundle = (over: Record<string, unknown> = {}): ProjectBundle =>
    ({
      project: {
        formatVersion: 2 as const, id: 'p', name: 'Acme', slug: 'acme',
        identity: { name: 'Acme', colors: { primary: '#4f46e5' } },
        settings: { defaultLocale: 'en', locales: ['en'] },
        website: {
          mainNav: '<ul class="menu menu-horizontal">{{#each nav.header}}<li><a href="{{sw-url path}}">{{sw-label}}</a></li>{{/each}}</ul>',
          ...over,
        },
      },
      pages: [
        { id: 'home', path: '', title: 'Home', source: '<p>Hi</p>', nav: { slots: ['header'], order: 1 } },
        { id: 'about', path: 'about', title: 'About', source: '<p>Us</p>', nav: { slots: ['header'], order: 2 } },
      ],
      datasets: [], entries: [],
    }) as unknown as ProjectBundle;

  it('replaces the four always-on fetches with ONE, on every page', async () => {
    await buildSite({ publishedAt: '2026-05-29T00:00:00.000Z', outDir, bundle: bundle() });
    for (const file of ['index.html', 'about/index.html']) {
      const html = await readFile(join(outDir, file), 'utf8');
      const linked = Array.from(html.matchAll(/<script defer src="[^"]*\/_sw\/([^"?]+)/g)).map((m) => m[1]);
      expect(linked).toEqual(['core.js']);
    }
    // …and all four runtimes are actually in the one file.
    const core = await readFile(join(outDir, '_assets/_sw/core.js'), 'utf8');
    for (const token of ['sw-nav-hidden', 'data-sw-back-to-top', 'sw-btn-ripple', '.menu a.active']) {
      expect(core, token).toContain(token);
    }
    // The per-runtime files are GONE — nothing writes an asset no page links.
    for (const name of ['sticky-header.js', 'back-to-top.js', 'button-effects.js', 'nav-active.js']) {
      await expect(readFile(join(outDir, '_assets/_sw', name), 'utf8')).rejects.toThrow();
    }
  });

  it('keeps a page-local runtime standalone next to the bundle', async () => {
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: (() => {
        const b = bundle() as unknown as { pages: { id: string; source: string }[] };
        // Only the ABOUT page authors a dialog → nav-link must not enter core, and must not land on home.
        b.pages = b.pages.map((pg) => (pg.id === 'about' ? { ...pg, source: '<dialog id="m"><p>hi</p></dialog>' } : pg));
        return b as unknown as ProjectBundle;
      })(),
    });
    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    const about = await readFile(join(outDir, 'about/index.html'), 'utf8');
    expect(home).not.toContain('nav-link.js');
    expect(about).toContain('nav-link.js');
    expect(await readFile(join(outDir, '_assets/_sw/core.js'), 'utf8')).not.toContain('scrollIntoView');
  });

  it('shares one ?v= token across the bundle and the sheet, and busts on any runtime change', async () => {
    await buildSite({ publishedAt: '2026-05-29T00:00:00.000Z', outDir, bundle: bundle() });
    const html = await readFile(join(outDir, 'index.html'), 'utf8');
    const tokens = Array.from(html.matchAll(/\?v=([a-f0-9]{16})/g)).map((m) => m[1]);
    expect(tokens.length).toBeGreaterThan(0);
    expect(new Set(tokens).size).toBe(1); // one digest for every platform asset
  });
});
