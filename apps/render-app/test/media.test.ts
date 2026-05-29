import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMediaManifest } from '../src/lib/media.js';

let tmp = '';
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'sw-media-'));
});
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('loadMediaManifest', () => {
  it('returns an empty manifest when the file is absent', () => {
    expect(loadMediaManifest(join(tmp, 'missing.json'))).toEqual({});
  });

  it('parses and validates a well-formed manifest', async () => {
    const file = join(tmp, 'ok.json');
    await writeFile(
      file,
      JSON.stringify({
        'hero.png': {
          width: 1600,
          height: 900,
          placeholder: 'data:image/webp;base64,AAAA',
          variants: [{ format: 'webp', width: 800, height: 450, path: 'hero-800.webp' }],
          fallback: 'hero-1200.jpg',
          dir: '/_sw-media/hero/',
        },
      }),
    );
    const manifest = loadMediaManifest(file);
    expect(manifest['hero.png']?.variants[0]?.path).toBe('hero-800.webp');
  });

  it('throws on a malformed manifest (e.g. a path-traversal dir)', async () => {
    const file = join(tmp, 'bad.json');
    await writeFile(file, JSON.stringify({ 'x.png': { dir: '/_sw-media/../../etc/' } }));
    expect(() => loadMediaManifest(file)).toThrow();
  });
});
