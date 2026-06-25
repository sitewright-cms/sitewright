import { describe, expect, it, vi } from 'vitest';
import { nativizeProject, type CaptureFn, type NativizeDeps } from '../src/render/nativize-project.js';
import type { ProjectContext } from '../src/repo/context.js';
import type { CapturedNode } from '@sitewright/site-import';

const ctx: ProjectContext = { userId: 'u1', projectId: 'p1', role: 'owner' };

// A tiny styled tree: a brand-colored div + a paragraph + an image the capture resolved to the loopback
// origin (the orchestrator must strip it back to root-relative).
const tree = (): CapturedNode[] => [
  {
    tag: 'div', s: { color: 'rgb(11, 74, 119)' }, children: [
      { tag: 'p', s: {}, text: 'Hello world', children: [] },
      { tag: 'img', s: {}, src: 'http://127.0.0.1/media/logo.webp', alt: 'Logo', children: [] },
    ],
  },
];
const okCapture: CaptureFn = async () => ({ base: tree(), md: tree(), lg: tree() });

interface DepOverrides {
  pages?: unknown[];
  capture?: CaptureFn;
  entries?: unknown[];
}
function makeDeps(o: DepOverrides = {}) {
  const pages = o.pages ?? [
    { id: 'home', path: '', title: 'Home', source: '<div>raw</div>', status: 'draft', data: { swImport: { sourceUrl: 'https://www.example.com/', rewritten: false } } },
    { id: 'about', path: 'about', title: 'About', source: '<div>raw</div>', status: 'draft', data: { swImport: { sourceUrl: 'https://www.example.com/about', rewritten: false } } },
    { id: 'native', path: 'x', title: 'X', source: '<div>done</div>', status: 'published', data: {} }, // NOT rawFidelity → excluded
  ];
  const settings = {
    identity: { colors: { primary: '#0b4a77' }, logo: '/media/logo.png' },
    website: { head: '<link rel="stylesheet" href="/media/import.css">', scripts: '<script src="/media/foreign.js"></script>', topNav: '<div><a href="/a">A</a></div>' },
  };
  const pagePuts: Array<{ id: string; raw: { status: string; source: string; data: { swImport: { rewritten: boolean } } } }> = [];
  let settingsPut: { website: { head: string; scripts: string; topNav: string; mobileNav: string } } | null = null;
  const entries = o.entries ?? [];
  const renderContexts: unknown[] = [];
  const contentRepo = {
    get: vi.fn(async () => settings),
    list: vi.fn(async (_c: unknown, kind: string) => (kind === 'entry' ? entries : pages)),
    put: vi.fn(async (_c: unknown, kind: string, id: string, raw: unknown) => {
      if (kind === 'settings') settingsPut = raw as never;
      else pagePuts.push({ id, raw: raw as never });
      return raw;
    }),
  } as unknown as NativizeDeps['contentRepo'];
  const renderPool = { render: vi.fn(async (src: string, context: unknown) => { renderContexts.push(context); return src; }) } as unknown as NativizeDeps['renderPool'];
  const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } as unknown as NativizeDeps['log'];
  const deps: NativizeDeps = { contentRepo, renderPool, originHostPort: '127.0.0.1:80', log, capture: o.capture ?? okCapture };
  return { deps, pagePuts, getSettingsPut: () => settingsPut, renderContexts, log };
}

describe('nativizeProject', () => {
  it('nativizes rawFidelity pages → published native source (brand→token, /media root-relative)', async () => {
    const { deps, pagePuts } = makeDeps();
    const report = await nativizeProject(ctx, deps, () => {});
    expect(report.pagesTotal).toBe(2); // the already-native page is excluded
    expect(report.pagesNativized).toBe(2);
    expect(report.skipped).toEqual([]);
    expect(pagePuts).toHaveLength(2);
    for (const { raw } of pagePuts) {
      expect(raw.status).toBe('published'); // #7
      expect(raw.data.swImport.rewritten).toBe(true);
      expect(raw.source).toContain('text-primary'); // brand rgb → theme token
      expect(raw.source).not.toContain('raw');
      expect(raw.source).toContain('src="/media/logo.webp"'); // loopback origin stripped
      expect(raw.source).not.toContain('127.0.0.1');
    }
  });

  it('rebuilds the chrome once the whole site is native: nav loop + foreign CSS/JS dropped', async () => {
    const { deps, getSettingsPut } = makeDeps();
    const report = await nativizeProject(ctx, deps, () => {});
    expect(report.chromeRebuilt).toBe(true);
    const w = getSettingsPut()!.website;
    expect(w.topNav).toContain('{{#each nav.header}}'); // #6 data-driven nav
    expect(w.topNav).not.toContain('href="/a"'); // the imported hard-coded link is gone
    expect(w.head).not.toMatch(/<link[^>]+stylesheet/i); // #5 foreign stylesheet dropped
    expect(w.scripts).toBe(''); // #5 foreign JS dropped
    expect(w.mobileNav).toBe('');
  });

  it('skips a page whose capture throws, and does NOT rebuild chrome (a rawFidelity page remains)', async () => {
    let n = 0;
    const capture: CaptureFn = async (...args) => { n += 1; if (n === 1) throw new Error('render boom'); return okCapture(...args); };
    const { deps, pagePuts, getSettingsPut, log } = makeDeps({ capture });
    const report = await nativizeProject(ctx, deps, () => {});
    expect(report.skipped).toHaveLength(1);
    expect(report.pagesNativized).toBe(1);
    expect(report.chromeRebuilt).toBe(false); // a still-rawFidelity page needs the foreign CSS + literal chrome
    expect(getSettingsPut()).toBeNull(); // settings untouched
    expect(pagePuts).toHaveLength(1);
    expect(log.warn).toHaveBeenCalled();
  });

  it('feeds real dataset entries into the render context (so {{#each}} loops render, not vanish)', async () => {
    const entries = [
      { id: 'e1', dataset: 'svc', status: 'published', values: { title: 'Mining' } },
      { id: 'e2', dataset: 'svc', status: 'published', values: { title: 'Energy' } },
    ];
    const { deps, renderContexts } = makeDeps({ entries });
    await nativizeProject(ctx, deps, () => {});
    const withData = renderContexts.find((c) => (c as { dataset?: Record<string, unknown> }).dataset?.svc);
    expect(withData).toBeDefined();
    expect((withData as { dataset: { svc: unknown[] } }).dataset.svc).toHaveLength(2);
  });

  it('the abort signal stops the tail of a concurrent batch', async () => {
    const ac = new AbortController();
    const pages = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, path: `p${i}`, title: `P${i}`, source: '<div>raw</div>', status: 'draft', data: { swImport: { sourceUrl: `https://www.example.com/p${i}`, rewritten: false } } }));
    const capture: CaptureFn = async (...args) => { ac.abort(); return okCapture(...args); }; // abort during the first captures
    const { deps } = makeDeps({ pages, capture });
    deps.signal = ac.signal;
    const report = await nativizeProject(ctx, deps, () => {});
    expect(report.pagesTotal).toBe(6);
    expect(report.pagesNativized).toBeGreaterThanOrEqual(1); // the in-flight pages complete
    expect(report.pagesNativized).toBeLessThan(6); // …but the tail is skipped once aborted
    expect(report.chromeRebuilt).toBe(false); // not all native → chrome untouched
  });
});
