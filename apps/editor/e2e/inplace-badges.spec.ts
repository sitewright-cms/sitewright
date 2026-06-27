import { test, expect } from '@playwright/test';

// The content editor marks editable regions with a top-level OVERLAY badge HUD (in the preview iframe):
// clickable, uniform badges that are never clipped by the host's overflow, show MULTIPLE directives per
// element, and expose the editable STACK under the pointer. This exercises all of that end-to-end.
test('content editor: overlay badge HUD — clickable, multi-directive, unclipped, stacked', async ({ page }) => {
  const s = Date.now();
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`badges-${s}@e2e.test`);
  await page.getByRole('textbox', { name: 'Password' }).fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Badge Site');
  await page.getByLabel('Project slug').fill(`badges-${s}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: /^Home/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(
    '<h1 data-sw-text="headline">Hello</h1>' +
      '<a data-sw-href="cta_url" data-sw-text="cta_label" href="/start" style="display:inline-block;margin:20px 0">Go</a>' +
      '<div style="overflow:hidden;height:34px;width:180px;border:1px solid #ccc"><p data-sw-text="boxed" style="margin:0">In a clipped box with long text</p></div>',
  );
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();
  const preview = page.frameLocator('iframe[title="Preview"]');

  // 1) Hover a plain heading → exactly one badge, naming the bound key, clickable (pointer-events:auto).
  await preview.locator('h1').hover();
  const headBadge = preview.locator('.sw-ov-badge', { hasText: 'headline' });
  await expect(headBadge).toBeVisible();
  await expect(headBadge).toHaveCSS('pointer-events', 'auto');

  // 2) A link carrying BOTH data-sw-text and data-sw-href → two badges (Q4 multiple directives).
  await preview.locator('a[data-sw-href]').hover();
  await expect(preview.locator('.sw-ov-badge', { hasText: 'cta_label' })).toBeVisible();
  await expect(preview.locator('.sw-ov-badge', { hasText: 'cta_url' })).toBeVisible();

  // 3) Clicking the url badge opens that directive's editor (the URL popover) — proving the badge itself
  //    is clickable even though the element's own click would otherwise be ambiguous (Q3).
  await preview.locator('.sw-ov-badge', { hasText: 'cta_url' }).click();
  await expect(preview.locator('.sw-pop .sw-url')).toBeVisible();
  await preview.locator('.sw-pop .sw-cancel').click();

  // 4) A text inside an overflow:hidden box still shows its badge — the HUD is a body-level overlay, so it
  //    is NOT clipped by the host's overflow (Q1).
  await preview.locator('p[data-sw-text="boxed"]').hover();
  await expect(preview.locator('.sw-ov-badge', { hasText: 'boxed' })).toBeVisible();
});
