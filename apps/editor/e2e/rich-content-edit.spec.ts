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
  await page.getByLabel('Project name').fill('Rich Site');
  await page.getByLabel('Project slug').fill(`${slug}-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: /^Home/ }).click(); // open the Home page editor
}

async function setSource(page: import('@playwright/test').Page, src: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(src);
}

// A data-sw-html region is marked in the preview and edited from the side panel's rich editor
// (here via the deterministic HTML-source view). The value is sanitized + reflected in the preview
// and persists on save.
test('rich region: edit via the side panel HTML-source view, preview reflects + persists', async ({ page }) => {
  await setup(page, 'rich');
  await setSource(page, '<section data-sw-html="intro"><p>Default intro</p></section>');

  const preview = page.frameLocator('iframe[title="Preview"]');
  const region = preview.locator('[data-sw-html="intro"]');
  await expect(region).toContainText('Default intro'); // the preview marks + renders the default

  // Content mode → the side panel lists the rich region with an "Edit rich text…" button.
  await page.getByRole('button', { name: 'content', exact: true }).click();
  await page.getByRole('button', { name: 'Edit rich text…' }).click();

  // The rich editor opens; switch to the HTML source view and set new markup (with a script that
  // MUST be stripped by the sanitizer).
  await expect(page.getByRole('dialog', { name: /Rich text/ })).toBeVisible();
  await page.getByRole('button', { name: '</> HTML source' }).click();
  const source = page.getByLabel('intro HTML source');
  await source.fill('<p>Hello <strong>world</strong></p><script>alert(1)</script>');

  // Close the rich editor (Esc closes the top overlay); the preview reloads with the sanitized value.
  await page.keyboard.press('Escape');
  await expect(region.locator('strong')).toHaveText('world');
  await expect(region).toContainText('Hello world');
  await expect(region).not.toContainText('alert'); // the <script> was stripped at render

  // Save + reopen → the rich content persisted (sanitized).
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: /^Home/ }).click();
  await page.getByRole('button', { name: 'content', exact: true }).click();
  await page.getByRole('button', { name: 'Edit rich text…' }).click();
  await page.getByRole('button', { name: '</> HTML source' }).click();
  await expect(page.getByLabel('intro HTML source')).toHaveValue(/Hello <strong>world<\/strong>/);
});
