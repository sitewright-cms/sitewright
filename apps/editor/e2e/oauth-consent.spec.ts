import { test, expect } from '@playwright/test';

const stamp = Date.now();
// RFC 7636 reference PKCE pair.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const REDIRECT = 'http://127.0.0.1:8976/callback';

// End-to-end OAuth authorization-code + PKCE in a real browser: render the
// consent page, approve, capture the redirected code, exchange it for tokens, and
// use the access token on the API (cookieless — the agent/CLI path).
test('OAuth consent → code → token, then the access token works', async ({ page, playwright, baseURL }) => {
  const api = page.request; // shares the browser cookie jar

  const reg = await api.post('/auth/register', {
    data: { email: `oauth-${stamp}@e2e.test`, password: 'pw-secret-1', orgName: `OAuth ${stamp}` },
  });
  expect(reg.status()).toBe(201);
  const orgId = (await reg.json()).orgId as string;
  const proj = await api.post(`/orgs/${orgId}/projects`, { data: { name: 'OAuth Site', slug: `oauth-${stamp}` } });
  const projectId = (await proj.json()).project.id as string;

  // The CLI's loopback redirect has no real listener — stub it so the browser's
  // post-approval navigation succeeds and we can read the code off the URL.
  await page.route('http://127.0.0.1:8976/**', (route) => route.fulfill({ status: 200, body: 'ok' }));

  const q = new URLSearchParams({
    client_id: 'sitewright-cli',
    redirect_uri: REDIRECT,
    response_type: 'code',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    scope: 'content:read content:write',
    state: 'cli-state',
  });
  await page.goto(`/oauth/authorize?${q.toString()}`);

  // Consent page renders the request + a project picker.
  await expect(page.getByRole('heading', { name: /Authorize/ })).toBeVisible();
  await expect(page.getByText('content:read')).toBeVisible();
  await page.getByLabel('Project').selectOption({ index: 0 });

  // Approve and read the 302's redirect target directly (no dependency on the
  // dead-loopback navigation completing).
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/oauth/authorize') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Approve' }).click(),
  ]);
  expect(resp.status()).toBe(302);
  const back = new URL(resp.headers()['location'] as string);
  expect(back.origin).toBe('http://127.0.0.1:8976'); // redirected to the registered loopback
  expect(back.searchParams.get('state')).toBe('cli-state');
  const code = back.searchParams.get('code');
  expect(code).toBeTruthy();

  // Exchange the code for tokens (cookieless — like the CLI).
  const bot = await playwright.request.newContext({ baseURL });
  const tokRes = await bot.post('/oauth/token', {
    form: { grant_type: 'authorization_code', code: code!, client_id: 'sitewright-cli', redirect_uri: REDIRECT, code_verifier: VERIFIER },
  });
  expect(tokRes.status()).toBe(200);
  const tok = await tokRes.json();
  expect(tok.token_type).toBe('Bearer');
  expect(tok.access_token).toMatch(/^swk_/);

  // The access token authenticates a normal bearer API call.
  const use = await bot.get(`/orgs/${orgId}/projects/${projectId}/content/page`, {
    headers: { authorization: `Bearer ${tok.access_token}` },
  });
  expect(use.status()).toBe(200);

  // And it refreshes (rotating).
  const refRes = await bot.post('/oauth/token', {
    form: { grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: 'sitewright-cli' },
  });
  expect(refRes.status()).toBe(200);
  expect((await refRes.json()).refresh_token).not.toBe(tok.refresh_token);
  await bot.dispose();
});
