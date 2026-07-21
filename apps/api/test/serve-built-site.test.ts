import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:http';
import { afterEach, expect, test } from 'vitest';
import { serveBuiltSite, type ServedSite } from '../src/render/serve-built-site.js';

/** Raw HTTP GET (no undici auto-decompress) so we can observe Content-Encoding + the gzip magic bytes. */
function rawGet(url: string, headers: Record<string, string>): Promise<{ headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    get({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers }, (r) => {
      const chunks: Buffer[] = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => resolve({ headers: r.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

/** The loopback static server that gives Lighthouse a real navigation, with deploy-equivalent cache headers. */

let served: ServedSite | undefined;
afterEach(async () => {
  await served?.close();
  served = undefined;
});

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sbs-'));
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>home</title>');
  await mkdir(join(dir, '_assets'), { recursive: true });
  await writeFile(join(dir, '_assets', 'app.css'), 'body{color:red}');
  await mkdir(join(dir, 'about'), { recursive: true });
  await writeFile(join(dir, 'about', 'index.html'), '<!doctype html><title>about</title>');
  return dir;
}

test('serves index.html at the root with no-cache', async () => {
  served = await serveBuiltSite(await fixture());
  const res = await fetch(served.url);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/text\/html/);
  expect(res.headers.get('cache-control')).toBe('no-cache');
  expect(await res.text()).toContain('home');
});

test('immutable-caches only versioned (?v=) assets; unversioned files revalidate (matches deploy)', async () => {
  served = await serveBuiltSite(await fixture());
  const versioned = await fetch(`${served.url}_assets/app.css?v=abc123`);
  expect(versioned.status).toBe(200);
  expect(versioned.headers.get('content-type')).toMatch(/text\/css/);
  expect(versioned.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  // A bare (unversioned) static file — e.g. favicon.ico / robots.txt — must NOT be reported immutable,
  // or Lighthouse's cache-policy audit would flatter the real site.
  const bare = await fetch(`${served.url}_assets/app.css`);
  expect(bare.status).toBe(200);
  expect(bare.headers.get('cache-control')).toBe('no-cache');
});

test('resolves a nested directory to its index.html', async () => {
  served = await serveBuiltSite(await fixture());
  const res = await fetch(`${served.url}about/`);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('about');
});

test('404s an unknown path', async () => {
  served = await serveBuiltSite(await fixture());
  const res = await fetch(`${served.url}nope.html`);
  expect(res.status).toBe(404);
});

test('gzips a text response when the client accepts gzip (representative transfer size)', async () => {
  served = await serveBuiltSite(await fixture());
  const res = await rawGet(`${served.url}_assets/app.css`, { 'accept-encoding': 'gzip, deflate, br' });
  expect(res.headers['content-encoding']).toBe('gzip');
  expect(String(res.headers['vary'])).toMatch(/accept-encoding/i);
  expect(res.headers['content-length']).toBeUndefined(); // streamed → length not known up front
  expect(res.body[0]).toBe(0x1f); // gzip magic
  expect(res.body[1]).toBe(0x8b);
});

test('does NOT gzip when the client does not accept it (serves verbatim with content-length)', async () => {
  served = await serveBuiltSite(await fixture());
  const res = await rawGet(`${served.url}_assets/app.css`, { 'accept-encoding': 'identity' });
  expect(res.headers['content-encoding']).toBeUndefined();
  expect(res.headers['content-length']).toBe('15'); // 'body{color:red}'
  expect(res.body.toString()).toBe('body{color:red}');
});

test('never escapes the root on an encoded traversal attempt', async () => {
  served = await serveBuiltSite(await fixture());
  // `%2e%2e%2f` decodes to `../` — the leading `..` segments must be stripped, staying inside the root.
  const res = await fetch(`${served.url}%2e%2e%2f%2e%2e%2fetc%2fpasswd`);
  expect(res.status).toBe(404);
});
