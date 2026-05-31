import { test, expect } from '@playwright/test';

const stamp = Date.now();

// Multilingual authoring: configure two locales, then use the editor's locale
// switcher to seed a German translation from the default ("copy from default"),
// edit it, persist it, and confirm it reloads as a real translation (not a copy).
test('switch locale, copy from default, edit and persist a translation', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Organization name').fill(`Agency ${stamp}`);
  await page.getByLabel('Email').fill(`locales-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  const [regRes] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/auth/register') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Create account' }).click(),
  ]);
  const { orgId } = await regRes.json();

  await page.getByLabel('Project name').fill('Locale Site');
  await page.getByLabel('Project slug').fill(`locale-${stamp}`);
  const [projRes] = await Promise.all([
    page.waitForResponse(
      (r) => /\/orgs\/[^/]+\/projects$/.test(r.url()) && r.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Create project' }).click(),
  ]);
  const { project } = await projRes.json();
  expect(project?.id).toBeTruthy();

  // Configure the project with two locales (there is no locale-management UI yet,
  // so set the settings singleton directly — page.request shares the session cookie).
  const put = await page.request.put(
    `/orgs/${orgId}/projects/${project.id}/content/settings/settings`,
    {
      data: {
        brand: { name: 'Locale Site', colors: {} },
        settings: { defaultLocale: 'en', locales: ['en', 'de'] },
      },
    },
  );
  expect(put.ok()).toBeTruthy();

  // Create a page and give the default locale some identifiable content, then save.
  await page.getByRole('button', { name: /Locale Site/ }).click();
  await page.getByLabel('Page slug').fill('home');
  await page.getByLabel('Page title').fill('Home Page');
  await page.getByRole('button', { name: 'Add page' }).click();
  await page.getByRole('button', { name: /Home Page/ }).click();

  await page.getByRole('button', { name: '+ Heading', exact: true }).click();
  await page.getByLabel('Text').fill('Hello');
  const preview = page.frameLocator('iframe[title="Live preview"]');
  await expect(preview.getByText('Hello')).toHaveCount(1);
  await page.getByRole('button', { name: 'Save page' }).click();
  await expect(page.getByRole('button', { name: /Home Page/ })).toBeVisible();

  // Re-open: the locale switcher is present (project has > 1 locale).
  await page.getByRole('button', { name: /Home Page/ }).click();
  const localeSelect = page.getByLabel('Editing locale');
  await expect(localeSelect).toBeVisible();

  // Switch to German → seeded from the saved default (copy-from-default). The
  // per-locale preview renders the copied content, and the save action is scoped
  // to the translation.
  await localeSelect.selectOption('de');
  await expect(page.getByText(/translating de · copied from default/)).toBeVisible();
  await expect(preview.getByText('Hello')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Save translation' })).toBeVisible();

  // Editing the translation title clears the "copied from default" hint.
  await page.getByLabel('Page title').fill('Startseite');
  await expect(page.getByText('copied from default')).toHaveCount(0);
  await expect(page.getByText('translating de')).toBeVisible();

  await page.getByRole('button', { name: 'Save translation' }).click();
  await expect(page.getByRole('button', { name: /Home Page/ })).toBeVisible();

  // Re-open and switch to German again → the SAVED translation loads (not a fresh
  // copy): the title override is restored and the copy hint is gone.
  await page.getByRole('button', { name: /Home Page/ }).click();
  await page.getByLabel('Editing locale').selectOption('de');
  await expect(page.getByLabel('Page title')).toHaveValue('Startseite');
  await expect(page.getByText('copied from default')).toHaveCount(0);

  // The default locale is untouched.
  await page.getByLabel('Editing locale').selectOption('en');
  await expect(page.getByLabel('Page title')).toHaveValue('Home Page');
});
