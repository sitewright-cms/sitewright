import { test, expect, request } from '@playwright/test';
import { E2E_PASSWORD, signUp } from './helpers.js';

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
  await expect(memberTokens.getByRole('checkbox', { name: /^Invite members/ })).not.toBeChecked();
  await memberTokens.getByLabel('Member token name').fill('Site fleet');
  await createProjects.check();
  // Minting is confirmed with the password — the button stays disabled until it is given.
  const create = memberTokens.getByRole('button', { name: 'Create member token' });
  await expect(create).toBeDisabled();
  await memberTokens.getByLabel('Your password').fill(E2E_PASSWORD);
  await create.click();

  const tokenBox = account.getByLabel('New member token');
  await expect(tokenBox).toContainText(/^swm_[0-9a-f]{64}$/);
  const token = (await tokenBox.textContent())?.trim() ?? '';
  await expect(memberTokens.getByText('content:read, content:write, projects:create')).toBeVisible();

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

  // ---- back in the editor: the project the token made is the member's own ----
  await account.getByRole('button', { name: 'Close' }).first().click();
  await page.reload();
  // The selector re-opens (still no project open) and now lists it.
  await expect(selector.getByText('Fleet Site')).toBeVisible();
  await selector.getByRole('button', { name: 'Close' }).click();
  await expect(selector).toBeHidden();

  // Revoke → the token is dead at once.
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Account Settings' }).click();
  await account.getByRole('button', { name: 'Access keys' }).click();
  await account.getByRole('button', { name: 'Revoke member token Site fleet' }).click();
  await page.getByRole('dialog', { name: 'Revoke member token' }).getByRole('button', { name: 'Revoke' }).click();
  await expect(account.getByText(/No member tokens yet/)).toBeVisible();
  expect((await api.get('/projects')).status()).toBe(401);
  await api.dispose();
});
