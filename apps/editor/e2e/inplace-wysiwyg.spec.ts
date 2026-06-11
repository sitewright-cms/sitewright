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
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
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

  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();
  await expect(region).toHaveAttribute('contenteditable', /.+/);
  await region.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Fresh tagline');

  await expect(region).toHaveText('Fresh tagline'); // the in-preview edit took
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
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();
  await expect(region).toHaveAttribute('contenteditable', 'true');

  // Select the region's text → the floating toolbar appears; Bold it.
  await region.click();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(preview.locator('.sw-tb')).toBeVisible();
  await preview.locator('.sw-tb button', { hasText: /^B$/ }).click();
  await expect(region.locator('b, strong')).toHaveCount(1);

  // Persist → reopen → the rich region's rendered content keeps the bold markup.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: /^Home/ }).click();
  await expect(page.frameLocator('iframe[title="Preview"]').locator('[data-sw-html="body"]').locator('b, strong')).toHaveCount(1);
});

// A [data-sw-href] anchor is click-to-edit (URL + text) via a popover; the change persists.
test('data-sw-href: edit a link URL + text via the popover, persists', async ({ page }) => {
  await setup(page, 'swhref');
  await setSource(page, '<a data-sw-href="cta" data-sw-text="cta_label" href="/old">Old label</a>');

  const preview = page.frameLocator('iframe[title="Preview"]');
  const link = preview.locator('[data-sw-href="cta"]');
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();
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

// The resting edit overlay (dashed outline) must render for a data-sw-href anchor in content mode.
// Regression guard: the bridge's base outline rule previously omitted [data-sw-href], so a link with
// NO data-sw-text (which wouldn't match the [data-sw-text] base rule) showed no editable affordance.
test('data-sw-href: shows the in-preview edit overlay (resting outline) in content mode', async ({ page }) => {
  await setup(page, 'swhref-overlay');
  await setSource(page, '<a data-sw-href="cta" href="/old">Visit</a>');

  const preview = page.frameLocator('iframe[title="Preview"]');
  const link = preview.locator('[data-sw-href="cta"]');
  await expect(link).toBeVisible();

  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();
  await expect(link).toHaveClass(/sw-link-on/); // bridge marked it editable
  // In content mode the always-on affordance is a DASHED outline at rest (the base rule's
  // outline-style + the on-state's outline-color), going solid only on focus.
  const outlineStyle = await link.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outlineStyle).toBe('dashed');
});

// A hover/focus label badge (CSS ::before) names the field a region binds to, anchored to the element
// (its host is promoted to position:relative) with a high z-index so it is never covered.
test('field-name badge: hovering an editable region reveals a ::before label naming its key', async ({ page }) => {
  await setup(page, 'badge');
  await setSource(page, '<h1 data-sw-text="tagline">Hello</h1>');
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();

  const region = page.frameLocator('iframe[title="Preview"]').locator('[data-sw-text="tagline"]');
  await expect(region).toBeVisible();
  // Hidden at rest (display:none — so it never interferes with clicks)…
  expect(await region.evaluate((el) => getComputedStyle(el, '::before').display)).toBe('none');
  // …revealed on hover, naming the field, with the host promoted so the absolute badge anchors here.
  await region.hover();
  await expect.poll(() => region.evaluate((el) => getComputedStyle(el, '::before').display)).not.toBe('none');
  const badge = await region.evaluate((el) => ({
    content: getComputedStyle(el, '::before').content,
    position: getComputedStyle(el).position,
  }));
  expect(badge.content).toContain('tagline');
  expect(badge.position).toBe('relative');

  // …and hidden again once the cursor leaves (so it never lingers over content).
  await page.mouse.move(0, 0);
  await expect.poll(() => region.evaluate((el) => getComputedStyle(el, '::before').display)).toBe('none');
});

// Undo/redo (header buttons) revert + reapply inline content edits.
test('undo/redo: header buttons revert and reapply an inline edit', async ({ page }) => {
  await setup(page, 'undo');
  await setSource(page, '<h1 data-sw-text="tagline">Hello</h1>');
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();

  const region = page.frameLocator('iframe[title="Preview"]').locator('[data-sw-text="tagline"]');
  await region.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Changed');
  await expect(region).toHaveText('Changed');
  await page.waitForTimeout(600); // let the debounced history push record the edit

  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(region).toHaveText('Hello');

  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(region).toHaveText('Changed');
});
