import { test, expect } from '@playwright/test';

// Unique per run so re-runs against the same deployed DB don't collide.
const stamp = Date.now();

// Full project-API-key lifecycle over real HTTP: a session mints a scoped token,
// a *separate, cookieless* client uses it as a Bearer to author content, and the
// confinement / capability / revocation guarantees hold end-to-end.
test('project API key: mint via session, use as Bearer, enforce scope + revoke', async ({
  playwright,
  baseURL,
}) => {
  const session = await playwright.request.newContext({ baseURL });

  const reg = await session.post('/auth/register', {
    data: { email: `keys-${stamp}@e2e.test`, password: 'pw-secret-1', orgName: `Keys ${stamp}` },
  });
  expect(reg.status()).toBe(201);
  const orgId = (await reg.json()).orgId as string;

  const created = await session.post(`/orgs/${orgId}/projects`, {
    data: { name: 'Keyed', slug: `keyed-${stamp}` },
  });
  expect(created.status()).toBe(201);
  const projectId = (await created.json()).project.id as string;
  const base = `/orgs/${orgId}/projects/${projectId}`;

  // Mint a read+write token (the raw token is returned exactly once).
  const mint = await session.post(`${base}/api-keys`, {
    data: { name: 'ci', role: 'admin', capabilities: ['content:read', 'content:write'], expiresInDays: 7 },
  });
  expect(mint.status()).toBe(201);
  const { token, key } = await mint.json();
  expect(token).toMatch(/^swk_/);

  // A cookieless client authenticates purely by Bearer token.
  const bot = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { authorization: `Bearer ${token}` },
  });

  // Write a page, then read it back — the round-trip goes through the same
  // guarded content repo as the editor.
  const page = { id: 'home', path: '/', title: 'Hallo', root: { id: 'r', type: 'Section' } };
  const put = await bot.put(`${base}/content/page/home`, { data: page });
  expect(put.status()).toBe(200);
  const got = await bot.get(`${base}/content/page/home`);
  expect(got.status()).toBe(200);
  expect((await got.json()).item.title).toBe('Hallo');

  // Capability ceiling: this token has no `publish`/`deploy`/`session-only` access.
  expect((await bot.post(`${base}/publish`)).status()).toBe(403);
  expect((await bot.get(`${base}/api-keys`)).status()).toBe(403); // session-only

  // Confinement: a second org/project is unreachable with this token (404, not 403).
  const other = await playwright.request.newContext({ baseURL });
  const regO = await other.post('/auth/register', {
    data: { email: `other-${stamp}@e2e.test`, password: 'pw-secret-1', orgName: `Other ${stamp}` },
  });
  const orgO = (await regO.json()).orgId as string;
  const projO = await other.post(`/orgs/${orgO}/projects`, { data: { name: 'O', slug: `o-${stamp}` } });
  const projectO = (await projO.json()).project.id as string;
  expect((await bot.get(`/orgs/${orgO}/projects/${projectO}/content/page`)).status()).toBe(404);

  // Revoke via the session → the Bearer token stops working immediately.
  expect((await session.delete(`${base}/api-keys/${key.id}`)).status()).toBe(204);
  expect((await bot.get(`${base}/content/page/home`)).status()).toBe(401);

  await bot.dispose();
  await other.dispose();
  await session.dispose();
});
