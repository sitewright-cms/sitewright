import { test, expect } from '@playwright/test';

const stamp = Date.now();

// Drives the glassmorphic Settings editor against the live editor + the unified
// Corporate Identity backend: edit identity + a brand color + website siteUrl,
// save, then reload and confirm everything persisted (full round-trip).

test('edit Corporate Identity + Website settings, save, and persist across reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`settings-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Acme Site');
  await page.getByLabel('Project slug').fill(`acme-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Open the Corporate Identity top tab → edit identity + a brand color directly.
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();

  await page.getByLabel('Display name').fill('Acme');
  await page.getByLabel('Legal name').fill('Acme Corporation');
  // Add a brand color token.
  await page.getByRole('button', { name: '+ Add color' }).click();
  await page.getByLabel('primary 1', { exact: true }).fill('primary');
  await page.getByLabel('#0ea5e9 1', { exact: true }).fill('#0ea5e9');

  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('✓ Saved')).toBeVisible();

  // Website Settings top tab: set the production URL.
  await page.getByRole('tab', { name: 'Website Settings' }).click();
  await page.getByLabel(/Production URL/).fill('https://acme.example');

  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('✓ Saved')).toBeVisible();

  // Reload → re-open the project → values persisted via the API.
  await page.reload();
  await page.getByRole('button', { name: /Acme Site/ }).click();
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  await expect(page.getByLabel('Legal name')).toHaveValue('Acme Corporation');
  await expect(page.getByLabel('primary 1', { exact: true })).toHaveValue('primary');
  await expect(page.getByLabel('#0ea5e9 1', { exact: true })).toHaveValue('#0ea5e9');
  await page.getByRole('tab', { name: 'Website Settings' }).click();
  await expect(page.getByLabel(/Production URL/)).toHaveValue('https://acme.example');
});

// The website partials are edited via an EDIT button that opens the large black CodeMirror
// editor in a modal (not an inline textarea). Verifies that flow end-to-end: open a partial,
// edit its source in CodeMirror, save the modal, persist the settings, and confirm it round-trips.
test('edit a website partial in the code-editor modal, save, and persist across reload', async ({ page }) => {
  const marker = `E2EPARTIAL${stamp}`;
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`partials-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Partials Site');
  await page.getByLabel('Project slug').fill(`partials-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('tab', { name: 'Website Settings' }).click();

  // Open the topNav partial's code editor in a modal (no inline textarea).
  await page.getByRole('button', { name: /Edit topNav/ }).click();
  const dialog = page.getByRole('dialog', { name: 'topNav partial' });
  await expect(dialog).toBeVisible();

  // Type into the black CodeMirror editor, then Save (the modal's ✓ button).
  await dialog.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(`<nav>${marker}</nav>`);
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();

  // The compact CodeField shows a line count (no inline source preview); the source itself
  // is verified by the reopen round-trip below.
  await expect(page.getByText('1 line', { exact: true })).toBeVisible();

  // Persist the settings bundle, then reload and confirm the partial round-tripped.
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('✓ Saved')).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: /Partials Site/ }).click();
  await page.getByRole('tab', { name: 'Website Settings' }).click();
  await page.getByRole('button', { name: /Edit topNav/ }).click();
  const reopened = page.getByRole('dialog', { name: 'topNav partial' });
  await expect(reopened.locator('.cm-content')).toContainText(marker);
});
