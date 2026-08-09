import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertRemoteFormEndpointsReachable } from '../src/publish/form-guard.js';
import { PublishError } from '../src/publish/build.js';

// A routed form's page as the publisher now builds it: the form carries only its ID, and the endpoint is
// assembled at runtime from this encoded payload — so the guard reads the BASE out of the payload rather
// than pattern-matching a URL that is deliberately no longer in the markup.
const routedPage = (payload: string): string =>
  `<form data-sw-component="form" data-sw-routed="contact"></form>` +
  `<script data-sw-f>(function(){try{var o=JSON.parse(atob("${payload}"));window.__swf=function(i){return o.b+"/"+"f"+"/"+o.p+"/"+i+(o.v?"/preview":"")}}catch(e){}})()</script>`;
const RELATIVE_PAYLOAD = 'eyJiIjogIiIsICJwIjogInByb2oxIiwgInYiOiAwfQ=='; // {"b":"","p":"proj1","v":0} — no public base configured
const ABSOLUTE_PAYLOAD = 'eyJiIjogImh0dHBzOi8vc3cuZXhhbXBsZSIsICJwIjogInByb2oxIiwgInYiOiAwfQ=='; // {"b":"https://sw.example",…}

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
    await writeFile(join(dir, 'index.html'), routedPage(RELATIVE_PAYLOAD));
    await expect(assertRemoteFormEndpointsReachable(dir)).rejects.toBeInstanceOf(PublishError);
    await expect(assertRemoteFormEndpointsReachable(dir)).rejects.toThrow(/SW_PUBLIC_URL/);
  });

  it('detects it in a NESTED page too (walks the whole build)', async () => {
    await writeFile(join(dir, 'index.html'), '<h1>Home</h1>');
    await mkdir(join(dir, 'contact'), { recursive: true });
    await writeFile(join(dir, 'contact', 'index.html'), routedPage(RELATIVE_PAYLOAD));
    await expect(assertRemoteFormEndpointsReachable(dir)).rejects.toBeInstanceOf(PublishError);
  });

  it('passes when the endpoint is ABSOLUTE (a publicBaseUrl was configured)', async () => {
    await writeFile(join(dir, 'index.html'), routedPage(ABSOLUTE_PAYLOAD));
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
