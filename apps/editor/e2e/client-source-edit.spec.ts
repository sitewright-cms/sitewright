import { test, expect } from '@playwright/test';
import { signUp } from './helpers.js';

const stamp = Date.now();
const ownerEmail = `owner-cs-${stamp}@e2e.test`;
const clientEmail = `client-cs-${stamp}@e2e.test`;

// T4: a client edits the BOUND CONTENT of a code-first page (the data-sw-text regions) while
// the template stays immutable to them. The owner creates a code page (its scaffold already
// has an editable region), invites a client, and the client edits that region's text.

test('client edits a code page’s bound region (content), template stays immutable', async ({ page }) => {
  // --- Owner: register, make a CODE page (the scaffold carries a data-sw-text region) ---
  await signUp(page, ownerEmail);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Code Site');
  await page.getByLabel('Project slug').fill(`cs-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  // The auto-created HOME page (empty-slug root) already carries a data-sw-text region the
  // client will edit later — no need to add one.

  // --- Owner: invite a project member (Settings → Project Members modal), capture the invite link ---
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Project Members' }).click();
  const clientsModal = page.getByRole('dialog', { name: 'Project Members' });
  await clientsModal.getByLabel('Project member email').fill(clientEmail);
  await clientsModal.getByRole('button', { name: 'Invite project member' }).click();
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
  // The invite landing opens the login form ALREADY in set-password mode with the email locked to the
  // invited address — there is no register toggle to click and no email to type.
  await expect(page.getByText(/You’ve been invited as/)).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();

  // --- Accepting is AUTOMATIC once authenticated (no confirm button): the invite materializes the
  // membership and drops the client into the app, where the project is now theirs to open. ---
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
  // `exact`: the editor header also carries "Save as template"/"Save settings".
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: /^Home/ }).click();
  await expect(page.frameLocator('iframe[title="Preview"]').locator('[data-sw-text="tagline"]')).toHaveText('A client-written tagline');
});
