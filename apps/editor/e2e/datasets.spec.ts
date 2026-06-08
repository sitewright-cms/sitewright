import { test, expect } from '@playwright/test';

const stamp = Date.now();

// The dataset manager (CMS): define a dataset + schema and add an entry. Code-first pages
// consume datasets via `{{#each data.<set>}}` in the template source (no block-binding UI).
test('define a dataset, its schema, and add an entry', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`data-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Data Site');
  await page.getByLabel('Project slug').fill(`data-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Data rail (bottom-left panel): create a "Posts" dataset with a "title" field.
  await page.getByRole('button', { name: 'Open Data' }).hover();
  await expect(page.getByLabel('Dataset name')).toBeVisible();
  await page.getByLabel('Dataset name').fill('Posts');
  await page.getByRole('button', { name: 'Create dataset' }).click();
  await page.getByLabel('New field name').fill('title');
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByRole('button', { name: 'Save schema' }).click();

  // Add an entry; it appears in the entry list.
  await page.getByRole('button', { name: 'New entry' }).click();
  await page.getByLabel('title', { exact: true }).fill('Hello World');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hello World' })).toBeVisible();
});

// An `image`-type entry field renders the reusable AssetField/FilePicker (not a bare text input),
// so editors browse the library or paste/import a URL — same control as the identity logo fields.
test('dataset image field uses the file picker (browse a URL into an entry)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`dataimg-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Gallery Site');
  await page.getByLabel('Project slug').fill(`dataimg-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Open the Data rail. A "Gallery" dataset with a text "title" + an "image"-type "photo" field.
  await page.getByRole('button', { name: 'Open Data' }).hover();
  await expect(page.getByLabel('Dataset name')).toBeVisible();
  await page.getByLabel('Dataset name').fill('Gallery');
  await page.getByRole('button', { name: 'Create dataset' }).click();
  await page.getByLabel('New field name').fill('title');
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByLabel('New field name').fill('photo');
  await page.getByLabel('New field type').selectOption('image');
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByRole('button', { name: 'Save schema' }).click();

  // New entry: the photo field is an AssetField (Browse button); the text field is not.
  await page.getByRole('button', { name: 'New entry' }).click();
  await expect(page.getByRole('button', { name: 'Browse for photo' })).toBeVisible();
  await page.getByLabel('title', { exact: true }).fill('Sunset');

  // Open the picker from the image field → URL tab → use a remote URL as-is.
  await page.getByRole('button', { name: 'Browse for photo' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose photo' });
  await picker.getByRole('button', { name: 'URL', exact: true }).click();
  await picker.getByLabel('URL').fill('https://cdn.example.com/remote-photo.jpg');
  await picker.getByRole('button', { name: 'Use URL as-is' }).click();
  await expect(page.locator('#entry-photo')).toHaveValue('https://cdn.example.com/remote-photo.jpg');

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sunset' })).toBeVisible();
});

// The entry editor is a modal with a draft/published TOGGLE (top-right); entries can be duplicated.
test('entry editor modal: status toggle + duplicate', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`dataedit-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Editorial');
  await page.getByLabel('Project slug').fill(`dataedit-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: 'Open Data' }).hover();
  await page.getByLabel('Dataset name').fill('Posts');
  await page.getByRole('button', { name: 'Create dataset' }).click();
  await page.getByLabel('New field name').fill('title');
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByRole('button', { name: 'Save schema' }).click();

  // Add an entry via the modal.
  await page.getByRole('button', { name: 'New entry' }).click();
  await page.getByLabel('title', { exact: true }).fill('Alpha');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Alpha' })).toBeVisible();

  // Open it → the modal has a Published toggle; flip it on, save, and the row badge updates.
  await page.getByRole('button', { name: 'Alpha' }).click();
  await expect(page.getByRole('dialog', { name: /Edit/ })).toBeVisible();
  await page.getByLabel('Published').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const alphaRow = page.locator('li', { has: page.getByRole('button', { name: 'Alpha', exact: true }) });
  await expect(alphaRow.getByText('published', { exact: true })).toBeVisible();

  // Duplicate it → a second "Alpha" appears (reset to draft).
  await alphaRow.getByRole('button', { name: /Duplicate entry/ }).click();
  await expect(page.getByRole('button', { name: 'Alpha', exact: true })).toHaveCount(2);
});
