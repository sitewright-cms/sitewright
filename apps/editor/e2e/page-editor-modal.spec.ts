import { test, expect } from '@playwright/test';
import { signUp } from './helpers.js';

const stamp = Date.now();

/** Long enough for a device switch (duration-300) to have fully settled before the next measurement. */
const TRANSITION_SETTLE_MS = 500;

// The contentbase-style page editor modal: 90vh dialog over the page list, a code
// strip that opens COLLAPSED and expands on hover, a device rail simulating the
// default Tailwind breakpoints, save-without-close (button + Ctrl+S), and Esc back
// to the page list with a confirm when changes would be discarded.

test('page editor modal: collapsed code strip, device simulation, Ctrl+S, Esc-with-confirm', async ({ page }) => {
  await signUp(page, `pemodal-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Modal Site');
  await page.getByLabel('Project slug').fill(`pemodal-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: /^Home/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();

  // The editor is a MODAL over the page list (the list stays in the DOM behind it).
  // Target it by its title (the page name) so the stacked discard dialog stays distinct.
  const dialog = page.getByRole('dialog', { name: 'Home' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('button:has-text("New page")')).toBeAttached(); // the list is still behind (inert)

  // The code strip opens COLLAPSED and expands on hover (contentbase behavior).
  // Park the pointer on neutral ground first: the modal renders UNDER the cursor
  // (which still sits where the page button was clicked), and Chromium re-evaluates
  // hover on layout — a legitimate hover-expand, but not the state under test.
  await page.mouse.move(8, 8);
  const strip = page.locator('section[aria-label="Template source editor"]');
  await expect(strip).toHaveAttribute('data-expanded', 'false');
  await strip.hover();
  await expect(strip).toHaveAttribute('data-expanded', 'true');

  // Device rail: large desktop is the default and FLUID — it fills the modal; the other buttons resize
  // to the Tailwind-aligned widths. Fluid now resolves to the host's MEASURED width in px rather than
  // rendering as a differently-shaped box, so that every switch is a px→px tween (see DevicePreview).
  const viewport = page.getByTestId('device-viewport');
  const host = viewport.locator('xpath=..');
  await expect(page.getByRole('button', { name: 'Preview: Large desktop' })).toHaveAttribute('aria-pressed', 'true');
  expect(await viewport.evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(
    await host.evaluate((el) => Math.round(el.getBoundingClientRect().width)),
  );
  await page.getByRole('button', { name: 'Preview: Mobile' }).click();
  await expect(viewport).toHaveCSS('width', '390px'); // below sm → mobile-first base styles
  await page.getByRole('button', { name: 'Preview: Tablet' }).click();
  await expect(viewport).toHaveCSS('width', '768px'); // md
  await page.getByRole('button', { name: 'Preview: Laptop' }).click();
  await expect(viewport).toHaveCSS('width', '1024px'); // lg

  // The switch GLIDES rather than snapping. Arm the sampler BEFORE the click, then watch for a width
  // strictly BETWEEN the two devices — the only proof that a transition actually ran. This can only be
  // asserted here: jsdom has no layout, and Testing Library's act() flushes effects synchronously, so
  // a unit test sees the transition class whether or not it arrives in time to do anything. It
  // regressed in exactly that gap once — the class was armed from a passive effect, one paint after
  // the width had already been committed, so the browser had nothing left to interpolate.
  const glided = viewport.evaluate(
    (el) =>
      new Promise<boolean>((resolve) => {
        const t0 = performance.now();
        const tick = () => {
          const w = el.getBoundingClientRect().width;
          if (w > 768.5 && w < 1023.5) return resolve(true); // caught it mid-flight
          if (performance.now() - t0 > 800) return resolve(false);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  await page.getByRole('button', { name: 'Preview: Tablet' }).click();
  expect(await glided).toBe(true);
  await expect(viewport).toHaveCSS('width', '768px');

  // ★ AND the two switches that involve FLUID, which are the ones that were broken while the check
  // above passed: it only ever exercised fixed→fixed. Sample width AND the box's CENTRE each frame —
  // a switch that tweens its width while sliding sideways is still wrong, and that is exactly what
  // "back to Large desktop" used to do (measured on the pre-fix component: 795px of centre drift,
  // i.e. the box jumped to the left edge and widened from there, while desktop→mobile did not tween
  // at all). Both directions must glide AND hold the centre.
  const track = (ms: number) =>
    viewport.evaluate(
      (el, budget) =>
        new Promise<{ w: number; cx: number }[]>((resolve) => {
          const rows: { w: number; cx: number }[] = [];
          const t0 = performance.now();
          const tick = () => {
            const r = el.getBoundingClientRect();
            rows.push({ w: r.width, cx: r.left + r.width / 2 });
            if (performance.now() - t0 > budget) return resolve(rows);
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
      ms,
    );
  const judge = (rows: { w: number; cx: number }[]) => {
    const first = rows[0]!, last = rows[rows.length - 1]!;
    const cxs = rows.map((r) => r.cx);
    return {
      midFlight: rows.filter((r) => Math.abs(r.w - first.w) > 1 && Math.abs(r.w - last.w) > 1).length,
      drift: Math.max(...cxs) - Math.min(...cxs),
    };
  };

  await page.getByRole('button', { name: 'Preview: Large desktop' }).click();
  await page.waitForTimeout(TRANSITION_SETTLE_MS);
  const toMobile = track(700);
  await page.getByRole('button', { name: 'Preview: Mobile' }).click();
  const outOfFluid = judge(await toMobile);
  expect(outOfFluid.midFlight).toBeGreaterThan(0); // it tweens leaving fluid…
  expect(outOfFluid.drift).toBeLessThanOrEqual(1); // …without leaving centre

  const toDesktop = track(700);
  await page.getByRole('button', { name: 'Preview: Large desktop' }).click();
  const intoFluid = judge(await toDesktop);
  expect(intoFluid.midFlight).toBeGreaterThan(0); // …and tweens going back
  expect(intoFluid.drift).toBeLessThanOrEqual(1); // …still without leaving centre

  await page.getByRole('button', { name: 'Preview: Large desktop' }).click();
  await page.waitForTimeout(TRANSITION_SETTLE_MS);
  // Back to fluid — which now means "as wide as the host", not "no inline style".
  expect(await viewport.evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(
    await host.evaluate((el) => Math.round(el.getBoundingClientRect().width)),
  );

  // The code strip COLLAPSES on a mode switch instead of vanishing: still in the DOM, zero-height,
  // and out of the tab order (visibility, not display, so the collapse can animate).
  await expect(strip).toHaveAttribute('data-collapsed', 'false');
  await page.getByRole('button', { name: 'Content Editor' }).click();
  await expect(strip).toHaveAttribute('data-collapsed', 'true');
  await expect(strip).toHaveCSS('visibility', 'hidden');
  expect(await strip.evaluate((el) => el.getBoundingClientRect().height)).toBe(0);
  await page.getByRole('button', { name: 'Code Editor' }).click();
  await expect(strip).toHaveAttribute('data-collapsed', 'false');
  await expect(strip).toHaveCSS('visibility', 'visible');

  // Edit, then Ctrl+S: saves WITHOUT closing the modal.
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('CTRLS-MARKER');
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByText('Saved')).toBeVisible();
  await expect(dialog).toBeVisible(); // still open — the loop continues

  // Esc on a CLEAN editor → straight back to the page list (no confirm).
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: '+ New page' })).toBeVisible();

  // Reopen, make it dirty, Esc → the stacked discard DIALOG appears; Cancel keeps editing.
  await page.getByRole('button', { name: /^Home/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('DISCARDED-EDIT');
  await page.keyboard.press('Escape');
  const discard = page.getByRole('dialog', { name: 'Discard changes' });
  await discard.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeVisible(); // still editing

  // Esc again → confirm Discard → closes WITHOUT saving.
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Discard changes' }).getByRole('button', { name: 'Discard' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: /^Home/ }).click();
  await expect(dialog).toBeVisible(); // the discarded modal finished closing before we grab the new one's tab
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('CTRLS-MARKER'); // the saved version
  await expect(page.locator('.cm-content')).not.toContainText('DISCARDED-EDIT'); // discard really discarded
});
