import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertRemoteFormEndpointsReachable } from '../src/publish/form-guard.js';
import { PublishError } from '../src/publish/build.js';

// Guards a REMOTE deploy from silently shipping a platform-routed form whose endpoint was baked
// root-relative (no publicBaseUrl) — which would 404 on the deployed host. See form-guard.ts.
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sw-formguard-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('assertRemoteFormEndpointsReachable', () => {
  it('throws PublishError when a page embeds a root-relative platform form endpoint', async () => {
    await writeFile(join(dir, 'index.html'), '<form data-sw-component="form" data-sw-endpoint="/f/proj1/contact"></form>');
    await expect(assertRemoteFormEndpointsReachable(dir)).rejects.toBeInstanceOf(PublishError);
    await expect(assertRemoteFormEndpointsReachable(dir)).rejects.toThrow(/SW_PUBLIC_URL/);
  });

  it('detects it in a NESTED page too (walks the whole build)', async () => {
    await writeFile(join(dir, 'index.html'), '<h1>Home</h1>');
    await mkdir(join(dir, 'contact'), { recursive: true });
    await writeFile(join(dir, 'contact', 'index.html'), '<form data-sw-endpoint="/f/p/c"></form>');
    await expect(assertRemoteFormEndpointsReachable(dir)).rejects.toBeInstanceOf(PublishError);
  });

  it('passes when the endpoint is ABSOLUTE (a publicBaseUrl was configured)', async () => {
    await writeFile(join(dir, 'index.html'), '<form data-sw-endpoint="https://sw.example/f/proj1/contact"></form>');
    await expect(assertRemoteFormEndpointsReachable(dir)).resolves.toBeUndefined();
  });

  it('passes for a co-located contact.php form (not platform-routed)', async () => {
    await writeFile(join(dir, 'index.html'), '<form data-sw-endpoint="../contact.php"></form>');
    await expect(assertRemoteFormEndpointsReachable(dir)).resolves.toBeUndefined();
  });

  it('passes when there are no forms (and ignores non-HTML files)', async () => {
    await writeFile(join(dir, 'index.html'), '<h1>No forms here</h1>');
    // A `.js`/`.css` asset that coincidentally contains the marker string must NOT trip the guard —
    // only rendered HTML pages embed a live form endpoint.
    await writeFile(join(dir, 'components.js'), 'var x="data-sw-endpoint=\\"/f/proj1/contact\\"";');
    await expect(assertRemoteFormEndpointsReachable(dir)).resolves.toBeUndefined();
  });
});
