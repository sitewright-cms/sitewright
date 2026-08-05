import { test, expect } from '@playwright/test';
import { deployLocally, liveSiteRequest, signUp } from './helpers.js';

const stamp = Date.now();

// The "PUBLISH & DEPLOY OPTIONS" modal (header overflow ⋮): enabling a preview token gates the
// locally-published site behind ?token= and rewrites the Preview link to carry it.
test('publish options: enabling a preview token gates the live site behind ?token= (live, no republish)', async ({ page }) => {
  const slug = `opt-${stamp}`;
  await signUp(page, `opt-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Opt Site');
  await page.getByLabel('Project slug').fill(slug);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Author + publish the home page.
  await page.getByRole('button', { name: /^Home/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('<h1>Gated content</h1>');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await deployLocally(page);

  // Before the token: the live site is openly reachable. Local hosting serves on a subdomain the DinD
  // host has no DNS for, so every live read here goes through an explicit Host header.
  expect((await liveSiteRequest(page, slug)).status()).toBe(200);

  // The token gate is a per-TARGET option now: the old "Publish & deploy options" tab is gone, and the
  // modal is the deploy-target wizard. Edit the Local target and turn on "Require a secret link".
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Publish & Deploy Options' }).click();
  const modal = page.getByRole('dialog', { name: 'Deploy targets' });
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: /^Edit / }).first().click();
  await modal.getByText('Require a secret link (unlisted)').click();
  // The form reveals the unlisted link inline: "<siteUrl>?token=<token>".
  const linkText = await modal.getByText(/Unlisted link:/).innerText();
  const token = linkText.match(/[?&]token=([\w-]{16,})/)?.[1];
  expect(token, 'the form must reveal the unlisted token').toBeTruthy();
  await modal.getByRole('button', { name: 'Save changes' }).click();
  await modal.getByRole('button', { name: 'Close' }).first().click();

  // The gate is LIVE (read from settings at serve time — no redeploy needed).
  expect((await liveSiteRequest(page, slug)).status()).toBe(403);
  const served = await liveSiteRequest(page, slug, `/?token=${encodeURIComponent(token!)}`);
  expect(served.status()).toBe(200);
  expect(await served.text()).toContain('Gated content');
});
