import { test, expect } from '@playwright/test';

const stamp = Date.now();

test('header gear menu unifies settings + inline agent indicator + publish toast', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`hdr-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Header Co');
  await page.getByLabel('Project slug').fill(`hdr-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // The retired header surfaces are gone (Admin tab + ⋮ "Site options").
  await expect(page.getByRole('tab', { name: 'Admin' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Site options' })).toHaveCount(0);

  // The AI-agent indicator sits INLINE in the header (next to Publish), not under it.
  await expect(page.getByRole('button', { name: 'Connect an agent' })).toBeVisible();

  // The gear menu lists the unified items. A non-admin owner has no admin-only items (System
  // Settings, Team).
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Settings' });
  for (const label of ['Publish & Deploy Options', 'Clients', 'Access', 'Sign out']) {
    await expect(menu.getByRole('menuitem', { name: label })).toBeVisible();
  }
  await expect(menu.getByRole('menuitem', { name: 'System Settings' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Team' })).toHaveCount(0);

  // A target (Clients) opens AS A MODAL.
  await menu.getByRole('menuitem', { name: 'Clients' }).click();
  await expect(page.getByRole('dialog', { name: 'Clients' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Clients' })).toBeHidden();

  // Publishing surfaces a transient TOAST (the persistent "Published · N pages" line was removed).
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Published · \d+ page/)).toBeVisible();

  // The agent indicator opens AI agent details, whose Connect-an-agent guide has 4 tabs
  // (ChatGPT / Claude.ai / Le Chat hosted + local CLI).
  await page.getByRole('button', { name: 'Connect an agent' }).click();
  const agent = page.getByRole('dialog', { name: 'AI agent details' });
  await expect(agent.getByRole('tab', { name: 'ChatGPT.com' })).toBeVisible();
  await expect(agent.getByRole('tab', { name: 'Claude.ai' })).toBeVisible();
  await agent.getByRole('tab', { name: 'Le Chat' }).click();
  await expect(agent.getByText(/Free plan/)).toBeVisible();
  await agent.getByRole('tab', { name: 'Local CLI Agents' }).click();
  await expect(agent.getByText(/npm install -g @sitewright\/cli/)).toBeVisible();
  await expect(agent.getByText('"mcpServers"')).toBeVisible();
});
