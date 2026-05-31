import { test, expect } from '@playwright/test';

const stamp = Date.now();
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const CLIENT_REDIRECT = 'https://hosted.example.test/oauth/callback';

// A hosted MCP client (claude.ai / ChatGPT style) self-registers via DCR, then
// runs the authorization-code + PKCE flow with its registered https redirect.
test('dynamically-registered client completes the OAuth flow', async ({ page, playwright, baseURL }) => {
  const api = page.request;

  const reg = await api.post('/auth/register', {
    data: { email: `dcr-${stamp}@e2e.test`, password: 'pw-secret-1', orgName: `DCR ${stamp}` },
  });
  const orgId = (await reg.json()).orgId as string;
  const proj = await api.post(`/orgs/${orgId}/projects`, { data: { name: 'DCR Site', slug: `dcr-${stamp}` } });
  const projectId = (await proj.json()).project.id as string;

  // Self-register the client (open DCR, no auth).
  const dcr = await api.post('/oauth/register', {
    data: { client_name: 'Hosted Agent', redirect_uris: [CLIENT_REDIRECT] },
  });
  expect(dcr.status()).toBe(201);
  const clientId = (await dcr.json()).client_id as string;
  expect(clientId).toMatch(/^swcid_/);

  // Stub the registered https redirect so the post-approval navigation succeeds.
  await page.route('https://hosted.example.test/**', (route) => route.fulfill({ status: 200, body: 'ok' }));

  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: CLIENT_REDIRECT,
    response_type: 'code',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    scope: 'content:read',
    state: 'dcr-state',
  });
  await page.goto(`/oauth/authorize?${q.toString()}`);
  await expect(page.getByRole('heading', { name: /Authorize/ })).toBeVisible();
  await expect(page.getByText('Hosted Agent')).toBeVisible(); // registered client name shown
  await page.getByLabel('Project').selectOption({ index: 0 });

  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/oauth/authorize') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Approve' }).click(),
  ]);
  expect(resp.status()).toBe(302);
  const back = new URL(resp.headers()['location'] as string);
  expect(back.origin).toBe('https://hosted.example.test');
  const code = back.searchParams.get('code');
  expect(code).toBeTruthy();

  // Exchange the code for tokens (cookieless), then use the access token.
  const bot = await playwright.request.newContext({ baseURL });
  const tok = await (
    await bot.post('/oauth/token', {
      form: { grant_type: 'authorization_code', code: code!, client_id: clientId, redirect_uri: CLIENT_REDIRECT, code_verifier: VERIFIER },
    })
  ).json();
  expect(tok.access_token).toMatch(/^swk_/);
  const use = await bot.get(`/orgs/${orgId}/projects/${projectId}/content/page`, {
    headers: { authorization: `Bearer ${tok.access_token}` },
  });
  expect(use.status()).toBe(200);
  await bot.dispose();
});
