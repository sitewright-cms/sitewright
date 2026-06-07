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
  await page.getByLabel('Project name').fill('Inline Site');
  await page.getByLabel('Project slug').fill(`${slug}-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: /^Home/ }).click(); // open the Home page editor
}

async function setSource(page: import('@playwright/test').Page, src: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(src);
}

// A body-context {{edit}} region is click-to-edit IN the preview (content mode): two-way with the
// side field, no full reload (the live edit survives), and it persists on save.
test('content mode: inline-edit a preview region (two-way, no reload, persists)', async ({ page }) => {
  await setup(page, 'inline');
  await setSource(page, '<h1>{{edit "tagline" "Hello"}}</h1>');

  const preview = page.frameLocator('iframe[title="Preview"]');
  const region = preview.locator('[data-sw-edit="tagline"]');
  await expect(region).toHaveText('Hello'); // the preview marks the region

  // Switch to content mode → the bridge makes the region editable.
  await page.getByRole('button', { name: 'content', exact: true }).click();
  await expect(region).toHaveAttribute('contenteditable', /.+/);

  // Tag the current preview document so we can detect a reload later.
  const frame = async () => (await (await page.locator('iframe[title="Preview"]').elementHandle())!.contentFrame())!;
  await (await frame()).evaluate(() => ((window as unknown as { __noReload?: boolean }).__noReload = true));

  // Inline-edit the region in the preview.
  await region.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Brand new tagline');

  // Two-way: the side region field reflects the inline edit.
  await expect(page.getByLabel('tagline')).toHaveValue('Brand new tagline');
  await expect(region).toHaveText('Brand new tagline');

  // No full reload happened (the suppression held): the doc tag survives past the debounce window.
  await page.waitForTimeout(1100);
  expect(await (await frame()).evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload === true)).toBe(true);
  await expect(region).toHaveText('Brand new tagline');

  // Save + reopen → the edited content persisted.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: /^Home/ }).click();
  await page.getByRole('button', { name: 'content', exact: true }).click();
  await expect(page.getByLabel('tagline')).toHaveValue('Brand new tagline');
});

// An {{edit}} in an ATTRIBUTE must NOT be marked (a span would break out) — but the side field still
// edits it. (Negative case for the body-only guard.)
test('an {{edit}} in an attribute is not inline-marked, but the side field still edits it', async ({ page }) => {
  await setup(page, 'attr');
  await setSource(page, '<a href="/" title="{{edit "lbl" "Home"}}">Link</a>');

  const preview = page.frameLocator('iframe[title="Preview"]');
  await expect(preview.locator('a')).toHaveText('Link');
  // No marker span emitted for this page (editsAreBodyOnly === false).
  await expect(preview.locator('[data-sw-edit]')).toHaveCount(0);

  // The side field still edits the attribute region; the preview reflects it on reload.
  await page.getByRole('button', { name: 'content', exact: true }).click();
  await page.getByLabel('lbl').fill('Start');
  await expect(preview.locator('a')).toHaveAttribute('title', 'Start');
});
