import { test, expect } from '@playwright/test';
import { deployLocally, dismissProjectSelector, signInAsAdmin, signUp } from './helpers.js';

const stamp = Date.now();

test('header gear menu unifies settings + inline agent indicator + publish toast', async ({ page }) => {
  await signUp(page, `hdr-${stamp}@e2e.test`);
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
  // Settings, Administrators). Account actions (Access keys, Logout) are NOT here — they moved to the user menu.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Settings' });
  for (const label of ['Publish & Deploy Options', 'Project Members']) {
    await expect(menu.getByRole('menuitem', { name: label })).toBeVisible();
  }
  await expect(menu.getByRole('menuitem', { name: 'System Settings' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Administrators' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Access', exact: true })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: /Sign out|Logout/ })).toHaveCount(0);

  // A target (Project Members) opens AS A MODAL.
  await menu.getByRole('menuitem', { name: 'Project Members' }).click();
  await expect(page.getByRole('dialog', { name: 'Project Members' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Project Members' })).toBeHidden();

  // Deploying surfaces a transient TOAST naming the target it went to.
  await deployLocally(page);
  await expect(page.getByText(/Published to Local Hosting · \d+ page/)).toBeVisible();

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
  // `@sitewright/cli` was never published; `/mcp` is the whole integration surface, so the CLI tab
  // shows the remote-HTTP config rather than an install step nobody could follow.
  await expect(agent.getByText(/claude mcp add --transport http/).first()).toBeVisible();
  await expect(agent.getByText('"mcpServers"')).toBeVisible();
});

// Both ADMINISTRATION items are instance-wide, so both must work from the "Pick a project to get
// started" home screen — the state an admin lands in by dismissing the project selector. "Administrators"
// used to be offered there and do nothing: the view sat below SettingsModalHost's project guard.
test('admin: the instance-wide gear items open with NO project selected', async ({ page }) => {
  await signInAsAdmin(page);

  // Sign-in auto-opens the project selector, whose full-screen overlay makes the header gear
  // unreachable; dismissing it is what lands on the home screen.
  await dismissProjectSelector(page);
  await expect(page.getByRole('heading', { name: 'Pick a project to get started' })).toBeVisible();

  const gear = page.getByRole('button', { name: 'Settings', exact: true });
  await gear.click();
  const menu = page.getByRole('menu', { name: 'Settings' });
  // No project open → no project-scoped items, and no bare "Project" group header to label an empty group.
  await expect(menu.getByRole('menuitem', { name: 'Publish & Deploy Options' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Project Members' })).toHaveCount(0);

  // The staff panel OPENS (the regression) and renders its own body, not just empty modal chrome.
  await menu.getByRole('menuitem', { name: 'Administrators' }).click();
  const team = page.getByRole('dialog', { name: 'Administrators' });
  await expect(team).toBeVisible();
  // TeamManager's own body, not just the modal chrome (whose <h2> title is the same word — hence the
  // blurb rather than a heading lookup). Its presence is also what makes the next assertion meaningful.
  await expect(team.getByText(/Your platform staff/)).toBeVisible();
  // …and the staff list RESOLVED from /admin/users rather than erroring: the signed-in admin is in it,
  // carrying an `admin` role badge. (The email itself is env-overridable, so match the badge.)
  await expect(team.getByText('admin', { exact: true }).first()).toBeVisible();
  await expect(team.getByText(/failed to load administrators/)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(team).toBeHidden();

  // Its neighbour in the same group still works from here too.
  await gear.click();
  await menu.getByRole('menuitem', { name: 'System Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'System settings' })).toBeVisible();
});
