import { test, expect } from '@playwright/test';

// Unique per run so re-runs against the same deployed DB don't collide.
const stamp = Date.now();

test('multi-tenant isolation over HTTP (the core guarantee)', async ({ playwright, baseURL }) => {
  // Independent cookie jars = two separate logged-in tenants.
  const a = await playwright.request.newContext({ baseURL });
  const b = await playwright.request.newContext({ baseURL });

  const regA = await a.post('/auth/register', {
    data: { email: `a-${stamp}@e2e.test`, password: 'pw-secret-1' },
  });
  expect(regA.status()).toBe(201);
  const regB = await b.post('/auth/register', {
    data: { email: `b-${stamp}@e2e.test`, password: 'pw-secret-1' },
  });
  expect(regB.status()).toBe(201);

  // A creates a project (session cookie carried by context `a`).
  const created = await a.post(`/projects`, {
    data: { name: 'Secret', slug: `secret-${stamp}` },
  });
  expect(created.status()).toBe(201);
  const projectId = (await created.json()).project.id as string;

  // A can read its own project.
  expect((await a.get(`/projects/${projectId}`)).status()).toBe(200);

  // Flat model: the project list is per-user. B's list succeeds (200) but contains only B's own
  // projects — never A's (no cross-tenant leak).
  const bList = await b.get(`/projects`);
  expect(bList.status()).toBe(200);
  const bProjects = (await bList.json()).projects as Array<{ id: string }>;
  expect(bProjects.some((p) => p.id === projectId)).toBe(false);

  // B is not a member of A's project → reading it directly is forbidden (403, no existence oracle).
  expect((await b.get(`/projects/${projectId}`)).status()).toBe(403);

  await a.dispose();
  await b.dispose();
});

test('unauthenticated access is rejected', async ({ playwright, baseURL }) => {
  const anon = await playwright.request.newContext({ baseURL });
  expect((await anon.get('/me')).status()).toBe(401);
  await anon.dispose();
});

test('login flow issues a working session', async ({ playwright, baseURL }) => {
  const ctx = await playwright.request.newContext({ baseURL });
  const email = `login-${stamp}@e2e.test`;
  expect(
    (
      await ctx.post('/auth/register', {
        data: { email, password: 'pw-secret-1' },
      })
    ).status(),
  ).toBe(201);
  await ctx.post('/auth/logout');
  const login = await ctx.post('/auth/login', {
    data: { email, password: 'pw-secret-1' },
  });
  expect(login.status()).toBe(200);
  expect((await ctx.get('/me')).status()).toBe(200);
  await ctx.dispose();
});
