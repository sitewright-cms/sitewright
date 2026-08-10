import { test, expect } from '@playwright/test';
import { signUp } from './helpers.js';

const stamp = Date.now();
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const CLIENT_REDIRECT = 'https://hosted.example.test/oauth/callback';

// A hosted MCP client (claude.ai / ChatGPT style) self-registers via DCR, then
// runs the authorization-code + PKCE flow with its registered https redirect.
test('dynamically-registered client completes the OAuth flow', async ({ page, playwright, baseURL }) => {
  const api = page.request;

  await signUp(page, `dcr-${stamp}@e2e.test`);
  const proj = await api.post('/projects', { data: { name: 'DCR Site', slug: `dcr-${stamp}` } });
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
  // The project picker is a RADIOGROUP of cards, not a <select>: the project scopes every token the
  // agent will get, so it reads as a choice rather than a dropdown default nobody looked at. The first
  // option is pre-checked; check it explicitly so the test still states which project it authorises.
  await page.locator('input[name="project"]').first().check();

  // Approval shows the code rather than redirecting — a REMOTE client's callback is exactly the case
  // the browser may not be able to reach, so the code is handed to the user with the redirect offered
  // as a choice. The continue link still carries it.
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('heading', { name: /Approved/ })).toBeVisible();
  const code = (await page.locator('#sw-code').textContent())?.trim();
  expect(code).toBeTruthy();
  const back = new URL((await page.locator('a[href] >> nth=0').getAttribute('href'))!.replace(/&amp;/g, '&'));
  expect(back.origin).toBe('https://hosted.example.test');
  expect(back.searchParams.get('code')).toBe(code);
  await expect(page.getByRole('button', { name: /Continue to hosted\.example\.test/ })).toBeVisible();

  // Exchange the code for tokens (cookieless), then use the access token.
  const bot = await playwright.request.newContext({ baseURL });
  const tok = await (
    await bot.post('/oauth/token', {
      form: { grant_type: 'authorization_code', code: code!, client_id: clientId, redirect_uri: CLIENT_REDIRECT, code_verifier: VERIFIER },
    })
  ).json();
  expect(tok.access_token).toMatch(/^swk_/);
  const use = await bot.get(`/projects/${projectId}/content/page`, {
    headers: { authorization: `Bearer ${tok.access_token}` },
  });
  expect(use.status()).toBe(200);
  await bot.dispose();
});
