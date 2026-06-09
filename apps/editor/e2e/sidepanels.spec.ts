import { test, expect } from '@playwright/test';

const stamp = Date.now();

// The reusable edge side panels (Library left, Assets right): a small blue tab on each edge that
// expands its fixed-size panel on hover and collapses on mouse-out. Always present for owners.
test('side panels: Library + Assets tabs open on hover and close on mouse-out', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`panels-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Panels Site');
  await page.getByLabel('Project slug').fill(`panels-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Both collapsed edge tabs are present.
  const libTab = page.getByRole('button', { name: 'Open System Library' });
  const assetsTab = page.getByRole('button', { name: 'Open File Manager' });
  await expect(libTab).toBeVisible();
  await expect(assetsTab).toBeVisible();

  // The Library panel is collapsed (aria-hidden) until hovered. (Query by attribute — a hidden
  // region is excluded from the accessibility tree, so getByRole wouldn't see it.)
  const library = page.locator('[role="region"][aria-label="System Library"]');
  await expect(library).toHaveAttribute('aria-hidden', 'true');

  // Hover the tab → the panel opens and its sections show.
  await libTab.hover();
  await expect(library).toHaveAttribute('aria-hidden', 'false');
  await expect(library.getByText('Google Fonts', { exact: true })).toBeVisible();

  // Move the pointer to the page center → the panel collapses again (close on mouse-out).
  await page.mouse.move(640, 400);
  await expect(library).toHaveAttribute('aria-hidden', 'true');

  // The Assets tab (right edge) shares the same component and opens its file browser on hover.
  await assetsTab.hover();
  const assets = page.locator('[role="region"][aria-label="File Manager"]');
  await expect(assets).toHaveAttribute('aria-hidden', 'false');
  await expect(assets.getByLabel('Upload files')).toBeVisible();
});
