import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { BrowserContext, Page } from 'playwright-core';
import { launchTestBrowser } from './browser-helper.js';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { CONSENT_SCRIPT } from '../src/http/consent-script.js';

/**
 * The OAuth "Approved" page in a REAL browser: nothing is focused (so no button is drawn highlighted),
 * yet Enter still copies the callback URL — over `navigator.clipboard` on a secure origin, and over the
 * execCommand fallback on a plain-HTTP one, which is the path that moves focus around. Only a browser
 * says what `:focus-visible` matches.
 */

const browser = await launchTestBrowser();
const SECURE = 'http://localhost:4580';
const PLAIN = 'http://sw-plain.test';
/** Records what each later execCommand copy writes: the fallback copies its focused textarea's value. */
const RECORD_COPIES =
  "window.__copied = []; var orig = document.execCommand.bind(document); document.execCommand = function(c){ var a = document.activeElement; if (a && a.tagName === 'TEXTAREA') window.__copied.push(a.value); return orig(c); }";

describe.skipIf(!browser)('the OAuth Approved page highlights nothing, and Enter still copies the callback URL', () => {
  let publishRoot: string;
  let app: FastifyInstance;
  let html = '';
  let callbackUrl = '';
  let code = '';

  beforeAll(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-approved-focus-'));
    const db = await makeTestDb();
    app = await createApp({ db, publishRoot, encryptionKey: randomBytes(32) });
    await app.ready();
    await registerAccount(db, 'focus@e2e.test', 'Pw-secret-1', { platformRole: 'developer' });
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'focus@e2e.test', password: 'Pw-secret-1' } });
    const session = login.cookies.find((c) => c.name === 'sw_session')!.value;
    const project = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: session }, payload: { name: 'Only', slug: 'focus-only' } });
    const res = await app.inject({
      method: 'POST',
      url: '/oauth/authorize',
      cookies: { sw_session: session },
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        client_id: 'sitewright-cli',
        redirect_uri: 'http://127.0.0.1:8976/callback',
        response_type: 'code',
        code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        code_challenge_method: 'S256',
        'scope_content:read': '1',
        state: 'st',
        project: (project.json() as { project: { id: string } }).project.id,
        decision: 'approve',
      }).toString(),
    });
    expect(res.statusCode).toBe(200);
    html = res.body;
    callbackUrl = /<span id="sw-url">([^<]+)<\/span>/.exec(html)![1]!.replaceAll('&amp;', '&');
    code = /<span id="sw-code">([^<]+)<\/span>/.exec(html)![1]!;
  });
  afterAll(async () => {
    await browser?.close();
    await app?.close();
    await rm(publishRoot, { recursive: true, force: true });
  });

  async function open(origin: string): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser!.newContext();
    if (origin === SECURE) await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await context.route(`${origin}/**`, (route) =>
      new URL(route.request().url()).pathname === '/oauth/consent.js'
        ? route.fulfill({ contentType: 'text/javascript', body: CONSENT_SCRIPT })
        : route.fulfill({ contentType: 'text/html', body: html }),
    );
    const page = await context.newPage();
    await page.goto(`${origin}/oauth/authorize`);
    return { context, page };
  }

  // Page-side code as string expressions: this package type-checks without the DOM lib.
  const focusState = (page: Page) =>
    page.evaluate<{ onBody: boolean; ringed: string | null }>(
      "({ onBody: document.activeElement === document.body, ringed: (document.querySelector(':focus-visible') || {}).id || null })",
    );

  it('on a secure origin: nothing focused on arrival, Enter copies the URL, and still nothing is ringed', async () => {
    const { context, page } = await open(SECURE);
    expect(await page.evaluate<boolean>('window.isSecureContext && !!navigator.clipboard')).toBe(true);
    expect(await focusState(page)).toEqual({ onBody: true, ringed: null });

    await page.keyboard.press('Enter');
    await expect.poll(() => page.locator('#sw-toast').textContent()).toBe('Callback URL copied to clipboard');
    expect(await page.evaluate<string>('navigator.clipboard.readText()')).toBe(callbackUrl);
    expect(await focusState(page)).toEqual({ onBody: true, ringed: null });
    await context.close();
  });

  it('on plain HTTP (the execCommand fallback): Enter copies the URL and leaves focus on the page, not the button', async () => {
    const { context, page } = await open(PLAIN);
    expect(await page.evaluate<boolean>('!window.isSecureContext && !navigator.clipboard')).toBe(true);
    expect(await focusState(page)).toEqual({ onBody: true, ringed: null });

    await page.keyboard.press('Enter');
    await expect.poll(() => page.locator('#sw-toast').textContent()).toBe('Callback URL copied to clipboard');
    // ★ The fallback focuses a hidden textarea to copy; returning focus to the BUTTON after a key press
    // would draw its focus ring — the highlight this page no longer shows.
    expect(await focusState(page)).toEqual({ onBody: true, ringed: null });
    await context.close();
  });

  it('on plain HTTP, after "Copy Auth Code" focus stays on that button, so a second Enter copies the code again, not the URL', async () => {
    const { context, page } = await open(PLAIN);
    await page.getByRole('button', { name: 'Copy Auth Code' }).click();
    await expect.poll(() => page.locator('#sw-toast').textContent()).toBe('Authorization code copied to clipboard');
    expect(await page.evaluate<string | null>('document.activeElement && document.activeElement.id')).toBe('sw-copy');

    await page.evaluate(RECORD_COPIES);
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate<string[]>('window.__copied')).toEqual([code]);
    await context.close();
  });

  it('…and so does a click that never focused the button (Safari: focus was on the page, not the button)', async () => {
    const { context, page } = await open(PLAIN);
    // A programmatic click leaves focus on <body>, exactly as a Safari mouse click on a button does.
    await page.evaluate("document.getElementById('sw-copy').click()");
    expect(await page.evaluate<string | null>('document.activeElement && document.activeElement.id')).toBe('sw-copy');

    await page.evaluate(RECORD_COPIES);
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate<string[]>('window.__copied')).toEqual([code]);
    await context.close();
  });

  it('names the callback host in the brand PRIMARY colour, not a gradient', async () => {
    const { context, page } = await open(SECURE);
    const heading = page.getByRole('heading', { level: 1 });
    await expect.poll(() => heading.textContent()).toBe('Approved — finish on 127.0.0.1:8976');
    const host = await page.evaluate<{ color: string; image: string; primary: string }>(
      "(function(){ var s = getComputedStyle(document.querySelector('h1 strong')); var probe = document.createElement('i'); probe.style.color = 'var(--sw-brand-1)'; document.body.appendChild(probe); var primary = getComputedStyle(probe).color; probe.remove(); return { color: s.color, image: s.backgroundImage, primary: primary }; })()",
    );
    expect(host.image).toBe('none');
    expect(host.color).toBe(host.primary);
    expect(host.color).not.toBe('rgba(0, 0, 0, 0)');
    await context.close();
  });
});
