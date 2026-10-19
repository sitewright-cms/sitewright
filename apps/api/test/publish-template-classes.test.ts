import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectBundle } from '@sitewright/core';
import { buildSite } from '../src/publish/build.js';

// ★ THE PUBLISHED SHEET MUST CARRY EVERY CLASS THE PUBLISHED PAGES RENDER.
//
// An agent wrote `<div class="p-6 {{#if (eq phase "dusk")}}bg-orange-500{{/if}}">`. The editor preview compiles
// Tailwind from the RENDERED page, so it looked right; the published and draft site compiled from the page
// SOURCE, where the `"` around "dusk" ended the attribute for the class scan, so `bg-orange-500` never compiled
// and the blocks shipped unstyled. Two halves to the fix, each pinned here:
//  - the source scan reads a class value the way Handlebars does (every branch, quotes and all), and
//  - the build ALSO compiles the classes its rendered pages carry — the preview's own rule — so a class that
//    exists only at render time (`bg-{{tone}}-600`) ships too, with a stylesheet token that busts when it changes.

let outDir: string;
beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'sw-publish-tplcls-'));
});
afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

function bundle(pages: unknown[], website?: Record<string, unknown>): ProjectBundle {
  return {
    project: {
      formatVersion: 2 as const,
      id: 'p',
      name: 'Acme',
      slug: 'acme',
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en'] },
      ...(website ? { website } : {}),
    },
    pages,
    datasets: [],
    entries: [],
  } as unknown as ProjectBundle;
}

const PUBLISHED_AT = '2026-10-19T00:00:00.000Z';
const sheet = (dir = outDir): Promise<string> => readFile(join(dir, '_assets', '_sw', 'styles.css'), 'utf8');
const home = (dir = outDir): Promise<string> => readFile(join(dir, 'index.html'), 'utf8');
const sheetToken = (html: string): string | undefined => html.match(/styles\.css\?v=([0-9a-f]{16})/)?.[1];

describe('publish — classes inside Handlebars expressions and classes made at render time', () => {
  it('★ compiles BOTH branches of a quoted-helper conditional in a class attribute', async () => {
    await buildSite({
      publishedAt: PUBLISHED_AT,
      outDir,
      bundle: bundle([
        {
          id: 'home', path: '', title: 'Home', data: { phase: 'dusk' },
          source: '<div class="p-6 {{#if (eq page.data.phase "dusk")}}bg-orange-500{{else}}bg-sky-700{{/if}}">Dusk</div>',
        },
      ]),
    });
    const html = await home();
    expect(html).toContain('<div class="p-6 bg-orange-500">Dusk</div>'); // the rendered branch…
    const css = await sheet();
    expect(css).toContain('.bg-orange-500{'); // …is in the sheet,
    expect(css).toContain('.bg-sky-700{'); // and so is the branch this publish did NOT render (source scan only)
    expect(css).toContain('.p-6{');
  });

  it('★ compiles a class that exists only in the RENDERED page (an interpolated class name)', async () => {
    await buildSite({
      publishedAt: PUBLISHED_AT,
      outDir,
      bundle: bundle([
        { id: 'home', path: '', title: 'Home', data: { tone: 'emerald' }, source: '<div class="rounded bg-{{page.data.tone}}-600">Hi</div>' },
      ]),
    });
    expect(await home()).toContain('class="rounded bg-emerald-600"');
    expect(await sheet()).toContain('.bg-emerald-600{');
  });

  it('★ busts the stylesheet token when ONLY a render-time class changes — and keeps it when nothing does', async () => {
    const page = (tone: string): unknown => ({
      id: 'home', path: '', title: 'Home', data: { tone }, source: '<div class="rounded bg-{{page.data.tone}}-600">Hi</div>',
    });
    const outB = await mkdtemp(join(tmpdir(), 'sw-publish-tplcls-b-'));
    const outC = await mkdtemp(join(tmpdir(), 'sw-publish-tplcls-c-'));
    try {
      await buildSite({ publishedAt: PUBLISHED_AT, outDir, bundle: bundle([page('emerald')]) });
      await buildSite({ publishedAt: '2027-01-01T00:00:00.000Z', outDir: outB, bundle: bundle([page('emerald')]) });
      await buildSite({ publishedAt: PUBLISHED_AT, outDir: outC, bundle: bundle([page('rose')]) });
      const [a, b, c] = await Promise.all([home(), home(outB), home(outC)]);
      // Same content → byte-identical pages and sheet (an incremental deploy re-uploads nothing).
      expect(a).toBe(b);
      expect(await sheet()).toBe(await sheet(outB));
      // The SOURCE is identical across all three, so a token derived from the source scan alone could not move —
      // and a visitor holding the immutable `styles.css?v=<old>` would never fetch `.bg-rose-600`.
      expect(await sheet(outC)).toContain('.bg-rose-600{');
      expect(sheetToken(a)).toBeTruthy();
      expect(sheetToken(c)).toBeTruthy();
      expect(sheetToken(c)).not.toBe(sheetToken(a));
      // Only the stylesheet's token moves: the runtime scripts keep theirs (their bytes did not change).
      const coreToken = (html: string): string | undefined => html.match(/core\.js\?v=([0-9a-f]{16})/)?.[1];
      expect(coreToken(c)).toBe(coreToken(a));
    } finally {
      await rm(outB, { recursive: true, force: true });
      await rm(outC, { recursive: true, force: true });
    }
  });

  it('links and writes the sheet for a site whose SOURCE has no literal class but whose pages render one', async () => {
    await buildSite({
      publishedAt: PUBLISHED_AT,
      outDir,
      // backToTop off: otherwise its platform button classes make every site "use utilities" from the start.
      bundle: bundle([{ id: 'home', path: '', title: 'Home', data: { cls: 'grid' }, source: '<div class="{{page.data.cls}}">x</div>' }], {
        effects: { backToTop: false },
      }),
    });
    const html = await home();
    expect(html).toContain('<div class="grid">x</div>');
    expect(html).toMatch(/<link rel="stylesheet" href="_assets\/_sw\/styles\.css\?v=[0-9a-f]{16}"/);
    expect(await sheet()).toContain('display:grid');
  });

  it('a site with no class anywhere — source or rendered — still ships no sheet and no link', async () => {
    await buildSite({
      publishedAt: PUBLISHED_AT,
      outDir,
      bundle: bundle([{ id: 'home', path: '', title: 'Home', source: '<div>{{company.name}}</div>' }], { effects: { backToTop: false } }),
    });
    expect(await home()).not.toContain('rel="stylesheet"');
    await expect(sheet()).rejects.toThrow(/ENOENT/);
  });

  it('a RAW-HTML page feeds none of its rendered classes into the shared sheet (it links none, as in the editor)', async () => {
    await buildSite({
      publishedAt: PUBLISHED_AT,
      outDir,
      bundle: bundle([
        { id: 'home', path: '', title: 'Home', source: '<div class="flex">home</div>' },
        { id: 'legacy', path: 'legacy', title: 'Legacy', rawHtml: true, data: { cls: 'w-100' }, source: '<div class="{{page.data.cls}}">old</div>' },
      ]),
    });
    expect(await readFile(join(outDir, 'legacy', 'index.html'), 'utf8')).toContain('class="w-100"');
    const css = await sheet();
    expect(css).toContain('display:flex'); // presence guard: the sheet exists and carries the home page's class
    expect(css).not.toContain('.w-100{');
  });
});
