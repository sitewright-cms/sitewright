import { test, expect } from '@playwright/test';

const stamp = Date.now();

// page.children — a parent page reads its child pages as a flat array. New pages are auto-parented to
// Home, so two new pages become Home's children; Home's source loops them with {{#each page.children}}.
test('page.children: a parent page lists its child pages in the preview', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`pchild-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Children Site');
  await page.getByLabel('Project slug').fill(`pchild-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Two child pages (auto-parented to Home).
  for (const [path, title] of [['first', 'First Article'], ['second', 'Second Article']]) {
    await page.getByRole('button', { name: 'New page' }).click();
    await page.getByLabel('Page path').fill(path);
    await page.getByLabel('Page title').fill(title);
    await page.getByRole('button', { name: 'Add page' }).click();
  }

  // Open Home and author an overview that loops its children.
  await page.getByRole('button', { name: /^Home/ }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('<main>{{#each page.children}}<a class="card" href="{{sw-url path}}"><h3>{{title}}</h3></a>{{/each}}</main>');

  const preview = page.frameLocator('iframe[title="Preview"]');
  await expect(preview.getByRole('heading', { name: 'First Article' })).toBeVisible();
  await expect(preview.getByRole('heading', { name: 'Second Article' })).toBeVisible();
  // The link targets the child's own route.
  await expect(preview.locator('a.card', { hasText: 'First Article' })).toHaveAttribute('href', /first/);
});
