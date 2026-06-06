import { test, expect } from '@playwright/test';

const stamp = Date.now();

// Per-project typography: heading + body font slots (system families + weight) applied in the
// editor settings, persisted, and reflected in the published page CSS.

test('typography slots: edit heading/body font + weight, persist, and publish applies them', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`typo-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Type Site');
  await page.getByLabel('Project slug').fill(`typo-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Corporate Identity → Typography card. Defaults: heading Serif/700, body Sans-serif/400.
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  await expect(page.getByLabel('Heading font family')).toHaveValue('serif');
  await expect(page.getByLabel('Body font family')).toHaveValue('sans-serif');

  // Change the BODY font to a serif at 700, and the HEADING to monospace.
  await page.getByLabel('Body font family').selectOption('serif');
  await page.getByLabel('Body font weight').selectOption('700');
  await page.getByLabel('Heading font family').selectOption('monospace');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('✓ Saved')).toBeVisible();

  // Reload → reopen → the selections persisted.
  await page.reload();
  await page.getByRole('button', { name: /Type Site/ }).click();
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  await expect(page.getByLabel('Body font family')).toHaveValue('serif');
  await expect(page.getByLabel('Body font weight')).toHaveValue('700');
  await expect(page.getByLabel('Heading font family')).toHaveValue('monospace');

  // Publish → the home page's typography CSS reflects the slots (applied to body + h1–h6).
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('button', { name: 'Publish actions' }).click();
  const href = await page.getByRole('menuitem', { name: 'View published site' }).getAttribute('href');
  const origin = new URL(page.url()).origin;
  const html = await (await page.request.get(`${origin}${href!.replace(/\/$/, '')}/`)).text();
  expect(html).toContain('--sw-font-body-weight:700');
  expect(html).toMatch(/--sw-font-body:[^;]*serif/);
  expect(html).toMatch(/--sw-font-heading:[^;]*monospace/);
  expect(html).toContain('body{font-family:var(--sw-font-body);font-weight:var(--sw-font-body-weight)}');
  expect(html).toContain('h1,h2,h3,h4,h5,h6{font-family:var(--sw-font-heading)');
});
