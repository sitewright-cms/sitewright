import { test, expect } from '@playwright/test';

const stamp = Date.now();

// Drives the "nav placeholder" (kind:'link') editor flow: create an external new-tab placeholder
// and a dropdown placeholder, confirm the pages-list treatment, and round-trip the link settings.

test('create nav placeholders (external + dropdown) and round-trip their settings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`navph-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Nav PH Site');
  await page.getByLabel('Project slug').fill(`navph-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // --- An EXTERNAL placeholder that opens in a new tab. ---
  await page.getByRole('button', { name: '+ Add nav placeholder' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add nav placeholder' });
  await dialog.getByLabel('Placeholder name').fill('Docs');
  await dialog.getByLabel('Link target').fill('https://docs.example.com');
  await dialog.getByLabel('Open in new tab').check();
  await dialog.getByRole('button', { name: 'Add placeholder' }).click();
  await expect(dialog).toBeHidden();

  // The row shows the name, a "placeholder" chip, and the target (not a route).
  const row = page.locator('li', { hasText: 'Docs' }).first();
  await expect(row.getByText('placeholder')).toBeVisible();
  await expect(row.getByText('https://docs.example.com')).toBeVisible();
  // No page editor / preview action on a placeholder row; settings + delete remain.
  await expect(row.getByRole('button', { name: 'Edit Docs' })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Settings for Docs' })).toBeVisible();

  // Settings round-trips the target + new-tab; slug/meta are absent.
  await row.getByRole('button', { name: 'Settings for Docs' }).click();
  const settings = page.getByRole('dialog', { name: /Nav placeholder settings/ });
  await expect(settings.getByLabel('Link target')).toHaveValue('https://docs.example.com');
  await expect(settings.getByLabel('Open in new tab')).toBeChecked();
  await expect(settings.getByLabel('Page path')).toHaveCount(0);
  await settings.getByRole('button', { name: 'Save settings' }).click();
  await expect(settings).toBeHidden();

  // --- A DROPDOWN-only placeholder (no target). ---
  await page.getByRole('button', { name: '+ Add nav placeholder' }).click();
  const d2 = page.getByRole('dialog', { name: 'Add nav placeholder' });
  await d2.getByLabel('Placeholder name').fill('Services');
  await d2.getByLabel('Dropdown of child pages').check();
  await d2.getByRole('button', { name: 'Add placeholder' }).click();
  await expect(d2).toBeHidden();
  const grp = page.locator('li', { hasText: 'Services' }).first();
  await expect(grp.getByText('placeholder')).toBeVisible();
  await expect(grp.getByText('— (dropdown)')).toBeVisible();
});
