import { test, expect } from '@playwright/test';

const stamp = Date.now();

// The visible code-first authoring loop: create a code page, edit its Handlebars source in
// the CodeMirror editor, watch the live styled preview, save, and confirm it persisted.

test('code-first authoring: CodeMirror editor, live styled preview, save + persist', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`code-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Project name').fill('Code Site');
  await page.getByLabel('Project slug').fill(`code-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: /Code Site/ }).click();

  // Create a CODE page (HTML + Handlebars), then open it.
  await page.getByLabel('Page slug').fill('home');
  await page.getByLabel('Page title').fill('Home');
  await page.getByRole('button', { name: 'Add page' }).click();
  await page.getByRole('button', { name: /Home/ }).click();

  // The CodeMirror editor shows the starter Handlebars source…
  await expect(page.locator('.cm-content')).toContainText('{{ company.name }}');
  // …and the live STYLED preview renders the bound company name + the scaffold's {{edit}} region.
  const preview = page.frameLocator('iframe[title="Preview"]');
  await expect(preview.getByRole('heading', { level: 1 })).toHaveText('Code Site');
  await expect(preview.getByText('Edit this tagline', { exact: true })).toBeVisible();

  // Edit the source (plain text sidesteps CodeMirror's bracket auto-close); preview updates.
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('HELLOMARKER42');
  await expect(preview.getByText('HELLOMARKER42')).toBeVisible();

  // Save → the saved state shows.
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  // Back to the pages list, reopen → the edit persisted to page.source.
  await page.getByRole('button', { name: 'Back to pages' }).click();
  await page.getByRole('button', { name: /Home/ }).click();
  await expect(page.locator('.cm-content')).toContainText('HELLOMARKER42');
});
