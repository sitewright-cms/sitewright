import { test, expect } from '@playwright/test';

const stamp = Date.now();
const ownerEmail = `owner-${stamp}@e2e.test`;
const clientEmail = `client-${stamp}@e2e.test`;

// End-to-end of the constrained-client track: an agency owner builds a page with one
// editable region and adds a client as a member; the client signs in, sees ONLY the
// restricted editor (no palette / tabs / publish), edits the editable region, and the
// change persists. The server independently enforces the edit boundary (API tests).

test('agency adds a client who edits only the editable region in a restricted editor', async ({ page }) => {
  // --- Owner: register, build a page with an editable RichText ---
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Organization name').fill(`Client Agency ${stamp}`);
  await page.getByLabel('Email').fill(ownerEmail);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.getByLabel('Project name').fill('Client Site');
  await page.getByLabel('Project slug').fill(`client-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: /Client Site/ }).click();

  await page.getByLabel('Page slug').fill('home');
  await page.getByLabel('Page title').fill('Home');
  await page.getByRole('button', { name: 'Add page' }).click();
  await page.getByRole('button', { name: /Home/ }).click();

  await page.getByRole('button', { name: '+ Rich text', exact: true }).click();
  await page.getByLabel('Text', { exact: true }).fill('Original copy');
  await page.getByLabel('Editable by client').check();
  await page.getByRole('button', { name: 'Save page' }).click();

  // --- Owner: add the client as a member, capture the one-time password ---
  await page.getByRole('button', { name: 'team' }).click();
  await page.getByLabel('Client email').fill(clientEmail);
  await page.getByRole('button', { name: 'Add client' }).click();
  await expect(page.getByText(/One-time password/)).toBeVisible();
  const tempPassword = (await page.locator('code').first().textContent())?.trim();
  expect(tempPassword).toBeTruthy();

  // --- Sign out, sign in as the client ---
  await page.getByRole('button', { name: 'Sign out' }).click();
  // Wait for the login form before filling, and match labels exactly: during the
  // sign-out transition a substring "Email" match could otherwise hit the lingering
  // "Client email" field from the team tab.
  await expect(page.getByText('Sign in to your account')).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(clientEmail);
  await page.getByLabel('Password', { exact: true }).fill(tempPassword!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Sign in to your account')).toBeHidden();

  // --- Client: open the project → restricted surface (no publish, no tabs, no palette) ---
  await page.getByRole('button', { name: /Client Site/ }).click();
  await expect(page.getByRole('button', { name: 'team' })).toHaveCount(0);
  await page.getByRole('button', { name: /Home/ }).click();
  await expect(page.getByText('Client editor')).toBeVisible();
  await expect(page.getByText('Add block')).toHaveCount(0);

  // The editable region's current copy is shown; the client edits and saves it.
  const field = page.getByLabel('Text', { exact: true });
  await expect(field).toHaveValue('Original copy');
  await field.fill('Client edited copy');
  await page.getByRole('button', { name: 'Save changes' }).click();

  // Reopen → the client's edit persisted.
  await page.getByRole('button', { name: /Home/ }).click();
  await expect(page.getByLabel('Text', { exact: true })).toHaveValue('Client edited copy');
});
