import { test, expect, type Page } from '@playwright/test';
import { signUp } from './helpers.js';

const stamp = Date.now();

/**
 * Entry drag-reorder — the case that had NO browser coverage while the schema-field drag did.
 *
 * The bug this guards: only the ROWS called preventDefault() on `dragover`, and HTML5 drag and drop
 * permits a drop only where the last dragover did. So the `gap-1` between rows, the virtualiser's
 * spacers and the space past the last row rejected the drop outright — the browser played its
 * snap-back animation and the entry returned to its original position, with no error anywhere.
 * jsdom does not implement that rule, so only a real browser can catch it.
 *
 * Both assertions therefore RELEASE IN A DEAD ZONE, and both re-read the order after a RELOAD: the
 * reorder is painted optimistically now, so checking the live DOM alone would pass even if the write
 * never reached the server.
 */

/** The entry labels, top to bottom. */
async function order(page: Page): Promise<string[]> {
  const rows = page.locator('li[data-drag-row]');
  await expect(rows.first()).toBeVisible();
  return (await rows.allInnerTexts()).map((t) => t.trim().split('\n')[0]!.trim());
}

/**
 * Re-enter the project from scratch and reopen the entries list.
 *
 * A plain `page.reload()` lands on the project PICKER (the editor does not keep the project in the
 * URL), so the rails do not exist to click. Going in through the front door is what the other specs
 * do, and it proves the order came back from the SERVER rather than from React state.
 */
async function reopenEntries(page: Page, baseURL: string, project: string, dataset: string): Promise<void> {
  await page.goto(baseURL);
  await page.getByText(project, { exact: true }).first().click();
  await page.getByRole('button', { name: 'Open Datasets' }).click();
  await page.getByText(dataset, { exact: true }).first().click();
  await expect(page.locator('li[data-drag-row]').first()).toBeVisible();
}

async function addEntry(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New entry' }).click();
  await page.getByLabel('title', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: title })).toBeVisible();
  await page.keyboard.press('Escape'); // the entry editor stays open after Save
}

test('drag-reorder entries by releasing in the dead zones (gap between rows, past the last row)', async ({ page, baseURL }) => {
  await signUp(page, `entryorder-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Order Site');
  await page.getByLabel('Project slug').fill(`entryorder-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: 'Open Datasets' }).click();
  await page.getByRole('button', { name: 'New dataset' }).click();
  await page.getByLabel('Dataset name').fill('Ordered');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: /schema · \d+ field|schema/ }).first().click();
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByLabel('New field name').fill('title');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Save schema' }).click();
  // Collapse the schema editor again so its field rows can't be confused with entry rows. Matched on
  // the "· N field" summary — a bare /schema/ also matches the "Save schema" button next to it.
  await page.getByRole('button', { name: /schema · \d+ field/ }).click();

  await addEntry(page, 'Alpha');
  await addEntry(page, 'Bravo');
  await addEntry(page, 'Charlie');
  expect(await order(page)).toEqual(['Alpha', 'Bravo', 'Charlie']);

  const rows = page.locator('li[data-drag-row]');
  const list = page.locator('ul').filter({ has: page.locator('li[data-drag-row]') }).first();

  // --- 1. Release in the GAP between Bravo and Charlie. Belongs to no row; used to be a dead zone.
  const listBox = (await list.boundingBox())!;
  const bravo = (await rows.nth(1).boundingBox())!;
  const charlie = (await rows.nth(2).boundingBox())!;
  const gapY = (bravo.y + bravo.height + charlie.y) / 2;
  expect(charlie.y).toBeGreaterThan(bravo.y + bravo.height); // there IS a gap to aim at

  await rows.nth(0).dragTo(list, { targetPosition: { x: 40, y: gapY - listBox.y } });
  await expect.poll(() => order(page)).toEqual(['Bravo', 'Alpha', 'Charlie']);

  // It must SURVIVE a reload — the optimistic paint would otherwise hide a write that never landed.
  await reopenEntries(page, baseURL!, 'Order Site', 'Ordered');
  await expect.poll(() => order(page)).toEqual(['Bravo', 'Alpha', 'Charlie']);

  // --- 2. Release PAST the last row — the other dead zone.
  const box2 = (await list.boundingBox())!;
  await rows.nth(0).dragTo(list, { targetPosition: { x: 40, y: box2.height - 1 } });
  await expect.poll(() => order(page)).toEqual(['Alpha', 'Charlie', 'Bravo']);

  await reopenEntries(page, baseURL!, 'Order Site', 'Ordered');
  await expect.poll(() => order(page)).toEqual(['Alpha', 'Charlie', 'Bravo']);
});
