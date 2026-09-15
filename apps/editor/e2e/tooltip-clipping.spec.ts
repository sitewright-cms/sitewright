import { test, expect } from '@playwright/test';
import { signUp } from './helpers.js';

const stamp = Date.now();

/**
 * A tooltip inside a scrolling panel must not be cut off by that panel's box.
 *
 * ★ The bubble renders in a `document.body` portal for exactly this reason. A CSS `:before` bubble is
 * clipped by any ancestor with `overflow`, and every editor panel is a scroll container — so the hint
 * was cut off precisely where it was most needed. A `position:fixed` pseudo-element would NOT have
 * fixed it either: `backdrop-filter` establishes a containing block for fixed descendants, and every
 * panel is a glass surface.
 *
 * ★ jsdom cannot see ANY of this — no layout, no clipping, no paint — so the unit suite passes either
 * way. This is the only place the fix is actually verified.
 */
test('a tooltip inside a scrolling panel is painted, not clipped by the panel', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signUp(page, `tipclip-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Tip Site');
  await page.getByLabel('Project slug').fill(`tip-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // The File Manager drawer — a fixed-size panel whose body scrolls.
  await page.getByRole('button', { name: 'Open File Manager' }).click();
  const panel = page.locator('[role="region"][aria-label="File Manager"]');
  await expect(panel).toBeVisible();

  // Any tooltipped control inside the panel. `data-tip` stays on the host purely as this hook.
  const host = panel.locator('[data-sw-tip="portal"]').first();
  await expect(host).toBeVisible();
  await host.hover();

  const bubble = page.locator('body > [role="tooltip"]');
  await expect(bubble).toBeVisible();

  // ★ EXACTLY ONE bubble: the CSS pseudo-bubble must be suppressed for portal hosts, or every hint
  // paints twice (once clipped, once not).
  await expect(page.locator('[role="tooltip"]')).toHaveCount(1);

  // ★ It escaped the panel's subtree entirely — that is what makes clipping impossible. Measured on
  // this flow: with the panel box at x=1270 w=896, the two bubbles painted at centres (1238,56) and
  // (519,219) — both OUTSIDE the panel's rect, and both the topmost element there. A clipped bubble
  // cannot be painted outside the box that clips it, let alone be hit-tested there.
  expect(await bubble.evaluate((el) => !!el.closest('[role="region"]')), 'must not be inside any panel').toBe(false);
  expect(await bubble.evaluate((el) => el.parentElement?.tagName)).toBe('BODY');

  // ★ And nothing is painted OVER it: `elementFromPoint` at its own centre returns the bubble. A
  // visible-but-covered bubble passes toBeVisible(), so this is the assertion that has teeth.
  //
  // The bubble ships `pointer-events:none` (a hint must never eat a click), and elementFromPoint
  // SKIPS such elements — so it is made hit-testable for the duration of the probe only. That
  // property affects hit-testing alone, never paint order or clipping, so toggling it cannot make a
  // clipped bubble look unclipped.
  const box = (await bubble.boundingBox())!;
  const hit = await page.evaluate(
    ([x, y]) => {
      const el = document.querySelector('body > [role="tooltip"]') as HTMLElement | null;
      if (!el) return 'no-bubble';
      const saved = el.style.pointerEvents;
      el.style.pointerEvents = 'auto';
      const top = document.elementFromPoint(x, y);
      el.style.pointerEvents = saved;
      return top === el ? 'bubble' : (top?.tagName ?? 'nothing');
    },
    [box.x + box.width / 2, box.y + box.height / 2] as const,
  );
  expect(hit, 'the bubble centre must be the topmost painted element').toBe('bubble');

  // Fully inside the viewport, on every edge.
  const vp = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
});
