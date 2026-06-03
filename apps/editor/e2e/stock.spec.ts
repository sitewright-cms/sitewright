import { test, expect } from '@playwright/test';

const stamp = Date.now();

// The Media manager's "Stock images" tab: verifies the picker UI is wired up against
// the live editor (provider list loaded from the API, search controls present). The
// real provider search/import (which needs provider keys + outbound network) is
// covered deterministically by the API E2E (apps/api/e2e/stock.spec.ts).

test('media manager exposes a Stock images picker with a loaded provider list', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`stock-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Project name').fill('Stock Site');
  await page.getByLabel('Project slug').fill(`stock-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: /Stock Site/ }).click();

  await page.getByRole('tab', { name: 'Media' }).click();

  // Switch from Upload to the Stock images tab (inner tab of the Media manager).
  await page.getByRole('tab', { name: 'Stock images' }).click();

  // The provider select loads from the API and defaults to the keyless Openverse.
  const provider = page.getByLabel('Stock provider');
  await expect(provider).toBeVisible();
  await expect(provider).toHaveValue('openverse');
  await expect(provider.locator('option')).toHaveCount(3); // openverse + unsplash + pexels

  // Search controls are present. Openverse is keyless/available, so with a query the
  // Search button is enabled (order-independent of any instance key configuration).
  const query = page.getByLabel('Stock search query');
  await expect(query).toBeVisible();
  await query.fill('mountains');
  await expect(page.getByRole('button', { name: 'Search' })).toBeEnabled();
});
