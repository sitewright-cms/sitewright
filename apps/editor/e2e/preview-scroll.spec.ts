import { test, expect } from '@playwright/test';

const stamp = Date.now();

// The page editor's preview keeps its scroll position across a reload (the editor↔preview bridge
// reports scrollY and restores it via a `#sw-y=` hash), and the taller (90vh) modal still leaves the
// bottom code-rail tabs reachable.
test('preview keeps scroll across a reload; bottom rails stay visible over the taller modal', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`scroll-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Scroll Site');
  await page.getByLabel('Project slug').fill(`scroll-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Open the Home page editor and give it tall content so the preview can scroll.
  await page.getByRole('button', { name: /^Home/ }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  const tall = `<main class="p-8"><h1 id="top">Top</h1>${'<p class="my-10">paragraph</p>'.repeat(30)}<h2 id="bottom">Bottom</h2></main>`;
  await page.keyboard.insertText(tall);

  const iframe = page.locator('iframe[title="Preview"]');
  await expect(iframe).toBeVisible();
  // Taller modal: the bottom code-rail tabs stay visible/reachable over the open page editor.
  await expect(page.getByRole('button', { name: 'Open Snippets' })).toBeVisible();
  // Wait for the preview to actually render the tall content (its end marker is in the DOM).
  await expect(page.frameLocator('iframe[title="Preview"]').locator('#bottom')).toBeVisible();
  await page.screenshot({ path: '/tmp/editor-tall.png' });

  // Scroll the preview down; the bridge reports it (rAF-coalesced) to the editor's scrollYRef.
  const frameOf = async () => (await (await iframe.elementHandle())!.contentFrame())!;
  await (await frameOf()).evaluate(() => window.scrollTo(0, 700));
  await expect.poll(async () => (await frameOf()).evaluate(() => Math.round(window.scrollY))).toBe(700);
  await page.waitForTimeout(250); // let the rAF scroll message reach the parent before we trigger a reload

  // Trigger a reload with a tiny source change; afterwards the preview must RESTORE scroll, not jump to 0.
  const reload = page.waitForResponse((r) => r.url().includes('/preview') && r.request().method() === 'POST');
  await page.locator('.cm-content').click();
  await page.keyboard.type('<!--r-->');
  await reload;
  // Poll until the freshly-loaded doc's bridge restores scroll (near 700) — definitively NOT the top.
  await expect
    .poll(async () => (await frameOf()).evaluate(() => Math.round(window.scrollY)), { timeout: 6000 })
    .toBeGreaterThan(300);
});
