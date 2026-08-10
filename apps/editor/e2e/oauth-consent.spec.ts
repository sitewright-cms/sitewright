import { test, expect } from '@playwright/test';
import { signUp } from './helpers.js';

const stamp = Date.now();
// RFC 7636 reference PKCE pair.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const REDIRECT = 'http://127.0.0.1:8976/callback';

// End-to-end OAuth authorization-code + PKCE in a real browser: render the
// consent page, approve, capture the redirected code, exchange it for tokens, and
// use the access token on the API (cookieless — the agent/CLI path).
test('OAuth consent → code → token, then the access token works', async ({ page, context, playwright, baseURL }) => {
  const api = page.request; // shares the browser cookie jar

  await signUp(page, `oauth-${stamp}@e2e.test`);
  const proj = await api.post('/projects', { data: { name: 'OAuth Site', slug: `oauth-${stamp}` } });
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
  // The project picker is a RADIOGROUP of cards, not a <select>: the project scopes every token the
  // agent will get, so it reads as a choice rather than a dropdown default nobody looked at. The first
  // option is pre-checked; check it explicitly so the test still states which project it authorises.
  await page.locator('input[name="project"]').first().check();

  // Approve. There is NO automatic redirect any more: the code is shown for the user to copy,
  // because a client's callback is frequently unreachable from the browser doing the authorizing.
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('heading', { name: /Approved/ })).toBeVisible();
  const code = (await page.locator('#sw-code').textContent())?.trim();
  expect(code).toBeTruthy();

  // The continue button names the destination host and carries the same code + state a redirect
  // would have — it is now a CHOICE rather than something that happens to the user.
  const href = await page.locator('a[href] >> nth=0').getAttribute('href');
  const back = new URL(href!);
  expect(back.origin).toBe('http://127.0.0.1:8976');
  expect(back.searchParams.get('state')).toBe('cli-state');
  expect(back.searchParams.get('code')).toBe(code);
  await expect(page.getByRole('button', { name: /Continue to 127\.0\.0\.1:8976/ })).toBeVisible();

  // Copy works and SAYS it worked. Note the deployed instance is reached over plain HTTP here, so
  // `navigator.clipboard` does not exist (it needs a secure context) — this is the execCommand
  // fallback path running, which is precisely the case a self-hosted LAN instance hits. Read the
  // clipboard back only where the API is actually available.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.getByRole('button', { name: 'Copy code' }).click();
  await expect(page.getByText('Code copied to clipboard')).toBeVisible();
  const clip = await page.evaluate(() =>
    navigator.clipboard?.readText ? navigator.clipboard.readText() : Promise.resolve(null),
  );
  if (clip !== null) expect(clip).toBe(code);

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
  const use = await bot.get(`/projects/${projectId}/content/page`, {
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
