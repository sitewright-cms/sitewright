import { test, expect, type Page } from '@playwright/test';

const stamp = Date.now();

// PR-D admin-UX polish: ripple ("waves") feedback on buttons, and modal close behaviour —
// a backdrop click is vetoed while the editor has unsaved changes (it asks to discard).

async function register(page: Page, suffix: string) {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`adminux-${suffix}-${stamp}@e2e.test`);
  await page.getByRole('textbox', { name: 'Password' }).fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Admin UX');
  await page.getByLabel('Project slug').fill(`adminux-${suffix}-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
}

test('buttons get a ripple: pointerdown injects a .waves-ripple inside the .waves-effect', async ({ page }) => {
  await register(page, 'wave');
  // Wait for the project-section tablist to render before probing.
  await expect(page.getByRole('tab').first()).toBeVisible();

  // A project-section tab is a `.waves-effect`. Dispatch pointerdown and check synchronously,
  // before the ripple animates out, that a ripple span was injected into that element.
  const injected = await page.evaluate(() => {
    const el = document.querySelector('[role="tab"].waves-effect') as HTMLElement | null;
    if (!el) return 'no-waves-effect-tab';
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
    return el.querySelector('.waves-ripple') ? 'rippled' : 'no-ripple';
  });
  expect(injected).toBe('rippled');
});

test('modal: a backdrop click is vetoed while dirty (asks to discard); × closes after discard', async ({ page }) => {
  await register(page, 'modal');

  // Create + open a code page.
  await page.getByRole('button', { name: 'New page' }).click();
  await page.getByLabel('Page path').fill('about');
  await page.getByLabel('Page title').fill('About');
  await page.getByRole('button', { name: 'Add page' }).click();
  await page.getByRole('button', { name: /^About/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await expect(page.locator('.cm-content')).toBeVisible();

  // Make the editor dirty.
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('<p>unsaved edit</p>');

  // Click the backdrop (the presentation wrapper around the dialog panel). The onBeforeClose
  // guard intercepts it → the discard dialog appears instead of closing. Cancel keeps editing.
  const editor = page.getByRole('dialog', { name: /About/ });
  await editor.evaluate((el) => {
    const wrapper = el.parentElement as HTMLElement; // role="presentation" backdrop container
    wrapper.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  const discard = page.getByRole('dialog', { name: 'Discard changes' });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.cm-content')).toBeVisible(); // still editing

  // The × button → Discard → the editor closes (back to the pages list).
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('dialog', { name: 'Discard changes' }).getByRole('button', { name: 'Discard' }).click();
  await expect(page.locator('.cm-content')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^About/ })).toBeVisible();
});
