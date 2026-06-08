import { test, expect } from '@playwright/test';

const stamp = Date.now();

// The Library side-panel exposes a "Template reference" modal documenting the Handlebars helpers,
// data-sw-* directives, bindings, and loop variables — searchable + group-filterable.
test('library: template reference — open, search, filter by group', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`ref-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Ref Site');
  await page.getByLabel('Project slug').fill(`ref-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Open the Library rail and the Template reference modal.
  const library = page.locator('[role="region"][aria-label="Library"]');
  if ((await library.getAttribute('aria-hidden')) === 'true') {
    await page.getByRole('button', { name: 'Open Library' }).hover();
    await expect(library).toHaveAttribute('aria-hidden', 'false');
  }
  await library.getByRole('button', { name: 'Template reference' }).click();
  const ref = page.getByRole('dialog', { name: 'Template reference' });
  await expect(ref).toBeVisible();

  // Search finds the dataset-aware {{#each}} loop (eachEntry was merged into it).
  const search = ref.getByLabel('Search the template reference');
  await search.fill('dataset');
  await expect(ref.getByText(/#each items/)).toBeVisible(); // the unified loop helper's syntax
  await expect(ref.getByRole('button', { name: 'Copy' }).first()).toBeVisible();

  // Filter to the directives group → the data-sw-html directive is documented.
  await search.fill('');
  await ref.getByRole('button', { name: 'Editable directives (data-sw-*)' }).click();
  await expect(ref.getByText('data-sw-html="key"')).toBeVisible();
  await expect(ref.getByText('data-sw-bg="key"')).toBeVisible();
});
