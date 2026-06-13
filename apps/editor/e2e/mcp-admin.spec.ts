import { test, expect } from '@playwright/test';

const stamp = Date.now();

// The instance-admin MCP panel: editable agent instructions, the endpoint list, and the connect guide.
// Runs as admin@e2e.test, which SW_ADMIN_EMAILS allowlists as an instance admin on the test container.
test('admin: edit agent (MCP) instructions, see the endpoint list + connect guide, and persist', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill('admin@e2e.test');
  await page.getByRole('textbox', { name: 'Password' }).fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();

  // Idempotent: if this admin already exists (a rerun / seeded), sign in instead of registering.
  const alreadyExists = await page
    .getByText('email already registered')
    .waitFor({ state: 'visible', timeout: 2500 })
    .then(() => true)
    .catch(() => false);
  if (alreadyExists) {
    await page.getByRole('button', { name: 'Have an account? Sign in' }).click();
    await page.getByLabel('Email').fill('admin@e2e.test');
    await page.getByRole('textbox', { name: 'Password' }).fill('Pw-secret-1');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }

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

  // Agent-instructions textarea is pre-filled with the built-in default.
  const instr = modal.getByLabel('Agent instructions');
  await expect(instr).toBeVisible();
  await expect(instr).toHaveValue(/CODE-FIRST/);

  // The endpoint list shows registered MCP tools; the connect guide shows the CLI bridge command.
  await expect(modal.getByText('MCP endpoints')).toBeVisible();
  await expect(modal.getByText('put_page', { exact: true })).toBeVisible();
  await expect(modal.getByText('Connect an agent')).toBeVisible();
  await expect(modal.getByText(/sitewright mcp --url/)).toBeVisible();

  // Edit + save an override. The save response re-hydrates the textarea from the STORED value, so a
  // value that survives the round-trip proves it persisted. (Cross-reload persistence + the override
  // → default clear are also covered deterministically by the instance-settings repo unit test.)
  await instr.fill('House style: terse, on-brand, accessible.');
  await modal.getByRole('button', { name: 'Save settings' }).click();
  await expect(modal.getByText('Saved.')).toBeVisible();
  await expect(instr).toHaveValue('House style: terse, on-brand, accessible.');

  // Reset to default → save → the round-trip reverts to the built-in default (override cleared).
  await modal.getByRole('button', { name: 'Reset to default' }).click();
  await expect(instr).toHaveValue(/CODE-FIRST/);
  await modal.getByRole('button', { name: 'Save settings' }).click();
  await expect(modal.getByText('Saved.')).toBeVisible();
  await expect(instr).toHaveValue(/CODE-FIRST/);
});
