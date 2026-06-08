import { test, expect } from '@playwright/test';

const stamp = Date.now();

// The built-in GLOBAL snippets (formerly the "Insert pattern" starters): composed into a page via
// `{{> name}}` (they render in the live preview through the merged partials), and listed read-only +
// copyable in the Snippets rail.
test('a global snippet renders via {{> name}} and is listed (copyable) in the Snippets rail', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`gsnip-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Snip Site');
  await page.getByLabel('Project slug').fill(`gsnip-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Compose the built-in `hero` global into the home page via a partial include.
  await page.getByRole('button', { name: /^Home/ }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('{{> hero}}');

  // The global partial resolves + renders its {{edit}} default in the preview.
  const preview = page.frameLocator('iframe[title="Preview"]');
  await expect(preview.getByRole('heading', { name: 'Build something people love' })).toBeVisible();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // The Snippets rail lists the built-in starters (read-only) with copy buttons.
  await page.getByRole('button', { name: 'Open Snippets' }).hover();
  const snippets = page.locator('[role="region"][aria-label="Snippets"]');
  await expect(snippets.getByText('Hero', { exact: true })).toBeVisible();
  await expect(snippets.getByRole('button', { name: 'Copy {{> hero}}' })).toBeVisible();
  await expect(snippets.getByRole('button', { name: 'Copy Hero source' })).toBeVisible();
});
