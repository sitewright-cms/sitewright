import { test, expect } from '@playwright/test';

const stamp = Date.now();

// data-sw-text="data.<key>" binds an editable leaf to the page's page.data (not the content map).
// In-preview editing it writes into page.data and persists there across a reload.
test('data-sw-* with a data.* key edits page.data in-preview and persists', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`pdd-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Directive Data Site');
  await page.getByLabel('Project slug').fill(`pdd-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: /^Home/ }).click();

  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('<main><h1 data-sw-text="data.headline">Default headline</h1></main>');

  const preview = page.frameLocator('iframe[title="Preview"]');
  const region = preview.locator('[data-sw-text="data.headline"]');
  await expect(region).toHaveText('Default headline');

  // Content mode → inline-edit the leaf.
  await page.getByRole('button', { name: 'content', exact: true }).click();
  await expect(region).toHaveAttribute('contenteditable', /.+/);
  await region.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Edited via directive');
  await expect(region).toHaveText('Edited via directive'); // the in-preview edit took

  // It landed in page.data — the "Edit page data" modal shows headline.
  await page.getByRole('button', { name: 'Edit page data' }).click();
  const dataModal = page.getByRole('dialog', { name: 'Page data' });
  await dataModal.getByRole('button', { name: /JSON source/ }).click();
  await expect(dataModal.getByLabel('JSON source')).toHaveValue(/Edited via directive/);
  await dataModal.getByRole('button', { name: 'Save', exact: true }).click();

  // Persist the page, reload, reopen → page.data round-trips and the directive renders it.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Directive Data Site/ }).click();
  await page.getByRole('button', { name: /^Home/ }).click();
  await expect(page.frameLocator('iframe[title="Preview"]').locator('[data-sw-text="data.headline"]')).toHaveText('Edited via directive');
});
