import { test, expect } from '@playwright/test';

const stamp = Date.now();

// A tiny but valid 1x1 PNG (red pixel) — enough for the sharp pipeline to accept.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);

test('upload an image, pick it into an Image block, and see it in the preview', async ({ page, baseURL }) => {
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

  // --- Media tab: upload an image ---
  await page.getByRole('button', { name: 'media', exact: true }).click();
  await page.getByLabel('Upload image').setInputFiles({
    name: 'hero.png',
    mimeType: 'image/png',
    buffer: PNG_1X1,
  });
  // The optimized thumbnail shows up once processing finishes.
  await expect(page.getByRole('button', { name: 'Delete hero.png' })).toBeVisible();

  // --- Pages tab: add a page, drop an Image block, pick the uploaded media ---
  await page.getByRole('button', { name: 'pages', exact: true }).click();
  await page.getByLabel('Page slug').fill('home');
  await page.getByLabel('Page title').fill('Home Page');
  await page.getByRole('button', { name: 'Add page' }).click();
  await page.getByRole('button', { name: /Home Page/ }).click();

  await page.getByRole('button', { name: '+ Image', exact: true }).click();
  await page.getByRole('button', { name: 'Use hero.png' }).click();

  // The preview renders the picked image (as an optimized <picture>).
  const preview = page.frameLocator('iframe[title="Live preview"]');
  await expect(preview.locator('picture img[src^="/media/"]')).toBeVisible();

  // Save + publish, then confirm the EXPORTED page is self-contained: an
  // optimized <picture> referencing bundled, page-relative media (no absolute
  // /media/ URL that would 404 on an external webspace).
  await page.getByRole('button', { name: 'Save page' }).click();
  await expect(page.getByRole('button', { name: /Home Page/ })).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).click();
  const viewLink = page.getByRole('link', { name: 'View published site' });
  await expect(viewLink).toBeVisible();
  const href = await viewLink.getAttribute('href');
  expect(href).toBeTruthy();

  const live = await page.context().newPage();
  const res = await live.goto(`${baseURL}${href}`);
  expect(res?.status()).toBe(200);
  const html = await live.content();
  expect(html).toContain('<picture');
  expect(html).toMatch(/srcset="media\/[\w-]+\/[\w-]+\.avif/);
  expect(html).not.toContain('/media/'); // no absolute, API-only URLs in the export
  await live.close();
});
