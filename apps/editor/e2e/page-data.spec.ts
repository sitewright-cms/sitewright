import { test, expect } from '@playwright/test';
import { signUp } from './helpers.js';

const stamp = Date.now();

// page.data — a per-page custom JSON object edited via the "Edit page data" tree/JSON modal and read
// in the page source as {{page.data.*}}. Verifies the edit reflects in the live preview and persists
// across a reload.
test('page.data: edit via the JSON modal, preview reflects it, persists across reload', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signUp(page, `pdata-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('PageData Site');
  await page.getByLabel('Project slug').fill(`pdata-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: /^Home/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();

  // Author a source that reads page.data, then fill page.data via the modal's JSON source view.
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('<div><h1>{{page.data.headline}}</h1></div>');

  await page.getByRole('button', { name: 'Edit page data' }).click();
  const dialog = page.getByRole('dialog', { name: 'Page data' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /JSON source/ }).click();
  await dialog.getByLabel('JSON source').fill('{"headline":"From page data"}');
  await dialog.getByRole('button', { name: 'Apply JSON' }).click();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();

  // The live preview re-renders the draft with the new page.data.
  const preview = page.frameLocator('iframe[title="Preview"]');
  await expect(preview.locator('h1')).toHaveText('From page data');

  // Persist the page, reload, reopen → the value round-tripped.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: /PageData Site/ }).click();
  await page.getByRole('button', { name: /^Home/ }).click();
  await expect(page.frameLocator('iframe[title="Preview"]').locator('h1')).toHaveText('From page data');
});

// The tree editor's own shape: name + type on one row, branches collapsed until asked for, and an
// order the author controls. A store with three nested levels used to open as a wall of inputs.
test('page.data tree: name+type on one row, branches collapsed, keys reorderable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signUp(page, `pdtree-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Tree Site');
  await page.getByLabel('Project slug').fill(`pdtree-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: /^Home/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('<div><h1>{{page.data.hero.headline}}</h1><p>{{page.data.tags.[0]}}</p></div>');

  await page.getByRole('button', { name: 'Edit page data' }).click();
  const dialog = page.getByRole('dialog', { name: 'Page data' });
  await dialog.getByRole('button', { name: /JSON source/ }).click();
  await dialog.getByLabel('JSON source').fill('{"hero":{"headline":"Deep"},"tags":["first","second"],"live":true}');
  await dialog.getByRole('button', { name: 'Apply JSON' }).click();

  // Only the TOP level is rendered — a nested key is behind its parent's expander.
  await expect(dialog.getByLabel('Key')).toHaveCount(3);
  await expect(dialog.getByRole('button', { name: 'Expand hero' })).toBeVisible();
  // A collapsed branch still says how big it is.
  await expect(dialog.getByText('2 items')).toBeVisible();
  await expect(dialog.getByText('1 key')).toBeVisible();

  // Name, type and remove share ONE row, in that order — `tags [array] ✕`. Asserted as geometry
  // rather than DOM nesting: "on one row" is a claim about what the author sees, and a locator that
  // pinned the wrapper structure would break on any refactor that kept the layout identical.
  const keyInput = dialog.getByLabel('Key').nth(1);
  const typeSelect = dialog.getByLabel('Value type').nth(1);
  const removeBtn = dialog.getByRole('button', { name: 'Remove tags' });
  await expect(typeSelect).toHaveValue('array');
  await expect(dialog.getByRole('option', { name: '[array]' }).first()).toBeAttached();
  const [k, t, r] = await Promise.all([keyInput.boundingBox(), typeSelect.boundingBox(), removeBtn.boundingBox()]);
  expect(Math.abs(k!.y - t!.y), 'the type select sits on the key row').toBeLessThan(8);
  expect(Math.abs(k!.y - r!.y), 'the remove button sits on the key row').toBeLessThan(8);
  expect(t!.x).toBeGreaterThan(k!.x);
  expect(r!.x).toBeGreaterThan(t!.x);

  // Expanding reveals the child; collapsing hides it again.
  await dialog.getByRole('button', { name: 'Expand hero' }).click();
  await expect(dialog.getByLabel('Key')).toHaveCount(4);
  await dialog.getByRole('button', { name: 'Collapse hero' }).click();
  await expect(dialog.getByLabel('Key')).toHaveCount(3);

  // Reorder: `live` moves above `tags`. Key order is what {{#each}} iterates, so it is content.
  await dialog.getByRole('button', { name: 'Move live up' }).click();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Edit page data' }).click();
  const reopened = page.getByRole('dialog', { name: 'Page data' });
  await expect(reopened.getByLabel('Key')).toHaveCount(3);
  const keys = await reopened.getByLabel('Key').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(keys).toEqual(['hero', 'live', 'tags']);

  // …and the page still renders from the (reordered, untouched) values.
  await reopened.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.frameLocator('iframe[title="Preview"]').locator('h1')).toHaveText('Deep');
  // Scoped to the page's OWN paragraph — the skeleton chrome (footer tagline, menu headings) supplies
  // several more, so a bare `p` matches the whole document.
  await expect(page.frameLocator('iframe[title="Preview"]').locator('h1 + p')).toHaveText('first');
});
