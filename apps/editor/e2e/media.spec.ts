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
  await page.getByLabel('Email').fill(`media-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Media Site');
  await page.getByLabel('Project slug').fill(`media-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Assets tab: upload an image; the optimized thumbnail appears once processing finishes.
  await page.getByRole('tab', { name: 'Assets' }).click();
  await page.getByLabel('Upload files').setInputFiles({
    name: 'hero.png',
    mimeType: 'image/png',
    buffer: PNG_1X1,
  });
  await expect(page.getByRole('button', { name: 'Delete hero.png' })).toBeVisible();
});

// Any-file-type upload: a non-image is stored as a downloadable file asset (filename + size +
// download link), and a virtual folder groups it. Exercises the Assets overhaul end-to-end.
test('upload a non-image file into a folder and see it listed with a download link', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`assets-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Assets Site');
  await page.getByLabel('Project slug').fill(`assets-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('tab', { name: 'Assets' }).click();

  // Create a PERSISTED folder (it shows immediately and survives reload), then enter it.
  await page.getByLabel('New folder name').fill('Docs');
  await page.getByRole('button', { name: '+ Folder' }).click();
  // The folder row's open button (exact 'Docs' — distinct from its Rename/Copy/Delete actions).
  await expect(page.getByRole('button', { name: 'Docs', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Docs', exact: true }).click();

  // Upload a PDF into the open folder.
  await page.getByLabel('Upload files').setInputFiles({
    name: 'report.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 hello'),
  });

  // The file row shows; its Download action links through the attachment-only /file/ handler.
  await expect(page.getByRole('button', { name: 'report.pdf', exact: true })).toBeVisible();
  const link = page.getByRole('link', { name: 'Download report.pdf' });
  await expect(link).toHaveAttribute('href', /\/media\/[\w-]+\/[\w-]+\/file\/report\.pdf$/);

  // Back at root (breadcrumb), the folder is shown and the file is not.
  await page.getByRole('button', { name: 'Assets', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Docs', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'report.pdf', exact: true })).toHaveCount(0);

  // The folder persists across a reload (the original bug it fixes). On reload the
  // project selector auto-opens — reopen the project, then check the folder is still there.
  await page.reload();
  await page.getByRole('dialog', { name: 'Your projects' }).getByRole('button', { name: /Assets Site/ }).click();
  await page.getByRole('tab', { name: 'Assets' }).click();
  await expect(page.getByRole('button', { name: 'Docs', exact: true })).toBeVisible();
});
