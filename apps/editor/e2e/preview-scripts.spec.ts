import { test, expect } from '@playwright/test';

const stamp = Date.now();

// Security regression guard: the live-preview iframe must NEVER execute scripts.
// We drop a probe script into a Raw HTML block; if the preview ran scripts it
// would flip the text to "scripts-on". It must stay "scripts-off" — proving the
// preview is script-isolated (sandbox="" + the inherited editor CSP). See the
// note in PreviewPane.tsx for why true WYSIWYG-with-scripts is a separate change.
test('live preview is script-isolated (does not execute embedded scripts)', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Organization name').fill(`Agency ${stamp}`);
  await page.getByLabel('Email').fill(`preview-iso-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.getByLabel('Project name').fill('Iso Site');
  await page.getByLabel('Project slug').fill(`iso-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: /Iso Site/ }).click();
  await page.getByLabel('Page slug').fill('home');
  await page.getByLabel('Page title').fill('Home Page');
  await page.getByRole('button', { name: 'Add page' }).click();
  await page.getByRole('button', { name: /Home Page/ }).click();

  await page.getByRole('button', { name: '+ Raw HTML / embed', exact: true }).click();
  await page
    .getByLabel('HTML', { exact: true }) // the textarea (not the "Move/Remove Html" block buttons)
    .fill('<p id="probe">scripts-off</p><script>document.getElementById("probe").textContent="scripts-on"</script>');

  // The iframe is fully sandboxed (no scripts).
  await expect(page.locator('iframe[title="Live preview"]')).toHaveAttribute('sandbox', '');

  // The embed renders as content, but the probe script never runs.
  const preview = page.frameLocator('iframe[title="Live preview"]');
  await expect(preview.locator('#probe')).toBeVisible();
  await expect(preview.locator('#probe')).toHaveText('scripts-off');
});
