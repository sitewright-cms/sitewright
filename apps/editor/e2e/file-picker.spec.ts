import { test, expect } from '@playwright/test';

const stamp = Date.now();
// A tiny valid 1x1 PNG (so the server's image pipeline accepts the picker upload).
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);

// The FilePicker (modal) wired to an asset field: pick a library file OR paste/use a URL.
test('file picker: use a URL as-is, then upload + pick a library image for the logo', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`picker-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Picker Site');
  await page.getByLabel('Project slug').fill(`picker-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('tab', { name: 'Corporate Identity' }).click();

  // --- URL tab: paste a URL, use it as-is ---
  await page.getByRole('button', { name: 'Browse for Logo' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose logo' });
  await picker.getByRole('button', { name: 'URL', exact: true }).click();
  await picker.getByLabel('URL').fill('https://cdn.example.com/remote-logo.svg');
  await picker.getByRole('button', { name: 'Use URL as-is' }).click();
  await expect(page.getByRole('textbox', { name: 'Logo' })).toHaveValue('https://cdn.example.com/remote-logo.svg');

  // --- Library tab: upload an image through the picker, then select it ---
  await page.getByRole('button', { name: 'Browse for Logo' }).click();
  const picker2 = page.getByRole('dialog', { name: 'Choose logo' });
  await picker2.getByLabel('Upload files').setInputFiles({ name: `lib-${stamp}.png`, mimeType: 'image/png', buffer: PNG_1X1 });
  // The upload lands in the (pick-mode) browser; switch to list view + pick it.
  await picker2.getByRole('button', { name: 'list view' }).click();
  await picker2.getByRole('button', { name: `Use lib-${stamp}.png` }).click();
  await expect(page.getByRole('textbox', { name: 'Logo' })).toHaveValue(/^\/media\//);

  // Persist + reload → the self-hosted logo survives.
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('✓ Saved')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Picker Site/ }).click();
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  await expect(page.getByRole('textbox', { name: 'Logo' })).toHaveValue(/^\/media\//);
});
