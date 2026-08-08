import { test, expect } from '@playwright/test';
import { signUpWithProject } from './helpers.js';

const stamp = Date.now();

/** Open the System Library rail, whichever state it starts in. */
async function openLibrary(page: import('@playwright/test').Page) {
  const library = page.locator('[role="region"][aria-label="System Library"]');
  if ((await library.getAttribute('aria-hidden')) === 'true') {
    await page.getByRole('button', { name: 'Open System Library' }).click();
    await expect(library).toHaveAttribute('aria-hidden', 'false');
  }
  return library;
}

// The Library's TailwindCSS Reference: every utility the bundled Tailwind can generate, searchable
// by class name OR by CSS property in plain words, with the generated CSS on every row.
test('library: tailwind reference — search by property, by class, and copy', async ({ page }) => {
  await signUpWithProject(page, `tw-${stamp}@e2e.test`, 'TW Site', `tw-${stamp}`);

  const library = await openLibrary(page);
  await library.getByRole('button', { name: /TailwindCSS Reference/ }).click();
  const ref = page.getByRole('dialog', { name: 'TailwindCSS Reference' });
  await expect(ref).toBeVisible();
  // The footer proves the dataset actually loaded from /authoring/tailwind/reference.
  await expect(ref.getByText(/Tailwind CSS \d+\.\d+\.\d+ · [\d,]+ utilities/)).toBeVisible();

  const search = ref.getByLabel('Search the Tailwind reference');

  // ── Searching a CSS property in WORDS lands on that topic. No synonym table backs this: the
  //    topic is keyed by the property its classes generate, so "font size" matches `font-size`.
  await search.fill('font size');
  await expect(ref.getByRole('heading', { name: 'Font Size' })).toBeVisible();
  await expect(ref.locator('[data-class-name="text-sm"]')).toBeVisible();

  // ── Searching a CLASS lands on the same topic with that row picked out.
  await search.fill('text-sm');
  await expect(ref.getByRole('heading', { name: 'Font Size' })).toBeVisible();
  const row = ref.locator('[data-class-name="text-sm"]');
  await expect(row).toBeVisible();
  await expect(row).toHaveClass(/ring-indigo-300/);
  // The generated CSS is on the row, at its resolved value rather than a var().
  await expect(row).toContainText('font-size: 0.875rem');

  // ── A typography preview is really PAINTED, not just marked up. Assert the computed style inside
  //    the shadow root: the editor's own sheet has no `text-sm` rule, so a class-based preview would
  //    silently render at the inherited size and this is the assertion that would catch it.
  const specimenSize = await row.locator('span[role="img"]').evaluate((host) => {
    const el = (host as HTMLElement & { shadowRoot: ShadowRoot }).shadowRoot.querySelector('.specimen');
    return el ? getComputedStyle(el).fontSize : null;
  });
  expect(specimenSize).toBe('14px'); // 0.875rem

  // ── Browsing by category works independently of search. `exact` matters: accessible-name
  //    matching is substring by default, and this category also has "Border Radius Bottom",
  //    "Border Radius Top Left" and a dozen more that would make the locator ambiguous.
  await search.fill('');
  await ref.getByRole('button', { name: 'Borders', exact: true }).click();
  await expect(ref.getByRole('heading', { name: 'Border Radius', exact: true })).toBeVisible();

  // ── Clicking a class copies it. The toast is portalled at app level, not inside the dialog.
  await ref.getByTitle('Copy rounded-full', { exact: true }).click();
  await expect(page.getByText('Copied to clipboard')).toBeVisible();
});

// The reference opens from anywhere via its keyboard shortcut, and inserting a class lands it at the
// caret in the open page editor.
test('library: tailwind reference — shortcut opens it, insert lands at the caret', async ({ page }) => {
  await signUpWithProject(page, `twk-${stamp}@e2e.test`, 'TW Keys', `twk-${stamp}`);
  // Let the create-project modal finish unwinding first. The shortcut deliberately does nothing
  // while an overlay is on the stack, so pressing it mid-close is suppressed — correctly, but it
  // makes for a flaky assertion.
  await expect(page.getByRole('button', { name: 'New page' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Ctrl+Alt+T opens it without touching the Library rail. (The editor also binds Ctrl+Shift+K,
  // because GNOME takes Ctrl+Alt+T at the desktop level and it never reaches the browser there.)
  await page.keyboard.press('Control+Alt+T');
  const ref = page.getByRole('dialog', { name: 'TailwindCSS Reference' });
  await expect(ref).toBeVisible();

  // With no code editor open, Insert is offered but disabled rather than silently doing nothing.
  await ref.getByLabel('Search the Tailwind reference').fill('text-sm');
  await expect(ref.locator('[data-class-name="text-sm"]')).toBeVisible();
  await expect(ref.getByRole('button', { name: 'Insert text-sm at cursor' })).toBeDisabled();
  // Two Escapes: the field is `<input type="search">`, and Chromium consumes the first one to clear
  // it without letting it propagate, so only the second reaches the modal. Platform behaviour shared
  // by every SearchField dialog in the editor, not specific to this one.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(ref).toBeHidden();

  // Open a page in code mode, put the caret at the end of the source, then insert from the reference.
  await page.getByRole('button', { name: 'New page' }).click();
  await page.getByLabel('Page path').fill('about');
  await page.getByLabel('Page title').fill('About');
  await page.getByRole('button', { name: 'Create page' }).click();
  await page.getByRole('button', { name: /^About/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  const content = page.locator('.cm-content');
  await expect(content).toContainText('{{ company.name }}');
  await content.click();
  await page.keyboard.press('ControlOrMeta+End');

  const library = await openLibrary(page);
  await library.getByRole('button', { name: /TailwindCSS Reference/ }).click();
  await expect(ref).toBeVisible();
  await ref.getByLabel('Search the Tailwind reference').fill('text-sm');
  const insert = ref.getByRole('button', { name: 'Insert text-sm at cursor' });
  await expect(insert).toBeEnabled();
  await insert.click();
  await expect(page.getByText('Inserted text-sm')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(content).toContainText('text-sm');
});
