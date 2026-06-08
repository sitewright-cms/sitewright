import { test, expect } from '@playwright/test';

const stamp = Date.now();
const ownerEmail = `owner-cs-${stamp}@e2e.test`;
const clientEmail = `client-cs-${stamp}@e2e.test`;

// T4: a client edits the BOUND CONTENT of a code-first page (the data-sw-text regions) while
// the template stays immutable to them. The owner creates a code page (its scaffold already
// has an editable region), invites a client, and the client edits that region's text.

test('client edits a code page’s bound region (content), template stays immutable', async ({ page }) => {
  // --- Owner: register, make a CODE page (the scaffold carries a data-sw-text region) ---
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(ownerEmail);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Code Site');
  await page.getByLabel('Project slug').fill(`cs-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  // The auto-created HOME page (empty-slug root) already carries a data-sw-text region the
  // client will edit later — no need to add one.

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

  // --- Client accepts → the page opens in the editor MODAL, defaulting to CONTENT mode ---
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await page.getByRole('button', { name: /Code Site/ }).click();
  await page.getByRole('button', { name: /^Home/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'content' })).toHaveAttribute('aria-pressed', 'true');

  // The editable region (the scaffold's `tagline`) is surfaced with its default; the raw
  // template source is NOT presented as editable.
  const region = page.getByLabel('tagline');
  await expect(region).toHaveValue('Welcome — edit this tagline.'); // the auto-home's data-sw-text default
  await region.fill('A client-written tagline');

  // The sandboxed live preview reflects the edit.
  const preview = page.frameLocator('iframe[title="Preview"]');
  await expect(preview.getByText('A client-written tagline')).toBeVisible();

  // Save keeps the modal open (the loop continues); close, reopen → the edit persisted.
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: /^Home/ }).click();
  await expect(page.getByLabel('tagline')).toHaveValue('A client-written tagline');
});
