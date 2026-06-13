import { test, expect } from '@playwright/test';

const stamp = Date.now();

// The contentbase-style page editor modal: 90vh dialog over the page list, a code
// strip that opens COLLAPSED and expands on hover, a device rail simulating the
// default Tailwind breakpoints, save-without-close (button + Ctrl+S), and Esc back
// to the page list with a confirm when changes would be discarded.

test('page editor modal: collapsed code strip, device simulation, Ctrl+S, Esc-with-confirm', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`pemodal-${stamp}@e2e.test`);
  await page.getByRole('textbox', { name: 'Password' }).fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
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

  // Device rail: large desktop is the default and FLUID — no simulated width, the
  // preview fills the modal; the other buttons resize to the Tailwind-aligned widths.
  const viewport = page.getByTestId('device-viewport');
  await expect(page.getByRole('button', { name: 'Preview: Large desktop' })).toHaveAttribute('aria-pressed', 'true');
  expect(await viewport.getAttribute('style')).toBeNull(); // fluid: no inline width
  await page.getByRole('button', { name: 'Preview: Mobile' }).click();
  await expect(viewport).toHaveCSS('width', '390px'); // below sm → mobile-first base styles
  await page.getByRole('button', { name: 'Preview: Tablet' }).click();
  await expect(viewport).toHaveCSS('width', '768px'); // md
  await page.getByRole('button', { name: 'Preview: Laptop' }).click();
  await expect(viewport).toHaveCSS('width', '1024px'); // lg
  await page.getByRole('button', { name: 'Preview: Large desktop' }).click();
  expect(await viewport.getAttribute('style')).toBeNull(); // back to fluid

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
