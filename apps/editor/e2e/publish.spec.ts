import { test, expect } from '@playwright/test';

const stamp = Date.now();

test('build a code page, publish the project, and view the live site', async ({ page, baseURL }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`publish-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Live Site');
  await page.getByLabel('Project slug').fill(`live-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Build a home page: every new page is code-first. Replace the scaffold with identifiable
  // text (plain text sidesteps CodeMirror bracket auto-close) and save.
  await page.getByLabel('Page path').fill('home');
  await page.getByLabel('Page title').fill('Home Page');
  await page.getByRole('button', { name: 'Add page' }).click();
  await page.getByRole('button', { name: /^Home Page/ }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('We Are Live');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // Publish, then open the "…" actions menu (secondary actions live behind it now).
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('button', { name: 'Publish actions' }).click();

  // Menu items carry role="menuitem" (the links/buttons live inside a role="menu").
  const viewLink = page.getByRole('menuitem', { name: 'View published site' });
  await expect(viewLink).toBeVisible();
  const href = await viewLink.getAttribute('href');
  expect(href).toMatch(/^\/sites\/[\w-]+\/$/);

  // The zip artifact downloads (stay on the editor — don't navigate away).
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Download site zip' }).click(),
  ]);
  expect(await download.suggestedFilename()).toMatch(/\.zip$/);

  // Deploy form: a connection to a closed port surfaces an error (full UI→API→adapter path).
  // (Clicking a menu link doesn't close the menu, so Deploy is still reachable.)
  await page.getByRole('menuitem', { name: 'Deploy…' }).click();
  await page.getByLabel('Deploy protocol').selectOption('ftp');
  await page.getByLabel('Deploy host').fill('127.0.0.1');
  await page.getByLabel('Deploy port').fill('1');
  await page.getByLabel('Deploy user').fill('u');
  await page.getByLabel('Deploy password').fill('pw');
  await page.getByRole('button', { name: 'Deploy', exact: true }).click();
  await expect(page.getByText(/deploy failed/i)).toBeVisible({ timeout: 20_000 });

  // Save the (FTP) connection as a reusable target — credentials encrypted at rest.
  await page.getByLabel('Target name').fill('My Webspace');
  await page.getByRole('button', { name: 'Save target' }).click();
  await expect(page.getByRole('button', { name: 'Deploy to My Webspace' })).toBeVisible();

  // The published static page renders the code-authored content (in a separate tab).
  const live = await page.context().newPage();
  await live.goto(`${baseURL}${href}`);
  await expect(live.locator('body')).toContainText('We Are Live');
  await live.close();
});
