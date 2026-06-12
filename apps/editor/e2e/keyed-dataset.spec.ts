import { test, expect } from '@playwright/test';

const stamp = Date.now();

// An entry created with a custom KEY is directly addressable in a template via
// {{item.<dataset>.<key>.<field>}} — no loop.
test('keyed dataset access: set an entry key, then read it directly with {{item.…}}', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`keyed-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Keyed Site');
  await page.getByLabel('Project slug').fill(`keyed-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Data rail: a "Services" dataset (slug "services") with a "title" field.
  await page.getByRole('button', { name: 'Open Datasets' }).hover();
  await page.getByLabel('Dataset name').fill('Services');
  await page.getByRole('button', { name: 'Create dataset' }).click();
  // The schema editor is collapsed by default — expand it to add fields.
  await page.getByRole('button', { name: /schema/ }).click();
  await page.getByLabel('New field name').fill('title');
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByRole('button', { name: 'Save schema' }).click();

  // New entry WITH a custom key "web_development".
  await page.getByRole('button', { name: 'New entry' }).click();
  await page.getByLabel('Entry key').fill('web_development');
  await page.getByLabel('title', { exact: true }).fill('Web Development');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Web Development' })).toBeVisible();

  // Close the (full-height) Data rail, then open Home and address the entry directly by key — no loop.
  await page.getByRole('region', { name: 'Datasets' }).getByRole('button', { name: 'Close Datasets' }).click();
  await page.getByRole('button', { name: /^Home/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('<h1 class="kw">{{item.services.web_development.title}}</h1>');

  const preview = page.frameLocator('iframe[title="Preview"]');
  await expect(preview.locator('.kw')).toHaveText('Web Development');
});
