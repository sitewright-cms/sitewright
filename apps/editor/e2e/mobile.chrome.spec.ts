import { test, expect, type Page } from '@playwright/test';
import { signUp } from './helpers.js';

const stamp = Date.now();

// Runs ONLY in the `mobile-chrome` project (Pixel 7, 412×915 — under the `sm` breakpoint, coarse
// pointer, real touch). See playwright.config.ts.
//
// Below `sm` the editor mounts a deliberately smaller app: the five edge rails are culled to two in the
// bottom corners, the page editor is the Content Editor and nothing else, and page rows trade their
// action toolbar for the long-press menu. Unit tests cover WHICH parts mount; only a real browser can
// answer whether the result actually fits on the screen.

/**
 * ★ THE GUARD THAT MATTERS MOST. Horizontal overflow is the classic mobile regression: one element
 * wider than the viewport and the whole page scrolls sideways, which looks broken everywhere at once
 * and is invisible in every jsdom test. `scrollWidth` on the document element is the cheapest true
 * answer. 1px of slack absorbs sub-pixel rounding in the emulated viewport.
 */
async function expectNoHorizontalOverflow(page: Page, where: string) {
  const [scrollWidth, clientWidth] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  expect(scrollWidth, `${where}: the page must not scroll sideways on a phone`).toBeLessThanOrEqual(clientWidth + 1);
}

test('mobile: no surface scrolls sideways, from sign-in to the page editor', async ({ page }) => {
  await signUp(page, `mob-${stamp}@e2e.test`);
  await expectNoHorizontalOverflow(page, 'project selector');

  await page.getByRole('button', { name: 'New project' }).click();
  await expectNoHorizontalOverflow(page, 'new project modal');
  await page.getByLabel('Project name').fill('Mobile Site');
  await page.getByLabel('Project slug').fill(`mob-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await expect(page.getByRole('button', { name: /^Home \// })).toBeVisible();
  await expectNoHorizontalOverflow(page, 'pages list');

  await page.getByRole('button', { name: /^Home \// }).click();
  await expect(page.getByTitle('Preview')).toBeVisible();
  await expectNoHorizontalOverflow(page, 'page editor');
});

test('mobile: only the Datasets and File Manager rails, one per bottom corner', async ({ page }) => {
  await signUp(page, `mobrail-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Rail Site');
  await page.getByLabel('Project slug').fill(`mobrail-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('button', { name: /^Home \// })).toBeVisible();

  // The code-authoring rails feed an editor a phone cannot open — they would be tabs leading nowhere.
  for (const gone of ['Open System Library', 'Open Snippets', 'Open Templates', 'Open Widgets']) {
    await expect(page.getByRole('button', { name: gone })).toHaveCount(0);
  }

  const data = page.getByRole('button', { name: 'Open Datasets' });
  const files = page.getByRole('button', { name: 'Open File Manager' });
  await expect(data).toBeVisible();
  await expect(files).toBeVisible();

  // One per corner, both on the bottom edge — and neither overlapping the other.
  const [d, f, viewport] = await Promise.all([
    data.boundingBox(),
    files.boundingBox(),
    page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight })),
  ]);
  expect(d!.x).toBeLessThan(viewport.w / 2);
  expect(f!.x).toBeGreaterThan(viewport.w / 2);
  expect(d!.x + d!.width).toBeLessThan(f!.x); // no overlap
  for (const box of [d!, f!]) {
    expect(box.y + box.height).toBeGreaterThan(viewport.h - 80); // docked to the bottom edge
  }

  // Opening one must not push the layout sideways.
  await files.click();
  await expect(page.getByRole('button', { name: 'Close File Manager' })).toBeVisible();
  await expectNoHorizontalOverflow(page, 'File Manager rail open');
});

test('mobile: page rows carry no action toolbar, and the page editor is content-only', async ({ page }) => {
  await signUp(page, `mobed-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Edit Site');
  await page.getByLabel('Project slug').fill(`mobed-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('button', { name: /^Home \// })).toBeVisible();

  // Seven icon buttons per row leave no width for the page name; every one is in the long-press menu.
  for (const gone of ['Preview Home', 'Edit Home', 'Settings for Home', 'Duplicate Home']) {
    await expect(page.getByRole('button', { name: gone })).toHaveCount(0);
  }

  await page.getByRole('button', { name: /^Home \// }).click();
  await expect(page.getByTitle('Preview')).toBeVisible();

  // Content Editor only: no mode switch, no page-data tree, no device simulator inside the device.
  await expect(page.getByRole('group', { name: 'Edit mode' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit page data' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preview: Mobile' })).toHaveCount(0);
  // The whole rail goes: with the toggles gone, keeping it alive for one button meant parking that
  // button on top of the page being edited.
  await expect(page.getByRole('group', { name: 'Preview device' })).toHaveCount(0);

  // Its action, plus the two rare recoveries, live in one overflow rather than each taking a 44px slot.
  await expect(page.getByRole('button', { name: 'Reload page' })).toHaveCount(0);
  await page.getByRole('button', { name: 'More page actions' }).click();
  const menu = page.getByRole('menu', { name: 'More page actions' });
  await expect(menu.getByRole('menuitem', { name: 'Open this page in a new tab' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Revision history' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Reload from the server' })).toBeVisible();
});

test('mobile: the tablist scrolls in its own row, and modals arrive as bottom sheets', async ({ page }) => {
  await signUp(page, `mobshell-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Shell Site');
  await page.getByLabel('Project slug').fill(`mobshell-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('button', { name: /^Home \// })).toBeVisible();

  // The tablist sits BELOW the header's control row, not inside it — so five tabs never compete with
  // the brand, the project pill, Publish and two menus for one row's width.
  const tablist = page.getByRole('tablist', { name: 'Project sections' });
  // The Account button is the far-RIGHT end of the control row — an unambiguous anchor for "that row"
  // (a /Deploy/ match would also catch "Choose a deploy target", since Playwright's name matching is
  // substring + case-insensitive).
  const account = page.getByRole('button', { name: 'Account' }).first();
  const [tabs, acct] = await Promise.all([tablist.boundingBox(), account.boundingBox()]);
  expect(tabs!.y, 'the tab strip must start below the control row').toBeGreaterThanOrEqual(acct!.y + acct!.height - 2);

  // The strip is BUILT to scroll, but shortening the two long labels ("Corporate Identity" → "Identity",
  // "Website Settings" → "Website") bought back enough width that all five now fit at 412px — the
  // better outcome, and worth pinning so a future long label does not quietly reintroduce the scroll.
  const strip = page.locator('div.sw-scroll-none').filter({ has: tablist });
  const [content, visible] = await strip.evaluate((el) => [el.scrollWidth, el.clientWidth]);
  expect(content, 'the five tabs should fit without scrolling at this width').toBeLessThanOrEqual(visible + 1);
  // And if a longer label ever does overflow it, scrolling the strip must still not drag the PAGE.
  await strip.evaluate((el) => el.scrollBy({ left: 400 }));
  await expectNoHorizontalOverflow(page, 'tab strip scrolled');

  // A modal is a bottom sheet: full-bleed to both side edges and anchored to the bottom of the screen.
  // "+ Page" on a phone, "+ New page" on desktop — the verb is implied by the "+".
  await page.getByRole('button', { name: '+ Page' }).click();
  const sheet = page.getByRole('dialog', { name: /New page/i });
  await expect(sheet).toBeVisible();
  const [box, viewport] = await Promise.all([
    sheet.boundingBox(),
    page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight })),
  ]);
  expect(box!.x).toBeLessThanOrEqual(1); // flush left…
  expect(box!.x + box!.width).toBeGreaterThanOrEqual(viewport.w - 1); // …and flush right
  // Bottom-anchored, but stopping above the rail tabs so those stay reachable over the sheet.
  expect(box!.y + box!.height).toBeGreaterThan(viewport.h * 0.75);
  expect(box!.y + box!.height).toBeLessThan(viewport.h);
  await expectNoHorizontalOverflow(page, 'bottom sheet open');
});

test('mobile: every visible control clears the 44px touch floor', async ({ page }) => {
  await signUp(page, `mobtap-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Tap Site');
  await page.getByLabel('Project slug').fill(`mobtap-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('button', { name: /^Home \// })).toBeVisible();

  // `ghostButton`/`dangerButton` are ~30px tall by default and the icon buttons are 20px glyphs — all
  // under the guidance, and the destructive one is in that set. The floor is a `(pointer: coarse)`
  // rule, so only a real touch-emulating browser can prove it landed.
  // HEIGHT is the assertion: that is the axis every one of them failed on (a text button is already
  // wider than 44px, so the width floor only ever binds on the icon-only ones). Zero-sized buttons are
  // skipped — a collapsed strip's controls are not on screen to be tapped.
  const tooSmall = await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .map((b) => ({ b, r: b.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0 && r.height < 44)
      .map(({ b, r }) => `${b.getAttribute('aria-label') ?? b.textContent?.trim().slice(0, 30)} — ${Math.round(r.height)}px`),
  );
  expect(tooSmall, 'controls under the 44px touch floor').toEqual([]);
});

test('mobile: the dataset rail stays usable, and long-press reaches the dropped caret menus', async ({ page }) => {
  await signUp(page, `mobds-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Data Site');
  await page.getByLabel('Project slug').fill(`mobds-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('button', { name: /^Home \// })).toBeVisible();

  // ── The Datasets rail. Its entry pane used to be `min-w-0 flex-1`, which on a narrow rail bottoms
  // out at a column of single characters. A floor makes the ROW overflow instead — the rail scrolls
  // horizontally, which is a far better failure mode than an unreadable pane.
  await page.getByRole('button', { name: 'Open Datasets' }).click();
  await expect(page.getByRole('button', { name: 'Close Datasets' })).toBeVisible();
  // Structural on purpose: the pane is the sibling of the dataset LIST, which is what it was losing
  // width to. Asserted unconditionally — a locator that silently matches nothing would turn this into
  // a test that always passes.
  const pane = page.locator('aside + section').first();
  await expect(pane).toBeVisible();
  const paneBox = await pane.boundingBox();
  expect(paneBox!.width, 'the entry pane must not collapse').toBeGreaterThanOrEqual(360);
  await expectNoHorizontalOverflow(page, 'datasets rail open');
  await page.keyboard.press('Escape');

  // ── Long-press stands in for the split-button carets the compact header drops. Dropping a control
  // is only acceptable if what it opened is still reachable.
  // Built in-page rather than via dispatchEvent's serialised form: `Touch` requires BOTH `identifier`
  // and a real `target` element, which cannot cross the serialisation boundary.
  const deploy = page.getByRole('button', { name: /^Deploy/ });
  await deploy.evaluate((el) => {
    const t = new Touch({ identifier: 1, target: el, clientX: 10, clientY: 10 });
    el.dispatchEvent(new TouchEvent('touchstart', { touches: [t], changedTouches: [t], bubbles: true }));
  });
  await page.waitForTimeout(700); // past LONG_PRESS_MS (500ms)
  await expect(page.getByRole('menu').first()).toBeVisible();
});
