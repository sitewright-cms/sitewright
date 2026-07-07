import { describe, expect, it, vi } from 'vitest';
import { nativizeProject, bodyBgCss, buildTypography, resolveFonts, detectContainerWidth, type CaptureFn, type NativizeDeps } from '../src/render/nativize-project.js';
import type { ProjectContext } from '../src/repo/context.js';
import type { BodyBackground } from '../src/render/nativize-capture.js';
import type { CapturedNode } from '@sitewright/site-import';
import { SLOT_MAX } from '@sitewright/schema';

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
const okCapture: CaptureFn = async () => ({
  base: tree(), md: tree(), lg: tree(),
  bodyBg: { image: 'url("http://127.0.0.1/media/bg.webp")', color: 'rgba(0, 0, 0, 0)', htmlColor: 'rgba(0, 0, 0, 0)', size: 'auto', position: '0% 0%', repeat: 'repeat', attachment: 'scroll', bodyFont: 'text-font, sans-serif', headingFont: 'primary-font, sans-serif' },
});

interface DepOverrides {
  pages?: unknown[];
  capture?: CaptureFn;
  entries?: unknown[];
  datasets?: unknown[];
  failSettingsPut?: boolean; // simulate a rejected settings write (e.g. an unexpected DB error)
}
function makeDeps(o: DepOverrides = {}) {
  const pages = o.pages ?? [
    { id: 'home', path: '', title: 'Home', source: '<div>raw</div>', status: 'draft', data: { swImport: { sourceUrl: 'https://www.example.com/', rewritten: false } } },
    { id: 'about', path: 'about', title: 'About', source: '<div>raw</div>', status: 'draft', data: { swImport: { sourceUrl: 'https://www.example.com/about', rewritten: false } } },
    { id: 'native', path: 'x', title: 'X', source: '<div>done</div>', status: 'published', data: {} }, // NOT rawFidelity → excluded
  ];
  const settings = {
    identity: { colors: { primary: '#0b4a77' }, logo: '/media/logo.png' },
    website: { head: '<link rel="stylesheet" href="/media/import.css">', scripts: '<script src="/media/foreign.js"></script>', mainNav: '<div><a href="/a">A</a></div>', footer: '<div class="rgba-black-strong">Foreign footer</div>', sidebarLeft: '<div id="facebook-page"><iframe src="https://www.facebook.com/plugins/page.php?href=https%3A%2F%2Fwww.facebook.com%2Facme%2F&tabs=timeline"></iframe></div>' },
  };
  const pagePuts: Array<{ id: string; raw: { status: string; source: string; data: { swImport: { rewritten: boolean } } } }> = [];
  let settingsPut: { website: { head: string; scripts: string; mainNav: string; footer: string; criticalCss?: string; sidebarLeft?: string; bottom?: string }; identity?: { typography?: { heading?: { assetId?: string; family?: string }; body?: { assetId?: string } } } } | null = null;
  const entries = o.entries ?? [];
  const datasets = (o as { datasets?: unknown[] }).datasets ?? [];
  const fonts = [{ id: 'f-primary', kind: 'font', family: 'primary-font' }, { id: 'f-text', kind: 'font', family: 'text-font' }];
  const renderContexts: unknown[] = [];
  const removed: Array<{ kind: string; id: string }> = [];
  const contentRepo = {
    get: vi.fn(async () => settings),
    list: vi.fn(async (_c: unknown, kind: string) => (kind === 'entry' ? entries : kind === 'media' ? fonts : kind === 'dataset' ? datasets : pages)),
    put: vi.fn(async (_c: unknown, kind: string, id: string, raw: unknown) => {
      if (kind === 'settings') { if (o.failSettingsPut) throw new Error('settings write boom'); settingsPut = raw as never; }
      else if (kind === 'page') pagePuts.push({ id, raw: raw as never });
      return raw;
    }),
    remove: vi.fn(async (_c: unknown, kind: string, id: string) => { removed.push({ kind, id }); }),
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

  it('extracts a cross-page TEMPLATE from same-parent pages sharing a structure (+ folds the loop to page.data)', async () => {
    const svcSrc = (title: string): string =>
      `<section class="hero"><h1>${title}</h1></section><section class="intro"><p>one</p><p>two</p></section>` +
      `<div class="proj"><h2>Projects</h2>{{#each dataset.svc}}<div class="row"><span>{{title}}</span></div>{{/each}}</div>` +
      `<div class="cta"><a href="/apply">Apply</a></div>`;
    const svc = (id: string, title: string) => ({ id, path: id, parent: 'svc', title, status: 'published', source: svcSrc(title), data: { swImport: { sourceUrl: `https://x/${id}`, rewritten: true } } });
    const { deps, pagePuts } = makeDeps({
      pages: [
        { id: 'home', path: '', title: 'Home', source: '<div>raw</div>', status: 'draft', data: { swImport: { sourceUrl: 'https://x/', rewritten: false } } },
        svc('a', 'Alpha'), svc('b', 'Beta'), svc('c', 'Gamma'),
      ],
      entries: [{ id: 'e1', dataset: 'svc', status: 'published', order: 0, values: { title: 'P1' } }],
      datasets: [{ id: 'svc', name: 'Svc', slug: 'svc', fields: [{ name: 'title', type: 'text', required: false, localized: false }] }],
    });
    await nativizeProject(ctx, deps, () => {});
    const templated = pagePuts.filter((p) => (p.raw as { template?: string }).template === 'page-template-1');
    expect(templated.map((p) => p.id).sort()).toEqual(['a', 'b', 'c']); // the 3 same-structure siblings share one template
    for (const p of templated) {
      expect((p.raw as { source: string }).source).toBe(''); // the template provides the source
      expect((p.raw as { data: { projects?: unknown[] } }).data.projects).toEqual([{ title: 'P1' }]); // loop folded into page.data
    }
  });

  it('rebuilds the chrome once the whole site is native: nav loop + foreign CSS/JS dropped', async () => {
    const { deps, getSettingsPut } = makeDeps();
    const report = await nativizeProject(ctx, deps, () => {});
    expect(report.chromeRebuilt).toBe(true);
    const w = getSettingsPut()!.website;
    expect(w.mainNav).toContain('{{#each nav.header}}'); // #6 data-driven nav
    expect(w.mainNav).not.toContain('href="/a"'); // the imported hard-coded link is gone
    expect(w.mainNav).toContain('{{company.name}}'); // nav shows the company name
    expect(w.mainNav).toContain('{{company.slogan}}'); // …and the slogan
    expect(w.mainNav).toContain('peer-checked'); // mobile = a CSS drawer (sidebar), not a dropdown
    expect(w.mainNav).toContain('bg-base-100'); // nav bar is solid white (page-bg texture must not show through)
    expect(w.sidebarLeft).toBe(''); // the Facebook widget is moved OUT of the in-flow sidebar
    expect(w.bottom).toMatch(/fixed left-0[^"]*facebook|facebook[\s\S]*fixed left-0|href="https:\/\/www\.facebook\.com\/acme/i); // …into a fixed edge-tab in bottom
    expect(w.criticalCss).toContain('background-image:url("/media/bg.webp")'); // page background (loopback stripped)
    expect(w.criticalCss).toContain('background-color:#ffffff'); // white base behind a semi-transparent texture (no black)
    expect(w.criticalCss).toContain('body{'); // applied site-wide
    const typo = getSettingsPut()!.identity!.typography!; // fonts matched to hosted assets
    expect(typo.heading).toMatchObject({ assetId: 'f-primary', family: 'primary-font' });
    expect(typo.body).toMatchObject({ assetId: 'f-text' });
    expect(w.head).not.toMatch(/<link[^>]+stylesheet/i); // #5 foreign stylesheet dropped
    expect(w.scripts).toBe(''); // #5 foreign JS dropped
    expect(w.mainNav).toContain('sw-nav-drawer'); // the rebuilt navbar is a self-contained responsive bar
    expect(w.footer).toContain('text-primary'); // footer nativized (foreign classes → platform tokens)
    expect(w.footer).not.toContain('rgba-black-strong'); // foreign footer class gone
  });

  it('skips the global-modal hoist when the deduped modals would overflow the bottom slot cap (kept per-page)', async () => {
    // A modal (isModal + id) whose nativized HTML exceeds SLOT_MAX, present on BOTH pages → hoistGlobalModals
    // would dedupe it into website.bottom and overflow the slot cap. The nativize must NOT throw on the
    // settings write — it skips the hoist (each page keeps its own modal) and still completes. Footer capture
    // stays small (differentiated by doc content) so only the PAGE bottom would overflow. Sized off SLOT_MAX
    // so it stays over-cap regardless of the exact cap value.
    const bigModal = (): CapturedNode[] => [
      { tag: 'div', s: {}, isModal: true, id: 'huge-modal', children: [{ tag: 'p', s: {}, text: 'x'.repeat(SLOT_MAX + 10_000), children: [] }] },
    ];
    const capture: CaptureFn = async (doc, opts) => (doc.includes('Foreign footer')
      ? okCapture(doc, opts) // the footer fragment stays small
      : { base: bigModal(), md: bigModal(), lg: bigModal(), bodyBg: undefined });
    const { deps, getSettingsPut, log, pagePuts } = makeDeps({ capture });
    const report = await nativizeProject(ctx, deps, () => {}); // must NOT throw
    expect(report.pagesNativized).toBe(2);
    expect(report.chromeRebuilt).toBe(true); // chrome still rebuilt — the settings write did not overflow
    const w = getSettingsPut()!.website;
    expect((w.bottom ?? '').length).toBeLessThanOrEqual(SLOT_MAX); // bottom stays within the slot cap
    expect(w.bottom ?? '').not.toContain('huge-modal'); // the oversized modal was NOT hoisted into bottom
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ bottomLen: expect.any(Number) }),
      expect.stringContaining('hoist skipped'),
    );
    // Hoist skipped → NO strip write ran, so every non-empty page source still holds its modal (a strip write
    // would be a non-empty source WITHOUT the modal; a later template-extraction write is empty → excluded).
    const written = pagePuts.filter((p) => p.raw.source !== '');
    expect(written.length).toBeGreaterThanOrEqual(2);
    expect(written.every((p) => p.raw.source.includes('huge-modal'))).toBe(true); // nothing was stripped/lost
  });

  it('does NOT strip modals from pages when the chrome settings write fails (write-first, strip-after)', async () => {
    // A modal small enough to hoist (hoistFits=true). If the settings write then throws, the per-page STRIP
    // must not have run yet — else the modal would be gone from the pages AND never written to `bottom` (loss).
    const smallModal = (): CapturedNode[] => [
      { tag: 'div', s: {}, isModal: true, id: 'm1', children: [{ tag: 'p', s: {}, text: 'hello modal', children: [] }] },
    ];
    const capture: CaptureFn = async (doc, opts) => (doc.includes('Foreign footer')
      ? okCapture(doc, opts)
      : { base: smallModal(), md: smallModal(), lg: smallModal(), bodyBg: undefined });
    const { deps, pagePuts } = makeDeps({ capture, failSettingsPut: true });
    await expect(nativizeProject(ctx, deps, () => {})).rejects.toThrow(); // the genuine write error surfaces
    expect(pagePuts.length).toBe(2); // only the per-page nativize writes — NO extra strip writes ran
    expect(pagePuts.every((p) => p.raw.source.includes('id="m1"'))).toBe(true); // every page still holds its modal
  });

  it('keeps the foreign CSS when the footer cannot be nativized (so it stays styled)', async () => {
    // Capture throws ONLY for the footer fragment (its rendered body carries the foreign footer class).
    const capture: CaptureFn = async (doc, opts) => {
      if (doc.includes('rgba-black-strong')) throw new Error('footer capture boom');
      return okCapture(doc, opts);
    };
    const { deps, getSettingsPut } = makeDeps({ capture });
    const report = await nativizeProject(ctx, deps, () => {});
    expect(report.pagesNativized).toBe(2); // pages still nativized fine
    expect(report.chromeRebuilt).toBe(false); // footer failed → not a full chrome transition
    const w = getSettingsPut()!.website;
    expect(w.mainNav).toContain('{{#each nav.header}}'); // nav still rebuilt (platform classes)
    expect(w.head).toMatch(/<link[^>]+stylesheet/i); // foreign CSS KEPT so the un-nativized footer stays styled
    expect(w.footer).toContain('rgba-black-strong'); // original footer kept
  });

  it('skips a page whose capture throws, and does NOT rebuild chrome (a rawFidelity page remains)', async () => {
    let n = 0;
    // n===1 is the up-front FONT pre-capture (best-effort); make a LOOP page's capture throw (n===2).
    const capture: CaptureFn = async (...args) => { n += 1; if (n === 2) throw new Error('render boom'); return okCapture(...args); };
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
    // n===1 is the up-front font pre-capture; abort from the 2nd call so the abort lands DURING the loop.
    let n = 0;
    const capture: CaptureFn = async (...args) => { n += 1; if (n >= 2) ac.abort(); return okCapture(...args); };
    const { deps } = makeDeps({ pages, capture });
    deps.signal = ac.signal;
    const report = await nativizeProject(ctx, deps, () => {});
    expect(report.pagesTotal).toBe(6);
    expect(report.pagesNativized).toBeGreaterThanOrEqual(1); // the in-flight pages complete
    expect(report.pagesNativized).toBeLessThan(6); // …but the tail is skipped once aborted
    expect(report.chromeRebuilt).toBe(false); // not all native → chrome untouched
  });
});

const LOOPBACK = /http:\/\/127\.0\.0\.1(:\d+)?/g;
const bg = (o: Partial<BodyBackground>): BodyBackground => ({ image: 'none', color: 'rgba(0, 0, 0, 0)', htmlColor: 'rgba(0, 0, 0, 0)', size: 'auto', position: '0% 0%', repeat: 'repeat', attachment: 'scroll', bodyFont: '', headingFont: '', ...o });

describe('bodyBgCss', () => {
  it('returns empty for no background / no image and transparent colors', () => {
    expect(bodyBgCss(undefined, LOOPBACK)).toBe('');
    expect(bodyBgCss(bg({}), LOOPBACK)).toBe(''); // image:none + transparent → nothing
  });
  it('uses an opaque body color, else the html color', () => {
    expect(bodyBgCss(bg({ color: 'rgb(20, 30, 40)' }), LOOPBACK)).toBe('body{background-color:rgb(20, 30, 40)}');
    expect(bodyBgCss(bg({ htmlColor: 'rgb(250, 250, 250)' }), LOOPBACK)).toBe('body{background-color:rgb(250, 250, 250)}');
  });
  it('adds a WHITE base behind a url() image (loopback stripped, first layer only)', () => {
    const css = bodyBgCss(bg({ image: 'url("http://127.0.0.1:80/media/x.webp"), url("http://127.0.0.1/y.webp")' }), LOOPBACK);
    expect(css).toContain('background-color:#ffffff');
    expect(css).toContain('background-image:url("/media/x.webp")');
    expect(css).not.toContain('y.webp'); // only the first layer
  });
  it('keeps a gradient image WHOLE (no comma truncation)', () => {
    const css = bodyBgCss(bg({ image: 'linear-gradient(to right, #fff, #000)', color: 'rgb(1, 2, 3)' }), LOOPBACK);
    expect(css).toContain('background-image:linear-gradient(to right, #fff, #000)');
  });
  it('drops a data: URI image', () => {
    expect(bodyBgCss(bg({ image: 'url("data:image/png;base64,AAAA")' }), LOOPBACK)).toBe('');
  });
});

describe('buildTypography', () => {
  const fonts = [{ id: 'fh', family: 'primary-font' }, { id: 'fb', family: 'text-font' }];
  it('returns undefined without bodyBg or fonts', () => {
    expect(buildTypography(undefined, fonts)).toBeUndefined();
    expect(buildTypography(bg({ headingFont: 'primary-font' }), [])).toBeUndefined();
  });
  it('matches heading + body fonts to hosted assets', () => {
    const t = buildTypography(bg({ headingFont: '"primary-font", sans-serif', bodyFont: 'text-font' }), fonts)!;
    expect(t.heading).toMatchObject({ source: 'asset', family: 'primary-font', assetId: 'fh', weight: 700 });
    expect(t.body).toMatchObject({ source: 'asset', family: 'text-font', assetId: 'fb', weight: 400 });
  });
  it('returns undefined when no captured font matches a hosted asset', () => {
    expect(buildTypography(bg({ headingFont: 'Arial', bodyFont: 'Georgia' }), fonts)).toBeUndefined();
  });
});

describe('resolveFonts', () => {
  const fonts = [
    { id: 'fh', family: 'primary-font' },
    { id: 'fb', family: 'text-font' },
    { id: 'fs', family: 'display-font' },
  ];

  it('returns heading/body typography + a palette map for the per-element font utilities', () => {
    const { typography, paletteFonts } = resolveFonts(bg({ headingFont: '"primary-font", serif', bodyFont: 'text-font' }), fonts);
    expect(typography!.heading).toMatchObject({ assetId: 'fh', weight: 700 });
    expect(typography!.body).toMatchObject({ assetId: 'fb', weight: 400 });
    // palette maps each captured family → its font-<slot> utility (what tailwind.ts assigns per element).
    expect(paletteFonts).toContainEqual(['primary-font', 'font-heading']);
    expect(paletteFonts).toContainEqual(['text-font', 'font-body']);
  });

  it('captures an extra distinct face (a display-font button) into a NAMED slot + palette entry', () => {
    const { typography, paletteFonts } = resolveFonts(
      bg({ headingFont: 'primary-font', bodyFont: 'text-font', fonts: ['text-font', '"display-font", sans-serif', 'primary-font'] }),
      fonts,
    );
    expect((typography!.named as Record<string, unknown>).secondary).toMatchObject({ assetId: 'fs', weight: 400 });
    expect(paletteFonts).toContainEqual(['display-font', 'font-secondary']); // so a button in display-font gets font-secondary
  });

  it('does not duplicate the heading/body face into a named slot (dedup by assetId)', () => {
    const { typography } = resolveFonts(
      bg({ headingFont: 'primary-font', bodyFont: 'text-font', fonts: ['primary-font', 'text-font'] }),
      fonts,
    );
    expect(typography!.named).toBeUndefined(); // both distinct fonts are already heading/body
  });

  it('empty result (no bodyBg / no fonts) yields an empty palette', () => {
    expect(resolveFonts(undefined, fonts)).toEqual({ paletteFonts: [] });
    expect(resolveFonts(bg({ headingFont: 'primary-font' }), [])).toEqual({ paletteFonts: [] });
  });

  it('orders paletteFonts longest-key-first so a prefix family cannot steal a sibling match', () => {
    // "Roboto" ⊂ "Roboto Condensed": tailwind.ts matches by ff.includes(k), first wins → the more specific
    // family MUST come first, else an element in "Roboto Condensed" would wrongly get font-heading.
    const sib = [
      { id: 'rh', family: 'Roboto' },
      { id: 'rc', family: 'Roboto Condensed' },
    ];
    const { paletteFonts } = resolveFonts(
      bg({ headingFont: 'Roboto', bodyFont: 'Roboto', fonts: ['"Roboto Condensed", sans-serif', 'Roboto'] }),
      sib,
    );
    // "Roboto Condensed" (16) must appear before "Roboto" (6) in the ordered map.
    const idxCondensed = paletteFonts.findIndex(([k]) => k === 'Roboto Condensed');
    const idxRoboto = paletteFonts.findIndex(([k]) => k === 'Roboto');
    expect(idxCondensed).toBeGreaterThanOrEqual(0);
    expect(idxCondensed).toBeLessThan(idxRoboto);
    // and an element rendered in "Roboto Condensed" resolves to font-secondary (first .includes hit).
    const ff = '"Roboto Condensed", sans-serif';
    expect(paletteFonts.find(([k]) => ff.includes(k))![1]).toBe('font-secondary');
  });
});

describe('detectContainerWidth', () => {
  const node = (s: Record<string, string>, children: CapturedNode[] = []): CapturedNode => ({ tag: 'div', s, children } as CapturedNode);
  it('finds the largest centered wide block (recursing into children)', () => {
    const trees = [node({ width: '100%' }, [
      node({ width: '1120px', 'margin-left': '140px', 'margin-right': '140px' }, [node({ width: '50px' }, [])]),
      node({ width: '1400px', 'margin-left': '68px', 'margin-right': '68px' }, [node({ width: '10px' }, [])]),
    ])];
    expect(detectContainerWidth(trees)).toBe(1400);
  });
  it('ignores non-centered / too-narrow / childless blocks', () => {
    expect(detectContainerWidth([node({ width: '1400px', 'margin-left': '0px', 'margin-right': '0px' }, [node({}, [])])])).toBeUndefined(); // not centered
    expect(detectContainerWidth([node({ width: '400px', 'margin-left': '50px', 'margin-right': '50px' }, [node({}, [])])])).toBeUndefined(); // too narrow
    expect(detectContainerWidth([node({ width: '1400px', 'margin-left': '68px', 'margin-right': '68px' }, [])])).toBeUndefined(); // no children
  });
});
