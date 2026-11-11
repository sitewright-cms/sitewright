import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { CONSENT_SCRIPT } from '../src/http/consent-script.js';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import type { Database } from '../src/db/client.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { AUTH_CODE_TTL_MS } from '../src/repo/oauth.js';

// The consent surface as a USER-FACING page: it must wear the instance's branding, sort and filter
// the project list, and hand the approved code to a human instead of firing it at a callback their
// browser may not be able to reach.

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const REDIRECT = 'http://127.0.0.1:8976/callback';
const CLIENT = 'sitewright-cli';

let app: FastifyInstance;
let db: Database;
let publishRoot: string;

beforeEach(async () => {
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-consent-'));
  db = await makeTestDb();
  app = await createApp({ db, publishRoot, encryptionKey: randomBytes(32) });
  await app.ready();
});
afterEach(async () => {
  await rm(publishRoot, { recursive: true, force: true });
});

function cookie(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session');
  return t;
}

/** A developer with `projectNames` projects, returning their session cookie + project ids. */
async function userWithProjects(projectNames: string[]): Promise<{ session: string; ids: string[] }> {
  const uid = randomUUID().slice(0, 8);
  const email = `c-${uid}@e2e.test`;
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  const session = cookie(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }));
  const ids: string[] = [];
  for (const [i, name] of projectNames.entries()) {
    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies: { sw_session: session },
      payload: { name, slug: `p-${uid}-${i}` },
    });
    ids.push((res.json() as { project: { id: string } }).project.id);
  }
  return { session, ids };
}

/** Promotes a fresh account to instance admin and PUTs instance settings. */
async function putSettings(body: Record<string, unknown>): Promise<void> {
  const uid = randomUUID().slice(0, 8);
  const email = `adm-${uid}@e2e.test`;
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'admin' });
  const session = cookie(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }));
  const res = await app.inject({ method: 'PUT', url: '/admin/settings', cookies: { sw_session: session }, payload: body });
  if (res.statusCode !== 200) throw new Error(`settings PUT failed (${res.statusCode}): ${res.body}`);
}

const authorizeUrl = () =>
  `/oauth/authorize?${new URLSearchParams({
    client_id: CLIENT,
    redirect_uri: REDIRECT,
    response_type: 'code',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'st',
  })}`;

function form(fields: Record<string, string>) {
  return {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString(),
  };
}

async function approve(session: string, projectId: string) {
  return app.inject({
    method: 'POST',
    url: '/oauth/authorize',
    cookies: { sw_session: session },
    ...form({
      client_id: CLIENT,
      redirect_uri: REDIRECT,
      response_type: 'code',
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      'scope_content:read': '1',
      state: 'st',
      project: projectId,
      decision: 'approve',
    }),
  });
}

describe('consent screen — platform branding', () => {
  it('uses the instance brand colours, name and logo, not hardcoded defaults', async () => {
    await putSettings({
      platformName: 'Acme Studio',
      brandPrimary: '#ff0055',
      brandSecondary: '#00ddaa',
      platformLogo: { mime: 'image/png', data: Buffer.from('fake-png-bytes').toString('base64') },
    });
    const { session } = await userWithProjects(['Only']);
    const res = await app.inject({ method: 'GET', url: authorizeUrl(), cookies: { sw_session: session } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('--sw-brand-1:#ff0055');
    expect(res.body).toContain('--sw-brand-2:#00ddaa');
    expect(res.body).toContain('Acme Studio');
    expect(res.body).toContain('/branding/logo?v=');
    // The stock palette must be gone, not merely overridden further down the sheet.
    expect(res.body).not.toContain('--sw-brand-1:#6366f1');
  });

  it('falls back to the built-in look when nothing is configured', async () => {
    const { session } = await userWithProjects(['Only']);
    const res = await app.inject({ method: 'GET', url: authorizeUrl(), cookies: { sw_session: session } });
    expect(res.body).toContain('--sw-brand-1:#4f46e5');
    expect(res.body).toContain('SiteWright');
    expect(res.body).not.toContain('/branding/logo');
  });

  it('renders the admin\'s animated background via the SHARED shader runtime', async () => {
    await putSettings({ platformBackground: { preset: 'mesh-gradient', angle: 30, colors: ['#112233', 'auto', 'primary'] } });
    const { session } = await userWithProjects(['Only']);
    const res = await app.inject({ method: 'GET', url: authorizeUrl(), cookies: { sw_session: session } });
    // The same declarative marker published sites use — not a second copy of the shader engine.
    expect(res.body).toContain('data-sw-component="shader-bg"');
    expect(res.body).toContain('data-preset="mesh-gradient"');
    expect(res.body).toContain('data-angle="30"');
    expect(res.body).toContain('data-colors="#112233,auto,primary"');
    expect(res.body).toContain('<script src="/oauth/consent.js">');

    // A token-named palette slot only resolves if the page defines the CI token it names.
    expect(res.body).toContain('--sw-color-primary:');
    // With a background behind it the shell becomes a frosted panel, so the heading is legible over
    // whatever palette the admin picked (no fixed text colour can be safe against an arbitrary one).
    expect(res.body).toContain('class="has-bg"');

    const js = await app.inject({ method: 'GET', url: '/oauth/consent.js' });
    expect(js.statusCode).toBe(200);
    expect(String(js.headers['content-type'])).toContain('javascript');
    expect(js.body).toContain('data-sw-shader'); // the shader runtime
    expect(js.body).toContain('data-copy'); // the consent behaviour
    // ★ It PARSES. The script is authored as a TS template literal, so a stray backtick in a comment
    // silently truncates it; `new Function` compiles without executing, which is exactly the check.
    expect(() => new Function(js.body)).not.toThrow();
  });

  it('omits the background HOST entirely when no background is configured', async () => {
    const { session } = await userWithProjects(['Only']);
    const res = await app.inject({ method: 'GET', url: authorizeUrl(), cookies: { sw_session: session } });
    // Assert on the host element, not the marker STRING: the runtime's stylesheet is inlined either
    // way and mentions the selector, so a substring check here passes vacuously.
    expect(res.body).not.toContain('class="sw-bg"');
    expect(res.body).not.toContain('data-preset=');
    expect(res.body).not.toContain('class="has-bg"'); // no background → no scrim needed
  });
});

describe('consent screen — project picker', () => {
  it('lists projects ALPHABETICALLY, not in membership order', async () => {
    const { session } = await userWithProjects(['Zebra', 'apple', 'Mango']);
    const res = await app.inject({ method: 'GET', url: authorizeUrl(), cookies: { sw_session: session } });
    const order = [...res.body.matchAll(/data-name="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['apple', 'Mango', 'Zebra']); // case-insensitive
  });

  it('offers a search box once the list is long enough to need one', async () => {
    const few = await userWithProjects(['A', 'B']);
    const fewRes = await app.inject({ method: 'GET', url: authorizeUrl(), cookies: { sw_session: few.session } });
    expect(fewRes.body).not.toContain('id="sw-project-search"');

    const many = await userWithProjects(['A', 'B', 'C', 'D', 'E', 'F']);
    const manyRes = await app.inject({ method: 'GET', url: authorizeUrl(), cookies: { sw_session: many.session } });
    expect(manyRes.body).toContain('id="sw-project-search"');
    expect(manyRes.body).toContain('Enter to approve'); // the shortcut is discoverable, not hidden
    expect(manyRes.body).toContain('id="sw-approve"'); // …and the script has a button to click
  });

  it('escapes a project name into the filter attribute (it is an HTML sink)', async () => {
    const { session } = await userWithProjects(['<img src=x onerror=alert(1)>']);
    const res = await app.inject({ method: 'GET', url: authorizeUrl(), cookies: { sw_session: session } });
    expect(res.body).not.toContain('<img src=x');
    expect(res.body).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('consent screen — the approved code is shown, not fired at the callback', () => {
  it('renders the callback URL and the code, with copy for each, instead of redirecting', async () => {
    const { session, ids } = await userWithProjects(['Only']);
    const res = await approve(session, ids[0]!);

    expect(res.statusCode).toBe(200); // NOT a 302
    expect(res.headers.location).toBeUndefined();

    // ★ The FULL CALLBACK URL is the headline value. Claude Code's manual fallback asks for the whole
    // URL and rejects a bare code — shipping only the code made this screen useless for the very
    // client it exists for. Both are offered because clients disagree about what to paste.
    expect(res.body).toContain('id="sw-url"');
    expect(res.body).toContain('data-copy="sw-url"');
    expect(res.body).toContain('id="sw-code"');
    expect(res.body).toContain('data-copy="sw-code"');
    expect(res.body).toContain('127.0.0.1:8976'); // the destination is named

    // The copied URL is a real callback URL carrying the same code + state a redirect would have.
    const shownUrl = /<span id="sw-url">([^<]+)<\/span>/.exec(res.body)?.[1]?.replace(/&amp;/g, '&');
    const url = new URL(shownUrl!);
    expect(url.origin + url.pathname).toBe('http://127.0.0.1:8976/callback');
    expect(url.searchParams.get('state')).toBe('st');
    const shownCode = /<span id="sw-code">([^<]+)<\/span>/.exec(res.body)?.[1];
    expect(url.searchParams.get('code')).toBe(shownCode); // the two values agree
  });

  it('offers exactly three actions — Continue to the host, Copy Callback URL, Copy Auth Code — and no boxes to read', async () => {
    const { session, ids } = await userWithProjects(['Only']);
    const res = await approve(session, ids[0]!);
    const callback = /<span id="sw-url">([^<]+)<\/span>/.exec(res.body)?.[1];

    // 1) The full-width gradient action is a real LINK to the callback (it navigates), named for its host.
    expect(res.body).toContain(`<a class="btn primary wide" href="${callback}">Continue to 127.0.0.1:8976</a>`);
    // 2) + 3) The two copy buttons share the row under it, neither with the gradient.
    const row = /<div class="row halves">([\s\S]*?)<\/div>/.exec(res.body)?.[1] ?? '';
    expect(row).toMatch(/<button type="button" id="sw-copy-url" data-copy="sw-url"[^>]*>Copy Callback URL<\/button>/);
    expect(row).toMatch(/<button type="button" id="sw-copy" data-copy="sw-code"[^>]*>Copy Auth Code<\/button>/);
    expect(row).not.toContain('primary');
    expect(res.body.match(/<button\b/g)).toHaveLength(2);

    // No URL box and no "just the code" disclosure: the values sit in HIDDEN boxes the buttons copy from.
    expect(res.body).not.toContain('<details');
    expect(res.body).not.toContain('My client asks for just the code');
    expect(res.body).not.toContain('Open it in this browser');
    expect(res.body).toContain('<div class="code-box" hidden><span id="sw-url">');
    expect(res.body).toContain('<div class="code-box" hidden><span id="sw-code">');
    // ★ .code-box is display:flex, which would beat the UA's [hidden] rule and put them on screen anyway.
    expect(res.body).toContain('.code-box[hidden]{display:none}');
    // A clipboard that refuses reveals the value, selected, so there is still something to copy by hand…
    expect(CONSENT_SCRIPT).toContain("var box = el.closest('.code-box');");
    expect(CONSENT_SCRIPT).toContain('if(box) box.hidden = false;');
    // ★ The execCommand path (plain HTTP: no navigator.clipboard) removes a focused textarea; focus must go
    // back to the button, or the next Enter lands on <body> and the shortcut copies the URL over the code
    // (proved in a real browser in oauth-approved-focus.browser.test.ts).
    expect(CONSENT_SCRIPT).toContain('var back = before && before !== document.body ? before : btn === primaryCopy ? null : btn;');
    // …and without JS (where the copy buttons cannot work) both values are shown.
    expect(res.body).toMatch(/<noscript>[\s\S]*Callback URL[\s\S]*Authorization code[\s\S]*<\/noscript>/);
  });

  it('★ Enter copies the callback URL — from the script, with NOTHING focused (no highlighted button)', async () => {
    // The one thing anyone comes to this screen to do. The user is mid-flow in a terminal somewhere
    // else, so the hand is on the keyboard, not the mouse.
    const { session, ids } = await userWithProjects(['Only']);
    const res = await approve(session, ids[0]!);

    // No autofocus anywhere: an autofocused Copy Callback URL was drawn with its focus ring, which read
    // as the page highlighting it. "Continue to …" is not focused either — Enter means copy, the link is
    // a click.
    expect(res.body).not.toContain('autofocus');

    // The page-level Enter shortcut does the copying instead, on arrival and after focus has moved off
    // the buttons (a click on the page).
    expect(CONSENT_SCRIPT).toContain("var primaryCopy = document.getElementById('sw-copy-url')");
    expect(CONSENT_SCRIPT).toContain('primaryCopy.click()');
    // It must NOT steal Enter from a control that has its own meaning for it — otherwise "Continue to …"
    // would copy instead of following the link, and the focused button would copy twice.
    expect(CONSENT_SCRIPT).toContain("t.closest('button, a, summary, input, textarea, select, [contenteditable]')");
    // …nor from a modified chord (Ctrl/Cmd/Alt+Enter is somebody else's shortcut).
    expect(CONSENT_SCRIPT).toContain("if(e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey) return;");
    // The page has to actually load the script for any of that to happen.
    expect(res.body).toContain('/oauth/consent.js');
  });

  it('the displayed code is the REAL one — it exchanges for a token', async () => {
    const { session, ids } = await userWithProjects(['Only']);
    const res = await approve(session, ids[0]!);
    const shown = /<span id="sw-code">([^<]+)<\/span>/.exec(res.body)?.[1];
    expect(shown).toBeTruthy();

    const tok = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      ...form({ grant_type: 'authorization_code', code: shown!, client_id: CLIENT, redirect_uri: REDIRECT, code_verifier: VERIFIER }),
    });
    expect(tok.statusCode).toBe(200);
    expect((tok.json() as { access_token: string }).access_token.startsWith('swk_')).toBe(true);
  });

  it('never caches the page and sends no referrer (it carries a live credential)', async () => {
    const { session, ids } = await userWithProjects(['Only']);
    const res = await approve(session, ids[0]!);
    expect(String(res.headers['cache-control'])).toContain('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('heads the page "finish on <host>" in the primary colour, with no paragraph under it', async () => {
    const { session, ids } = await userWithProjects(['Only']);
    const res = await approve(session, ids[0]!);
    expect(res.body).toContain('<h1>Approved — finish on <strong class="solid">127.0.0.1:8976</strong></h1>\n     <div class="card">');
    expect(res.body).not.toContain('Most clients');
    expect(res.body).not.toContain('minutes');
    // The host is ONE colour, the brand primary — not the gradient the consent screen's client name wears.
    expect(res.body).toContain('h1 strong.solid{background:none;color:var(--sw-brand-1)}');
  });

  it('the code lives long enough to copy by hand', () => {
    // ★ A minute is not enough time for a human to read a page, copy a code and paste it elsewhere;
    // that is the whole reason this screen exists, so the lifetime has to allow for it.
    expect(AUTH_CODE_TTL_MS).toBeGreaterThanOrEqual(5 * 60 * 1000);
  });

  it('DENY still redirects — only approval shows a page', async () => {
    const { session, ids } = await userWithProjects(['Only']);
    const res = await app.inject({
      method: 'POST',
      url: '/oauth/authorize',
      cookies: { sw_session: session },
      ...form({
        client_id: CLIENT,
        redirect_uri: REDIRECT,
        response_type: 'code',
        code_challenge: CHALLENGE,
        code_challenge_method: 'S256',
        'scope_content:read': '1',
        state: 'st',
        project: ids[0]!,
        decision: 'deny',
      }),
    });
    // A denial has nothing to hand the user, and the client needs to hear about it promptly.
    expect(res.statusCode).toBe(302);
    expect(String(res.headers.location)).toContain('error=access_denied');
  });
});
