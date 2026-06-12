import { test, expect } from '@playwright/test';

const stamp = Date.now();

// {{sw-control}}: a content-editor-only control chip sets a whitelisted page / page.data value from
// inside the preview. The chip shows ONLY in content mode and is stripped from the published output.
test('sw-control: a control sets a page.data value (preview updates) and is stripped on publish', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`ctrl-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Control Site');
  await page.getByLabel('Project slug').fill(`ctrl-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Author a page that binds page.data.tagline + places a control to set it.
  await page.getByRole('button', { name: /^Home/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('<h1 class="tag">{{page.data.tagline}}</h1>{{sw-control target="tagline" label="Tagline"}}');
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();

  const preview = page.frameLocator('iframe[title="Preview"]');
  const chip = preview.locator('[data-sw-control="tagline"]');
  await expect(chip).toBeVisible(); // shown only in content mode

  // Click the chip → its popover → set the value → Apply.
  await chip.click();
  await preview.locator('.sw-pop .sw-cval').fill('Hello World');
  await preview.locator('.sw-pop .sw-ok').click();

  // The preview reloads and the bound heading shows the new value.
  await expect(preview.locator('h1.tag')).toHaveText('Hello World');

  // Save + publish; the published page keeps the bound value but has NO control chip.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('button', { name: 'Publish actions' }).click();
  const href = await page.getByRole('menuitem', { name: 'View published site' }).getAttribute('href');

  await page.goto(href!);
  await expect(page.locator('h1.tag')).toHaveText('Hello World');
  await expect(page.locator('[data-sw-control]')).toHaveCount(0); // chip stripped on publish
});

// as="file" opens the FILE picker (filtered to uploaded files) and sets the target to the chosen URL.
test('sw-control as="file": opens the file picker and sets a page.data file URL', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`ctrlfile-${Date.now()}@e2e.test`);
  await page.getByLabel('Password').fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Control File');
  await page.getByLabel('Project slug').fill(`ctrlfile-${Date.now()}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: /^Home/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('<a class="dl" href="{{sw-url page.data.brochure}}">Download</a>{{sw-control target="brochure" as="file" label="Brochure"}}');
  await page.getByRole('button', { name: 'Content Editor', exact: true }).click();

  const preview = page.frameLocator('iframe[title="Preview"]');
  await expect(preview.locator('[data-sw-control="brochure"]')).toBeVisible();
  await preview.locator('[data-sw-control="brochure"]').click();

  // The editor's FILE picker opens (titled "Choose file" — image controls say "Choose image"); paste a URL.
  const picker = page.getByRole('dialog', { name: 'Choose file' });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: 'URL', exact: true }).click();
  await picker.getByLabel('URL').fill('/media/seed/x/file/doc.pdf');
  await picker.getByRole('button', { name: 'Use URL as-is' }).click();

  // page.data.brochure is set → the bound link's href updates after the preview reload.
  await expect(preview.locator('a.dl')).toHaveAttribute('href', '/media/seed/x/file/doc.pdf');
});
