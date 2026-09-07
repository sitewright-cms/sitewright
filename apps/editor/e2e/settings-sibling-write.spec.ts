import { test, expect } from '@playwright/test';
import { signUp } from './helpers.js';

const stamp = Date.now();

/**
 * REGRESSION — reported 2026-09-07: "I saved changes in criticalCSS, then changed some skeleton code
 * and button effects, and the criticalCSS changes were gone."
 *
 * criticalCss, the skeleton slots and the button effects all live in the SAME settings singleton, but
 * the Critical CSS shortcut writes it through `?merge=1` while the Website Settings form does a FULL
 * REPLACE. The form therefore has to notice the shortcut's write; if it does not, its next save sends
 * the CSS it was holding before — an empty string — straight over the top.
 *
 * This drives both surfaces in one session, which is the only way the bug appears: the API alone is
 * innocent, and each surface alone is fine.
 */
test('CSS written by the shortcut survives a later Website-settings save', async ({ page }) => {
  await signUp(page, `sibling-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Sibling Write');
  await page.getByLabel('Project slug').fill(`sibling-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // 1. Open Website Settings — the form is now built from the CURRENT version.
  await page.getByRole('tab', { name: 'Website Settings' }).click();
  await expect(page.getByRole('tab', { name: 'Website Settings' })).toBeVisible();

  // 2. Save CSS through the Critical CSS shortcut (Ctrl+Alt+C) — a `?merge=1` write to the same
  //    singleton, by a different surface, while the form above sits open.
  const marker = `.hero-${stamp}{color:rebeccapurple}`;
  await page.keyboard.press('Control+Alt+KeyC');
  const cssModal = page.getByRole('dialog', { name: 'Critical CSS' });
  await expect(cssModal).toBeVisible();
  // Scope every control to the modal — the Settings save button sits right behind it.
  await cssModal.getByRole('textbox').first().fill(marker);
  await cssModal.getByRole('button', { name: 'Save' }).click();
  await expect(cssModal.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');
  await expect(cssModal).toBeHidden();

  // 3. Now change a Website field (a button effect) and save the section — the full replace.
  await page.getByRole('tab', { name: 'Website Settings' }).click();
  // A nav effect is a plain select on this screen (the button effect is behind its own modal), and it
  // is a Website-section field — which is the point: it makes the SAME full replace the CSS rides in.
  await page.getByLabel('Nav effect').selectOption('sliding-pill');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Settings saved')).toBeVisible({ timeout: 10_000 });

  // 4. ★ The CSS must still be there. Before the fix it came back empty: the shortcut's merge write had
  //    re-pointed the tab-wide version store, so the form both missed the refresh AND passed the
  //    If-Match check with a token describing state it had never held.
  await page.reload();
  // A reload lands on the project list, and the shortcut is inert outside a project — re-enter first.
  await page.getByRole('button', { name: /Sibling Write/ }).click();
  await page.keyboard.press('Control+Alt+KeyC');
  const reopened = page.getByRole('dialog', { name: 'Critical CSS' });
  await expect(reopened).toBeVisible();
  // CodeMirror is a contenteditable, not an input — assert on its text.
  await expect(reopened.getByRole('textbox').first()).toContainText(marker, { timeout: 10_000 });
});
