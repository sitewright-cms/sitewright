import { test, expect } from '@playwright/test';

// Flat-tenancy end-to-end coverage (post org-removal): platform admin reach, the project
// invite → member flow, the constrained-write relaxation (members edit freely), per-project
// isolation, and the platform-staff invite being admin-gated. Runs against the deployed DinD
// instance (baseURL); `:orgId` in the paths is the vestigial constant 'platform'.
//
// NOTE: registration is rate-limited per IP (10/min). This spec registers exactly TWO users and is
// meant to be run on its own or spaced from the other suites that also register.

const stamp = Date.now();
const ADMIN_EMAIL = 'admin@sitewright.example';
const ADMIN_PW = process.env.SW_ADMIN_PASSWORD ?? '123456';

test('project invite → member edits freely; isolation holds; platform invite is admin-gated', async ({
  playwright,
  baseURL,
}) => {
  const admin = await playwright.request.newContext({ baseURL });
  const client = await playwright.request.newContext({ baseURL });

  // ---- Platform admin signs in (seeded with platform_role='admin') ----
  expect((await admin.post('/auth/login', { data: { email: ADMIN_EMAIL, password: ADMIN_PW } })).status()).toBe(200);
  const me = await (await admin.get('/me')).json();
  expect(me.isInstanceAdmin).toBe(true);
  expect(me.platformRole).toBe('admin');
  // A platform admin reaches every project as owner; the seeded Example Project is visible.
  expect((me.projectAccess as Array<{ projectSlug: string }>).some((p) => p.projectSlug === 'example')).toBe(true);

  // ---- Admin creates a project (becomes its owner, atomically) ----
  const created = await admin.post('/orgs/platform/projects', {
    data: { name: 'Tenancy E2E', slug: `tenancy-e2e-${stamp}` },
  });
  expect(created.status()).toBe(201);
  const projectId = (await created.json()).project.id as string;

  // Seed a page so the member has something to read/extend.
  expect(
    (
      await admin.put(`/orgs/platform/projects/${projectId}/content/page/home`, {
        data: { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' } },
      })
    ).status(),
  ).toBe(200);

  // ---- Admin invites a client to THIS project (project invite → role 'member') ----
  const inv = await admin.post(`/orgs/platform/projects/${projectId}/invites`, {
    data: { email: `member-${stamp}@e2e.test` },
  });
  expect(inv.status()).toBe(201);
  const inviteBody = await inv.json();
  expect(inviteBody.invite.role).toBe('member');
  expect(inviteBody.invite.projectId).toBe(projectId);
  const token = inviteBody.token as string;

  // peek masks the email and surfaces the project (no orgName field in the flat model).
  const peek = await (await admin.get(`/invites/peek?token=${encodeURIComponent(token)}`)).json();
  expect(peek.invite.role).toBe('member');
  expect(peek.invite.email).not.toBe(`member-${stamp}@e2e.test`);

  // ---- Client registers (open registration; orgName not required) and accepts ----
  expect(
    (await client.post('/auth/register', { data: { email: `member-${stamp}@e2e.test`, password: 'pw-secret-1' } })).status(),
  ).toBe(201);
  const accept = await client.post('/invites/accept', { data: { token } });
  expect(accept.status()).toBe(200);
  expect(await accept.json()).toMatchObject({ projectId, role: 'member' });

  // /me surfaces ONLY the invited project, as a member.
  const clientMe = await (await client.get('/me')).json();
  expect(clientMe.platformRole).toBeNull();
  expect((clientMe.projectAccess as Array<{ projectId: string; role: string }>)).toEqual([
    expect.objectContaining({ projectId, role: 'member' }),
  ]);

  // ---- Constrained-write relaxation: a member writes freely (all kinds) ----
  expect(
    (
      await client.put(`/orgs/platform/projects/${projectId}/content/page/about`, {
        data: { id: 'about', path: '/about', title: 'About', root: { id: 'r', type: 'Section' } },
      })
    ).status(),
  ).toBe(200);
  // …and may publish the project.
  expect((await client.post(`/orgs/platform/projects/${projectId}/publish`, { data: {} })).status()).toBe(200);

  // ---- Isolation: the member cannot reach the admin's other (Example) project ----
  const example = (me.projectAccess as Array<{ projectId: string; projectSlug: string }>).find(
    (p) => p.projectSlug === 'example',
  );
  if (example) {
    expect((await client.get(`/orgs/platform/projects/${example.projectId}/content/page`)).status()).toBe(403);
  }

  // ---- Platform-staff invite is platform-admin-only ----
  // The plain member cannot invite platform staff.
  expect(
    (await client.post('/orgs/platform/invites', { data: { email: `dev-${stamp}@e2e.test` } })).status(),
  ).toBe(403);
  // The admin can (grants the 'developer' platform role; no project).
  const platformInvite = await admin.post('/orgs/platform/invites', {
    data: { email: `dev-${stamp}@e2e.test`, role: 'developer' },
  });
  expect(platformInvite.status()).toBe(201);
  expect((await platformInvite.json()).invite).toMatchObject({ role: 'developer', projectId: null });

  await admin.dispose();
  await client.dispose();
});
