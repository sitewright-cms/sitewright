import { test, expect } from '@playwright/test';

const stamp = Date.now();

async function setup(page: import('@playwright/test').Page, slug: string) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`${slug}-${stamp}@e2e.test`);
  await page.getByRole('textbox', { name: 'Password' }).fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Image Site');
  await page.getByLabel('Project slug').fill(`${slug}-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: /^Home/ }).click();
}

async function setSource(page: import('@playwright/test').Page, src: string) {
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(src);
}

// Clicking a data-sw-src image in the preview opens the file picker; choosing a URL updates the
// <img src> and persists.
test('data-sw-src: replace an image via the preview → file picker (URL), persists', async ({ page }) => {
  await setup(page, 'img');
  await setSource(page, '<img data-sw-src="hero" src="/old.jpg" alt="Hero" width="240" height="140">');

  const preview = page.frameLocator('iframe[title="Preview"]');
  const img = preview.locator('[data-sw-src="hero"]');
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();
  await img.click();

  // The "Replace image" picker opens (in the editor); use the URL tab.
  await expect(page.getByRole('dialog', { name: 'Replace image' })).toBeVisible();
  await page.getByRole('button', { name: 'URL', exact: true }).click();
  await page.getByLabel('URL').fill('/media/seed/hero-new.jpg');
  await page.getByRole('button', { name: 'Use URL as-is' }).click();

  await expect(img).toHaveAttribute('src', '/media/seed/hero-new.jpg');

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
});

// Clicking a data-sw-bg element replaces its background-image.
test('data-sw-bg: replace a background image via the preview → file picker (URL)', async ({ page }) => {
  await setup(page, 'bg');
  await setSource(page, '<section data-sw-bg="band" style="height:120px;background:#eee">Band</section>');

  const preview = page.frameLocator('iframe[title="Preview"]');
  const band = preview.locator('[data-sw-bg="band"]');
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();
  await band.click();

  await expect(page.getByRole('dialog', { name: 'Replace image' })).toBeVisible();
  await page.getByRole('button', { name: 'URL', exact: true }).click();
  await page.getByLabel('URL').fill('/media/seed/band.jpg');
  await page.getByRole('button', { name: 'Use URL as-is' }).click();

  await expect(band).toHaveAttribute('style', /background-image:url\(.*band\.jpg/);
});
