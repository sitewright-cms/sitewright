import { test, expect } from '@playwright/test';
import { signUp } from './helpers.js';

const stamp = Date.now();

async function setup(page: import('@playwright/test').Page, slug: string) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signUp(page, `${slug}-${stamp}@e2e.test`);
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

// The expanded rich-text toolbar: superscript (one of the new commands) wraps the selection in <sup>.
test('rich-text toolbar: superscript wraps the selection in <sup>', async ({ page }) => {
  await setup(page, 'sup');
  await setSource(page, '<section data-sw-html="body"><p>E=mc2</p></section>');
  const preview = page.frameLocator('iframe[title="Preview"]');
  const region = preview.locator('[data-sw-html="body"]');
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();
  await region.click();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(preview.locator('.sw-tb')).toBeVisible();
  await preview.locator('.sw-tb button', { hasText: 'x²' }).click(); // superscript
  await expect(region.locator('sup')).toHaveCount(1);
});

// The on-page toolbar emits Tailwind utility CLASSES, and it applies them to the LIVE DOM of a preview
// document whose stylesheet was compiled from the rendered markup — which cannot contain a class the
// author has not picked yet. So every colour/highlight/size/align pick used to land a class with no
// rule behind it: nothing changed on screen until a save re-rendered the page. These assert the
// RENDERED result inside the iframe, which is the only thing that would have caught it.
test('rich-text toolbar: a colour pick PAINTS immediately (not just after a save)', async ({ page }) => {
  await setup(page, 'tbcolor');
  await setSource(page, '<section data-sw-html="body"><p>Colour me</p></section>');
  const preview = page.frameLocator('iframe[title="Preview"]');
  const region = preview.locator('[data-sw-html="body"]');
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();
  await region.click();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(preview.locator('.sw-tb')).toBeVisible();

  const before = await region.locator('p').evaluate((el) => getComputedStyle(el).color);
  await preview.locator('.sw-tb button[aria-label="Text color"]').click();
  await preview.locator('.sw-tb-sw[aria-label="Red"]').click();

  const painted = region.locator('.text-red-600');
  await expect(painted).toHaveCount(1);
  const after = await painted.evaluate((el) => getComputedStyle(el).color);
  expect(after, 'the colour class has no rule in the preview sheet').not.toBe(before);
  // Resolve through a canvas: Tailwind emits palette colours in oklch, which computed style hands back verbatim.
  const [r, g, b] = await painted.evaluate((el) => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.fillStyle = getComputedStyle(el).color;
    ctx.fillRect(0, 0, 1, 1);
    const [rr, gg, bb] = ctx.getImageData(0, 0, 1, 1).data;
    return [rr, gg, bb] as [number, number, number];
  });
  expect(r, `expected a red, got rgb(${r},${g},${b})`).toBeGreaterThan(150);
  expect(r).toBeGreaterThan(g + 60);
  expect(r).toBeGreaterThan(b + 60);
});

test('rich-text toolbar: a size pick RESIZES immediately', async ({ page }) => {
  await setup(page, 'tbsize');
  await setSource(page, '<section data-sw-html="body"><p>Size me</p></section>');
  const preview = page.frameLocator('iframe[title="Preview"]');
  const region = preview.locator('[data-sw-html="body"]');
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();
  await region.click();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(preview.locator('.sw-tb')).toBeVisible();

  const before = parseFloat(await region.locator('p').evaluate((el) => getComputedStyle(el).fontSize));
  await preview.locator('.sw-tb button[aria-label="Text size"]').click();
  await preview.locator('.sw-tb-item[aria-label="4XL"]').click();

  const sized = region.locator('.text-4xl');
  await expect(sized).toHaveCount(1);
  const after = parseFloat(await sized.evaluate((el) => getComputedStyle(el).fontSize));
  expect(after, 'the size class has no rule in the preview sheet').toBeGreaterThan(before);
  expect(after).toBeCloseTo(36, 1);
});

// The toolbar's </> button opens the HTML SOURCE editor (a CodeMirror modal); edits round-trip and
// are sanitized on render (a <script> in the source never reaches the rendered region).
test('rich-text </>: HTML source editor round-trips and is sanitized on render', async ({ page }) => {
  await setup(page, 'htmlsrc');
  await setSource(page, '<section data-sw-html="body"><p>Original</p></section>');
  const preview = page.frameLocator('iframe[title="Preview"]');
  const region = preview.locator('[data-sw-html="body"]');
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();
  await region.click();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(preview.locator('.sw-tb')).toBeVisible();

  // Open the HTML source modal via the toolbar's </> button; it is seeded with the current HTML.
  await preview.locator('.sw-tb button', { hasText: '</>' }).click();
  const modal = page.getByRole('dialog', { name: /Edit HTML/ });
  await expect(modal).toBeVisible();
  await expect(modal.locator('.cm-content')).toContainText('Original');

  // Replace the source with new HTML: a <b> (allowed) + a <script> (must be stripped on render).
  await modal.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('<p>Edited <b>bold</b></p><script>alert(1)</script>');
  await modal.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(modal).not.toBeVisible();

  // The preview reloads with the edited content: the <b> survives, the <script> is gone.
  await expect(region).toContainText('Edited');
  await expect(region.locator('b')).toHaveCount(1);
  await expect(region.locator('script')).toHaveCount(0);

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
});

// Closing the HTML source modal with unsaved edits confirms first (no silent data loss).
test('rich-text </>: discarding dirty HTML source confirms first', async ({ page }) => {
  await setup(page, 'htmlsrc-discard');
  await setSource(page, '<section data-sw-html="body"><p>Keep me</p></section>');
  const preview = page.frameLocator('iframe[title="Preview"]');
  const region = preview.locator('[data-sw-html="body"]');
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();
  await region.click();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(preview.locator('.sw-tb')).toBeVisible();
  await preview.locator('.sw-tb button', { hasText: '</>' }).click();
  const modal = page.getByRole('dialog', { name: /Edit HTML/ });
  await expect(modal).toBeVisible();

  // Make it dirty, then Esc → the discard confirm appears; confirming closes the source modal.
  await modal.locator('.cm-content').click();
  await page.keyboard.type('ZZZ');
  await page.keyboard.press('Escape');
  const discard = page.getByRole('dialog', { name: 'Discard changes' });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Discard' }).click();
  await expect(modal).not.toBeVisible();
  await expect(region).toContainText('Keep me'); // the edit was discarded
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
