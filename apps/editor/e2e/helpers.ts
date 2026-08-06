import { expect, request, type APIResponse, type Page } from '@playwright/test';

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
 * ONE admin session per worker, not one per seeded user.
 *
 * Every seed needs an admin to issue the invite, and a full run seeds ~50 users — which is ~50 logins
 * against `/auth/login`, whose rate limiter allows 20 per window. The suite tripped its own 429 and
 * reported it as "the seeded platform admin must be able to log in", which reads like a broken slot.
 * Logging in once and reusing the context removes the whole class of failure.
 */
let adminCtx: Promise<APIRequestContext> | null = null;
function admin(): Promise<APIRequestContext> {
  adminCtx ??= (async () => {
    const ctx = await request.newContext({ baseURL: baseURL() });
    const res = await ctx.post('/auth/login', { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    expect(res.status(), 'the seeded platform admin must be able to log in').toBe(200);
    return ctx;
  })();
  return adminCtx;
}

/** Invite `email` and return the token. Uses the shared admin session. */
async function inviteUser(email: string, role: 'developer' | 'admin'): Promise<string> {
  const res = await (await admin()).post('/admin/invites', { data: { email, role } });
  expect(res.status(), `inviting ${email}`).toBe(201);
  return (await res.json()).token as string;
}

/**
 * Invite → register → accept, leaving `page` signed in as `email` and sitting on the app root.
 *
 * `role` defaults to `developer`, which is what creating a project requires; pass `admin` for the
 * specs that assert instance-admin surfaces.
 */
export async function signUp(page: Page, email: string, role: 'developer' | 'admin' = 'developer'): Promise<void> {
  const token = await inviteUser(email, role);
  const reg = await page.request.post('/auth/register', { data: { email, password: E2E_PASSWORD } });
  expect(reg.status(), `registering ${email} against its invite`).toBe(201);
  const accepted = await page.request.post('/invites/accept', { data: { token } });
  expect(accepted.status(), `accepting the invite for ${email}`).toBe(200);
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


/**
 * Deploy the open project to Local Hosting and return the path its live site is served at.
 *
 * Replaces the old one-click `Publish` + `Publish actions` menu, which no longer exists. Deploying is
 * TARGET-DRIVEN now: with no target the Deploy button opens the wizard, and `/sites/<slug>/` does not
 * serve until a Local Hosting target carries the serve options. Configured through the UI on purpose —
 * creating the target over the API leaves the already-mounted PublishBar unaware of it, and a reload
 * does not help because the SPA keeps project selection in STATE, so it lands back on the project list.
 */
export async function deployLocally(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Deploy', exact: true }).click();
  // Pick the card by its heading text — `getByText('Local Hosting')` also matches the "already
  // configured" note and the summary row, and clicking those closes the wizard instead.
  await page.getByRole('button').filter({ hasText: 'Local Hosting' }).first().click();
  await page.getByRole('button', { name: 'Save target' }).click();
  // Saving returns the wizard to its target LIST and leaves the modal open (you may be adding several).
  // PublishDeployModal bumps the bar's refresh signal ON CLOSE, so the bar still reads "Deploy" — i.e.
  // "no target" — until the modal is dismissed. Close it, as a user does, or the split button never appears.
  await page.getByRole('button', { name: 'Close' }).first().click();
  await page.getByRole('button', { name: /^Deploy to / }).click();
  const view = page.getByRole('link', { name: 'View the live site' });
  await expect(view).toBeVisible({ timeout: 60_000 });
  const href = await view.getAttribute('href');
  // Local hosting serves on `<slug>.<SW_SITES_DOMAIN>` when that is configured (the /sites/<slug>/ path
  // 301s there), so do NOT pin a path shape — assert only that a live address was advertised.
  expect(href, 'the deployed site must advertise a live address').toBeTruthy();
  return href!;
}

/**
 * Fetch a page of the deployed local site.
 *
 * Local hosting SERVES on `<slug>.<SW_SITES_DOMAIN>` when that is configured (which the E2E slot does,
 * because apps/api/e2e/forms.spec.ts covers subdomain serving) and `/sites/<slug>/` 301s there. The DinD
 * host has no wildcard DNS, so neither a browser navigation nor a redirect-following request can reach
 * that name — send an explicit Host header instead, the same technique the API spec uses.
 */
export async function liveSiteRequest(page: Page, slug: string, path = '/'): Promise<APIResponse> {
  const u = new URL(baseURL());
  const host = `${slug}.${process.env.SW_E2E_SITES_DOMAIN ?? u.hostname}${u.port ? `:${u.port}` : ''}`;
  return page.request.get(`${baseURL()}${path}`, { headers: { Host: host } });
}

/** The common case: assert a 200 and hand back the HTML. */
export async function fetchLiveSite(page: Page, slug: string, path = '/'): Promise<{ status: number; html: string }> {
  const res = await liveSiteRequest(page, slug, path);
  return { status: res.status(), html: await res.text() };
}

/**
 * The API-context form of `signUp`, for a `beforeAll` that seeds over HTTP rather than driving a page.
 * Same invite -> register -> accept chain; returns that user's context. Dispose it when done.
 */
export async function seedApiUser(baseUrl: string, email: string, role: 'developer' | 'admin' = 'developer') {
  const token = await inviteUser(email, role);
  const ctx = await request.newContext({ baseURL: baseUrl });
  expect((await ctx.post('/auth/register', { data: { email, password: E2E_PASSWORD } })).status()).toBe(201);
  expect((await ctx.post('/invites/accept', { data: { token } })).status()).toBe(200);
  return ctx;
}

/**
 * Dismiss the first-load PROJECT SELECTOR.
 *
 * On first load the app shows the selector as a full-screen `fixed inset-0` overlay, so the header
 * behind it (Account, Settings…) is unreachable — a plain click times out on actionability and even a
 * forced click lands on the overlay. Specs that open or create a project close it implicitly; specs
 * that go straight to a header control must dismiss it. Waits for it to actually be up first, or the
 * Escape fires before it renders and does nothing.
 */
export async function dismissProjectSelector(page: Page): Promise<void> {
  const account = page.getByRole('button', { name: 'Account' });
  await expect(account).toBeVisible();
  for (let i = 0; i < 10; i++) {
    const covered = await account.evaluate((el) => {
      const b = el.getBoundingClientRect();
      const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return !(top === el || el.contains(top));
    });
    if (!covered) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
}
