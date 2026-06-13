import { test, expect } from '@playwright/test';

const stamp = Date.now();
// A tiny but valid 1x1 PNG (red pixel) — enough for the image pipeline to accept.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);

// {{#sw-folder}} loops a MEDIA FOLDER: upload an image into a folder, loop it in the page source, and
// see the optimized image render in the live preview (validates the media→render-context plumbing).
test('sw-folder gallery: folder images render in the preview', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`gallery-${stamp}@e2e.test`);
  await page.getByRole('textbox', { name: 'Password' }).fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Gallery Site');
  await page.getByLabel('Project slug').fill(`gallery-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Upload an image into a "gallery" folder via the File Manager, then close the panel.
  await page.getByRole('button', { name: 'Open File Manager' }).click();
  const panel = page.getByRole('region', { name: 'File Manager' });
  await panel.getByRole('button', { name: '+ New folder' }).click();
  await page.getByLabel('Folder name').fill('gallery');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await panel.getByRole('button', { name: 'gallery', exact: true }).click();
  await panel.getByLabel('Upload files').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await expect(panel.getByRole('button', { name: 'Delete shot.png' })).toBeVisible();
  // Close the right-edge File Manager (its in-panel header close) and move the cursor off it.
  await panel.getByRole('button', { name: 'Close File Manager' }).click();
  await page.mouse.move(300, 400);

  // Author a gallery that loops the folder; the preview renders the optimized image.
  await page.getByRole('button', { name: /^Home/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(
    '<div class="grid">{{#sw-folder "gallery"}}<img class="shot" src="{{sw-url url}}" alt="{{alt}}">{{else}}<p class="empty">none</p>{{/sw-folder}}</div>',
  );

  const preview = page.frameLocator('iframe[title="Preview"]');
  const shot = preview.locator('img.shot');
  await expect(shot).toHaveCount(1); // the folder's one image looped
  await expect(shot).toHaveAttribute('src', /\/media\/[\w-]+\/[\w-]+\//); // an API-served media URL
  await expect(preview.locator('p.empty')).toHaveCount(0); // not the {{else}} branch
});
