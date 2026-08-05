import { test, expect } from '@playwright/test';
import { deployLocally, fetchLiveSite, signUp } from './helpers.js';

const stamp = Date.now();

test('build a code page, publish the project, and view the live site', async ({ page }) => {
  await signUp(page, `publish-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Live Site');
  await page.getByLabel('Project slug').fill(`live-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Edit the auto-created HOME page (the empty-slug root). Use a data-sw-text region (insertText
  // sidesteps CodeMirror bracket auto-close) so we can also assert preview-only inline-edit markers
  // NEVER ship to a published page.
  await page.getByRole('button', { name: /^Home/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('<h1 data-sw-text="headline">We Are Live</h1>');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // Deploy to Local Hosting — there is no one-click Publish + "…" actions menu any more.
  await deployLocally(page);

  // The zip artifact downloads. It is a menuitem in the deploy split-button's dropdown now.
  await page.getByRole('button', { name: 'Choose a deploy target' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Download site zip' }).click(),
  ]);
  expect(await download.suggestedFilename()).toMatch(/\.zip$/);

  // A second, REMOTE target saved through the wizard — credentials encrypted at rest — and deploying to
  // it at a closed port must surface the failure (full UI→API→adapter path).
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Publish & Deploy Options' }).click();
  const wizard = page.getByRole('dialog', { name: 'Deploy targets' });
  await wizard.getByRole('button').filter({ hasText: 'FTP / FTPS Upload' }).first().click();
  await wizard.getByLabel('Name', { exact: true }).fill('My Webspace');
  await wizard.getByLabel('Host', { exact: true }).fill('127.0.0.1');
  await wizard.getByLabel('Port', { exact: true }).fill('1');
  await wizard.getByLabel('User', { exact: true }).fill('u');
  await wizard.getByLabel(/^Password/).fill('pw');
  await wizard.getByRole('button', { name: 'Save target' }).click();
  await wizard.getByRole('button', { name: 'Deploy to My Webspace' }).click();
  await expect(page.getByText(/deploy failed/i)).toBeVisible({ timeout: 25_000 });

  // The published static page renders the code-authored content. Local hosting serves on a subdomain
  // the DinD host has no DNS for, so read it with an explicit Host header.
  const live = await fetchLiveSite(page, `live-${stamp}`);
  expect(live.status).toBe(200);
  expect(live.html).toContain('We Are Live');
  // The preview-only inline-edit marker MUST NOT reach published HTML.
  expect(live.html).not.toContain('data-sw-text="headline"');
});
