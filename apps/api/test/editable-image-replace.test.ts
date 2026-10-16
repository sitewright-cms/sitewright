import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { ProjectBundle } from '@sitewright/core';
import type { MediaAsset } from '@sitewright/schema';
import { renderTrustedSvgToPng } from '@sitewright/image-pipeline';
import { buildSite } from '../src/publish/build.js';
import { assetAlias } from '../src/publish/asset-alias.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { RenderPool } from '../src/render/render-pool.js';
import { makeTestDb } from './helpers.js';
import { makePng } from './png.js';

// ★ A REPLACED editable {{sw-image}} must stay as responsive as the one it replaced, on BOTH surfaces.
//
// The directive pass rebuilds the replacement's `?size=` rungs (packages/blocks) from the render
// context's media list — which each surface has to hand it. PUBLISH then has to find every rung in the
// rendered HTML, rewrite it to a flat `_assets/` file and generate that file, since a static host can
// serve none of them; the publish tests check the page against the disk — every referenced variant
// exists, and nothing still points at the photo that was replaced.

type ImageAsset = Extract<MediaAsset, { kind: 'image' }>;

function photo(id: string, name: string, width: number, height: number): ImageAsset {
  return {
    kind: 'image',
    id,
    folder: '',
    filename: name,
    format: 'png',
    bytes: 1,
    width,
    height,
    hasAlpha: false,
    animated: false,
    original: name,
    url: `/media/acme/${id}-${name}`,
    placeholder: 'data:image/webp;base64,UklGRg==',
  };
}

const OLD = photo('a1', 'old.png', 800, 400); // what the template was written with
const NEW = photo('b2', 'new.png', 1200, 600); // what the site owner picked in the editor
const oldAlias = assetAlias(OLD.id);
const newAlias = assetAlias(NEW.id);

let outDir = '';
const originals = new Map<string, Buffer>();

/** Publish one page whose source is `source`, with `data` as its page.data, and return its HTML. */
async function publish(source: string, data: Record<string, unknown>, avif = false): Promise<string> {
  await buildSite({
    publishedAt: '2026-10-16T00:00:00.000Z',
    outDir,
    media: [OLD, NEW],
    // A COLD store: only the originals exist, so every referenced variant has to be generated here.
    readMedia: async (id, file) => {
      const asset = [OLD, NEW].find((a) => a.id === id);
      const png = originals.get(id);
      if (asset && png && file === asset.original) return png;
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    },
    bundle: {
      project: {
        formatVersion: 2 as const,
        id: 'p',
        name: 'Acme',
        slug: 'acme',
        identity: { name: 'Acme', colors: { primary: '#0a7' } },
        settings: { defaultLocale: 'en', locales: ['en'] },
        ...(avif ? { website: { imageDelivery: 'avif' } } : {}),
      },
      pages: [{ id: 'home', path: '', title: 'Home', source, data }],
      datasets: [],
      entries: [],
    } as unknown as ProjectBundle,
  });
  return readFile(join(outDir, 'index.html'), 'utf8');
}

/** Every flat media file the page references (`_assets/<alias>-…`, not the platform's `_assets/_sw/…`). */
function mediaRefs(html: string): string[] {
  return [...new Set([...html.matchAll(/_assets\/([A-Za-z0-9][A-Za-z0-9_.-]*)/g)].map((m) => m[1]!))];
}

const HERO = '<section>{{sw-image "/media/acme/a1-old.png" editable="hero" alt="Hero" sizes="50vw"}}</section>';

describe('publish — a replaced editable {{sw-image}}', () => {
  beforeAll(async () => {
    for (const a of [OLD, NEW]) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${a.width}" height="${a.height}"><rect width="${a.width}" height="${a.height}" fill="#0a7"/></svg>`;
      originals.set(a.id, await renderTrustedSvgToPng(svg, a.width, a.height));
    }
  });
  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'sw-editable-img-'));
  });
  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it('ships the NEW asset’s srcset rungs as materialized files, with no dangling or stale refs', async () => {
    const home = await publish(HERO, { hero: NEW.url });
    // The rungs of the 1200px replacement: sm, md, and lg clamped to the source (no upscale).
    expect(home).toContain(
      `srcset="_assets/${newAlias}-new-sm.webp 500w, _assets/${newAlias}-new-md.webp 1000w, _assets/${newAlias}-new-lg.webp 1200w"`,
    );
    expect(home).toContain(`src="_assets/${newAlias}-new-lg.webp"`);
    expect(home).toContain('width="1200" height="600"'); // the replacement's aspect, not the 800×400 original
    expect(home).toContain('sizes="50vw"');
    expect(home).toContain("background-image:url('data:image/webp;base64,UklGRg==')");
    expect(home).not.toContain('data-sw-src'); // the marker never ships

    // Every referenced media file is on disk — and only the replacement's are referenced.
    const refs = mediaRefs(home);
    expect(refs).toEqual(
      expect.arrayContaining([`${newAlias}-new-sm.webp`, `${newAlias}-new-md.webp`, `${newAlias}-new-lg.webp`]),
    );
    for (const ref of refs) expect(existsSync(join(outDir, '_assets', ref)), ref).toBe(true);
    expect(refs.some((r) => r.startsWith(`${oldAlias}-`))).toBe(false);
    expect(home).not.toContain('/media/acme/');
    expect(home).not.toContain('?size=');
  });

  it('AVIF delivery: rebuilds the <picture> sources and generates their .avif rungs too', async () => {
    const home = await publish(HERO, { hero: NEW.url }, true);
    expect(home).toContain(
      `<source type="image/avif" srcset="_assets/${newAlias}-new-sm.avif 500w, _assets/${newAlias}-new-md.avif 1000w, _assets/${newAlias}-new-lg.avif 1200w"`,
    );
    expect(home).toContain(`<source type="image/webp" srcset="_assets/${newAlias}-new-sm.webp 500w,`);
    const refs = mediaRefs(home);
    expect(refs).toEqual(expect.arrayContaining([`${newAlias}-new-sm.avif`, `${newAlias}-new-lg.avif`]));
    for (const ref of refs) expect(existsSync(join(outDir, '_assets', ref)), ref).toBe(true);
    expect(refs.some((r) => r.startsWith(`${oldAlias}-`))).toBe(false);
    // The serializer writes the AVIF query's `&` as `&amp;`; none of it may survive the rewrite.
    expect(home).not.toContain('format=avif');
    expect(home).not.toContain('?size=');
  });

  it('AVIF delivery: an UNEDITED editable image on a directive page ships valid .avif sources too', async () => {
    // Any data-sw-* on the page sends the whole fragment through the directive pass's parse→serialize,
    // which is what turns `&format=avif` into `&amp;format=avif` — with or without an override.
    const home = await publish(HERO, {}, true);
    expect(home).toContain(`<source type="image/avif" srcset="_assets/${oldAlias}-old-sm.avif 500w, _assets/${oldAlias}-old-md.avif 800w"`);
    for (const ref of mediaRefs(home)) expect(existsSync(join(outDir, '_assets', ref)), ref).toBe(true);
    expect(home).not.toContain('format=avif');
  });
});

describe('preview — a replaced editable {{sw-image}}', () => {
  // The editor's "Replace image" stores the picked asset's bare url in page.data and re-POSTs the draft,
  // so the new art reaches the iframe through THIS server render — the bridge never patches an <img>.
  // The preview route must therefore hand the directive pass the media list, as publish does.
  const workerPath = fileURLToPath(new URL('./fixtures/blocks-render-worker.mjs', import.meta.url));
  let app: FastifyInstance;
  let db: Awaited<ReturnType<typeof makeTestDb>>;
  let mediaRoot = '';

  beforeEach(async () => {
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-editable-img-media-'));
    db = await makeTestDb();
    app = await createApp({ db, mediaRoot, renderPool: new RenderPool({ size: 1, workerPath }) });
    await app.ready();
  });
  afterEach(async () => {
    await app.close(); // drains + terminates the render worker
    await rm(mediaRoot, { recursive: true, force: true });
  });

  async function upload(projectId: string, t: string, name: string, png: Buffer): Promise<{ url: string }> {
    const boundary = 'SWEDITABLEIMG';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n`),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/media`,
      cookies: { sw_session: t },
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { item: { url: string } }).item;
  }

  it('re-renders the replacement with its own srcset and dimensions', async () => {
    await registerAccount(db, 'img@acme.test', 'Pw-secret-1', { platformRole: 'developer' });
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'img@acme.test', password: 'Pw-secret-1' } });
    const t = login.cookies.find((c) => c.name === 'sw_session')!.value;
    const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Site', slug: 'site' } });
    const projectId = (proj.json() as { project: { id: string } }).project.id;
    const oldImg = await upload(projectId, t, 'old.png', makePng(800, 400, [10, 120, 90]));
    const newImg = await upload(projectId, t, 'new.png', makePng(1200, 600, [200, 30, 30]));

    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/preview`,
      cookies: { sw_session: t },
      payload: {
        id: 'home', path: '', title: 'Home',
        source: `<section>{{sw-image "${oldImg.url}" editable="hero" sizes="50vw"}}</section>`,
        data: { hero: newImg.url },
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    const { html } = res.json() as { html: string };
    expect(html).toContain(`srcset="${newImg.url}?size=sm 500w, ${newImg.url}?size=md 1000w, ${newImg.url}?size=lg 1200w"`);
    expect(html).toContain('width="1200" height="600"');
    expect(html).toContain('data-sw-src="hero"'); // still click-to-replace in the editor
    expect(html).not.toContain(oldImg.url);
  });
});
