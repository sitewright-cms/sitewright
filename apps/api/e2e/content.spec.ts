import { test, expect } from '@playwright/test';

const stamp = Date.now();

test('content lifecycle + export over HTTP', async ({ playwright, baseURL }) => {
  const ctx = await playwright.request.newContext({ baseURL });

  const reg = await ctx.post('/auth/register', {
    data: { email: `content-${stamp}@e2e.test`, password: 'pw-secret-1', orgName: `Content ${stamp}` },
  });
  expect(reg.status()).toBe(201);
  const orgId = (await reg.json()).orgId as string;

  const proj = await ctx.post(`/orgs/${orgId}/projects`, {
    data: { name: 'Site', slug: `site-${stamp}` },
  });
  expect(proj.status()).toBe(201);
  const projectId = (await proj.json()).project.id as string;
  const base = `/orgs/${orgId}/projects/${projectId}`;

  const page = { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' } };
  const put = await ctx.put(`${base}/content/page/home`, { data: page });
  expect(put.status()).toBe(200);

  const get = await ctx.get(`${base}/content/page/home`);
  expect((await get.json()).item.title).toBe('Home');

  const exp = await ctx.get(`${base}/export`);
  expect(exp.status()).toBe(200);
  expect((await exp.json()).pages).toHaveLength(1);

  // invalid payload rejected at the boundary
  const bad = await ctx.put(`${base}/content/page/home`, { data: { id: 'home', title: 'x' } });
  expect(bad.status()).toBe(400);

  await ctx.dispose();
});
