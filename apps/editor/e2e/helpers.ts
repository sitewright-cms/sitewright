import { expect, request, type Page } from '@playwright/test';

/**
 * Seed a signed-in E2E user for a BROWSER spec.
 *
 * These specs each carried their own copy of a UI sign-up flow:
 *
 *     await page.getByRole('button', { name: /Register/ }).click();
 *     await page.getByLabel('Email').fill(email);
 *     …
 *     await page.getByRole('button', { name: 'Create account' }).click();
 *
 * That flow no longer exists. Registration became INVITATION-ONLY — unconditionally, there is no
 * self-registration setting any more — and the login screen's register affordance went with it
 * (`Login.tsx` only opens register mode for `allowRegister`, which only the invite landing passes).
 * So 47 of 52 specs waited 30s for a button that is never rendered. The deploy script meanwhile still
 * PUT `allowSelfRegistration` at `/admin/settings`, where nothing reads it — the endpoint answers 200
 * and ignores the key, so the breakage was invisible from both ends. The API suite was migrated to the
 * real flow (see apps/api/e2e/helpers.ts); this is the browser half of the same fix.
 *
 * The supported path is the one a real operator uses: a platform admin issues an invite, the invitee
 * registers against it, then accepts. Done over HTTP through `page.request`, which SHARES the browser
 * context's cookie jar — so the session cookie it receives signs the page itself in, and the spec
 * resumes at the point its old UI flow reached, with no bypass of the real auth path.
 *
 * ONE shared helper on purpose: 70 hand-copied duplicates are why the rot spread across the whole
 * suite and why nothing pointed at a single cause when it broke.
 */

/** The seeded platform admin — MUST match what `scripts/e2e-deploy.sh` seeds. */
const ADMIN_EMAIL = process.env.SW_E2E_ADMIN_EMAILS ?? 'admin@e2e.test';
const ADMIN_PASSWORD = process.env.SW_E2E_ADMIN_PASSWORD ?? 'Pw-secret-1';
export const E2E_PASSWORD = 'Pw-secret-1';

const baseURL = (): string => process.env.E2E_BASE_URL ?? 'http://dind.local:2003';

/**
 * Invite → register → accept, leaving `page` signed in as `email` and sitting on the app root.
 *
 * `role` defaults to `developer`, which is what creating a project requires; pass `admin` for the
 * specs that assert instance-admin surfaces.
 */
export async function signUp(page: Page, email: string, role: 'developer' | 'admin' = 'developer'): Promise<void> {
  // A SEPARATE context for the admin: logging the admin in through `page.request` would put ITS session
  // in the browser jar, and the spec would be driving the UI as the wrong user.
  const admin = await request.newContext({ baseURL: baseURL() });
  try {
    const login = await admin.post('/auth/login', { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    expect(login.status(), 'the seeded platform admin must be able to log in').toBe(200);
    const inv = await admin.post('/admin/invites', { data: { email, role } });
    expect(inv.status(), `inviting ${email}`).toBe(201);
    const token = (await inv.json()).token as string;

    const reg = await page.request.post('/auth/register', { data: { email, password: E2E_PASSWORD } });
    expect(reg.status(), `registering ${email} against its invite`).toBe(201);
    const accepted = await page.request.post('/invites/accept', { data: { token } });
    expect(accepted.status(), `accepting the invite for ${email}`).toBe(200);
  } finally {
    await admin.dispose();
  }
  await page.goto('/');
}

/** Sign up, then create a project through the UI — the opening move of most specs. */
export async function signUpWithProject(page: Page, email: string, name: string, slug: string): Promise<void> {
  await signUp(page, email);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill(name);
  await page.getByLabel('Project slug').fill(slug);
  await page.getByRole('button', { name: 'Create project' }).click();
}

/**
 * Sign the page in as the SEEDED platform admin, which already exists — so it is a login, not a sign-up.
 * For the specs that assert instance-admin surfaces (the global snippet/template library).
 */
export async function signInAsAdmin(page: Page): Promise<void> {
  const res = await page.request.post('/auth/login', { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  expect(res.status(), 'the seeded platform admin must be able to log in').toBe(200);
  await page.goto('/');
}

