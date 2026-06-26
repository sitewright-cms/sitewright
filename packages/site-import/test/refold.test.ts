import { describe, expect, it } from 'vitest';
import { renderTemplate } from '@sitewright/blocks';
import { refoldLoops } from '../src/nativize/refold.js';

// The probe used by the real nativize is the render pool; here the in-process engine stands in for it.
const probe = (t: string, extra: Record<string, unknown>): Promise<string> => Promise.resolve(renderTemplate(t, extra as never));

describe('refoldLoops', () => {
  it('re-folds a uniform text+link grid into a {{#each}} loop + dataset + entries', async () => {
    const cards = [0, 1, 2, 3].map((i) => `<a class="card" href="/p${i}"><h3>Title ${i}</h3><p>Body ${i}</p></a>`).join('');
    const res = await refoldLoops(`<h2>Our Team</h2><section class="grid">${cards}</section>`, new Set<string>(), probe);
    expect(res.datasets).toHaveLength(1);
    expect(res.datasets[0]!.slug).toBe('ourteam');
    expect(res.datasets[0]!.fields.map((f) => f.name)).toEqual(['link', 'title', 'description']);
    expect(res.entries).toHaveLength(4);
    expect(res.entries[0]!.values).toEqual({ link: '/p0', title: 'Title 0', description: 'Body 0' });
    expect(res.html).toContain('{{#each dataset.ourteam}}');
    expect(res.html).not.toContain('Title 0'); // the literal cards are gone, replaced by the loop
  });

  it('does NOT fold cards with per-card SVG icons (the loop would bake card 0 icon → render-mismatch)', async () => {
    const cards = [0, 1, 2, 3].map((i) => `<a class="card" href="/p${i}"><svg viewBox="0 0 2 2"><path d="M${i} ${i}h1"/></svg><h3>Title ${i}</h3></a>`).join('');
    const res = await refoldLoops(`<section class="grid">${cards}</section>`, new Set<string>(), probe);
    expect(res.datasets).toHaveLength(0);
    expect(res.html).toContain('Title 3'); // every card stays literal (its own icon preserved)
  });

  it('folds a grid with per-row grid-cols/height artifacts (a table) — only varying cells become fields', async () => {
    // Each row carries a captured per-row grid-cols + height (artifacts), a CONSTANT "{{sw-icon}} VIEW"
    // action cell, and the varying project name/file. Expect: it folds; only name + file are fields; the
    // shared action cell + the column grid stay in the template (not field-ized).
    const row = (i: number, w: number, h: number) =>
      `<div class="grid grid-cols-[minmax(0,${w}fr)_minmax(0,90fr)] h-${h} rounded"><span>Project ${i}</span><a href="/files/${i}.pdf"><span>{{sw-icon "eye"}} VIEW</span></a></div>`;
    const html = `<section class="list">${[0, 1, 2, 3].map((i) => row(i, 80 + i, 10 + i)).join('')}</section>`;
    const res = await refoldLoops(html, new Set<string>(), probe);
    expect(res.datasets).toHaveLength(1);
    expect(res.datasets[0]!.fields.map((f) => f.type)).toEqual(['text', 'text']); // name + file href; the action label is constant → static
    expect(res.entries).toHaveLength(4);
    expect(res.html).toContain('{{#each dataset.');
    expect(res.html).toContain('{{sw-icon "eye"}}'); // the shared helper stays literal (NOT baked into a field → would render escaped)
  });

  it('leaves html unchanged when there is no qualifying grid', async () => {
    const res = await refoldLoops('<div><p>just some prose</p></div>', new Set<string>(), probe);
    expect(res.datasets).toHaveLength(0);
    expect(res.html).toContain('just some prose');
  });

  it('keeps slugs unique against the shared used-set', async () => {
    const used = new Set<string>(['ourteam']);
    const cards = [0, 1, 2, 3].map((i) => `<article class="x"><h3>T${i}</h3><p>B${i}</p></article>`).join('');
    const res = await refoldLoops(`<h2>Our Team</h2><section>${cards}</section>`, used, probe);
    expect(res.datasets[0]!.slug).toBe('ourteam2'); // deduped
  });
});
