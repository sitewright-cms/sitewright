import { test, expect } from '@playwright/test';
import { signInAsAdmin } from './helpers.js';

const stamp = Date.now();

// The instance-admin MCP panel: editable agent instructions, the endpoint list, and the connect guide.
// Runs as admin@e2e.test, which SW_ADMIN_EMAILS allowlists as an instance admin on the test container.
test('admin: edit agent (MCP) instructions, see the endpoint list + connect guide, and persist', async ({ page }) => {
  await signInAsAdmin(page);

  // A no-projects account auto-opens (and re-opens) the project selector, whose backdrop intercepts
  // the header gear. Create a project to land in a stable, modal-free state (same flow the other
  // specs use), then open the instance-admin panel from the gear menu.
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Admin Co');
  await page.getByLabel('Project slug').fill(`admin-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  // The header gear being clickable confirms the selector backdrop is gone.
  const gear = page.getByRole('button', { name: 'Settings', exact: true });
  await expect(gear).toBeVisible();
  await gear.click();
  await page.getByRole('menuitem', { name: 'System Settings' }).click();

  // System Settings opens AS A MODAL over the project view — scope assertions to it (the header's
  // own "Connect an agent" agent indicator is also on the page behind the modal).
  const modal = page.getByRole('dialog', { name: 'System settings' });
  await expect(modal).toBeVisible();

  // Settings are grouped into tabs: agent instructions live under "AI Assistant"; the MCP endpoint
  // catalog + connect guide are the info-only "Agents" tab.
  await modal.getByRole('tab', { name: 'AI Assistant' }).click();
  // Agent instructions are INSTANCE-GLOBAL. This test SAVES an override, so a re-run against the same
  // slot used to see its own leftover here and fail on the first assertion — establish the default
  // rather than assuming it, the way the stock spec establishes "no key configured".
  const instr = modal.getByLabel('Agent instructions');
  await expect(instr).toBeVisible();
  await modal.getByRole('button', { name: 'Reset to default', exact: true }).click();
  await modal.getByRole('button', { name: 'Save settings' }).click();
  await expect(modal.getByText('Saved.')).toBeVisible();
  await expect(instr).toHaveValue(/CODE-FIRST/);

  // The endpoint list shows registered MCP tools; the connect guide shows how to reach /mcp.
  await modal.getByRole('tab', { name: 'Agents' }).click();
  await expect(modal.getByText('MCP endpoints')).toBeVisible();
  await expect(modal.getByText('put_page', { exact: true })).toBeVisible();
  await expect(modal.getByText('Connect an agent')).toBeVisible();
  // There is no CLI to install — `@sitewright/cli` was never published — so the guide names the remote
  // endpoint and the one-liner that registers it.
  await expect(modal.getByText(/claude mcp add --transport http/)).toBeVisible();
  // Back to the AI Assistant tab to edit + save the instructions (the Save row is hidden on Agents).
  await modal.getByRole('tab', { name: 'AI Assistant' }).click();

  // Edit + save an override. The save response re-hydrates the textarea from the STORED value, so a
  // value that survives the round-trip proves it persisted. (Cross-reload persistence + the override
  // → default clear are also covered deterministically by the instance-settings repo unit test.)
  await instr.fill('House style: terse, on-brand, accessible.');
  await modal.getByRole('button', { name: 'Save settings' }).click();
  await expect(modal.getByText('Saved.')).toBeVisible();
  await expect(instr).toHaveValue('House style: terse, on-brand, accessible.');

  // Reset to default → save → the round-trip reverts to the built-in default (override cleared).
  // `exact`: the section's help tooltip quotes the phrase too, so a substring match hits both.
  await modal.getByRole('button', { name: 'Reset to default', exact: true }).click();
  await expect(instr).toHaveValue(/CODE-FIRST/);
  await modal.getByRole('button', { name: 'Save settings' }).click();
  await expect(modal.getByText('Saved.')).toBeVisible();
  await expect(instr).toHaveValue(/CODE-FIRST/);
});
