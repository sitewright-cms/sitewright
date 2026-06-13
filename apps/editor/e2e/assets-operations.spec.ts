import { test, expect } from '@playwright/test';

const stamp = Date.now();
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);

// The asset operations: in-app image preview modal, rename (prompt dialog), copy,
// and delete (confirm dialog) — all modal-based, no native browser dialogs.

test('assets: image preview modal, rename, copy, delete via modal dialogs', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`assetops-${stamp}@e2e.test`);
  await page.getByRole('textbox', { name: 'Password' }).fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Asset Ops');
  await page.getByLabel('Project slug').fill(`assetops-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Open the File Manager side panel from its edge tab.
  await page.getByRole('button', { name: 'Open File Manager' }).click();
  await page.getByLabel('Upload files').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await expect(page.getByRole('button', { name: 'logo.png', exact: true })).toBeVisible();

  // Clicking an image opens the IN-APP preview modal (not a new tab).
  await page.getByRole('button', { name: 'logo.png', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'logo.png' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'logo.png' })).toHaveCount(0);

  // RENAME via the prompt dialog → the row updates.
  await page.getByRole('button', { name: 'Rename logo.png' }).click();
  const renameField = page.getByLabel('Display name');
  await renameField.fill('brand-mark.png');
  await page.getByRole('dialog', { name: 'Rename file' }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'brand-mark.png', exact: true })).toBeVisible();

  // COPY duplicates the asset in the current folder.
  await page.getByRole('button', { name: 'Copy brand-mark.png' }).click();
  await expect(page.getByRole('button', { name: 'brand-mark.png', exact: true })).toHaveCount(2);

  // DELETE one via the confirm dialog → back to a single copy.
  await page.getByRole('button', { name: 'Delete brand-mark.png' }).first().click();
  await page.getByRole('dialog', { name: 'Delete file' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('button', { name: 'brand-mark.png', exact: true })).toHaveCount(1);
});

// The project selector + New Project modal flow, and switching projects from the header.
test('project selector: search, create, auto-open, and switch', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`psel-${stamp}@e2e.test`);
  await page.getByRole('textbox', { name: 'Password' }).fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();

  // After auth the selector auto-opens; create the first project from it.
  const selector = page.getByRole('dialog', { name: 'SiteWright' });
  await expect(selector).toBeVisible();
  await selector.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Alpha Site');
  await expect(page.getByLabel('Project slug')).toHaveValue('alpha-site'); // auto-derived slug
  // Make it unique to avoid slug collisions across re-runs.
  await page.getByLabel('Project slug').fill(`alpha-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  // Auto-opens the new project (its name shows in the header).
  await expect(page.getByRole('button', { name: 'Switch project', exact: true })).toContainText('Alpha Site');

  // Make a second project, then switch between them via the header.
  await page.getByRole('button', { name: 'Switch project', exact: true }).click();
  await page.getByRole('dialog', { name: 'SiteWright' }).getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Beta Site');
  await page.getByLabel('Project slug').fill(`beta-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('button', { name: 'Switch project', exact: true })).toContainText('Beta Site');

  // Switch back to Alpha; the search filters the list.
  await page.getByRole('button', { name: 'Switch project', exact: true }).click();
  const sel2 = page.getByRole('dialog', { name: 'SiteWright' });
  await sel2.getByLabel('Search projects').fill('alpha');
  await expect(sel2.getByRole('button', { name: /Beta Site/ })).toHaveCount(0);
  await sel2.getByRole('button', { name: /Alpha Site/ }).click();
  await expect(page.getByRole('button', { name: 'Switch project', exact: true })).toContainText('Alpha Site');
});
