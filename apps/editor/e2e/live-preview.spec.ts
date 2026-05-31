import { test, expect } from '@playwright/test';

const stamp = Date.now();

// Live auto-reload: a pop-out preview window reflects a SAVED-content change made
// through a DIFFERENT channel (here a cookieless Bearer token, i.e. the CLI/MCP
// agent path) without any interaction in the preview window itself.
test('live preview auto-reloads when content changes via another channel', async ({ page, playwright, baseURL }) => {
  const api = page.request; // shares the browser context's cookie jar

  const reg = await api.post('/auth/register', {
    data: { email: `live-${stamp}@e2e.test`, password: 'pw-secret-1', orgName: `Live ${stamp}` },
  });
  expect(reg.status()).toBe(201);
  const orgId = (await reg.json()).orgId as string;

  const proj = await api.post(`/orgs/${orgId}/projects`, { data: { name: 'Live Site', slug: `live-${stamp}` } });
  const projectId = (await proj.json()).project.id as string;
  const base = `/orgs/${orgId}/projects/${projectId}`;

  const original = {
    id: 'home',
    path: '/',
    title: 'Home',
    root: { id: 'r', type: 'Section', children: [{ id: 'h', type: 'Heading', props: { text: 'Original' } }] },
  };
  expect((await api.put(`${base}/content/page/home`, { data: original })).status()).toBe(200);

  // Mint an agent token (used from a cookieless context — a genuine 2nd channel).
  const keyRes = await api.post(`${base}/api-keys`, {
    data: { name: 'agent', role: 'admin', capabilities: ['content:read', 'content:write'], expiresInDays: 1 },
  });
  const token = (await keyRes.json()).token as string;

  // Open the pop-out live preview (authenticated by the shared session cookie).
  await page.goto(`/?live=${orgId}/${projectId}/home`);
  const frame = page.frameLocator('iframe[title="Live preview"]');
  await expect(frame.getByText('Original')).toBeVisible();
  // Wait until the change stream is connected so the upcoming write isn't missed.
  await expect(page.getByText('● live')).toBeVisible();

  // Out-of-band write via the Bearer token (no cookie → not a dual-credential req).
  const bot = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { authorization: `Bearer ${token}` },
  });
  const updated = {
    ...original,
    root: { id: 'r', type: 'Section', children: [{ id: 'h', type: 'Heading', props: { text: 'Updated by agent' } }] },
  };
  expect((await bot.put(`${base}/content/page/home`, { data: updated })).status()).toBe(200);
  await bot.dispose();

  // The preview reloads itself via SSE — no interaction in this window.
  await expect(frame.getByText('Updated by agent')).toBeVisible();
  await expect(frame.getByText('Original')).toHaveCount(0);
});
