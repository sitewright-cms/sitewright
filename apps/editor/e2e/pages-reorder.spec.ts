import { test, expect, type Page } from '@playwright/test';

const stamp = Date.now();

// Drag&drop (and keyboard) reordering of sibling pages within the same parent. Reordering
// rewrites each page's `order`; the change is optimistic and persists across a reload.

/** Registers a throwaway account + project, then adds two sibling pages under Home. */
async function setup(page: Page, suffix: string) {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`reorder-${suffix}-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Reorder Site');
  await page.getByLabel('Project slug').fill(`reorder-${suffix}-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  for (const [slug, title] of [
    ['about', 'About'],
    ['contact', 'Contact'],
  ]) {
    await page.getByRole('button', { name: 'New page' }).click();
    await page.getByLabel('Page path').fill(slug);
    await page.getByLabel('Page title').fill(title);
    await page.getByRole('button', { name: 'Add page' }).click();
    // Wait for the new row's title to land before adding the next page.
    await expect(page.locator('main ul li span.truncate.font-medium', { hasText: title })).toBeVisible();
  }
}

/** The page titles in list (DOM) order — the title span is uniquely `.truncate.font-medium`. */
const titles = (page: Page) => page.locator('main ul li span.truncate.font-medium').allInnerTexts();

/** A full reload drops to the project selector (project isn't in the URL) — re-open it. */
async function reloadIntoProject(page: Page) {
  await page.reload();
  await page.getByRole('button', { name: /Reorder Site/ }).click();
}

test('keyboard reorder: focus the grip, Arrow Up moves a page above its sibling, persists', async ({ page }) => {
  await setup(page, 'kbd');

  // New pages have no explicit order → title-sorted: Home, About, Contact.
  await expect.poll(() => titles(page)).toEqual(['Home', 'About', 'Contact']);

  // Home is pinned: it has no reorder grip.
  await expect(page.getByRole('button', { name: 'Reorder Home' })).toHaveCount(0);

  // Focus Contact's grip and move it up one — it jumps above About.
  await page.getByRole('button', { name: 'Reorder Contact' }).focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => titles(page)).toEqual(['Home', 'Contact', 'About']);
  // The move is announced for assistive tech (sr-only live region — present in the DOM).
  await expect(page.getByText('Moved Contact before About')).toBeAttached();

  // The new order survives a full reload (persisted to each page's `order`).
  await reloadIntoProject(page);
  await expect.poll(() => titles(page)).toEqual(['Home', 'Contact', 'About']);
});

test('drag reorder: dropping a page on the upper half of a sibling places it before, persists', async ({ page }) => {
  await setup(page, 'dnd');
  await expect.poll(() => titles(page)).toEqual(['Home', 'About', 'Contact']);

  // Native HTML5 DnD driven by dispatched events sharing one DataTransfer (Playwright's
  // synthetic mouse can't initiate real drags). The handlers read React state set by the
  // PRIOR event (dragstart→dragId, dragover→drop target), so the events must be dispatched in
  // SEPARATE steps — each await lets React commit before the next fires. Drop Contact onto
  // About's TOP quarter → "before".
  const pick = () =>
    page.evaluate(() => {
      const rows = [...document.querySelectorAll('ul > li')] as HTMLElement[];
      const src = rows.find((li) => li.draggable && li.textContent?.includes('Contact'))!;
      const tgt = rows.find((li) => li.draggable && li.textContent?.includes('About'))!;
      const w = window as unknown as { __dnd: { src: HTMLElement; tgt: HTMLElement; dt: DataTransfer } };
      w.__dnd = { src, tgt, dt: new DataTransfer() };
    });
  await pick();
  await page.evaluate(() => {
    const { src, dt } = (window as unknown as { __dnd: { src: HTMLElement; dt: DataTransfer } }).__dnd;
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  });
  await page.evaluate(() => {
    const { tgt, dt } = (window as unknown as { __dnd: { tgt: HTMLElement; dt: DataTransfer } }).__dnd;
    const r = tgt.getBoundingClientRect();
    tgt.dispatchEvent(
      new DragEvent('dragover', { bubbles: true, dataTransfer: dt, clientX: r.left + 8, clientY: r.top + r.height * 0.25 }),
    );
  });
  await page.evaluate(() => {
    const { src, tgt, dt } = (window as unknown as { __dnd: { src: HTMLElement; tgt: HTMLElement; dt: DataTransfer } }).__dnd;
    const r = tgt.getBoundingClientRect();
    tgt.dispatchEvent(
      new DragEvent('drop', { bubbles: true, dataTransfer: dt, clientX: r.left + 8, clientY: r.top + r.height * 0.25 }),
    );
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  });

  await expect.poll(() => titles(page)).toEqual(['Home', 'Contact', 'About']);
  await reloadIntoProject(page);
  await expect.poll(() => titles(page)).toEqual(['Home', 'Contact', 'About']);
});
