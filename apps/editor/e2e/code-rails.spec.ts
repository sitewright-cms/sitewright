import { test, expect } from '@playwright/test';

const stamp = Date.now();

// The bottom CODE RAILS: the Snippets panel manages reusable {{> name}} Handlebars partials —
// create (name → editor), edit source, persist, delete. (Templates share the same component.)
// The project snippet uses a name that does NOT collide with a built-in global (which now also
// renders as a named chip in this same rail) so the row selectors stay unambiguous.
test('snippets rail: create, edit source, persist across reload, delete', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`rail-${stamp}@e2e.test`);
  await page.getByRole('textbox', { name: 'Password' }).fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Rail Site');
  await page.getByLabel('Project slug').fill(`rail-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Open the Snippets rail (bottom-left tab) → create a snippet via the name prompt.
  await page.getByRole('button', { name: 'Open Snippets' }).click();
  const panel = page.locator('[role="region"][aria-label="Snippets"]');
  await expect(panel).toHaveAttribute('aria-hidden', 'false');
  await panel.getByRole('button', { name: '+ New snippet' }).click();
  const namePrompt = page.getByRole('dialog', { name: 'New snippet' });
  await namePrompt.getByLabel('Name', { exact: true }).fill('mycard');
  await namePrompt.getByRole('button', { name: 'Save' }).click();

  // The source editor opens on the new snippet; type Handlebars + save.
  const editor = page.getByRole('dialog', { name: 'mycard — snippet' });
  await expect(editor).toBeVisible();
  await editor.locator('.cm-content').click();
  await page.keyboard.type('<h1>{{company.name}}</h1>');
  await editor.getByRole('button', { name: 'Save changes' }).click();
  await expect(panel.getByText('mycard', { exact: true })).toBeVisible();

  // Persists across a reload (loaded from the server), and the source round-trips.
  await page.reload();
  await page.getByRole('dialog', { name: 'SiteWright' }).getByRole('button', { name: /Rail Site/ }).click();
  await page.getByRole('button', { name: 'Open Snippets' }).click();
  const panel2 = page.locator('[role="region"][aria-label="Snippets"]');
  await expect(panel2.getByText('mycard', { exact: true })).toBeVisible();
  await panel2.getByRole('button', { name: 'Edit mycard' }).click();
  await expect(page.getByRole('dialog', { name: 'mycard — snippet' }).locator('.cm-content')).toContainText('company.name');
  await page.keyboard.press('Escape');

  // Delete via the confirm dialog → the row is gone.
  await panel2.getByRole('button', { name: 'Delete mycard' }).click();
  await page.getByRole('dialog', { name: 'Delete snippet' }).getByRole('button', { name: 'Delete' }).click();
  await expect(panel2.getByText('mycard', { exact: true })).toHaveCount(0);
});

// The Templates rail renders in a 2-column grid and lets you RENAME a template in the editor (its
// free-text name is decoupled from the stable id, so a rename keeps page references intact).
test('templates rail: 2-column grid + rename a template in the editor, persist across reload', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`tplrename-${stamp}@e2e.test`);
  await page.getByRole('textbox', { name: 'Password' }).fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Tpl Site');
  await page.getByLabel('Project slug').fill(`tpl-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Open the Templates rail (bottom-right tab) → create a template via the name prompt.
  await page.getByRole('button', { name: 'Open Templates' }).click();
  const panel = page.locator('[role="region"][aria-label="Templates"]');
  await expect(panel).toHaveAttribute('aria-hidden', 'false');

  // The records render in a 2-column grid (not the default 4-column).
  await expect(panel.locator('ul.grid').first()).toHaveClass(/sm:grid-cols-2/);
  await expect(panel.locator('ul.grid').first()).not.toHaveClass(/grid-cols-4/);

  await panel.getByRole('button', { name: '+ New template' }).click();
  const namePrompt = page.getByRole('dialog', { name: 'New template' });
  await namePrompt.getByLabel('Name', { exact: true }).fill('Promo');
  await namePrompt.getByRole('button', { name: 'Save' }).click();

  // The editor opens with a Name field. Use a title regex so the locator survives the rename (the
  // dialog's accessible name updates live from "Promo — template" to "Promo Page — template").
  const editor = page.getByRole('dialog', { name: /— template$/ });
  await expect(editor).toBeVisible();
  await editor.getByLabel('template name', { exact: true }).fill('Promo Page');
  await editor.locator('.cm-content').click();
  await page.keyboard.type('<section data-sw-text="page.data.heading">Promo</section>');
  await editor.getByRole('button', { name: 'Save changes' }).click();

  // The chip shows the NEW name; the old name is gone.
  await expect(panel.getByText('Promo Page', { exact: true })).toBeVisible();
  await expect(panel.getByText('Promo', { exact: true })).toHaveCount(0);

  // Persists across reload (the rename round-trips via the API; the stable id is unchanged).
  await page.reload();
  await page.getByRole('dialog', { name: 'SiteWright' }).getByRole('button', { name: /Tpl Site/ }).click();
  await page.getByRole('button', { name: 'Open Templates' }).click();
  const panel2 = page.locator('[role="region"][aria-label="Templates"]');
  await expect(panel2.getByText('Promo Page', { exact: true })).toBeVisible();
});

// The eye button server-renders the snippet into a sandboxed preview iframe (brand-styled), and the
// edit modal lets the snippet be RENAMED (re-keying its {{> id}}), which round-trips through the API.
test('snippets rail: eye preview renders the snippet, and a snippet can be renamed', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`snip2-${stamp}@e2e.test`);
  await page.getByRole('textbox', { name: 'Password' }).fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Snip Site');
  await page.getByLabel('Project slug').fill(`snip2-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: 'Open Snippets' }).click();
  const panel = page.locator('[role="region"][aria-label="Snippets"]');
  await expect(panel).toHaveAttribute('aria-hidden', 'false');
  await panel.getByRole('button', { name: '+ New snippet' }).click();
  await page.getByRole('dialog', { name: 'New snippet' }).getByLabel('Name', { exact: true }).fill('previewcard');
  await page.getByRole('dialog', { name: 'New snippet' }).getByRole('button', { name: 'Save' }).click();
  const editor = page.getByRole('dialog', { name: 'previewcard — snippet' });
  await editor.locator('.cm-content').click();
  await page.keyboard.type('<h1 class="font-bold">{{company.name}}</h1>');
  await editor.getByRole('button', { name: 'Save changes' }).click();
  await expect(panel.getByText('previewcard', { exact: true })).toBeVisible();

  // Hover the eye → the sandboxed preview iframe server-renders the snippet ({{company.name}} → the
  // project name). frameLocator reaches into the (opaque-origin) iframe's rendered document.
  await panel.getByRole('button', { name: 'Preview previewcard' }).hover();
  await expect(page.getByRole('dialog', { name: 'previewcard preview' })).toBeVisible();
  await expect(page.frameLocator('iframe[title="previewcard preview"]').locator('h1')).toHaveText('Snip Site', { timeout: 15000 });

  // Move away to dismiss the preview, then RENAME via the edit modal's name field.
  await page.mouse.move(640, 700);
  await panel.getByRole('button', { name: 'Edit previewcard' }).click();
  // The dialog's accessible name updates live as the name field is edited ("previewcard — snippet"
  // → "renamedcard — snippet"), so locate it by the stable suffix.
  const editor2 = page.getByRole('dialog', { name: /— snippet$/ });
  await editor2.getByLabel('snippet name').fill('renamedcard');
  await editor2.getByRole('button', { name: 'Save changes' }).click();

  // The rail now shows the new name and not the old; the rename round-trips through the API.
  await expect(panel.getByText('renamedcard', { exact: true })).toBeVisible();
  await expect(panel.getByText('previewcard', { exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByRole('dialog', { name: 'SiteWright' }).getByRole('button', { name: /Snip Site/ }).click();
  await page.getByRole('button', { name: 'Open Snippets' }).click();
  const panelR = page.locator('[role="region"][aria-label="Snippets"]');
  await expect(panelR.getByText('renamedcard', { exact: true })).toBeVisible();
  await expect(panelR.getByText('previewcard', { exact: true })).toHaveCount(0);
});
