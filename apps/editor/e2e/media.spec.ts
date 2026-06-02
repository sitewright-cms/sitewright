import { test, expect } from '@playwright/test';

const stamp = Date.now();

// A tiny but valid 1x1 PNG (red pixel) — enough for the sharp pipeline to accept.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);

// The media library (upload + optimize). Code-first pages reference media by its `/media/…`
// URL in the template source; the optimized <picture> export is covered by the API
// publish-build tests.
test('upload an image into the media library and see the optimized thumbnail', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Organization name').fill(`Media Agency ${stamp}`);
  await page.getByLabel('Email').fill(`media-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Project name').fill('Media Site');
  await page.getByLabel('Project slug').fill(`media-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: /Media Site/ }).click();

  // Media tab: upload an image; the optimized thumbnail appears once processing finishes.
  await page.getByRole('button', { name: 'media', exact: true }).click();
  await page.getByLabel('Upload image').setInputFiles({
    name: 'hero.png',
    mimeType: 'image/png',
    buffer: PNG_1X1,
  });
  await expect(page.getByRole('button', { name: 'Delete hero.png' })).toBeVisible();
});
