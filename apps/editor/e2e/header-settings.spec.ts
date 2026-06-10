import { test, expect } from '@playwright/test';

const stamp = Date.now();

test('header gear menu unifies settings + inline agent indicator + publish toast', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`hdr-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Header Co');
  await page.getByLabel('Project slug').fill(`hdr-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // The retired header surfaces are gone (Admin tab + ⋮ "Site options").
  await expect(page.getByRole('tab', { name: 'Admin' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Site options' })).toHaveCount(0);

  // The AI-agent indicator sits INLINE in the header (next to Publish), not under it.
  await expect(page.getByRole('button', { name: 'Connect an agent' })).toBeVisible();

  // The gear menu lists the unified items. A non-admin owner has no "System Settings".
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Settings' });
  for (const label of ['Publish & Deploy Options', 'Clients', 'Team', 'Access', 'Sign out']) {
    await expect(menu.getByRole('menuitem', { name: label })).toBeVisible();
  }
  await expect(menu.getByRole('menuitem', { name: 'System Settings' })).toHaveCount(0);

  // A target (Team) opens AS A MODAL.
  await menu.getByRole('menuitem', { name: 'Team' }).click();
  await expect(page.getByRole('dialog', { name: 'Team' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Team' })).toBeHidden();

  // Publishing surfaces a transient TOAST (the persistent "Published · N pages" line was removed).
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Published · \d+ page/)).toBeVisible();
});
