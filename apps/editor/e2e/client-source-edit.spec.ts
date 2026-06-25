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
  await page.getByRole('textbox', { name: 'Password' }).fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Code Site');
  await page.getByLabel('Project slug').fill(`cs-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  // The auto-created HOME page (empty-slug root) already carries a data-sw-text region the
  // client will edit later — no need to add one.

  // --- Owner: invite a client (Settings → Clients modal), capture the invite link ---
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Clients' }).click();
  const clientsModal = page.getByRole('dialog', { name: 'Clients' });
  await clientsModal.getByLabel('Client email').fill(clientEmail);
  await clientsModal.getByRole('button', { name: 'Invite client' }).click();
  const link = (await clientsModal.locator('code').first().textContent())?.trim();
  expect(link).toContain('/?invite=');
  // Close the modal before reaching the header gear (the modal backdrop overlays the header).
  await page.keyboard.press('Escape');
  await expect(clientsModal).toBeHidden();

  // --- Owner signs out (Account → Logout); the client opens the link and registers ---
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Logout' }).click();
  await expect(page.getByText('Sign in to your account')).toBeVisible();
  await page.goto(link!);
  await expect(page.getByText(/invited/)).toBeVisible();
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email', { exact: true }).fill(clientEmail);
  await page.getByLabel('Password', { exact: true }).fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();

  // --- Client accepts → the page opens in the editor MODAL, defaulting to CONTENT mode ---
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await page.getByRole('button', { name: /Code Site/ }).click();
  await page.getByRole('button', { name: /^Home/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Content Editor' })).toHaveAttribute('aria-pressed', 'true');

  // The editable region (the scaffold's `tagline`) is edited IN THE PREVIEW (the raw template source
  // is NOT presented as editable to the client).
  const preview = page.frameLocator('iframe[title="Preview"]');
  const region = preview.locator('[data-sw-text="tagline"]');
  await expect(region).toHaveText('Welcome — edit this tagline.'); // the auto-home's data-sw-text default
  await expect(region).toHaveAttribute('contenteditable', /.+/); // content mode (client default) made it editable
  await region.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('A client-written tagline');
  await expect(region).toHaveText('A client-written tagline');

  // Save keeps the modal open (the loop continues); close, reopen → the edit persisted.
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: /^Home/ }).click();
  await expect(page.frameLocator('iframe[title="Preview"]').locator('[data-sw-text="tagline"]')).toHaveText('A client-written tagline');
});
