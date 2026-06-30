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

  it('refuses to serve a copied asset under _assets/ as inline HTML (stored-XSS guard)', async () => {
    const dir = store.dirFor('site');
    await mkdir(join(dir, '_assets', 'asset1', 'file'), { recursive: true });
    // A raw user file named report.html lands in the exported artifact's _assets dir…
    await writeFile(join(dir, '_assets', 'asset1', 'file', 'report.html'), '<script>steal()</script>');
    // …but the /sites serving path must NOT render it as HTML on this origin.
    expect(() => store.resolveHtml('site', '/_assets/asset1/file/report.html')).toThrow(/asset path/);
    expect(await store.readHtml('site', '/_assets/asset1/file/report.html')).toBeNull();
    // It IS readable as a binary, but download-only (octet-stream + attachment) — never inline.
    const bin = await store.readBinary('site', '/_assets/asset1/file/report.html');
    expect(bin?.attachment).toBe(true);
    expect(bin?.contentType).toBe('application/octet-stream');
  });

  it('serves a bundled image binary inline with its type; rejects non-_assets binary paths', async () => {
    const dir = store.dirFor('site');
    await mkdir(join(dir, '_assets', 'img1'), { recursive: true });
    await writeFile(join(dir, '_assets', 'img1', 'p-40.webp'), Buffer.from('webpbytes'));
    const img = await store.readBinary('site', '/_assets/img1/p-40.webp');
    expect(img?.contentType).toBe('image/webp');
    expect(img?.attachment).toBe(false);
    // A path outside _assets/ is not binary-servable here (text assets go via readAsset).
    expect(await store.readBinary('site', '/styles.css')).toBeNull();
  });

  it('serves a bundled stylesheet (imported CSS) inline as text/css, not a download', async () => {
    const dir = store.dirFor('site');
    await mkdir(join(dir, '_assets', 'css1'), { recursive: true });
    await writeFile(join(dir, '_assets', 'css1', 'styles.css'), '.a{color:red}');
    const css = await store.readBinary('site', '/_assets/css1/styles.css');
    expect(css?.contentType).toBe('text/css; charset=utf-8'); // not octet-stream
    expect(css?.attachment).toBe(false); // inline, so the page's <link> applies it
  });

  it('serves a bundled script (imported JS) DOWNLOAD-ONLY (never executes on the same-origin platform)', async () => {
    const dir = store.dirFor('site');
    await mkdir(join(dir, '_assets', 'js1'), { recursive: true });
    await writeFile(join(dir, '_assets', 'js1', 'script.js'), 'console.log(1)');
    const js = await store.readBinary('site', '/_assets/js1/script.js');
    expect(js?.contentType).toBe('application/octet-stream'); // NOT text/javascript on the platform origin
    expect(js?.attachment).toBe(true); // runs only on the owner's own external deploy
  });

  it('serves a bundled script EXECUTABLE only when executableScripts is opted in (the sandboxed preview)', async () => {
    const dir = store.dirFor('site');
    await mkdir(join(dir, '_assets', 'js1'), { recursive: true });
    await writeFile(join(dir, '_assets', 'js1', 'script.js'), 'console.log(1)');
    const js = await store.readBinary('site', '/_assets/js1/script.js', { executableScripts: true });
    expect(js?.contentType).toBe('text/javascript; charset=utf-8'); // runnable in the opaque-origin frame
    expect(js?.attachment).toBe(false);
    // The flag is scoped to scripts: a non-.js binary is unaffected (still download-only).
    await writeFile(join(dir, '_assets', 'js1', 'data.bin'), 'x');
    const bin = await store.readBinary('site', '/_assets/js1/data.bin', { executableScripts: true });
    expect(bin?.contentType).toBe('application/octet-stream');
    expect(bin?.attachment).toBe(true);
  });

  it('still rejects traversal segments', async () => {
    expect(() => store.resolveHtml('site', '/../../etc/passwd.html')).toThrow();
    await expect(store.readBinary('site', '/_assets/../../etc/passwd.png')).resolves.toBeNull();
  });
});
