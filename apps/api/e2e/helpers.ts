import type { APIRequestContext, PlaywrightWorkerArgs } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Seed a signed-in E2E user.
 *
 * These specs used to call `/auth/register` directly. That stopped working when registration became
 * INVITATION-ONLY: there is no self-registration toggle any more, so every register call returns 403 and
 * fifteen specs failed at their first assertion. The deploy script still tried to flip a setting that no
 * longer exists, and swallowed the failure — so the breakage was silent from both ends.
 *
 * The supported path is the one a real operator uses: a platform admin issues an invite, the invitee
 * registers against it, then accepts. That is what this does, so the harness exercises the real flow
 * rather than a bypass.
 */

/** The seeded platform admin. MUST match what the deploy script seeds (SW_ADMIN_EMAIL/PASSWORD) —
 *  specs that hardcoded their own values drifted from the container and failed to log in. */
export const ADMIN_EMAIL = process.env.SW_E2E_ADMIN_EMAILS ?? 'admin@e2e.test';
export const ADMIN_PASSWORD = process.env.SW_E2E_ADMIN_PASSWORD ?? 'Pw-secret-1';
export const E2E_PASSWORD = 'Pw-secret-1';

/** A signed-in platform-admin context. Dispose it when done. */
export async function adminContext(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string | undefined,
): Promise<APIRequestContext> {
  const ctx = await playwright.request.newContext({ baseURL });
  const res = await ctx.post('/auth/login', { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  expect(res.status(), 'the seeded platform admin must be able to log in').toBe(200);
  return ctx;
}

/**
 * Invite `email` as platform staff and return the invite token. Requires an admin context.
 * `role` defaults to `developer`, which is what project creation requires.
 */
export async function invite(
  admin: APIRequestContext,
  email: string,
  role: 'developer' | 'admin' = 'developer',
): Promise<string> {
  const res = await admin.post('/admin/invites', { data: { email, role } });
  expect(res.status(), `inviting ${email}`).toBe(201);
  return (await res.json()).token as string;
}

/**
 * The whole chain: invite → register → accept. Returns a context holding that user's session, ready to
 * create projects. Pass an existing `admin` context to avoid a second admin login per user.
 */
export async function seedUser(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string | undefined,
  email: string,
  opts: { role?: 'developer' | 'admin'; admin?: APIRequestContext } = {},
): Promise<APIRequestContext> {
  const ownAdmin = opts.admin ? null : await adminContext(playwright, baseURL);
  const admin = opts.admin ?? ownAdmin!;
  try {
    const token = await invite(admin, email, opts.role ?? 'developer');
    const ctx = await playwright.request.newContext({ baseURL });
    const reg = await ctx.post('/auth/register', { data: { email, password: E2E_PASSWORD } });
    expect(reg.status(), `registering ${email} against its invite`).toBe(201);
    const accepted = await ctx.post('/invites/accept', { data: { token } });
    expect(accepted.status(), `accepting the invite for ${email}`).toBe(200);
    return ctx;
  } finally {
    await ownAdmin?.dispose();
  }
}

/**
 * Give a project a Local Hosting deploy target, which is what makes `/sites/<slug>/…` serve.
 *
 * Publishing alone is not enough and never was an oversight: the local target CARRIES the serve options
 * (preview token, etc.), so without one the route deliberately behaves as if nothing is published. Specs
 * that publish and then fetch the exported site predate that rule and 404ed on a successful publish.
 */
export async function enableLocalHosting(ctx: APIRequestContext, projectId: string): Promise<void> {
  const res = await ctx.post(`/projects/${projectId}/deploy-targets`, {
    data: { name: 'Local', protocol: 'local' },
  });
  // 409 = one already exists, which is just as good.
  expect([201, 409], 'creating the local hosting target').toContain(res.status());
}

/** A unique-per-run suffix so re-runs against the same deployed DB never collide. */
export const stamp = (): string => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
