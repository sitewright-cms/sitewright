import { test, expect } from '@playwright/test';
import { signUp } from './helpers.js';

const stamp = Date.now();

// Page settings live in their OWN modal, STACKED above the page editor modal.
// Applying settings updates the editor's draft; the editor's Save persists all.
// Set draft + header nav + order + dropdown, save, and confirm persistence.

test('code page settings: stacked modal sets draft + nav, persisted across reopen', async ({ page }) => {
  await signUp(page, `cset-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Code Settings Site');
  await page.getByLabel('Project slug').fill(`cset-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Create a code page and open it.
  await page.getByRole('button', { name: 'New page' }).click();
  await page.getByLabel('Page path').fill('about');
  await page.getByLabel('Page title').fill('About');
  await page.getByRole('button', { name: 'Create page' }).click();
  await page.getByRole('button', { name: /^About/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click(); // the Page-settings gear is source-mode-only

  // Page settings opens a SECOND dialog stacked above the editor.
  await page.getByRole('button', { name: 'Page settings' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(2);
  await page.getByRole('button', { name: 'draft', exact: true }).click();
  // Nav is a set of named MENU SLOTS now (the old single "header" flag plus a numeric "Nav order"
  // are gone — ordering is drag-and-drop in the pages list). A new page joins Main navigation by
  // default, so Footer is the one that proves the checkbox round-trips.
  await expect(page.getByLabel('Nav: Main navigation')).toBeChecked();
  await page.getByLabel('Nav: Footer').check();
  await page.getByLabel('Show in dropdown').check();
  await page.getByRole('button', { name: 'Save settings' }).click(); // applies to the DRAFT
  await expect(page.getByRole('dialog')).toHaveCount(1); // settings closed, editor stays

  await page.getByRole('button', { name: 'Save', exact: true }).click(); // ONE save persists everything
  await expect(page.getByText('Saved')).toBeVisible();

  // Close the editor modal — the About row in the page list behind it shows the draft badge.
  // (Scoped to the ROW: a bare "draft" matches more than one element on this screen.)
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: /^About/ })).toContainText('draft');

  // Reopen → the settings persisted (incl. the dropdown toggle).
  await page.getByRole('button', { name: /^About/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click(); // the Page-settings gear is source-mode-only
  await page.getByRole('button', { name: 'Page settings' }).click();
  await expect(page.getByRole('button', { name: 'draft', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Nav: Main navigation')).toBeChecked();
  await expect(page.getByLabel('Nav: Footer')).toBeChecked();
  await expect(page.getByLabel('Show in dropdown')).toBeChecked();

  // Esc unwinds ONE modal at a time: settings first, then the editor.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
