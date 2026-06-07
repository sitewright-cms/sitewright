import { test, expect } from '@playwright/test';

const stamp = Date.now();

// The bottom CODE RAILS: the Snippets panel manages reusable {{> name}} Handlebars partials —
// create (name → editor), edit source, persist, delete. (Templates share the same component.)
test('snippets rail: create, edit source, persist across reload, delete', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`rail-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Rail Site');
  await page.getByLabel('Project slug').fill(`rail-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Open the Snippets rail (bottom-left tab) → create a snippet via the name prompt.
  await page.getByRole('button', { name: 'Open Snippets' }).hover();
  const panel = page.locator('[role="region"][aria-label="Snippets"]');
  await expect(panel).toHaveAttribute('aria-hidden', 'false');
  await panel.getByRole('button', { name: '+ New snippet' }).click();
  const namePrompt = page.getByRole('dialog', { name: 'New snippet' });
  await namePrompt.getByLabel('Name', { exact: true }).fill('hero');
  await namePrompt.getByRole('button', { name: 'Save' }).click();

  // The source editor opens on the new snippet; type Handlebars + save.
  const editor = page.getByRole('dialog', { name: 'hero — snippet' });
  await expect(editor).toBeVisible();
  await editor.locator('.cm-content').click();
  await page.keyboard.type('<h1>{{company.name}}</h1>');
  await editor.getByRole('button', { name: 'Save changes' }).click();
  await expect(panel.getByText('hero', { exact: true })).toBeVisible();

  // Persists across a reload (loaded from the server), and the source round-trips.
  await page.reload();
  await page.getByRole('dialog', { name: 'Your projects' }).getByRole('button', { name: /Rail Site/ }).click();
  await page.getByRole('button', { name: 'Open Snippets' }).hover();
  const panel2 = page.locator('[role="region"][aria-label="Snippets"]');
  await expect(panel2.getByText('hero', { exact: true })).toBeVisible();
  await panel2.getByRole('button', { name: 'Edit hero' }).click();
  await expect(page.getByRole('dialog', { name: 'hero — snippet' }).locator('.cm-content')).toContainText('company.name');
  await page.keyboard.press('Escape');

  // Delete via the confirm dialog → the row is gone.
  await panel2.getByRole('button', { name: 'Delete hero' }).click();
  await page.getByRole('dialog', { name: 'Delete snippet' }).getByRole('button', { name: 'Delete' }).click();
  await expect(panel2.getByText('hero', { exact: true })).toHaveCount(0);
});
