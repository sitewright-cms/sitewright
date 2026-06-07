import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FontStore } from '../src/fonts/store.js';

describe('FontStore', () => {
  let root: string;
  let store: FontStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sw-fonts-'));
    store = new FontStore(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes then reads a cached weight, and reports has()', async () => {
    expect(await store.has('playfair-display', '700.woff2')).toBe(false);
    await store.write('playfair-display', '700.woff2', Buffer.from('woff2-bytes'));
    expect(await store.has('playfair-display', '700.woff2')).toBe(true);
    expect((await store.read('playfair-display', '700.woff2')).toString()).toBe('woff2-bytes');
  });

  it('lays the file out at <root>/<fontId>/<weight>.woff2', async () => {
    await store.write('inter', '400.woff2', Buffer.from('x'));
    expect((await readFile(join(root, 'inter', '400.woff2'))).toString()).toBe('x');
  });

  it('read() rejects for an absent weight', async () => {
    await expect(store.read('inter', '900.woff2')).rejects.toBeTruthy();
  });

  it('rejects an invalid font id (charset)', async () => {
    await expect(store.write('../etc', '400.woff2', Buffer.from('x'))).rejects.toThrow(/invalid font id/);
    await expect(store.has('bad id', '400.woff2')).resolves.toBe(false); // has() swallows the throw → false
  });

  it('accepts the supported font formats (woff2/woff/ttf/otf, optional -italic)', async () => {
    for (const file of ['400.woff2', '700.woff', '500-italic.ttf', '900.otf']) {
      await store.write('boombox', file, Buffer.from('x'));
      expect(await store.has('boombox', file)).toBe(true);
    }
  });

  it('rejects an unsupported extension / traversal / bad weight file name', async () => {
    await expect(store.write('inter', '400.exe', Buffer.from('x'))).rejects.toThrow(/invalid font file/);
    await expect(store.write('inter', '../400.woff2', Buffer.from('x'))).rejects.toThrow(/invalid font file/);
    await expect(store.write('inter', '050.woff2', Buffer.from('x'))).rejects.toThrow(/invalid font file/); // weight must be 100–900
  });
});
