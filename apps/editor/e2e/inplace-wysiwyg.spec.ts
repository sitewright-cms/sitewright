import { test, expect, type FrameLocator } from '@playwright/test';
import { hoverForHud, signUp } from './helpers.js';

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
/**
 * Click a rich-text toolbar command in the preview.
 *
 * The floating toolbar renders SVG icons (not letter glyphs) with an aria-label and a stable
 * `data-tbid`, and it COLLAPSES trailing groups into a "More formatting" overflow menu when the bar is
 * narrower than its commands — so whether a given command is directly present depends on the viewport.
 * Try the bar, then the overflow. Overflow rows carry the label but no data-tbid.
 */
async function tbClick(preview: FrameLocator, id: string, label: string): Promise<void> {
  const direct = preview.locator(`.sw-tb button[data-tbid="${id}"]`);
  if (await direct.count()) {
    await direct.click();
    return;
  }
  await preview.locator('.sw-tb button[aria-label="More formatting"]').click();
  await preview.locator(`.sw-tb-pop button[aria-label="${label}"]`).click();
}

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
  //
  // ★ Ctrl/Cmd+B, not a click on the toolbar's B. Both work in a real browser (verified by hand against
  // a deployed instance), but headless Chromium will not deliver pointer input to the LEFTMOST control
  // of this toolbar: it is `position: fixed` inside the sandboxed, opaque-origin preview iframe, and a
  // click at its centre — Playwright's own computed coordinates, `force: true`, or a raw `mouse.click`
  // alike — produces no pointerdown at all, while the neighbouring Italic 27px away receives the full
  // sequence. A dispatched event does fire the handler, which is how we know the button itself is sound.
  // This spec had been failing on that quirk since 0.35.0 and reads as "rich editing is broken" when it
  // is not. Keyboard input is a real user path and exercises the same execCommand; the toolbar's own
  // click path stays covered by the superscript spec below, which does not sit at the toolbar's edge.
  await region.click();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(preview.locator('.sw-tb')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+b');
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
  await tbClick(preview, 'superscript', 'Superscript');
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
  await tbClick(preview, 'source', 'Edit HTML source');
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
  await tbClick(preview, 'source', 'Edit HTML source');
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

// A data-sw-href anchor must show an at-rest edit affordance in content mode.
// Regression guard: the affordance once came from a base rule that omitted [data-sw-href], so a link
// with NO data-sw-text showed nothing at all.
//
// It is also the browser-level guard for the invariant the unit tests can only assert about CSS TEXT:
// the affordance is drawn in an OVERLAY and the edited element is NOT restyled. Only a real browser
// can confirm both that the host's computed outline is untouched AND that a box actually paints over
// the link — a rule that is correct in the stylesheet but positioned wrong is invisible here otherwise.
test('data-sw-href: marks the link with an OVERLAY box, without restyling the link', async ({ page }) => {
  await setup(page, 'swhref-overlay');
  await setSource(page, '<a data-sw-href="cta" href="/old">Visit</a>');

  const preview = page.frameLocator('iframe[title="Preview"]');
  const link = preview.locator('[data-sw-href="cta"]');
  await expect(link).toBeVisible();

  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();
  await expect(link).toHaveClass(/sw-link-on/); // bridge marked it editable

  // ★ The element the author is editing keeps its own painting: no outline, no imposed radius, and
  // the pointer shape is the only thing content mode puts on it.
  const own = await link.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { outlineStyle: cs.outlineStyle, borderRadius: cs.borderTopLeftRadius, cursor: cs.cursor };
  });
  expect(own.outlineStyle).toBe('none');
  expect(own.borderRadius).toBe('0px');
  expect(own.cursor).toBe('pointer');

  // …and the affordance is a box in the fixed overlay layer, painted OVER the link's own rect.
  const restBox = preview.locator('.sw-ov-rest .sw-ov-r').first();
  await expect(restBox).toBeVisible();
  const [boxRect, linkRect] = await Promise.all([
    restBox.evaluate((el) => el.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number }),
    link.evaluate((el) => el.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number }),
  ]);
  // Same box, within a pixel — the marker tracks the element rather than approximating it.
  expect(Math.abs(boxRect.x - linkRect.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(boxRect.y - linkRect.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(boxRect.width - linkRect.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(boxRect.height - linkRect.height)).toBeLessThanOrEqual(1);
});

// A hover/focus label badge (CSS ::before) names the field a region binds to, anchored to the element
// (its host is promoted to position:relative) with a high z-index so it is never covered.
test('field-name badge: hovering an editable region reveals a HUD badge naming its key', async ({ page }) => {
  await setup(page, 'badge');
  await setSource(page, '<h1 data-sw-text="tagline">Hello</h1>');
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();

  const preview = page.frameLocator('iframe[title="Preview"]');
  const region = preview.locator('[data-sw-text="tagline"]');
  await expect(region).toBeVisible();

  // The badge is NOT a host ::before any more. It lives in a body-level, position:fixed HUD layer
  // (`.sw-ov`), deliberately: there it can never be clipped by the host's overflow, never covered by
  // host content, is immune to host styling, and — unlike a pseudo-element — is CLICKABLE.
  // `hideHud` hides the ROW rather than removing its children, so assert VISIBILITY, not node count.
  const badges = preview.locator('.sw-ov .sw-ov-badge');
  await expect(badges.first()).toBeHidden(); // nothing showing at rest

  await hoverForHud(page, region, badges.first());
  await expect(badges.first()).toContainText('tagline'); // names the field it edits
  // The full typed description is its accessible name (the styled tooltip renders from data-tip).
  expect(await badges.first().getAttribute('aria-label')).toContain('tagline');

  // …and it clears once the pointer leaves the preview, so it never lingers over content. The HUD hides
  // on a SCHEDULE (scheduleHide) rather than synchronously, so poll rather than asserting immediately.
  // The HUD hides when a move lands on a NON-editable point (or the pointer leaves the frame), and it
  // hides on a SCHEDULE rather than synchronously — so move within the preview, below the heading, and
  // poll. Moving to the page chrome is not enough: the iframe gets no mouseleave from that.
  const box = (await page.locator('iframe[title="Preview"]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 20);
  await expect(badges.first()).toBeHidden({ timeout: 10_000 });
});

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
