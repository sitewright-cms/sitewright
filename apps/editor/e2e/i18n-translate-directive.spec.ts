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
  await page.getByLabel('Project name').fill('Translate Site');
  await page.getByLabel('Project slug').fill(`${slug}-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: /^Home/ }).click(); // open the Home page editor
}

async function setSourceAndSave(page: import('@playwright/test').Page, src: string) {
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(src);
  // Persist the source (the page is dirty) so reopening the editor renders this markup.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
}

// data-sw-translate is the i18n TWIN of data-sw-text: a plaintext region that, edited in the live
// preview, writes the SHARED project translation catalog (website.translations) — NOT page.data — and
// auto-saves immediately via PUT /:id/translations. On reopen the directive renders the saved catalog
// value for the page locale (the authored inner text is just the untranslated fallback).
test('content mode: inline-edit a data-sw-translate region → auto-saves to the catalog + persists', async ({ page }) => {
  await setup(page, 'translate');
  // The key is not in the catalog yet → the directive shows the authored fallback text.
  await setSourceAndSave(page, '<h1 data-sw-translate="greeting">Authored fallback</h1>');

  const preview = page.frameLocator('iframe[title="Preview"]');
  const region = preview.locator('[data-sw-translate="greeting"]');
  await expect(region).toHaveText('Authored fallback');

  // Content mode → the bridge makes the region a plaintext contenteditable (the green .sw-tr-on affordance).
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();
  await expect(region).toHaveAttribute('contenteditable', /.+/);
  await expect(region).toHaveClass(/sw-tr-on/);

  // Edit it — and assert the auto-save actually hit the cell endpoint (PUT /projects/:id/translations).
  const saved = page.waitForResponse(
    (r) => /\/projects\/[^/]+\/translations$/.test(r.url()) && r.request().method() === 'PUT' && r.ok(),
  );
  await region.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Edited via the live preview');
  await expect(region).toHaveText('Edited via the live preview'); // the in-preview edit took
  const putResp = await saved;
  expect((await putResp.json()) as unknown).toMatchObject({ key: 'greeting', value: 'Edited via the live preview' });

  // Close + reopen the Home editor → the directive now renders the SAVED catalog value (not the
  // authored fallback), proving it persisted to website.translations end-to-end. (No page Save needed —
  // the translate cell auto-saved on its own endpoint; the source was already saved above.)
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: /^Home/ }).click();
  await expect(
    page.frameLocator('iframe[title="Preview"]').locator('[data-sw-translate="greeting"]'),
  ).toHaveText('Edited via the live preview');
});

// Cross-check: the same catalog value surfaces in the Settings → Website → Translations grid editor,
// proving the inline edit and the bulk editor read/write the ONE shared store.
test('the inline-edited cell appears in the Settings → Translations grid', async ({ page }) => {
  await setup(page, 'translate-grid');
  await setSourceAndSave(page, '<p data-sw-translate="tagline">Default tagline</p>');
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();
  const region = page.frameLocator('iframe[title="Preview"]').locator('[data-sw-translate="tagline"]');
  await expect(region).toHaveAttribute('contenteditable', /.+/);
  const saved = page.waitForResponse(
    (r) => /\/projects\/[^/]+\/translations$/.test(r.url()) && r.request().method() === 'PUT' && r.ok(),
  );
  await region.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Catalog-backed tagline');
  await saved;
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // The project view exposes the settings as top tabs → Website Settings → the Translations grid.
  await page.getByRole('tab', { name: 'Website Settings' }).click();
  const keyCell = page.getByLabel('Translation key');
  await keyCell.scrollIntoViewIfNeeded();
  await expect(keyCell).toHaveValue('tagline'); // the key row
  await expect(page.getByLabel(/^tagline .* en$/)).toHaveValue('Catalog-backed tagline'); // its en cell
});
