import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitFaviconSet } from '../src/publish/favicon-assets.js';
import type { CorporateIdentity, MediaAsset } from '@sitewright/schema';

/**
 * The favicon/PWA set is derived from the single `identity.icon`. The parse that turns that url
 * back into an asset id is the whole risk: it once assumed the LEGACY `/media/<slug>/<id>/<file>`
 * folder layout, so under the current FLAT `/media/<slug>/<id>-<name>` scheme it matched nothing and
 * this function returned undefined — dropping favicon.ico, the apple-touch icon and the manifest on
 * every modern project, invisibly, because the caller's plain <link rel="icon"> still rendered.
 */

const SLUG = 'demo-site';
const IDENTITY = {
  name: 'Demo Site',
  colors: { primary: '#38841f', 'base-100': '#ffffff' },
} as unknown as CorporateIdentity;

const asset = (id: string, original: string): MediaAsset =>
  ({ kind: 'image', id, original, filename: original, url: `/media/${SLUG}/${original}` }) as unknown as MediaAsset;

/** A 64×64 solid-green PNG. Inline rather than generated: `sharp` is a transitive dep here. */
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAZUlEQVR42u3QQR' +
    'EAAAQAME3UEFBvcjh7rMCiOuezECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBA' +
    'gAABAgQIECBAgAABAgQIECBAgAABAu5bhiShtChJEa4AAAAASUVORK5CYII=',
  'base64',
);

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'favicon-test-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const readMedia = async () => png;

describe('emitFaviconSet — icon url parsing', () => {
  it('resolves a FLAT `<id>-<name>` icon url and emits the whole set', async () => {
    const out = await mkdtemp(join(dir, 'flat-'));
    const set = await emitFaviconSet(
      out,
      SLUG,
      { ...IDENTITY, icon: `/media/${SLUG}/3313cQ-forever-elvi-app-icon.png` },
      [asset('3313cQ', '3313cQ-forever-elvi-app-icon.png')],
      readMedia,
    );

    // The regression: this was `undefined` for every flat url, so nothing below ever ran.
    expect(set).toBeDefined();
    expect(set!.ico).toMatch(/^_assets\/_icons\//);
    expect(set!.manifest).toBe('site.webmanifest');

    // The files must actually be on disk, not just named in the returned record.
    for (const rel of [set!.ico, set!.png, set!.apple]) {
      expect((await stat(join(out, rel))).size).toBeGreaterThan(0);
    }
    const manifest = JSON.parse(await readFile(join(out, set!.manifest), 'utf8'));
    expect(manifest.name).toBe('Demo Site');
    expect(manifest.icons).toHaveLength(3);
    expect(manifest.icons.map((i: { purpose: string }) => i.purpose)).toContain('maskable');
  });

  it('still resolves the LEGACY `<id>/<file>` folder url', async () => {
    const out = await mkdtemp(join(dir, 'legacy-'));
    const set = await emitFaviconSet(
      out,
      SLUG,
      { ...IDENTITY, icon: `/media/${SLUG}/ab12CD/icon.png` },
      [asset('ab12CD', 'icon.png')],
      readMedia,
    );
    expect(set).toBeDefined();
  });

  it('ignores a query string on the icon url', async () => {
    const out = await mkdtemp(join(dir, 'query-'));
    const set = await emitFaviconSet(
      out,
      SLUG,
      { ...IDENTITY, icon: `/media/${SLUG}/3313cQ-icon.png?v=99` },
      [asset('3313cQ', '3313cQ-icon.png')],
      readMedia,
    );
    expect(set).toBeDefined();
  });

  it.each([
    ['no icon set', undefined, '3313cQ'],
    ['an external icon', 'https://cdn.example.com/icon.png', '3313cQ'],
    ['an icon whose asset is missing', `/media/${SLUG}/nope-icon.png`, '3313cQ'],
    ['a bare prefix with no file', `/media/${SLUG}/`, '3313cQ'],
  ])('falls back to undefined for %s', async (_label, icon, id) => {
    const out = await mkdtemp(join(dir, 'none-'));
    const set = await emitFaviconSet(
      out,
      SLUG,
      { ...IDENTITY, ...(icon ? { icon } : {}) } as CorporateIdentity,
      [asset(id, `${id}-icon.png`)],
      readMedia,
    );
    expect(set).toBeUndefined();
  });
});
