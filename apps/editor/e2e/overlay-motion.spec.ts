import { test, expect } from '@playwright/test';
import { signUp } from './helpers.js';

/**
 * ★ THE MARKERS MUST FOLLOW A MOVING ELEMENT.
 *
 * The at-rest markers are position:fixed boxes placed from getBoundingClientRect(). They were
 * repainted on scroll, resize, input and a ResizeObserver on <body> — and a TRANSFORM changes no
 * layout size, so the ResizeObserver never fires for one. Transform is what nearly every animation on
 * these pages animates (scroll-reveal, parallax, a carousel, a marquee, a hover lift), so on an
 * animated element the marker did not merely lag: it was placed once and then never updated until the
 * next scroll.
 *
 * This measures the actual gap between the marker and the element it marks — the only way to know,
 * since the unit tests can assert what the stylesheet SAYS but not where a box lands.
 */

const stamp = Date.now();

async function project(page: import('@playwright/test').Page, slug: string) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signUp(page, `${slug}-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Motion');
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

/**
 * The worst gap, in px, between a marked element and its overlay box, sampled every frame over `ms`.
 *
 * Runs INSIDE the preview frame: it is sandboxed to an opaque origin (no allow-same-origin), so the
 * parent page cannot reach its contentDocument at all — which is the point of the sandbox.
 */
async function worstGap(page: import('@playwright/test').Page, ms: number): Promise<number> {
  const preview = page.frameLocator('iframe[title="Preview"]');
  return preview.locator('[data-sw-text="tagline"]').evaluate(async (el, duration) => {
    const box = el.ownerDocument.querySelector('.sw-ov-rest .sw-ov-r') as HTMLElement | null;
    if (!box) throw new Error('no overlay marker rendered');
    let worst = 0;
    const until = performance.now() + (duration as number);
    while (performance.now() < until) {
      await new Promise((r) => requestAnimationFrame(r));
      const a = el.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      worst = Math.max(worst, Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.width - b.width), Math.abs(a.height - b.height));
    }
    return worst;
  }, ms);
}

test('the marker follows an element animated by TRANSFORM', async ({ page }) => {
  await project(page, 'motion-transform');
  // A long, slow slide — the shape of a scroll-reveal or a carousel, and the case a ResizeObserver
  // is blind to because the border box never changes size.
  await setSource(
    page,
    '<style>@keyframes slide{from{transform:translateX(0)}to{transform:translateX(320px)}}' +
      '.mover{animation:slide 4s linear infinite alternate}</style>' +
      '<h1 class="mover" data-sw-text="tagline">Hello</h1>',
  );
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();

  const preview = page.frameLocator('iframe[title="Preview"]');
  await expect(preview.locator('.sw-ov-rest .sw-ov-r').first()).toBeVisible();
  // The source edit is debounced and then re-renders the preview, so the frame navigates once more
  // after the first paint. Measuring across that reload just kills the execution context.
  await page.waitForTimeout(1500);
  await expect(preview.locator('.sw-ov-rest .sw-ov-r').first()).toBeVisible();

  // Sampled every frame for a second, MID-animation. Before the motion loop this drifted by hundreds
  // of pixels — the box stayed where the element started.
  const gap = await worstGap(page, 1000);
  expect(gap, `marker drifted ${gap}px from the element it marks`).toBeLessThanOrEqual(8);
});

test('the marker lands exactly once an animation SETTLES, and stops burning frames', async ({ page }) => {
  await project(page, 'motion-settle');
  await setSource(
    page,
    '<style>@keyframes once{from{transform:translateY(-120px);opacity:0}to{transform:none;opacity:1}}' +
      '.enter{animation:once .6s ease-out both}</style>' +
      '<h1 class="enter" data-sw-text="tagline">Hello</h1>',
  );
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();
  const preview = page.frameLocator('iframe[title="Preview"]');
  await expect(preview.locator('.sw-ov-rest .sw-ov-r').first()).toBeVisible();

  await page.waitForTimeout(1200); // well past the .6s entrance
  const settled = await worstGap(page, 250);
  expect(settled, 'the marker must land ON the element once it comes to rest').toBeLessThanOrEqual(1);
});
