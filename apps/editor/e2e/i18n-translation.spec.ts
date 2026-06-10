import { test, expect } from '@playwright/test';

const stamp = Date.now();

/** Register a fresh user + create a project, returning its slug. */
async function newProject(page: import('@playwright/test').Page, tag: string): Promise<string> {
  const slug = `${tag}-${stamp}`;
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`${tag}-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('I18n Site');
  await page.getByLabel('Project slug').fill(slug);
  await page.getByRole('button', { name: 'Create project' }).click();
  return slug;
}

test('add translation scaffolds a locale that inherits the main language layout, published under /<locale>', async ({ page, baseURL }) => {
  const slug = await newProject(page, 'i18n');

  // Author the home page with a recognizable layout marker (the inherited structure).
  await page.getByRole('button', { name: /^Home/ }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('<section class="p-6"><h1 class="inherit-marker">Main layout</h1></section>');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // Add a translation target (German) via the top "+ Add translation" button → searchable picker.
  await page.getByRole('button', { name: '+ Add translation' }).click();
  const picker = page.getByRole('dialog', { name: 'Add a translation target' });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: /German/ }).click();

  // The language switcher appears and jumps to the new language; the German home is in the list.
  const langTablist = page.getByRole('tablist', { name: 'Language' });
  await expect(langTablist).toBeVisible();
  await expect(langTablist.getByRole('tab', { name: 'de', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('ul.mb-8 > li')).toHaveCount(1); // just the German home (scaffolded)
  // The German home is INHERIT mode — its row shows the "inherited" badge.
  await expect(page.getByText('inherited')).toBeVisible();

  // Publish, then both / and /de/ must render the SAME main-language layout (inheritance).
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('link', { name: /Preview/ })).toBeVisible();
  const en = await page.request.get(`${baseURL}/sites/${slug}/`);
  const de = await page.request.get(`${baseURL}/sites/${slug}/de/`);
  expect(en.status()).toBe(200);
  expect(de.status()).toBe(200);
  expect(await en.text()).toContain('inherit-marker');
  expect(await de.text()).toContain('inherit-marker'); // /de inherited the English layout
  expect(await de.text()).toContain('<html lang="de"');
});

test('Website Settings: removing a language warns about page deletion and cascades', async ({ page }) => {
  await newProject(page, 'i18nrm');

  // Add German from the Website Settings → Localization manager.
  await page.getByRole('tab', { name: 'Website Settings' }).click();
  await page.getByRole('button', { name: '+ Add language' }).click();
  const picker = page.getByRole('dialog', { name: 'Add a language' });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: /German/ }).click();
  // The German row appears with a Remove action.
  await expect(page.getByRole('button', { name: 'Remove German' })).toBeVisible();

  // Removing it warns that its pages will be permanently deleted, then cascades on confirm.
  await page.getByRole('button', { name: 'Remove German' }).click();
  const confirm = page.getByRole('dialog', { name: /Remove German/ });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText(/permanently deletes/)).toBeVisible();
  await confirm.getByRole('button', { name: 'Remove language' }).click();

  // The German row is gone (its pages were cascade-deleted server-side).
  await expect(page.getByRole('button', { name: 'Remove German' })).toBeHidden();
});
