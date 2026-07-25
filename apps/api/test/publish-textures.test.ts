import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rewriteTextureUrls, materializeTextures } from '../src/publish/publish-textures.js';

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'sw-tex-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('rewriteTextureUrls', () => {
  it('rebases a known texture url to a page-relative _assets/_textures path and records it', () => {
    const used = new Set<string>();
    const out = rewriteTextureUrls(
      `<section style="background-image:url('/authoring/textures/cartographer.png')"></section>`,
      '',
      used,
    );
    expect(out).toContain(`url('_assets/_textures/cartographer.png')`);
    expect(out).not.toContain('/authoring/textures/');
    expect([...used]).toEqual(['cartographer']);
  });

  it('applies siteRoot depth for a nested page and dedups repeated references', () => {
    const used = new Set<string>();
    const out = rewriteTextureUrls(
      `a url(/authoring/textures/paper.png) b url("/authoring/textures/paper.png")`,
      '../../',
      used,
    );
    expect(out).toContain('../../_assets/_textures/paper.png');
    expect(out).not.toContain('/authoring/textures/');
    expect([...used]).toEqual(['paper']); // one entry despite two references
  });

  it('leaves an unknown / non-catalog texture name untouched and does not record it', () => {
    const used = new Set<string>();
    const out = rewriteTextureUrls(
      `url(/authoring/textures/definitely-not-real.png) url(/authoring/textures/cartographer.png)`,
      '',
      used,
    );
    expect(out).toContain('/authoring/textures/definitely-not-real.png'); // untouched (not a catalog name)
    expect(out).toContain('_assets/_textures/cartographer.png'); // the real one is rebased
    expect([...used]).toEqual(['cartographer']);
  });
});

describe('materializeTextures', () => {
  it('copies only referenced catalog PNGs; skips an unknown name; no-op when nothing referenced', async () => {
    expect(await materializeTextures(tmp, new Set())).toBe(0); // early return — nothing written

    const bytes = await materializeTextures(tmp, new Set(['cartographer', 'definitely-not-real']));
    expect(bytes).toBeGreaterThan(0);
    const files = await readdir(join(tmp, '_assets', '_textures'));
    expect(files).toEqual(['cartographer.png']); // the unknown name → readTexture null → skipped
    const png = await readFile(join(tmp, '_assets', '_textures', 'cartographer.png'));
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic
  });
});
