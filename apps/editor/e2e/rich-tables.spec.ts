import { test, expect, type Page } from '@playwright/test';
import { signUp } from './helpers.js';

const stamp = Date.now();

/**
 * Table editing in the dataset richtext WYSIWYG: the ops menu, and drag-to-size.
 *
 * Same posture as `rich-toolbar.spec.ts` — assert what the author SEES. A table op that writes correct
 * markup but leaves the rendered table unchanged is the failure this layer exists to catch, and a
 * dragged column width is only real if the column is actually that wide on screen AND survives a save.
 */

/** Sign in, create a project, and give it a dataset with a single `richtext` field. */
async function openRichTextEntry(page: Page, key: string): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await signUp(page, `${key}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Table Site');
  await page.getByLabel('Project slug').fill(key);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: 'Open Datasets' }).click();
  await page.getByRole('button', { name: 'New dataset' }).click();
  await expect(page.getByLabel('Dataset name')).toBeVisible();
  await page.getByLabel('Dataset name').fill('Posts');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: /schema/ }).click();
  // A `title` text field as well as the richtext one: with no text field at all an entry row is
  // labelled by its generated id, which the save/reopen specs below could not name.
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByLabel('New field name').fill('title');
  await page.getByLabel('New field type').selectOption('text');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByLabel('New field name').fill('body');
  await page.getByLabel('New field type').selectOption('richtext');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Save schema' }).click();

  await page.getByRole('button', { name: 'New entry' }).click();
  await expect(page.getByRole('textbox', { name: 'body' })).toBeVisible();
}

const editable = (page: Page) => page.getByRole('textbox', { name: 'body' });

/** Insert the starter table and put the caret in its first BODY cell. */
async function insertTable(page: Page): Promise<void> {
  await editable(page).click();
  await page.getByRole('button', { name: 'Insert table' }).click();
  await expect(editable(page).locator('table')).toHaveCount(1);
  await editable(page).locator('tbody td').first().click();
}

/** Open the table ops menu (the button renames itself once the caret is inside a table). */
async function openTableMenu(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Table options' });
  await expect(button).toBeVisible();
  await button.click();
}

/** Run one entry of the table ops menu from a caret already inside a table. */
async function tableOp(page: Page, label: string): Promise<void> {
  await openTableMenu(page);
  await page.getByRole('button', { name: label, exact: true }).click();
}

test('the table button becomes the ops menu once the caret is inside a table', async ({ page }) => {
  await openRichTextEntry(page, `tblmenu-${stamp}`);

  // Outside a table it INSERTS — and says so.
  await editable(page).click();
  await expect(page.getByRole('button', { name: 'Insert table' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Table options' })).toHaveCount(0);

  await insertTable(page);

  // Inside one it opens the menu, and its accessible NAME follows — not merely a highlight, which
  // tells a screen-reader user nothing about why the button now does something else.
  await expect(page.getByRole('button', { name: 'Table options' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Insert table' })).toHaveCount(0);

  await openTableMenu(page);
  for (const label of [
    'Insert row above', 'Insert row below', 'Insert column left', 'Insert column right',
    'Delete row', 'Delete column', 'Toggle header row', 'Merge cells', 'Split cell',
    'Reset sizes', 'Delete table',
  ]) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
});

test('inserting and deleting rows/columns changes the RENDERED grid', async ({ page }) => {
  await openRichTextEntry(page, `tblgrid-${stamp}`);
  await insertTable(page);

  const table = editable(page).locator('table');
  // The starter is a header row + two body rows, two columns wide.
  await expect(table.locator('tr')).toHaveCount(3);
  await expect(table.locator('tbody tr').first().locator('td')).toHaveCount(2);

  await tableOp(page, 'Insert row below');
  await expect(table.locator('tr')).toHaveCount(4);

  // NO re-click between ops: the caret stays in the table, so the menu stays reachable. Losing it was
  // the actual bug here — deleting the row you stand in left the toolbar back on "Insert table".
  await tableOp(page, 'Insert column right');
  await expect(table.locator('tbody tr').first().locator('td')).toHaveCount(3);
  await expect(table.locator('thead th')).toHaveCount(3); // the header row grew with it

  await tableOp(page, 'Delete column');
  await expect(table.locator('tbody tr').first().locator('td')).toHaveCount(2);

  await tableOp(page, 'Delete row');
  await expect(table.locator('tr')).toHaveCount(3);
  // Still inside the table after deleting the row the caret was in.
  await expect(page.getByRole('button', { name: 'Table options' })).toBeVisible();
});

test('toggling the header row swaps th/td and changes how the row renders', async ({ page }) => {
  await openRichTextEntry(page, `tblhead-${stamp}`);
  await insertTable(page);

  const table = editable(page).locator('table');
  await expect(table.locator('thead th')).toHaveCount(2);
  // A <th> is bold by UA default; that is the visible difference the toggle is FOR.
  const headerWeight = await table.locator('thead th').first().evaluate((el) => getComputedStyle(el).fontWeight);

  await tableOp(page, 'Toggle header row');
  await expect(table.locator('thead')).toHaveCount(0);
  await expect(table.locator('th')).toHaveCount(0);
  await expect(table.locator('tbody tr')).toHaveCount(3); // the ex-header folded into the body
  const plainWeight = await table.locator('tbody td').first().evaluate((el) => getComputedStyle(el).fontWeight);
  expect(Number(plainWeight)).toBeLessThan(Number(headerWeight));

  // …and back, with the scope a header row needs to be announced as one.
  await tableOp(page, 'Toggle header row');
  await expect(table.locator('thead th')).toHaveCount(2);
  await expect(table.locator('thead th').first()).toHaveAttribute('scope', 'col');
});

test('merging two cells produces one wider cell that keeps both texts', async ({ page }) => {
  await openRichTextEntry(page, `tblmerge-${stamp}`);
  await insertTable(page);

  const table = editable(page).locator('table');
  const firstRow = table.locator('tbody tr').first();
  // Drag-select across the row's two cells — a caret in one cell is not a merge.
  const a = firstRow.locator('td').nth(0);
  const b = firstRow.locator('td').nth(1);
  const from = (await a.boundingBox())!;
  const to = (await b.boundingBox())!;
  await page.mouse.move(from.x + 5, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width - 5, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();

  await tableOp(page, 'Merge cells');
  await expect(firstRow.locator('td')).toHaveCount(1);
  await expect(firstRow.locator('td')).toHaveAttribute('colspan', '2');
  // The other cell's words survive the merge — dropping them would be data loss dressed up as
  // formatting, and it is the mistake this op is most likely to make.
  await expect(firstRow.locator('td')).toContainText('Cell');
  // The merged cell genuinely spans the table's width, not just carries an attribute.
  const merged = (await firstRow.locator('td').boundingBox())!;
  const whole = (await table.boundingBox())!;
  expect(merged.width).toBeGreaterThan(whole.width * 0.8);

  // Splitting puts the second cell back.
  await firstRow.locator('td').click();
  await tableOp(page, 'Split cell');
  await expect(firstRow.locator('td')).toHaveCount(2);
});

test('dragging a column boundary resizes that column, and the width survives a save', async ({ page }) => {
  await openRichTextEntry(page, `tblsize-${stamp}`);
  await insertTable(page);

  const table = editable(page).locator('table');
  const firstCol = table.locator('thead th').first();
  const before = (await firstCol.boundingBox())!;

  // Grab the boundary between column 1 and 2 (the right edge of the first header cell) and pull left.
  const box = (await table.boundingBox())!;
  const edgeX = before.x + before.width;
  const midY = before.y + before.height / 2;
  await page.mouse.move(edgeX, midY);
  await page.mouse.down();
  await page.mouse.move(edgeX - 60, midY, { steps: 10 });
  await page.mouse.up();

  // It actually got narrower on screen — not merely "an attribute was written".
  await expect
    .poll(async () => (await firstCol.boundingBox())!.width, { message: 'the column never narrowed' })
    .toBeLessThan(before.width - 30);
  // …and the TABLE did not shrink with it: dragging a column boundary moves one boundary.
  const after = (await table.boundingBox())!;
  expect(Math.abs(after.width - box.width)).toBeLessThan(4);

  // The size is stored where the sanitizer allows it, so it survives the save/reopen round trip.
  const width = await firstCol.evaluate((el) => el.getAttribute('style'));
  expect(width).toMatch(/width:\s*\d+px/);
  // The entry editor stays OPEN after Save (it resets its baseline) — dismiss it, then reopen the row.
  await page.getByLabel('title', { exact: true }).fill('Sized');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sized', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Sized', exact: true }).click();
  const reopened = page.getByRole('textbox', { name: 'body' });
  await expect(reopened.locator('table')).toHaveCount(1);
  await expect(reopened.locator('thead th').first()).toHaveAttribute('style', /width:\s*\d+px/);
});

test('Reset sizes clears dragged widths, and Delete table removes it', async ({ page }) => {
  await openRichTextEntry(page, `tblreset-${stamp}`);
  await insertTable(page);

  const table = editable(page).locator('table');
  const firstCol = table.locator('thead th').first();
  const before = (await firstCol.boundingBox())!;
  const edgeX = before.x + before.width;
  const midY = before.y + before.height / 2;
  await page.mouse.move(edgeX, midY);
  await page.mouse.down();
  await page.mouse.move(edgeX - 60, midY, { steps: 10 });
  await page.mouse.up();
  await expect(firstCol).toHaveAttribute('style', /width/);

  await editable(page).locator('tbody td').first().click();
  await tableOp(page, 'Reset sizes');
  await expect(firstCol).not.toHaveAttribute('style', /width/);
  await expect(table).not.toHaveAttribute('style', /table-layout/);

  await editable(page).locator('tbody td').first().click();
  await tableOp(page, 'Delete table');
  await expect(editable(page).locator('table')).toHaveCount(0);
});

test('a table authored here survives the render sanitizer with its sizes intact', async ({ page }) => {
  // The sanitizer is the boundary the stored value crosses on the way to a published page. Sizing is
  // the NEW thing it allows, and it allows it on table elements only — so this asserts the round trip
  // the unit tests can only assert in isolation.
  await openRichTextEntry(page, `tblsan-${stamp}`);
  await insertTable(page);
  const table = editable(page).locator('table');
  const firstCol = table.locator('thead th').first();
  const before = (await firstCol.boundingBox())!;
  await page.mouse.move(before.x + before.width, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width - 50, before.y + before.height / 2, { steps: 8 });
  await page.mouse.up();

  await page.getByLabel('title', { exact: true }).fill('Stored');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stored', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  // Read the STORED value back over the API — past the editor, through the save-side gate.
  const stored = await page.evaluate(async () => {
    const projects = await (await fetch('/projects', { credentials: 'include' })).json();
    const id = projects.projects[0].id as string;
    const entries = await (await fetch(`/projects/${id}/content/entry?dataset=posts`, { credentials: 'include' })).json();
    return JSON.stringify(entries.items?.[0]?.values ?? {});
  });
  expect(stored).toContain('<table');
  expect(stored).toMatch(/width:\s*\d+px/);
  expect(stored).toContain('table-layout');
});
