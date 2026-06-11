import { test, expect } from '@playwright/test';

const stamp = Date.now();

// global:blog-article is a content-only template: enabling it on a page seeds the page's page.data
// with the template's declared defaults, and the template renders those via data-sw-*="data.*" leaves.
test('global:blog-article: enabling the template seeds page.data defaults and renders them', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`blog-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Blog Site');
  await page.getByLabel('Project slug').fill(`blog-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: 'New page' }).click();
  await page.getByLabel('Page path').fill('post');
  await page.getByLabel('Page title').fill('Post');
  await page.getByRole('button', { name: 'Add page' }).click();
  await page.getByRole('button', { name: /^Post/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click(); // the Page-settings gear is source-mode-only

  // Page settings → enable the blog-article template (its declared defaults seed page.data).
  await page.getByRole('button', { name: 'Page settings' }).click();
  await page.getByLabel('Page template').selectOption({ label: 'Blog article (global)' });
  await page.getByRole('button', { name: 'Save settings' }).click();

  // The template renders, bound to the seeded page.data.
  const preview = page.frameLocator('iframe[title="Preview"]');
  await expect(preview.locator('[data-sw-text="data.article_title"]')).toHaveText('Your article title');

  // The defaults landed in page.data (visible in the Edit-page-data modal).
  await page.getByRole('button', { name: 'Edit page data' }).click();
  const dm = page.getByRole('dialog', { name: 'Page data' });
  await dm.getByRole('button', { name: /JSON source/ }).click();
  await expect(dm.getByLabel('JSON source')).toHaveValue(/article_title/);
  await expect(dm.getByLabel('JSON source')).toHaveValue(/article_body/);
  await dm.getByRole('button', { name: 'Save', exact: true }).click();

  // Persist + reload → the seeded data round-trips and still renders.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Blog Site/ }).click();
  await page.getByRole('button', { name: /^Post/ }).click();
  await expect(page.frameLocator('iframe[title="Preview"]').locator('[data-sw-text="data.article_title"]')).toHaveText('Your article title');
});
