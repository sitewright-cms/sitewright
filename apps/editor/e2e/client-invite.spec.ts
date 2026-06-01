import { test, expect } from '@playwright/test';

const stamp = Date.now();
const ownerEmail = `owner-${stamp}@e2e.test`;
const clientEmail = `client-${stamp}@e2e.test`;

// Full Phase 4c flow: the agency invites a client to ONE project via a link; the client
// accepts (registering with the invited email), lands on their site, and edits only the
// editable region. Project isolation + the auth boundary are covered by the API tests.

test('agency invites a client by link; the client accepts and edits the editable region', async ({ page }) => {
  // --- Owner: register + build a page with an editable RichText ---
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Organization name').fill(`Invite Agency ${stamp}`);
  await page.getByLabel('Email').fill(ownerEmail);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.getByLabel('Project name').fill('Invite Site');
  await page.getByLabel('Project slug').fill(`invite-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: /Invite Site/ }).click();

  await page.getByLabel('Page slug').fill('home');
  await page.getByLabel('Page title').fill('Home');
  await page.getByRole('button', { name: 'Add page' }).click();
  await page.getByRole('button', { name: /Home/ }).click();
  await page.getByRole('button', { name: '+ Rich text', exact: true }).click();
  await page.getByLabel('Text', { exact: true }).fill('Original copy');
  await page.getByLabel('Editable by client').check();
  await page.getByRole('button', { name: 'Save page' }).click();

  // --- Owner: invite a client from the project's Clients tab, capture the invite link ---
  await page.getByRole('button', { name: 'clients' }).click();
  await page.getByLabel('Client email').fill(clientEmail);
  await page.getByRole('button', { name: 'Invite client' }).click();
  const link = (await page.locator('code').first().textContent())?.trim();
  expect(link).toContain('/?invite=');

  // --- Owner signs out; the client opens the invite link and registers ---
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByText('Sign in to your account')).toBeVisible();
  await page.goto(link!);
  // The accept screen shows the invite context + a sign-in form; the new client registers.
  await expect(page.getByText(/invited/)).toBeVisible();
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Organization name').fill(`Client Personal ${stamp}`);
  await page.getByLabel('Email', { exact: true }).fill(clientEmail);
  await page.getByLabel('Password', { exact: true }).fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();

  // --- Client accepts → lands on their site → edits the editable region ---
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await page.getByRole('button', { name: /Invite Site/ }).click();
  await page.getByRole('button', { name: /Home/ }).click();
  await expect(page.getByText('Client editor')).toBeVisible();
  const field = page.getByLabel('Text', { exact: true });
  await expect(field).toHaveValue('Original copy');
  await field.fill('Client edited via invite');
  await page.getByRole('button', { name: 'Save changes' }).click();

  // Reopen → the client's edit persisted.
  await page.getByRole('button', { name: /Home/ }).click();
  await expect(page.getByLabel('Text', { exact: true })).toHaveValue('Client edited via invite');
});
