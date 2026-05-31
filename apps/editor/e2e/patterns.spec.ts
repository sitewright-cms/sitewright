import { test, expect } from '@playwright/test';

const stamp = Date.now();

// Patterns: save a selection as a reusable pattern, then insert a forked copy.
test('save a block as a pattern, then insert a forked copy', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Organization name').fill(`Agency ${stamp}`);
  await page.getByLabel('Email').fill(`patterns-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.getByLabel('Project name').fill('Pattern Site');
  await page.getByLabel('Project slug').fill(`pattern-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: /Pattern Site/ }).click();
  await page.getByLabel('Page slug').fill('home');
  await page.getByLabel('Page title').fill('Home Page');
  await page.getByRole('button', { name: 'Add page' }).click();
  await page.getByRole('button', { name: /Home Page/ }).click();

  // Add a Heading (inside the root Section) and give it identifiable text.
  await page.getByRole('button', { name: '+ Heading', exact: true }).click();
  await page.getByLabel('Text').fill('Reusable');

  // The preview shows it once.
  const preview = page.frameLocator('iframe[title="Live preview"]');
  await expect(preview.getByText('Reusable')).toHaveCount(1);

  // Save the selected Heading as a pattern (auto-accept the name prompt).
  page.once('dialog', (dialog) => dialog.accept('My heading'));
  await page.getByRole('button', { name: '+ Save selection' }).click();

  // It appears in the Patterns panel; insert a forked copy.
  const patternBtn = page.getByRole('button', { name: 'My heading', exact: true });
  await expect(patternBtn).toBeVisible();
  await patternBtn.click();

  // The preview now shows the heading twice (original + forked insert).
  await expect(preview.getByText('Reusable')).toHaveCount(2);
});
