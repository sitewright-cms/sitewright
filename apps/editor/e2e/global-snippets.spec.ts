import { test, expect } from '@playwright/test';

const stamp = Date.now();

// The built-in GLOBAL snippets: composed into a page via `{{> name}}` (they render in the live
// preview through the merged partials), and listed in the Snippets rail's "Global" section —
// read-only + copyable for a project user, editable for an instance admin (the second test).
test('a global snippet renders via {{> name}} and is listed (copyable) in the Snippets rail', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`gsnip-${stamp}@e2e.test`);
  await page.getByRole('textbox', { name: 'Password' }).fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Snip Site');
  await page.getByLabel('Project slug').fill(`gsnip-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Compose a built-in reference recipe into the home page via a partial include.
  await page.getByRole('button', { name: /^Home/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('{{> recipe-page-vars}}');

  // The global partial resolves + renders its data-sw-text default in the preview.
  const preview = page.frameLocator('iframe[title="Preview"]');
  await expect(preview.getByRole('heading', { name: 'Section title' })).toBeVisible();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // The Snippets rail lists the built-in globals (read-only for a project user) with copy buttons —
  // the chip's name is the partial identifier (`recipe-page-vars`), which is what you type in {{> … }}.
  await page.getByRole('button', { name: 'Open Snippets' }).click();
  const snippets = page.locator('[role="region"][aria-label="Snippets"]');
  await expect(snippets.getByText(/Global snippets/)).toContainText('built-in, read-only');
  await expect(snippets.getByText('recipe-page-vars', { exact: true })).toBeVisible();
  await expect(snippets.getByRole('button', { name: 'Copy {{> recipe-page-vars}}' })).toBeVisible();
  await expect(snippets.getByRole('button', { name: 'Copy recipe-page-vars source' })).toBeVisible();
  // A non-admin gets no editing affordances on the global library.
  await expect(snippets.getByRole('button', { name: '+ New global' })).toHaveCount(0);
});

// An instance admin (the deploy seeds `admin@e2e.test` into the admin allowlist) sees the GLOBAL
// section as editable and can author a new global snippet, scoped to the whole instance, through the
// same name-prompt → code-editor flow as a project snippet.
test('an instance admin can create + delete a global snippet from the Snippets rail', async ({ page }) => {
  const name = `gadmin${stamp}`; // a valid partial identifier (letters/digits, ≤100)
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill('admin@e2e.test'); // in SW_E2E_ADMIN_EMAILS → instance admin
  await page.getByRole('textbox', { name: 'Password' }).fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Admin Globals');
  await page.getByLabel('Project slug').fill(`gadmin-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // The global section is editable, with a "+ New global" affordance (absent for project users).
  await page.getByRole('button', { name: 'Open Snippets' }).click();
  const snippets = page.locator('[role="region"][aria-label="Snippets"]');
  await expect(snippets).toHaveAttribute('aria-hidden', 'false');
  await expect(snippets.getByText(/Global snippets/)).toContainText('editable');
  await snippets.getByRole('button', { name: '+ New global' }).click();

  // Name prompt → code editor (its title marks the global scope) → author + save.
  const namePrompt = page.getByRole('dialog', { name: 'New global snippet' });
  await namePrompt.getByLabel('Name', { exact: true }).fill(name);
  await namePrompt.getByRole('button', { name: 'Save' }).click();
  const editor = page.getByRole('dialog', { name: `${name} — global snippet` });
  await expect(editor).toBeVisible();
  await editor.locator('.cm-content').click();
  await page.keyboard.type('<div id="global-admin-made">{{company.name}}</div>');
  await editor.getByRole('button', { name: 'Save changes' }).click();

  // It lands in the GLOBAL section as an EDITABLE chip (Edit/Delete, not the read-only copy buttons).
  await expect(snippets.getByText(name, { exact: true })).toBeVisible();
  await expect(snippets.getByRole('button', { name: `Edit ${name}` })).toBeVisible();

  // Persists across a reload (loaded from the server), then clean up so the shared slot stays tidy.
  await page.reload();
  await page.getByRole('dialog', { name: 'SiteWright' }).getByRole('button', { name: /Admin Globals/ }).click();
  await page.getByRole('button', { name: 'Open Snippets' }).click();
  const snippets2 = page.locator('[role="region"][aria-label="Snippets"]');
  await expect(snippets2.getByText(name, { exact: true })).toBeVisible();
  await snippets2.getByRole('button', { name: `Delete ${name}` }).click();
  await page.getByRole('dialog', { name: 'Delete global snippet' }).getByRole('button', { name: 'Delete' }).click();
  await expect(snippets2.getByText(name, { exact: true })).toHaveCount(0);
});
