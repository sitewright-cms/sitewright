import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BODY_EFFECT_RUNTIMES,
  bodyEffectStyles,
  bodyEffectNoscript,
  previewBodyEffectScripts,
  publishBodyEffectFiles,
} from '../src/publish/effect-runtimes.js';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { RenderPool } from '../src/render/render-pool.js';

const workerPath = fileURLToPath(new URL('./fixtures/blocks-render-worker.mjs', import.meta.url));

// Guards the "preview vs deploy never drift" invariant. The single-page editor preview used to keep a
// hand-maintained runtime list that silently fell behind the publish path (a new engine shipped on
// deploy but not in preview). Both paths now derive from the SHARED registry (effect-runtimes.ts); these
// tests prove the registry is self-consistent AND that both delivery paths actually consume it.

const here = fileURLToPath(import.meta.url);
const read = (rel: string) => readFileSync(join(here, '../../', rel), 'utf8');

// An authored surface that trips EVERY registry runtime's marker at once.
const ALL_MARKERS =
  '<section>' +
  '<div data-sw-animation="fade-up">a</div>' +
  '<div data-sw-parallax-translate="40,-40">p</div>' +
  '<svg viewBox="0 0 10 10" data-sw-svg-scene><path data-sw-svg="draw" d="M0 0 H10" stroke="currentColor" fill="none"/>' +
  '<path data-sw-svg="morph" data-sw-svg-to="M0 0 H10 V10" d="M0 0 H10"/></svg>' +
  '<div data-sw-marquee><span>m</span></div>' +
  '<img data-bg="/x.jpg" alt="" />' +
  '<a class="waves-effect">r</a>' +
  '<div data-sw-cart></div>' +
  '<div data-sw-consent></div>' +
  '</section>';

describe('effect-runtime registry — self-consistency', () => {
  it('every entry has a marker + css, unique keys, and any JS is deliverable via a script', () => {
    const keys = BODY_EFFECT_RUNTIMES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length); // no dup keys
    for (const r of BODY_EFFECT_RUNTIMES) {
      expect(typeof r.uses).toBe('function');
      expect(r.css || r.js, `${r.key} is deliverable (has CSS and/or JS)`).toBeTruthy();
      if (r.js) expect(r.script, `${r.key} JS is shippable (has a script filename)`).toBeTruthy();
    }
  });

  it('classifies marquee (CSS-only) and cart/consent (style-only in preview) correctly', () => {
    const marquee = BODY_EFFECT_RUNTIMES.find((r) => r.key === 'marquee')!;
    expect(marquee.js).toBeUndefined();
    expect(marquee.script).toBeUndefined();
    for (const key of ['cart', 'consent']) {
      expect(BODY_EFFECT_RUNTIMES.find((r) => r.key === key)!.preview).toBe('style-only');
    }
  });

  it('the helpers resolve the full set for an all-markers page, and nothing for a plain one', () => {
    // Every runtime WITH css inlines it in both paths (svg-morph is JS-only).
    expect(bodyEffectStyles(ALL_MARKERS)).toHaveLength(BODY_EFFECT_RUNTIMES.filter((r) => r.css).length);
    // Preview JS = 'run' runtimes that have JS (excludes CSS-only marquee + style-only cart/consent).
    const runWithJs = BODY_EFFECT_RUNTIMES.filter((r) => r.js && (r.preview ?? 'run') === 'run');
    expect(previewBodyEffectScripts(ALL_MARKERS)).toHaveLength(runWithJs.length);
    // Publish files = every runtime with an external script (all except CSS-only marquee).
    expect(publishBodyEffectFiles(ALL_MARKERS)).toHaveLength(BODY_EFFECT_RUNTIMES.filter((r) => r.script).length);
    // No false positives.
    expect(bodyEffectStyles('<p>plain</p>')).toEqual([]);
    expect(previewBodyEffectScripts('<p>plain</p>')).toEqual([]);
  });

  it('emits a single <noscript> un-hide for a first-paint-hiding runtime (svg-anim), nothing otherwise', () => {
    const ns = bodyEffectNoscript(ALL_MARKERS);
    expect(ns).toContain('<noscript><style>');
    expect(ns).toContain('[data-sw-svg]{opacity:1!important;animation:none!important}');
    expect((ns.match(/<noscript>/g) || []).length).toBe(1); // one combined block
    expect(bodyEffectNoscript('<p>plain</p>')).toBe(''); // no hiding runtime → nothing
    expect(bodyEffectNoscript('<div data-sw-animation="fade-up">a</div>')).toBe(''); // entrance is PE-first (no hide)
  });
});

describe('effect-runtime registry — both delivery paths consume it (no hand-list regression)', () => {
  it('the single-page preview (app.ts) derives its runtimes from the registry helpers', () => {
    const app = read('src/http/app.ts');
    expect(app).toContain('bodyEffectStyles(scanHtml)');
    expect(app).toContain('previewBodyEffectScripts(scanHtml)');
    // It must NOT reintroduce a per-runtime hand-list in the preview assembly (the old drift source).
    expect(app).not.toContain('SVG_ANIM_JS');
    expect(app).not.toContain('PARALLAX_JS');
  });

  it('the publish build (build.ts) derives its runtimes from the registry', () => {
    const build = read('src/publish/build.ts');
    expect(build).toContain('BODY_EFFECT_RUNTIMES');
    expect(build).toContain('usedBodyEffects');
    expect(build).not.toContain('SVG_ANIM_SCRIPT'); // the per-runtime SCRIPT consts are gone
  });
});

describe('effect-runtime registry — behavioural parity (publish vs preview)', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'site';
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-parity-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-parity-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot, renderPool: new RenderPool({ size: 1, workerPath }) });
    client = await harness.signup();
    projectId = await client.createProject('Site', slug);
  });
  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('every registry runtime ships on PUBLISH and inlines in the single-page PREVIEW', async () => {
    const proj = client.project(projectId);
    const page = { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source: ALL_MARKERS };
    expect((await proj.putContent('page', 'home', page)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    // PUBLISH: every runtime with a script is linked at the site root.
    const index = (await client.get(`/sites/${slug}/index.html`)).body;
    for (const r of publishBodyEffectFiles(ALL_MARKERS)) {
      expect(index, `publish links ${r.script}`).toContain(`${r.script}?v=`);
    }

    // PREVIEW: the same page inlines every runtime's CSS + the 'run' runtimes' JS (svg draw signature,
    // parallax selector, animation observer). cart/consent are styled but their JS stays inert.
    const preview = ((await client.post(`/projects/${projectId}/preview`, page)).json() as { html: string }).html;
    expect(preview).toContain('transform-box:fill-box'); // svg-anim CSS
    expect(preview).toContain('getTotalLength'); // svg-anim JS (run)
    expect(preview).toContain('[data-sw-parallax-scene]'); // parallax CSS
    expect(preview).toContain('sw-animation-init'); // animation CSS
    // Parity count: the number of run-JS runtimes inlined equals the registry's run-with-JS set.
    const runWithJs = BODY_EFFECT_RUNTIMES.filter((r) => r.js && (r.preview ?? 'run') === 'run');
    expect(previewBodyEffectScripts(ALL_MARKERS)).toHaveLength(runWithJs.length);
  });
});
