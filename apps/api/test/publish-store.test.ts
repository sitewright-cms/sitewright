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

  it('serves a bundled VIDEO inline and marks it seekable', async () => {
    // Video used to fall through to the octet-stream + attachment default, so a self-hosted background
    // video on a published or previewed site arrived as a DOWNLOAD: the browser could not seek it
    // (a `currentTime = 6` landed back at 0) and had to transfer all 16 MB before playback started.
    const dir = store.dirFor('site');
    await mkdir(join(dir, '_assets'), { recursive: true });
    await writeFile(join(dir, '_assets', 'bg-video.webm'), Buffer.from('webmbytes'));
    const vid = await store.readBinary('site', '/_assets/bg-video.webm');
    expect(vid?.contentType).toBe('video/webm');
    expect(vid?.attachment).toBe(false); // INLINE — it has to play
    expect(vid?.ranged).toBe(true); // …and be seekable

    await writeFile(join(dir, '_assets', 'theme.mp3'), Buffer.from('mp3bytes'));
    const audio = await store.readBinary('site', '/_assets/theme.mp3');
    expect(audio?.contentType).toBe('audio/mpeg');
    expect(audio?.ranged).toBe(true);

    // …while an unknown binary is still download-only, and NOT marked seekable.
    await writeFile(join(dir, '_assets', 'thing.bin'), Buffer.from('x'));
    const other = await store.readBinary('site', '/_assets/thing.bin');
    expect(other?.attachment).toBe(true);
    expect(other?.ranged).toBeFalsy();
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

  it('serves a bundled SVG INLINE (image/svg+xml) under a locked-down CSP, not a download', async () => {
    const dir = store.dirFor('site');
    await mkdir(join(dir, '_assets', 'svg1'), { recursive: true });
    await writeFile(join(dir, '_assets', 'svg1', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
    const svg = await store.readBinary('site', '/_assets/svg1/logo.svg');
    expect(svg?.contentType).toBe('image/svg+xml; charset=utf-8');
    expect(svg?.attachment).toBe(false); // inline, so a cloned <img src=logo.svg> renders
    // the CSP forbids scripts + external fetches (belt to the sanitize-on-store suspenders)
    expect(svg?.csp).toMatch(/default-src 'none'/);
    expect(svg?.csp).toMatch(/sandbox/);
  });

  it('serves a bundled PDF INLINE (application/pdf) + same-origin frameable, not a download', async () => {
    const dir = store.dirFor('site');
    await mkdir(join(dir, '_assets', 'doc1', 'file'), { recursive: true });
    await writeFile(join(dir, '_assets', 'doc1', 'file', 'company_profile.pdf'), '%PDF-1.4 fake');
    const pdf = await store.readBinary('site', '/_assets/doc1/file/company_profile.pdf');
    expect(pdf?.contentType).toBe('application/pdf');
    expect(pdf?.attachment).toBe(false); // inline, so a cloned modal <iframe src=….pdf> renders it
    // frame-ancestors 'self' lets ONLY the same-origin published page frame it (also skips onSend's DENY)
    expect(pdf?.csp).toMatch(/frame-ancestors 'self'/);
  });

  it('still rejects traversal segments', async () => {
    expect(() => store.resolveHtml('site', '/../../etc/passwd.html')).toThrow();
    await expect(store.readBinary('site', '/_assets/../../etc/passwd.png')).resolves.toBeNull();
  });
});

describe('PublishStore text-asset serving', () => {
  it('serves the site-search index — but still NOT release.json', async () => {
    // `.json` is deliberately absent from ASSET_CONTENT_TYPES so release.json stays unreachable, so
    // the search index needs an EXACT-NAME exception. Without it every search box on a
    // PLATFORM-served site (/sites/<slug>/* and the signed draft preview both read root files
    // through readAsset) is silently inert, while a customer's own host serves the file happily.
    const dir = store.dirFor('site');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'search-index.json'), '{"v":1,"lang":"en","pages":[],"terms":{}}');
    await writeFile(join(dir, 'search-text.de.json'), '{"v":1,"text":[],"offsets":[]}');
    await writeFile(join(dir, 'release.json'), '{"publishedAt":"x"}');

    const index = await store.readAsset('site', '/search-index.json');
    expect(index?.contentType).toBe('application/json; charset=utf-8');
    expect(index?.body).toContain('"lang":"en"');
    expect((await store.readAsset('site', '/search-text.de.json'))?.body).toContain('offsets');

    // The reason `.json` was never opened up wholesale.
    expect(await store.readAsset('site', '/release.json')).toBeNull();
  });

  it('serves .well-known/security.txt — the ONE allowlisted nested asset (RFC 9116 fixes its path)', async () => {
    const dir = store.dirFor('site');
    await mkdir(join(dir, '.well-known'), { recursive: true });
    await writeFile(join(dir, '.well-known', 'security.txt'), 'Contact: https://acme.com/contact/\n');
    const asset = await store.readAsset('site', '/.well-known/security.txt');
    expect(asset?.contentType).toBe('text/plain; charset=utf-8'); // exactly what RFC 9116 §3 requires
    expect(asset?.body).toContain('Contact:');
  });

  it('keeps the root-only rule for every OTHER nested path (the exception is exact, not a prefix)', async () => {
    const dir = store.dirFor('site');
    await mkdir(join(dir, '.well-known', 'nested'), { recursive: true });
    // A sibling in the same directory is NOT served — the allowlist is one exact path, not a prefix.
    await writeFile(join(dir, '.well-known', 'secrets.txt'), 'nope');
    await writeFile(join(dir, '.well-known', 'nested', 'security.txt'), 'nope');
    expect(await store.readAsset('site', '/.well-known/secrets.txt')).toBeNull();
    expect(await store.readAsset('site', '/.well-known/nested/security.txt')).toBeNull();
    // And a subdirectory .js still cannot become publicly served as script.
    await mkdir(join(dir, 'sub'), { recursive: true });
    await writeFile(join(dir, 'sub', 'evil.js'), 'alert(1)');
    expect(await store.readAsset('site', '/sub/evil.js')).toBeNull();
  });

  it('still confines the allowlisted path (no traversal through the exception)', async () => {
    expect(await store.readAsset('site', '/../.well-known/security.txt')).toBeNull();
    expect(await store.readAsset('site', '/.well-known/../../security.txt')).toBeNull();
  });

  it('serves the root text assets it always did', async () => {
    const dir = store.dirFor('site');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'styles.css'), 'body{}');
    await writeFile(join(dir, 'robots.txt'), 'User-agent: *\n');
    expect((await store.readAsset('site', '/styles.css'))?.contentType).toBe('text/css; charset=utf-8');
    expect((await store.readAsset('site', '/robots.txt'))?.contentType).toBe('text/plain; charset=utf-8');
  });
});

describe('platform runtimes under _assets/_sw/', () => {
  it('are EXECUTABLE javascript on every origin — they are our code, not imported', async () => {
    // ★ They were served executable from the site ROOT until they moved into `_assets/`. The `.js`
    // download-only rule in readBinary exists for scripts IMPORTED from a cloned site, which could read
    // a visitor's session if they ran on the cookie-bearing app origin. Claiming the platform's own
    // component runtimes under that rule would leave every interactive component silently dead on a
    // platform-served page — a download instead of a script.
    const dir = store.dirFor('site');
    {
      await mkdir(join(dir, '_assets', '_sw'), { recursive: true });
      await writeFile(join(dir, '_assets', '_sw', 'c-lightbox.js'), 'console.log(1)');
      // readBinary DECLINES it, so the route falls through to readAsset…
      expect(await store.readBinary('site', '/_assets/_sw/c-lightbox.js')).toBeNull();
      // …which serves it runnable, with no attachment disposition.
      const asset = await store.readAsset('site', '_assets/_sw/c-lightbox.js');
      expect(asset?.contentType).toContain('text/javascript');
      expect(asset?.body).toContain('console.log(1)');
    }
  });

  it('does NOT widen the rule for any other script under _assets/', async () => {
    // The security invariant this carve-out must not break: a script imported from a cloned site is
    // still download-only on the app origin, and readAsset still refuses anything nested it does not
    // explicitly name.
    const dir = store.dirFor('site');
    {
      await mkdir(join(dir, '_assets', 'js1'), { recursive: true });
      await writeFile(join(dir, '_assets', 'js1', 'foreign.js'), 'steal()');
      const bin = await store.readBinary('site', '/_assets/js1/foreign.js');
      expect(bin?.attachment).toBe(true);
      expect(bin?.contentType).not.toContain('javascript');
      expect(await store.readAsset('site', '_assets/js1/foreign.js')).toBeNull();
      // A nested path that merely LOOKS like the reserved one is not it.
      await mkdir(join(dir, '_assets', '_sw', 'nested'), { recursive: true });
      await writeFile(join(dir, '_assets', '_sw', 'nested', 'x.js'), 'nope()');
      expect(await store.readAsset('site', '_assets/_sw/nested/x.js')).toBeNull();
    }
  });
});

