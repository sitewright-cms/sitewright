import { test, expect, request } from '@playwright/test';
import { E2E_PASSWORD, seedApiUser, signUp } from './helpers.js';

const stamp = Date.now();
const baseURL = (): string => process.env.E2E_BASE_URL ?? 'http://dind.local:2003';

// Account → Access keys → Member tokens: mint a token from the editor, then use it — with no session
// and no project key — to create a project, write to it, and see it appear in the member's own
// project list. The point of a member token is exactly this loop, so the spec drives the whole of it.
test('a member token created in the editor creates and manages a project on its own', async ({ page }) => {
  await signUp(page, `member-token-${stamp}@e2e.test`);

  // After auth the project selector auto-opens. Dismiss it WITHOUT opening anything: member tokens
  // belong to the member, so the section has to be available with no project open at all.
  const selector = page.getByRole('dialog', { name: 'SiteWright' });
  await expect(selector).toBeVisible();
  await selector.getByRole('button', { name: 'Close' }).click();
  await expect(selector).toBeHidden();
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Account Settings' }).click();
  const account = page.getByRole('dialog', { name: 'Account' });
  await account.getByRole('button', { name: 'Access keys' }).click();

  // Both sections are there, and the project one explains why it is empty.
  const projectTokens = account.getByRole('region', { name: 'Project tokens' });
  const memberTokens = account.getByRole('region', { name: 'Member tokens' });
  await expect(projectTokens.getByText(/Open a project you own/)).toBeVisible();
  await expect(memberTokens.getByText('every project you can open')).toBeVisible();

  // The account-wide capabilities start OFF; turn on only "Create projects".
  const createProjects = memberTokens.getByRole('checkbox', { name: /^Create projects/ });
  await expect(createProjects).not.toBeChecked();
  await expect(memberTokens.getByRole('checkbox', { name: /^Delete projects/ })).not.toBeChecked();
  await expect(memberTokens.getByRole('checkbox', { name: /^Invite and add members/ })).not.toBeChecked();
  await memberTokens.getByLabel('Member token name').fill('Site fleet');
  // A daily limit is only asked for once the token may create projects; it starts at the instance
  // maximum and is lowered here to ONE, so the limit can be seen to bind below.
  await expect(memberTokens.getByLabel('New projects per day')).toHaveCount(0);
  await createProjects.check();
  await expect(memberTokens.getByLabel('New projects per day')).toHaveValue('50');
  await memberTokens.getByLabel('New projects per day').fill('1');
  // Minting is confirmed with the password — the button stays disabled until it is given.
  const create = memberTokens.getByRole('button', { name: 'Create member token' });
  await expect(create).toBeDisabled();
  await memberTokens.getByLabel('Your password').fill(E2E_PASSWORD);
  await create.click();

  const tokenBox = account.getByLabel('New member token');
  await expect(tokenBox).toContainText(/^swm_[0-9a-f]{64}$/);
  const token = (await tokenBox.textContent())?.trim() ?? '';
  await expect(memberTokens.getByText('content:read, content:write, projects:create · up to 1 new projects a day')).toBeVisible();

  // ---- the token, alone: a fresh request context with NO cookies ----
  const api = await request.newContext({ baseURL: baseURL(), extraHTTPHeaders: { authorization: `Bearer ${token}` } });
  const slug = `fleet-${stamp}`;
  const made = await api.post('/projects', { data: { name: 'Fleet Site', slug } });
  expect(made.status()).toBe(201);
  const projectId = ((await made.json()) as { project: { id: string } }).project.id;

  // Usable immediately with the same token — no per-project key was minted.
  const page1 = { id: 'about', path: 'about', title: 'About', source: '<section><h1>About</h1></section>\n', order: 1 };
  expect((await api.put(`/projects/${projectId}/content/page/about`, { data: page1 })).status()).toBe(200);
  const listed = (await (await api.get('/projects')).json()) as { projects: Array<{ id: string }> };
  expect(listed.projects.map((p) => p.id)).toContain(projectId);
  // What was NOT ticked stays out of reach.
  expect((await api.delete(`/projects/${projectId}`)).status()).toBe(403);
  expect((await api.patch(`/projects/${projectId}`, { data: { name: 'Renamed' } })).status()).toBe(403);
  // …and a token can never manage tokens.
  expect((await api.get('/account/member-tokens')).status()).toBe(403);
  // The limit chosen at mint time binds: this token has made its one project for today.
  const second = await api.post('/projects', { data: { name: 'One Too Many', slug: `fleet-two-${stamp}` } });
  expect(second.status()).toBe(429);
  expect(((await second.json()) as { error: string }).error).toBe('this member token has reached its limit of 1 new projects per 24 hours');

  // ---- back in the editor: the project the token made is the member's own ----
  await account.getByRole('button', { name: 'Close' }).first().click();
  await page.reload();
  // The selector re-opens (still no project open) and now lists it.
  await expect(selector.getByText('Fleet Site')).toBeVisible();
  await selector.getByRole('button', { name: 'Close' }).click();
  await expect(selector).toBeHidden();

  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Account Settings' }).click();

  // ---- changing the password ASKS what should happen to the token ----
  await account.getByRole('button', { name: 'Password' }).click();
  await account.getByLabel('Current password').fill(E2E_PASSWORD);
  await account.getByLabel('New password', { exact: true }).fill('Pw-rotated-22');
  await account.getByLabel('Confirm new password').fill('Pw-rotated-22');
  const question = account.getByRole('group', { name: 'Member tokens' });
  await expect(question.getByText(/sign in with your member token, not with your password/)).toBeVisible();
  // Everything else is valid, yet the change will not go through until the question is answered.
  const change = account.getByRole('button', { name: 'Change password' });
  await expect(change).toBeDisabled();
  await question.getByRole('radio', { name: 'Keep it working' }).check();
  await change.click();
  await expect(page.getByText('Password changed — other sessions were signed out', { exact: true })).toBeVisible();
  // Kept: the automation is not interrupted by a routine password change.
  expect((await api.get('/projects')).status()).toBe(200);

  // Revoke → the token is dead at once.
  await account.getByRole('button', { name: 'Access keys' }).click();
  await account.getByRole('button', { name: 'Revoke member token Site fleet' }).click();
  await page.getByRole('dialog', { name: 'Revoke member token' }).getByRole('button', { name: 'Revoke' }).click();
  await expect(account.getByText(/No member tokens yet/)).toBeVisible();
  expect((await api.get('/projects')).status()).toBe(401);
  await api.dispose();
});

// System settings → Security → Member tokens: an instance admin sees a token that belongs to someone
// else — without opening any project it touched — and revokes it.
test('an admin finds another member’s token in the instance-wide list and revokes it', async ({ page }) => {
  const ownerEmail = `mt-owner-${stamp}@e2e.test`;
  const owner = await seedApiUser(baseURL(), ownerEmail);
  const minted = await owner.post('/account/member-tokens', {
    data: { name: `Fleet ${stamp}`, expiresInDays: 1, currentPassword: E2E_PASSWORD, capabilities: ['content:read', 'projects:create'], dailyProjectLimit: 3 },
  });
  expect(minted.status()).toBe(201);
  const { token } = (await minted.json()) as { token: string };
  const bearer = await request.newContext({ baseURL: baseURL(), extraHTTPHeaders: { authorization: `Bearer ${token}` } });
  expect((await bearer.post('/projects', { data: { name: 'Listed', slug: `mt-listed-${stamp}` } })).status()).toBe(201);

  await signUp(page, `mt-admin-${stamp}@e2e.test`, 'admin');
  const selector = page.getByRole('dialog', { name: 'SiteWright' });
  await expect(selector).toBeVisible();
  await selector.getByRole('button', { name: 'Close' }).click();
  await expect(selector).toBeHidden();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'System Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'System settings' });
  await settings.getByRole('tab', { name: 'Security' }).click();
  // The instance maximum is here too; this spec only reads it (it is instance-global — changing it
  // would move the limit under every other spec running against the same slot).
  await expect(settings.getByLabel('Maximum new projects per member token per day')).toHaveValue('50');
  await settings.getByRole('button', { name: 'View all member tokens' }).click();

  const list = page.getByRole('dialog', { name: 'Member tokens' });
  await list.getByLabel('Filter member tokens').fill(ownerEmail);
  const row = list.getByRole('listitem').filter({ hasText: `Fleet ${stamp}` });
  await expect(row.getByText(ownerEmail)).toBeVisible();
  await expect(row.getByText('Active', { exact: true })).toBeVisible();
  await expect(row.getByText('developer', { exact: true })).toBeVisible();
  // What it did: one project used, one of its three for today created.
  await expect(row.getByText(/used on 1 project · 1 of 3 new projects in the last 24 hours/)).toBeVisible();

  await row.getByRole('button', { name: `Revoke member token Fleet ${stamp} of ${ownerEmail}` }).click();
  await page.getByRole('dialog', { name: 'Revoke member token' }).getByRole('button', { name: 'Revoke' }).click();
  // Gone from the working list, dead for whoever holds it, and still on record behind the switch.
  await expect(row).toHaveCount(0);
  expect((await bearer.get('/projects')).status()).toBe(401);
  await list.getByRole('checkbox', { name: 'Show revoked and expired' }).check();
  await expect(row.getByText('Revoked', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: /Revoke/ })).toHaveCount(0);

  await bearer.dispose();
  await owner.dispose();
});
