import { test, expect } from '@playwright/test';

const stamp = Date.now();

// page.data — a per-page custom JSON object edited via the "Edit page data" tree/JSON modal and read
// in the page source as {{page.data.*}}. Verifies the edit reflects in the live preview and persists
// across a reload.
test('page.data: edit via the JSON modal, preview reflects it, persists across reload', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`pdata-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('PageData Site');
  await page.getByLabel('Project slug').fill(`pdata-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: /^Home/ }).click();

  // Author a source that reads page.data, then fill page.data via the modal's JSON source view.
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('<main><h1>{{page.data.headline}}</h1></main>');

  await page.getByRole('button', { name: 'Edit page data' }).click();
  const dialog = page.getByRole('dialog', { name: 'Page data' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /JSON source/ }).click();
  await dialog.getByLabel('JSON source').fill('{"headline":"From page data"}');
  await dialog.getByRole('button', { name: 'Apply JSON' }).click();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();

  // The live preview re-renders the draft with the new page.data.
  const preview = page.frameLocator('iframe[title="Preview"]');
  await expect(preview.locator('h1')).toHaveText('From page data');

  // Persist the page, reload, reopen → the value round-tripped.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: /PageData Site/ }).click();
  await page.getByRole('button', { name: /^Home/ }).click();
  await expect(page.frameLocator('iframe[title="Preview"]').locator('h1')).toHaveText('From page data');
});
