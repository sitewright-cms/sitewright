import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { serveBuiltSite, type ServedSite } from '../src/render/serve-built-site.js';

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

test('never escapes the root on an encoded traversal attempt', async () => {
  served = await serveBuiltSite(await fixture());
  // `%2e%2e%2f` decodes to `../` — the leading `..` segments must be stripped, staying inside the root.
  const res = await fetch(`${served.url}%2e%2e%2f%2e%2e%2fetc%2fpasswd`);
  expect(res.status).toBe(404);
});
