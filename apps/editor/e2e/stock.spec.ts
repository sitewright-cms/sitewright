import { test, expect } from '@playwright/test';

const stamp = Date.now();

// The Media manager's "Search stock images" modal: verifies the picker UI is wired up
// against the live editor (opens in a modal, provider list loaded from the API, search
// controls present). The real provider search/import (which needs provider keys + outbound
// network) is covered deterministically by the API E2E (apps/api/e2e/stock.spec.ts).

test('media manager exposes a Stock images picker with a loaded provider list', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`stock-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Stock Site');
  await page.getByLabel('Project slug').fill(`stock-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('tab', { name: 'Assets' }).click();

  // Open the stock picker in a modal (it replaced the inner "Stock images" tab).
  await page.getByRole('button', { name: 'Search stock images' }).click();
  const dialog = page.getByRole('dialog', { name: 'Search stock images' });
  await expect(dialog).toBeVisible();

  // The provider select loads from the API and defaults to the keyless Openverse.
  const provider = dialog.getByLabel('Stock provider');
  await expect(provider).toBeVisible();
  await expect(provider).toHaveValue('openverse');
  await expect(provider.locator('option')).toHaveCount(3); // openverse + unsplash + pexels

  // Search controls are present. Openverse is keyless/available, so with a query the
  // Search button is enabled (order-independent of any instance key configuration).
  const query = dialog.getByLabel('Stock search query');
  await expect(query).toBeVisible();
  await query.fill('mountains');
  await expect(dialog.getByRole('button', { name: 'Search' })).toBeEnabled();

  // The modal closes cleanly.
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});
