import { test, expect, type FrameLocator } from '@playwright/test';
import { signUpWithProject } from './helpers.js';

const stamp = Date.now();

/**
 * The button EFFECT / ACCENT / SHAPE axes, measured as COMPUTED STYLE in a real browser.
 *
 * ★ Why this suite exists. These three axes shipped inert for months and every unit test stayed green,
 * because the unit tests assert the stylesheet's TEXT — the rules were all present, correct, and
 * addressed to the right selectors. What was wrong was the CASCADE: the axes were emitted inside
 * `@layer sw-effects` while the platform `.btn` baseline ships UNLAYERED, and a layered declaration
 * loses to an unlayered one whatever its specificity. Measured against a no-effect control, 13 of 28
 * effects changed nothing at all, all four accents left `--sw-btn-fx` at the baseline's secondary, and
 * all eight shapes left the radius at the baseline's `.7rem`.
 *
 * Nothing short of a real browser can see that: `@layer` precedence is exactly what jsdom does not
 * implement, and a text assertion cannot distinguish "the rule is in the sheet" from "the rule wins".
 * So every assertion here reads a computed value off a rendered button, and each one is anchored to a
 * CONTROL — the same button before the axis is applied — so "the effect did nothing" can never be
 * mistaken for "the effect happens to match the default".
 */

const SAMPLE = 'Get started'; // the solid btn-primary sample, first in both previews

/** Computed style of the named sample button inside a preview iframe. */
const styleOf = (frame: FrameLocator, prop: string) =>
  frame
    .locator('button', { hasText: SAMPLE })
    .first()
    .evaluate((el, p) => {
      const cs = getComputedStyle(el);
      return p.startsWith('--') ? cs.getPropertyValue(p).trim() : cs[p as 'transform'];
    }, prop);

/**
 * Hover the sample and wait for its transform to REACH the expected value.
 *
 * A fixed wait is wrong here and flaked once already at `matrix(1.04204, …)` against an expected
 * `1.05`: these transitions run .2–.45s, but the suite shares one machine, so "long enough" is not a
 * constant. Polling converges on the settled value instead — the hover stays applied between reads, so
 * this only re-reads the computed style, it does not re-trigger anything.
 */
async function hoverTransform(frame: FrameLocator, expected: string) {
  await frame.locator('button', { hasText: SAMPLE }).first().hover();
  await expect.poll(() => styleOf(frame, 'transform'), { timeout: 5_000 }).toBe(expected);
}

test('website Button effects modal: effect, accent and shape all reach the preview', async ({ page }) => {
  await signUpWithProject(page, `btnfx-${stamp}@e2e.test`, 'Btn Site', `btnfx-${stamp}`);

  await page.getByRole('tab', { name: 'Website Settings' }).click();
  await page.getByRole('button', { name: /accent ·/ }).click();
  const modal = page.getByRole('dialog', { name: 'Button effects' });
  await expect(modal).toBeVisible();

  const preview = modal.frameLocator('iframe[title="Button preview"]');
  await expect(preview.locator('button', { hasText: SAMPLE })).toBeVisible();

  // ── CONTROL: the baseline, with no axis class on the button at all. Its hover is a 1.05 scale and
  //    its accent is the brand secondary — the two values the axes below have to displace.
  const restingRadius = await styleOf(preview, 'borderRadius');
  const baselineAccent = await styleOf(preview, '--sw-btn-fx');
  await hoverTransform(preview, 'matrix(1.05, 0, 0, 1.05, 0, 0)');

  // ── EFFECT. `lift` replaces that scale with a 3px translate. Asserting the exact matrix (rather
  //    than "not the baseline") pins that the effect's OWN rule won, not merely that something moved.
  await modal.getByLabel('Button effect').selectOption('lift');
  await hoverTransform(preview, 'matrix(1, 0, 0, 1, 0, -3)');

  // ── ACCENT. Read the token rather than a colour literal: the hex belongs to the project's palette,
  //    but whether `sw-btn-accent-*` outranks the baseline's `--sw-btn-fx` is what is under test.
  await modal.getByLabel('Button hover accent').selectOption('accent');
  await expect.poll(() => styleOf(preview, '--sw-btn-fx')).not.toBe(baselineAccent);
  const accentToken = await styleOf(preview, '--sw-btn-fx');
  await modal.getByLabel('Button hover accent').selectOption('neutral');
  await expect.poll(() => styleOf(preview, '--sw-btn-fx')).not.toBe(accentToken); // each role is distinct

  // ── SHAPE. `pill` is a radius the baseline never produces; `sharp` is its opposite. Both are
  //    resting state, so no hover is needed.
  await modal.getByLabel('Button shape').selectOption('pill');
  await expect.poll(() => styleOf(preview, 'borderRadius')).toBe('999px');
  await modal.getByLabel('Button shape').selectOption('sharp');
  await expect.poll(() => styleOf(preview, 'borderRadius')).toBe('0px');
  expect(restingRadius).not.toBe('0px'); // the control really did differ

  // ── The picked axes are what gets applied to the site, not just to the preview.
  await modal.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('button', { name: /Lift · Neutral accent · Sharp/ })).toBeVisible();
});

test('library Button builder: the composed button previews with its effect and shape live', async ({ page }) => {
  await signUpWithProject(page, `btnlab-${stamp}@e2e.test`, 'Lab Site', `btnlab-${stamp}`);

  const library = page.locator('[role="region"][aria-label="System Library"]');
  if ((await library.getAttribute('aria-hidden')) === 'true') {
    await page.getByRole('button', { name: 'Open System Library' }).click();
    await expect(library).toHaveAttribute('aria-hidden', 'false');
  }
  await library.getByRole('button', { name: /Button builder/ }).click();
  const modal = page.getByRole('dialog', { name: 'Button builder' });
  await expect(modal).toBeVisible();

  const preview = modal.frameLocator('iframe[title="Button preview"]');
  await expect(preview.locator('button', { hasText: SAMPLE })).toBeVisible();

  // Control first, then the same two axes — this modal builds its own markup and injects the brand
  // from the DOM rather than from the settings form, so it is a genuinely separate surface.
  await hoverTransform(preview, 'matrix(1.05, 0, 0, 1.05, 0, 0)');

  await modal.getByLabel('Button effect').selectOption('lift');
  await hoverTransform(preview, 'matrix(1, 0, 0, 1, 0, -3)');

  await modal.getByLabel('Button shape').selectOption('pill');
  await expect.poll(() => styleOf(preview, 'borderRadius')).toBe('999px');

  // The copied markup carries the same classes the preview just proved.
  await expect(modal.locator('pre')).toContainText('sw-btn-fx-lift');
  await expect(modal.locator('pre')).toContainText('sw-btn-shape-pill');

  // ── The Lab gallery renders every effect on a real button. Spot-check one whose whole visible
  //    result is a property the baseline also sets — the exact shape of the bug this suite guards.
  await modal.getByRole('button', { name: 'Lab' }).click();
  const lab = modal.frameLocator('iframe[title="Button lab"]');
  const frost = lab.locator('button.sw-btn-fx-frost').first();
  await expect(frost).toBeVisible();
  // `frost` paints a translucent tint of the face; the baseline paints the face opaque. If the rule
  // lost the cascade the button would simply render as a plain solid primary.
  const frostBg = await frost.evaluate((el) => getComputedStyle(el).backgroundColor);
  const plainBg = await lab
    .locator('button.sw-btn-fx-lift')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(frostBg).not.toBe(plainBg);
  // …and specifically translucent: an alpha channel, which the opaque baseline face never has.
  expect(frostBg).toMatch(/\/\s*0?\.\d+\s*\)|rgba\([^)]+,\s*0?\.\d+\s*\)/);
});
