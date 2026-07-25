import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TEXTURE_NAMES, searchTextures, textureCss, textureUrl, isTextureName } from '../src/index.js';

// The PNG bytes live with the API (served + materialised there); the catalog here is metadata only.
const TEXTURES_DIR = fileURLToPath(new URL('../../../apps/api/assets/textures', import.meta.url));

describe('texture catalog', () => {
  it('has a substantial, unique, lowercase-hyphenated name list', () => {
    expect(TEXTURE_NAMES.length).toBeGreaterThan(300);
    expect(new Set(TEXTURE_NAMES).size).toBe(TEXTURE_NAMES.length);
    for (const n of TEXTURE_NAMES) expect(n, `bad name: ${n}`).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it('every catalog name maps to a committed PNG and vice-versa (no drift)', () => {
    const files = new Set(
      readdirSync(TEXTURES_DIR)
        .filter((f) => f.endsWith('.png'))
        .map((f) => f.slice(0, -4)),
    );
    for (const n of TEXTURE_NAMES) expect(files.has(n), `catalog name without a PNG: ${n}`).toBe(true);
    expect(files.size, 'a PNG exists without a catalog entry — run gen:textures').toBe(TEXTURE_NAMES.length);
  });

  it('isTextureName allowlists real names only (path-traversal guard for the serving route)', () => {
    expect(isTextureName(TEXTURE_NAMES[0] as string)).toBe(true);
    expect(isTextureName('../../etc/passwd')).toBe(false);
    expect(isTextureName('not-a-real-texture')).toBe(false);
  });

  it('textureUrl + textureCss emit the served URL and a CI-tinted overlay snippet', () => {
    const name = 'cartographer';
    expect(isTextureName(name)).toBe(true);
    expect(textureUrl(name)).toBe('/authoring/textures/cartographer.png');
    const css = textureCss(name);
    expect(css).toContain('background-color: var(--sw-color-primary);');
    expect(css).toContain('background-image: url("/authoring/textures/cartographer.png");');
    expect(css).toContain('background-repeat: repeat;');
    expect(textureCss(name, '#123456')).toContain('background-color: #123456;');
  });

  it('searchTextures — per-term groups, matches names/tokens, honours limit, blank → []', () => {
    const groups = searchTextures('fabric, paper', 3);
    expect(groups.map((g) => g.term)).toEqual(['fabric', 'paper']);
    for (const g of groups) {
      expect(g.matches.length, `no matches for ${g.term}`).toBeGreaterThan(0);
      expect(g.matches.length).toBeLessThanOrEqual(3);
      for (const m of g.matches) expect(m).toContain(g.term); // every match's name contains the term
    }
    expect(searchTextures('')).toEqual([]);
    expect(searchTextures('   ')).toEqual([]);
    // an exact name is the top hit for its own term
    expect(searchTextures('cartographer', 5)[0]?.matches[0]).toBe('cartographer');
  });
});
