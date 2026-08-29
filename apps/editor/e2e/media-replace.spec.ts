import { test, expect } from '@playwright/test';
import { signUp } from './helpers.js';

const stamp = Date.now();

/** 32×16 solid green JPEG. */
const JPEG_32X16 = Buffer.from(
  '/9j/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAQACADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAYH/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AmARTPAAH/9k=',
  'base64',
);
/** 40×40 JPEG — SQUARE, so replacing the 2:1 original genuinely changes the aspect ratio. */
const JPEG_40X40 = Buffer.from(
  '/9j/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAoACgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAUH/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8Am4DSk8AAAAAAAAAAAAAAAB//2Q==',
  'base64',
);

async function openLibrary(page: import('@playwright/test').Page, slug: string) {
  await signUp(page, `${slug}-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Replace Site');
  await page.getByLabel('Project slug').fill(`${slug}-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Open File Manager' }).click();
  return page.getByRole('region', { name: 'File Manager' });
}

/**
 * "Replace file" in the File Manager: swap the bytes behind an asset while its id and URL stay put.
 *
 * Note this is a DIFFERENT operation from the page editor's "Replace image" dialog (image-replace.spec.ts),
 * which repoints one `<img>` at a different asset and leaves the file alone. Both exist; the labels
 * are deliberately distinct.
 */
test('replace an image in place — the row survives and the author is warned about a reshape', async ({ page }) => {
  const panel = await openLibrary(page, 'replace');

  await panel.getByLabel('Upload files').setInputFiles({ name: 'hero.jpg', mimeType: 'image/jpeg', buffer: JPEG_32X16 });
  await expect(panel.getByRole('button', { name: 'Delete hero.jpg' })).toBeVisible();

  // The replace picker is a hidden input the row action opens.
  await panel.getByRole('button', { name: 'Replace hero.jpg' }).click();
  await panel.getByLabel('Replace file').setInputFiles({ name: 'square.jpg', mimeType: 'image/jpeg', buffer: JPEG_40X40 });

  // Same asset, same row — nothing was created and nothing needs repointing.
  await expect(panel.getByRole('button', { name: 'Delete hero.jpg' })).toBeVisible();
  // …but the shape changed, and that is the one thing a same-URL swap cannot show on its own.
  await expect(panel.getByRole('status')).toContainText('reflow');
});

test('a format change is refused, with the reason shown to the author', async ({ page }) => {
  const panel = await openLibrary(page, 'replfmt');

  await panel.getByLabel('Upload files').setInputFiles({ name: 'logo.jpg', mimeType: 'image/jpeg', buffer: JPEG_32X16 });
  await expect(panel.getByRole('button', { name: 'Delete logo.jpg' })).toBeVisible();

  await panel.getByRole('button', { name: 'Replace logo.jpg' }).click();
  await panel.getByLabel('Replace file').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAJUlEQVQ4jWNgYPj/n7qYYdRAhtEwZBhNNgyjOYVhtHBgGHHlIQDZvh0OP+rLwQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });

  // The extension is part of every URL referencing the asset, so this cannot be allowed to succeed.
  await expect(panel.getByText(/extension/i)).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Delete logo.jpg' })).toBeVisible();
});
