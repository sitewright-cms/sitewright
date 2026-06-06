import { test, expect } from '@playwright/test';

const stamp = Date.now();

// The visible code-first authoring loop: create a code page, edit its Handlebars source in
// the CodeMirror editor, watch the live styled preview, save, and confirm it persisted.

test('code-first authoring: CodeMirror editor, live styled preview, save + persist', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`code-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Code Site');
  await page.getByLabel('Project slug').fill(`code-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Create a fresh CODE page (the project already has an auto-created home), then open it.
  await page.getByLabel('Page path').fill('about');
  await page.getByLabel('Page title').fill('About');
  await page.getByRole('button', { name: 'Add page' }).click();
  await page.getByRole('button', { name: /^About/ }).click();

  // The CodeMirror editor shows the starter Handlebars source…
  await expect(page.locator('.cm-content')).toContainText('{{ company.name }}');
  // …and the live STYLED preview renders the bound company name + the scaffold's {{edit}} region.
  const preview = page.frameLocator('iframe[title="Preview"]');
  await expect(preview.getByRole('heading', { level: 1 })).toHaveText('Code Site');
  await expect(preview.getByText('Edit this tagline', { exact: true })).toBeVisible();

  // Edit the source (plain text sidesteps CodeMirror's bracket auto-close); preview updates.
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('HELLOMARKER42');
  await expect(preview.getByText('HELLOMARKER42')).toBeVisible();

  // Save → the saved state shows. (`exact` avoids the pages-list "Save … as template" buttons.)
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  // Close the editor modal (clean — just saved), reopen → the edit persisted to page.source.
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: /^About/ }).click();
  await expect(page.locator('.cm-content')).toContainText('HELLOMARKER42');
});

test('Shift+Tab auto-indents the selection to its syntactic depth (not a plain dedent)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`indent-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Indent Site');
  await page.getByLabel('Project slug').fill(`indent-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByLabel('Page path').fill('reindent');
  await page.getByLabel('Page title').fill('Reindent');
  await page.getByRole('button', { name: 'Add page' }).click();
  await page.getByRole('button', { name: /^Reindent/ }).click();

  // `insertText` injects the document verbatim — no per-line electric indent — so the nested
  // markup lands FLUSH-LEFT, mis-indented on purpose.
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('<section>\n<div>\n<p>Hi</p>\n</div>\n</section>');

  // Select all, Shift+Tab → auto-indent (`indentSelection`) re-flows every line to the depth
  // its syntax implies. The OLD binding (dedent) would have LEFT these lines flush-left.
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Shift+Tab');

  const lines = await page.locator('.cm-content .cm-line').allInnerTexts();
  expect(lines[0]).toMatch(/^<section>/);
  expect(lines[1]).toMatch(/^ {2}<div>/); // one indent unit (2 spaces) under <section>
  expect(lines[2]).toMatch(/^ {4}<p>Hi<\/p>/); // two units under <div>
  expect(lines[3]).toMatch(/^ {2}<\/div>/);
  expect(lines[4]).toMatch(/^<\/section>/);
});
