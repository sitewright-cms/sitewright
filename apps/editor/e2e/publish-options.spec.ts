import { test, expect } from '@playwright/test';

const stamp = Date.now();

// The "PUBLISH & DEPLOY OPTIONS" modal (header overflow ⋮): enabling a preview token gates the
// locally-published site behind ?token= and rewrites the Preview link to carry it.
test('publish options: enabling a preview token gates the live site behind ?token= (live, no republish)', async ({ page, baseURL }) => {
  const slug = `opt-${stamp}`;
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`opt-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Opt Site');
  await page.getByLabel('Project slug').fill(slug);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Author + publish the home page.
  await page.getByRole('button', { name: /^Home/ }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('<h1>Gated content</h1>');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('link', { name: /Preview/ })).toBeVisible();

  // Before the token: the live site is openly reachable.
  expect((await page.request.get(`${baseURL}/sites/${slug}/`)).status()).toBe(200);

  // Open the header gear → "Publish & Deploy Options" → require a token + save.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Publish & Deploy Options' }).click();
  const modal = page.getByRole('dialog', { name: 'Publish & deploy options' });
  await expect(modal).toBeVisible();
  await modal.getByRole('switch', { name: 'Require a preview token' }).click();
  // The modal reveals the full tokenized URL (copy-able). Capture it for the live-gate checks.
  const urlField = modal.locator('input[readonly]');
  await expect(urlField).toHaveValue(/\/sites\/[\w-]+\/\?token=[\w-]{16,}/);
  const tokenUrl = await urlField.inputValue();
  await modal.getByRole('button', { name: 'Save publish options' }).click();
  await modal.getByRole('button', { name: 'Close' }).click();

  // The gate is LIVE (read from settings at serve time — no republish needed):
  // the bare URL is now 403, and the exact tokenized URL from the modal serves the page.
  expect((await page.request.get(`${baseURL}/sites/${slug}/`)).status()).toBe(403);
  const served = await page.request.get(tokenUrl);
  expect(served.status()).toBe(200);
  expect(await served.text()).toContain('Gated content');
});
