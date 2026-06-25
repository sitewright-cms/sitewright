import { test, expect } from '@playwright/test';

const stamp = Date.now();

test('header gear menu unifies settings + inline agent indicator + publish toast', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`hdr-${stamp}@e2e.test`);
  await page.getByRole('textbox', { name: 'Password' }).fill('Pw-secret-1');
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

  // Account actions live under the person icon (a dropdown): "Account Settings" + "Logout".
  await page.getByRole('button', { name: 'Account' }).click();
  const account = page.getByRole('menu', { name: 'Account' });
  await expect(account.getByRole('menuitem', { name: 'Account Settings' })).toBeVisible();
  await expect(account.getByRole('menuitem', { name: 'Logout' })).toBeVisible();
  await page.keyboard.press('Escape');

  // The gear menu lists the unified settings items. A non-admin owner has no admin-only items (System
  // Settings, Team). Account actions (Access keys, Logout) are NOT here — they moved to the user menu.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Settings' });
  for (const label of ['Publish & Deploy Options', 'Clients']) {
    await expect(menu.getByRole('menuitem', { name: label })).toBeVisible();
  }
  await expect(menu.getByRole('menuitem', { name: 'System Settings' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Team' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Access', exact: true })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: /Sign out|Logout/ })).toHaveCount(0);

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
  // ChatGPT's Developer mode is a staged beta (reachable on free accounts too); Claude + Le Chat are free.
  await expect(agent.getByText(/reachable on free accounts/)).toBeVisible();
  await agent.getByRole('tab', { name: 'Claude.ai' }).click();
  await expect(agent.getByText(/including Free/)).toBeVisible();
  await agent.getByRole('tab', { name: 'Le Chat' }).click();
  await expect(agent.getByText(/Free plan/)).toBeVisible();
  await agent.getByRole('tab', { name: 'Local CLI Agents' }).click();
  await expect(agent.getByText(/npm install -g @sitewright\/cli/)).toBeVisible();
  await expect(agent.getByText('"mcpServers"')).toBeVisible();
});
