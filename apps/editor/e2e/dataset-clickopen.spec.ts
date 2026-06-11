import { test, expect } from '@playwright/test';

const stamp = Date.now();

// A page that renders a dataset via {{#each}} marks each row in the preview; clicking a row
// (content mode) opens that entry's editor, and saving refreshes the preview.
test('click a rendered dataset row in the preview → edit its entry → preview updates', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`clickopen-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Click Open');
  await page.getByLabel('Project slug').fill(`clickopen-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Data rail: a "Posts" dataset with a "title" field + one entry "Hello".
  await page.getByRole('button', { name: 'Open Datasets' }).hover();
  await page.getByLabel('Dataset name').fill('Posts');
  await page.getByRole('button', { name: 'Create dataset' }).click();
  // The schema editor is collapsed by default — expand it to add fields.
  await page.getByRole('button', { name: /schema/ }).click();
  await page.getByLabel('New field name').fill('title');
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByRole('button', { name: 'Save schema' }).click();
  await page.getByRole('button', { name: 'New entry' }).click();
  await page.getByLabel('title', { exact: true }).fill('Hello');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hello' })).toBeVisible();

  // Close the (full-height) Data rail, then open the Home page editor; render the dataset with
  // {{#each}} (fields flattened).
  await page.getByRole('region', { name: 'Datasets' }).getByRole('button', { name: 'Close Datasets' }).click();
  await page.getByRole('button', { name: /^Home/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('<ul>{{#each data.posts}}<li class="post">{{title}}</li>{{/each}}</ul>');

  const preview = page.frameLocator('iframe[title="Preview"]');
  const row = preview.locator('[data-sw-entry]');
  await expect(row).toContainText('Hello');

  // Content mode → click the row → the entry editor opens for "Hello".
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();
  await row.click();
  const entryDialog = page.getByRole('dialog', { name: /Edit/ });
  await expect(entryDialog).toBeVisible();

  // Edit the title and save (the entry modal's own Save — scoped, since the page editor has one too).
  await entryDialog.getByLabel('title', { exact: true }).fill('Updated');
  await entryDialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(row).toContainText('Updated');
});
