import { test, expect } from '@playwright/test';

const stamp = Date.now();

async function setup(page: import('@playwright/test').Page, slug: string) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`${slug}-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('WYSIWYG Site');
  await page.getByLabel('Project slug').fill(`${slug}-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: /^Home/ }).click();
}

async function setSource(page: import('@playwright/test').Page, src: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(src);
}

// data-sw-text gets the same in-place plaintext editing as the legacy {{edit}} marker.
test('data-sw-text: inline plaintext edit in the preview, two-way + persists', async ({ page }) => {
  await setup(page, 'swtext');
  await setSource(page, '<h1 data-sw-text="tagline">Hello</h1>');

  const preview = page.frameLocator('iframe[title="Preview"]');
  const region = preview.locator('[data-sw-text="tagline"]');
  await expect(region).toHaveText('Hello');

  await page.getByRole('button', { name: 'content', exact: true }).click();
  await expect(region).toHaveAttribute('contenteditable', /.+/);
  await region.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Fresh tagline');

  await expect(page.getByLabel('tagline')).toHaveValue('Fresh tagline'); // two-way with the side field
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
});

// A [data-sw-html] region is a full contenteditable with a floating toolbar; the rich edit flows
// back and persists.
test('data-sw-html: in-place rich editing (contenteditable + toolbar) persists', async ({ page }) => {
  await setup(page, 'swhtml');
  await setSource(page, '<section data-sw-html="body"><p>Original</p></section>');

  const preview = page.frameLocator('iframe[title="Preview"]');
  const region = preview.locator('[data-sw-html="body"]');
  await page.getByRole('button', { name: 'content', exact: true }).click();
  await expect(region).toHaveAttribute('contenteditable', 'true');

  // Select the region's text → the floating toolbar appears; Bold it.
  await region.click();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(preview.locator('.sw-tb')).toBeVisible();
  await preview.locator('.sw-tb button', { hasText: /^B$/ }).click();
  await expect(region.locator('b, strong')).toHaveCount(1);

  // Persist → reopen → the rich region's HTML source shows the bold markup.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: /^Home/ }).click();
  await page.getByRole('button', { name: 'content', exact: true }).click();
  await page.getByRole('button', { name: 'Edit rich text…' }).click();
  await page.getByRole('button', { name: '</> HTML source' }).click();
  await expect(page.getByLabel('body HTML source')).toHaveValue(/<(b|strong)>/);
});

// A [data-sw-href] anchor is click-to-edit (URL + text) via a popover; the change persists.
test('data-sw-href: edit a link URL + text via the popover, persists', async ({ page }) => {
  await setup(page, 'swhref');
  await setSource(page, '<a data-sw-href="cta" data-sw-text="cta_label" href="/old">Old label</a>');

  const preview = page.frameLocator('iframe[title="Preview"]');
  const link = preview.locator('[data-sw-href="cta"]');
  await page.getByRole('button', { name: 'content', exact: true }).click();
  await link.click(); // opens the URL+text popover (inside the iframe)

  await preview.locator('.sw-pop .sw-url').fill('https://example.test/new');
  await preview.locator('.sw-pop .sw-text').fill('New label');
  await preview.locator('.sw-pop .sw-ok').click();

  // The preview reloads with the new href + text.
  await expect(link).toHaveText('New label');
  await expect(link).toHaveAttribute('href', 'https://example.test/new');

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
});

// Undo/redo (header buttons) revert + reapply inline content edits.
test('undo/redo: header buttons revert and reapply an inline edit', async ({ page }) => {
  await setup(page, 'undo');
  await setSource(page, '<h1 data-sw-text="tagline">Hello</h1>');
  await page.getByRole('button', { name: 'content', exact: true }).click();

  const field = page.getByLabel('tagline');
  await field.fill('Changed');
  await page.waitForTimeout(600); // let the debounced history push record the edit

  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(field).toHaveValue('Hello');

  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(field).toHaveValue('Changed');
});
