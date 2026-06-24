import { describe, expect, it, vi } from 'vitest';
import { nativizeProject, type CaptureFn, type NativizeDeps } from '../src/render/nativize-project.js';
import type { ProjectContext } from '../src/repo/context.js';
import type { CapturedNode } from '@sitewright/site-import';

const ctx: ProjectContext = { userId: 'u1', projectId: 'p1', role: 'owner' };

// A tiny styled tree: a brand-colored div wrapping a paragraph + a self-hosted image whose src the
// headless capture resolved to the loopback origin (the orchestrator must strip it back to root-relative).
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
}
function makeDeps(o: DepOverrides = {}) {
  const pages = o.pages ?? [
    { id: 'home', path: '', title: 'Home', source: '<div>raw</div>', status: 'draft', data: { swImport: { sourceUrl: 'https://www.example.com/', rewritten: false } } },
    { id: 'about', path: 'about', title: 'About', source: '<div>raw</div>', status: 'draft', data: { swImport: { sourceUrl: 'https://www.example.com/about', rewritten: false } } },
    { id: 'native', path: 'x', title: 'X', source: '<div>done</div>', status: 'published', data: {} }, // NOT rawFidelity → skipped
  ];
  const settings = { identity: { colors: { primary: '#0b4a77' } }, website: {} };
  const puts: Array<{ id: string; raw: { source: string; data: { swImport: { rewritten: boolean } } } }> = [];
  const contentRepo = {
    get: vi.fn(async () => settings),
    list: vi.fn(async () => pages),
    put: vi.fn(async (_c: unknown, _k: unknown, id: string, raw: unknown) => { puts.push({ id, raw: raw as never }); return raw; }),
  } as unknown as NativizeDeps['contentRepo'];
  const renderPool = { render: vi.fn(async (src: string) => src) } as unknown as NativizeDeps['renderPool'];
  const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } as unknown as NativizeDeps['log'];
  const deps: NativizeDeps = { contentRepo, renderPool, originHostPort: '127.0.0.1:80', log, capture: o.capture ?? okCapture };
  return { deps, puts, log };
}

describe('nativizeProject', () => {
  it('nativizes only rawFidelity pages → native source + rewritten:true, theme color → token', async () => {
    const { deps, puts } = makeDeps();
    const progress: Array<{ phase: string; detail?: string }> = [];
    const report = await nativizeProject(ctx, deps, (e) => progress.push(e));
    expect(report.pagesTotal).toBe(2); // the already-native page is excluded
    expect(report.pagesNativized).toBe(2);
    expect(report.skipped).toEqual([]);
    expect(puts).toHaveLength(2);
    for (const { raw } of puts) {
      expect(raw.data.swImport.rewritten).toBe(true);
      expect(raw.source).toContain('text-primary'); // brand rgb → token via the theme-derived palette
      expect(raw.source).not.toContain('raw'); // literal source replaced by the nativized output
      expect(raw.source).toContain('src="/media/logo.webp"'); // loopback origin stripped → root-relative
      expect(raw.source).not.toContain('127.0.0.1');
    }
    expect(progress.some((e) => e.phase === 'nativize' && !!e.detail)).toBe(true);
  });

  it('skips a page whose capture throws, without aborting the batch', async () => {
    let n = 0;
    const capture: CaptureFn = async (...args) => { n += 1; if (n === 1) throw new Error('render boom'); return okCapture(...args); };
    const { deps, puts, log } = makeDeps({ capture });
    const report = await nativizeProject(ctx, deps, () => {});
    expect(report.skipped).toHaveLength(1);
    expect(report.pagesNativized).toBe(1);
    expect(puts).toHaveLength(1);
    expect(log.warn).toHaveBeenCalled();
  });

  it('stops between pages when the abort signal fires', async () => {
    const ac = new AbortController();
    const capture: CaptureFn = async (...args) => { ac.abort(); return okCapture(...args); };
    const { deps, puts } = makeDeps({ capture });
    deps.signal = ac.signal;
    const report = await nativizeProject(ctx, deps, () => {});
    expect(report.pagesNativized).toBe(1); // first page completes; the loop breaks before the second
    expect(puts).toHaveLength(1);
  });
});
