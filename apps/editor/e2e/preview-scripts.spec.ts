import { test, expect } from '@playwright/test';

const stamp = Date.now();

// The live preview is loaded via `src` from a document served under
// `Content-Security-Policy: sandbox allow-scripts` (an opaque, isolated origin),
// so interactive components + embeds RUN in the editor (true WYSIWYG) while
// staying isolated from the editor session. We prove execution with a probe
// script in a Raw HTML block: it flips the text only if scripts actually run.
test('live preview runs scripts in an isolated sandbox (WYSIWYG)', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Organization name').fill(`Agency ${stamp}`);
  await page.getByLabel('Email').fill(`preview-wys-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.getByLabel('Project name').fill('WYSIWYG Site');
  await page.getByLabel('Project slug').fill(`wysiwyg-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: /WYSIWYG Site/ }).click();
  await page.getByLabel('Page slug').fill('home');
  await page.getByLabel('Page title').fill('Home Page');
  await page.getByRole('button', { name: 'Add page' }).click();
  await page.getByRole('button', { name: /Home Page/ }).click();

  await page.getByRole('button', { name: '+ Raw HTML / embed', exact: true }).click();
  await page
    .getByLabel('HTML', { exact: true }) // the textarea (not the "Move/Remove Html" block buttons)
    .fill('<p id="probe">scripts-off</p><script>document.getElementById("probe").textContent="scripts-on"</script>');

  // The iframe is sandboxed allow-scripts (and never same-origin).
  const iframe = page.locator('iframe[title="Live preview"]');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');

  // ...and the probe proves the script actually executed inside the preview.
  const preview = page.frameLocator('iframe[title="Live preview"]');
  await expect(preview.locator('#probe')).toHaveText('scripts-on');
});
