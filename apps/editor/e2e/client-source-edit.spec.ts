import { test, expect } from '@playwright/test';

const stamp = Date.now();
const ownerEmail = `owner-cs-${stamp}@e2e.test`;
const clientEmail = `client-cs-${stamp}@e2e.test`;

// T4: a client edits the BOUND CONTENT of a code-first page (the {{edit "…"}} regions) while
// the template stays immutable to them. The owner creates a code page (its scaffold already
// has an editable region), invites a client, and the client edits that region's text.

test('client edits a code page’s bound region (content), template stays immutable', async ({ page }) => {
  // --- Owner: register, make a CODE page (the scaffold carries an {{edit}} region) ---
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(ownerEmail);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Project name').fill('Code Site');
  await page.getByLabel('Project slug').fill(`cs-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: /Code Site/ }).click();

  await page.getByLabel('Page slug').fill('home');
  await page.getByLabel('Page title').fill('Home');
  await page.getByRole('button', { name: 'Add page' }).click();

  // --- Owner: invite a client, capture the invite link ---
  await page.getByRole('tab', { name: 'Admin' }).click();
  await page.getByRole('tab', { name: 'Clients' }).click();
  await page.getByLabel('Client email').fill(clientEmail);
  await page.getByRole('button', { name: 'Invite client' }).click();
  const link = (await page.locator('code').first().textContent())?.trim();
  expect(link).toContain('/?invite=');

  // --- Owner signs out; the client opens the link and registers ---
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByText('Sign in to your account')).toBeVisible();
  await page.goto(link!);
  await expect(page.getByText(/invited/)).toBeVisible();
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email', { exact: true }).fill(clientEmail);
  await page.getByLabel('Password', { exact: true }).fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();

  // --- Client accepts → opens the code page in the bound-content editor ---
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await page.getByRole('button', { name: /Code Site/ }).click();
  await page.getByRole('button', { name: /Home/ }).click();
  await expect(page.getByText('Client editor')).toBeVisible();

  // The editable region (the scaffold's `tagline`) is surfaced with its default; the raw
  // template source is NOT presented as editable.
  const region = page.getByLabel('tagline');
  await expect(region).toHaveValue('Edit this tagline');
  await region.fill('A client-written tagline');

  // The sandboxed live preview reflects the edit.
  const preview = page.frameLocator('iframe[title="Live preview"]');
  await expect(preview.getByText('A client-written tagline')).toBeVisible();

  await page.getByRole('button', { name: 'Save changes' }).click();

  // Reopen → the client's content edit persisted.
  await page.getByRole('button', { name: /Home/ }).click();
  await expect(page.getByLabel('tagline')).toHaveValue('A client-written tagline');
});
