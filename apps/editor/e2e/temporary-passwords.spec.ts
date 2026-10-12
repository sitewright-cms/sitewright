import { test, expect, request } from '@playwright/test';
import { E2E_PASSWORD, seedApiUser, signUp } from './helpers.js';

const stamp = Date.now();
const baseURL = (): string => process.env.E2E_BASE_URL ?? 'http://dind.local:2003';
const OWN_PASSWORD = 'Their-own-pw-9';

// A password somebody else generated is TEMPORARY: whoever generated it has seen it. These two specs
// drive both ways one comes to exist, from the screen that hands it over to the person who receives it.

test('a member added without the invite link has to replace the temporary password before anything else', async ({ page, browser }) => {
  const clientEmail = `client-tp-${stamp}@e2e.test`;
  await signUp(page, `owner-tp-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Temp Site');
  await page.getByLabel('Project slug').fill(`tp-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // --- The owner invites, then approves without the link ---
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Project Members' }).click();
  const members = page.getByRole('dialog', { name: 'Project Members' });
  await members.getByLabel('Project member email').fill(clientEmail);
  await members.getByRole('button', { name: 'Invite project member' }).click();
  await members.getByRole('button', { name: `Approve ${clientEmail} now` }).click();
  // Told before approving what kind of password this will be.
  await expect(page.getByText(/a temporary password is shown ONCE — they choose their own the first time they sign in/)).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();

  // The panel says what to tell the person it is handed to: temporary, and until when.
  const panel = members.getByRole('status');
  await expect(panel).toContainText(`Temporary password for ${clientEmail}`);
  await expect(panel).toContainText(/asked to choose their own password the first time they sign in, and this one stops working on .+ if they have not/);
  const temporary = (await panel.locator('code').textContent())?.trim() ?? '';
  expect(temporary).toHaveLength(20);

  // --- The member, in a browser of their own ---
  const theirs = await browser.newContext();
  const member = await theirs.newPage();
  await member.goto('/');
  await member.getByLabel('Email').fill(clientEmail);
  await member.getByRole('textbox', { name: 'Password' }).fill(temporary);
  await member.getByRole('button', { name: 'Sign in' }).click();

  // Not the editor: the one screen this session gets.
  await expect(member.getByText('Choose a new password')).toBeVisible();
  await expect(member.getByText(/is on a temporary password that someone else issued/)).toBeVisible();
  await expect(member.getByRole('button', { name: /Temp Site/ })).toHaveCount(0);

  // And it is a hard gate, not a screen in front of a working session: with this browser's own cookie
  // the server answers nothing else — a READ included — and `/me` lists no project.
  const held = await member.request.get('/projects');
  expect(held.status()).toBe(403);
  expect(((await held.json()) as { error: string }).error).toBe('password-change-required');
  const me = (await (await member.request.get('/me')).json()) as { mustChangePassword: boolean; temporaryPassword: boolean; projects: unknown[] };
  expect(me).toMatchObject({ mustChangePassword: true, temporaryPassword: true, projects: [] });

  // "Replacing" it with itself is refused — the person who handed it over would still know it. (The
  // generated password satisfies the policy, so only the server can say no.)
  await member.getByLabel('Temporary password').fill(temporary);
  await member.getByLabel('New password', { exact: true }).fill(temporary);
  await member.getByLabel('Confirm new password').fill(temporary);
  await member.getByRole('button', { name: /Set new password/ }).click();
  await expect(member.getByText(/choose a new password — the current one has to be replaced/)).toBeVisible();

  // Their own password lets them in, to the project they were added to.
  await member.getByLabel('New password', { exact: true }).fill(OWN_PASSWORD);
  await member.getByLabel('Confirm new password').fill(OWN_PASSWORD);
  await member.getByRole('button', { name: /Set new password/ }).click();
  await expect(member.getByRole('button', { name: /Temp Site/ })).toBeVisible();
  expect((await member.request.get('/projects')).status()).toBe(200);

  // The copy the owner saw is dead; the one its owner chose works.
  const fresh = await request.newContext({ baseURL: baseURL() });
  expect((await fresh.post('/auth/login', { data: { email: clientEmail, password: temporary } })).status()).toBe(401);
  expect((await fresh.post('/auth/login', { data: { email: clientEmail, password: OWN_PASSWORD } })).status()).toBe(200);
  await theirs.close();
});

test('a password an admin issues holds the account’s open session until it has been replaced', async ({ page, browser }) => {
  const devEmail = `dev-tp-${stamp}@e2e.test`;
  // A developer who is signed in somewhere, working.
  const working = await seedApiUser(baseURL(), devEmail);
  expect((await working.get('/projects')).status()).toBe(200);

  // --- The admin issues them a new password ---
  await signUp(page, `admin-tp-${stamp}@e2e.test`, 'admin');
  const selector = page.getByRole('dialog', { name: 'SiteWright' });
  await expect(selector).toBeVisible();
  await selector.getByRole('button', { name: 'Close' }).click();
  await expect(selector).toBeHidden();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Administrators' }).click();
  const team = page.getByRole('dialog', { name: 'Administrators' });
  await team.getByRole('button', { name: `Issue a new password for ${devEmail}` }).click();
  // The confirmation says the part that would otherwise surprise.
  await expect(page.getByText(/It is temporary: they cannot use the editor until they have signed in with it and chosen their own \(or signed in through single sign-on, which discards it\), and it stops working after 7 days/)).toBeVisible();
  await page.getByRole('button', { name: 'Issue new password' }).click();
  const panel = team.getByRole('status');
  await expect(panel).toContainText(`Temporary password for ${devEmail}`);
  const temporary = (await panel.locator('code').textContent())?.trim() ?? '';

  // --- The session that was already open is no longer an identity ---
  const held = await working.get('/projects');
  expect(held.status()).toBe(403);
  expect(((await held.json()) as { error: string }).error).toBe('password-change-required');
  // …and the password it was opened with is gone.
  const fresh = await request.newContext({ baseURL: baseURL() });
  expect((await fresh.post('/auth/login', { data: { email: devEmail, password: E2E_PASSWORD } })).status()).toBe(401);

  // --- The developer signs in with what the admin handed over, and replaces it ---
  const theirs = await browser.newContext();
  const dev = await theirs.newPage();
  await dev.goto('/');
  await dev.getByLabel('Email').fill(devEmail);
  await dev.getByRole('textbox', { name: 'Password' }).fill(temporary);
  await dev.getByRole('button', { name: 'Sign in' }).click();
  await expect(dev.getByText(/is on a temporary password that someone else issued/)).toBeVisible();
  await dev.getByLabel('Temporary password').fill(temporary);
  await dev.getByLabel('New password', { exact: true }).fill(OWN_PASSWORD);
  await dev.getByLabel('Confirm new password').fill(OWN_PASSWORD);
  await dev.getByRole('button', { name: /Set new password/ }).click();
  // Through: the project selector of a signed-in developer.
  await expect(dev.getByRole('button', { name: 'New project' })).toBeVisible();
  // Replacing the password signed every OTHER session out, the old one included.
  expect((await working.get('/projects')).status()).toBe(401);
  await theirs.close();
});

// An agent's sign-in window (`/oauth/authorize`) opened by someone still on a temporary password. The
// consent page does not recognize that session and sends it back to the editor — which used to send it
// straight back again, since it WAS signed in: two redirects chasing each other until the rate limiter
// stopped them. The forced screen has to stand in between, and hand over once it is done.
test('an agent authorization waits behind the forced screen instead of looping, then resumes', async ({ page }) => {
  const devEmail = `dev-next-${stamp}@e2e.test`;
  const dev = await seedApiUser(baseURL(), devEmail);
  // A project of their own, so the consent page has something to offer once it is reached.
  expect((await dev.post('/projects', { data: { name: 'Next Site', slug: `next-${stamp}` } })).status()).toBe(201);
  const admin = await seedApiUser(baseURL(), `admin-next-${stamp}@e2e.test`, 'admin');
  const staff = (await (await admin.get('/admin/users')).json()) as { members: Array<{ userId: string; email: string }> };
  const issued = await admin.post(`/admin/users/${staff.members.find((u) => u.email === devEmail)!.userId}/password`, { data: {} });
  expect(issued.status()).toBe(200);
  const temporary = ((await issued.json()) as { password: string }).password;

  const q = new URLSearchParams({
    client_id: 'sitewright-cli',
    redirect_uri: 'http://127.0.0.1:8976/callback',
    response_type: 'code',
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
    scope: 'content:read',
    state: 'st',
  });
  let authorizeHits = 0;
  page.on('request', (r) => {
    if (r.isNavigationRequest() && new URL(r.url()).pathname === '/oauth/authorize') authorizeHits++;
  });

  // Signed out: bounced to the editor's sign-in, the authorization kept in `next`.
  await page.goto(`/oauth/authorize?${q.toString()}`);
  await page.getByLabel('Email').fill(devEmail);
  await page.getByRole('textbox', { name: 'Password' }).fill(temporary);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Signed in on the temporary password: the forced screen, and it STAYS — no bouncing.
  await expect(page.getByText(/is on a temporary password that someone else issued/)).toBeVisible();
  await page.waitForTimeout(1500);
  expect(authorizeHits, 'only the visit that started it').toBe(1);
  expect(new URL(page.url()).searchParams.get('next')).toContain('/oauth/authorize');

  // Replacing the password is what the consent page was waiting for.
  await page.getByLabel('Temporary password').fill(temporary);
  await page.getByLabel('New password', { exact: true }).fill(OWN_PASSWORD);
  await page.getByLabel('Confirm new password').fill(OWN_PASSWORD);
  await page.getByRole('button', { name: /Set new password/ }).click();
  await expect(page.getByRole('heading', { name: /Authorize/ })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/oauth/authorize');
  expect(authorizeHits).toBe(2);
});
