import { test, expect } from '@playwright/test';
import { signUp } from './helpers.js';

const stamp = Date.now();

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);

async function openManager(page: import('@playwright/test').Page, slug: string) {
  await signUp(page, `${slug}-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('FM Site');
  await page.getByLabel('Project slug').fill(`${slug}-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Open File Manager' }).click();
  return page.getByRole('region', { name: 'File Manager' });
}

/**
 * File Manager toolbar + drop-zone UX, in a real browser.
 *
 * The native `<input type=file>` is the only control a browser will not let us style, and its
 * "Choose files" button was the one piece of unbranded chrome in the manager. It is now hidden (still
 * the accessible control, still what `setInputFiles` drives) behind a branded button.
 */
test('the upload affordance is a branded button; the native input is hidden', async ({ page }) => {
  const panel = await openManager(page, 'fmux');

  const btn = panel.getByRole('button', { name: 'Upload files' });
  await expect(btn).toBeVisible();
  // The platform's primary styling — brand gradient + the waves ripple.
  await expect(btn).toHaveClass(/sw-brand-gradient/);
  await expect(btn).toHaveClass(/waves-effect/);
  await expect(panel.getByLabel('Upload files')).toBeHidden();

  // …and the hidden input still works, which is what every other spec relies on.
  await panel.getByLabel('Upload files').setInputFiles({ name: 'hero.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await expect(panel.getByRole('button', { name: 'Delete hero.png' })).toBeVisible();
});

test('Upload / Search stock / Search unused sit on one row', async ({ page }) => {
  const panel = await openManager(page, 'fmrow');
  const names = ['Upload files', 'Search stock images', 'Search for unused files'];
  const boxes = [];
  for (const n of names) {
    const b = await panel.getByRole('button', { name: n }).boundingBox();
    expect(b, `${n} must be laid out`).not.toBeNull();
    boxes.push(b!);
  }
  // Same row ⇒ vertical centres within a few px of each other (tolerant of differing heights).
  const centres = boxes.map((b) => b.y + b.height / 2);
  for (const c of centres) expect(Math.abs(c - centres[0]!)).toBeLessThan(8);
  // …and in the given order, left to right.
  expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
  expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x);
});

test('dragging FILES over the manager outlines it; an internal drag does not', async ({ page }) => {
  const panel = await openManager(page, 'fmdrag');
  await panel.getByLabel('Upload files').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await expect(panel.getByRole('button', { name: 'Delete a.png' })).toBeVisible();

  /**
   * Dispatch from a element INSIDE the pane and let it bubble — the drop zone is an ancestor, and DOM
   * events travel up. A desktop-file drag is distinguished by `dataTransfer.types` containing 'Files'.
   */
  const fire = (type: string, withFiles: boolean) =>
    page.evaluate(
      ([t, files]) => {
        const dt = new DataTransfer();
        if (files) dt.items.add(new File(['x'], 'dropped.png', { type: 'image/png' }));
        else dt.setData('text/plain', 'internal-move');
        const from = document.querySelector('input[aria-label="Upload files"]')!;
        from.dispatchEvent(new DragEvent(t as string, { dataTransfer: dt, bubbles: true, cancelable: true }));
      },
      [type, withFiles] as [string, boolean],
    );

  await fire('dragenter', true);
  await expect(page.locator('[data-file-drag="over"]')).toHaveCount(1);

  await fire('drop', true);
  await expect(page.locator('[data-file-drag="over"]')).toHaveCount(0);

  // An INTERNAL drag carries no 'Files' — outlining the whole pane would wrongly say "drop anywhere",
  // when a move needs a specific target folder (which has its own row highlight).
  await fire('dragenter', false);
  await expect(page.locator('[data-file-drag="over"]')).toHaveCount(0);
});

test('a slow upload shows a progress modal that closes itself when it succeeds', async ({ page }) => {
  const panel = await openManager(page, 'fmprog');

  // Hold the upload open long enough for the modal to be observable, then let it through.
  await page.route('**/media**', async (route) => {
    if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });

  await panel.getByLabel('Upload files').setInputFiles({ name: 'slow.png', mimeType: 'image/png', buffer: PNG_1X1 });

  const dialog = page.getByRole('dialog', { name: /Uploading files/i });
  await expect(dialog).toBeVisible();
  // Auto-closes on success — no click required.
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(panel.getByRole('button', { name: 'Delete slow.png' })).toBeVisible();
});
