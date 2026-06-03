import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublishStore } from '../src/publish/store.js';

let root: string;
let store: PublishStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sw-sites-'));
  store = new PublishStore(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('PublishStore HTML serving', () => {
  it('serves a real published page', async () => {
    const dir = store.dirFor('site');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), '<h1>home</h1>');
    expect(await store.readHtml('site', '/')).toContain('home');
  });

  it('refuses to serve a copied asset under media/ as inline HTML (stored-XSS guard)', async () => {
    const dir = store.dirFor('site');
    await mkdir(join(dir, 'media', 'asset1'), { recursive: true });
    // A raw user file named report.html lands in the exported artifact's media dir…
    await writeFile(join(dir, 'media', 'asset1', 'report.html'), '<script>steal()</script>');
    // …but the /sites serving path must NOT render it as HTML on this origin.
    expect(() => store.resolveHtml('site', '/media/asset1/report.html')).toThrow(/media path/);
    expect(await store.readHtml('site', '/media/asset1/report.html')).toBeNull();
  });

  it('still rejects traversal segments', () => {
    expect(() => store.resolveHtml('site', '/../../etc/passwd.html')).toThrow();
  });
});
