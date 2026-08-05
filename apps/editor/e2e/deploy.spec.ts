import { test, expect } from '@playwright/test';
import { deployLocally, signUp } from './helpers.js';

const stamp = Date.now();

// Deploy settings (the DEPLOY tab of the Publish & Deploy modal): save an SFTP target authenticated
// by a PRIVATE KEY, then deploy it — the deploy runs in a streaming modal whose progress/result/error
// is shown live. Here the target points at a closed port, so the modal surfaces the failure.
test('deploy: save an SFTP key-auth target and stream the deploy (failure shows in the deploy modal)', async ({ page }) => {
  await signUp(page, `deploy-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Deploy Site');
  await page.getByLabel('Project slug').fill(`deploy-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Author + publish (deploying requires a published artifact).
  await page.getByRole('button', { name: /^Home/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('<h1>Ship it</h1>');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await deployLocally(page);

  // Add a SECOND target through the wizard: SFTP authenticated by a PRIVATE KEY, at a closed port.
  // (The old inline "Deploy…" form behind a "Publish actions" menu is gone — targets are configured in
  // the wizard and the transport runs from the header's split Deploy button.)
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Publish & Deploy Options' }).click();
  const wizard = page.getByRole('dialog', { name: 'Deploy targets' });
  await wizard.getByRole('button').filter({ hasText: 'SSH / SFTP Upload' }).first().click();
  await wizard.getByLabel('Name', { exact: true }).fill('Key SFTP');
  await wizard.getByLabel('Host', { exact: true }).fill('127.0.0.1');
  await wizard.getByLabel('Port', { exact: true }).fill('1');
  await wizard.getByLabel('User', { exact: true }).fill('deployer');
  await wizard.getByLabel('SFTP auth method').selectOption('key');
  await wizard
    .getByLabel(/^Private key/)
    .fill('-----BEGIN OPENSSH PRIVATE KEY-----\nZHVtbXkta2V5LWNvbnRlbnRz\n-----END OPENSSH PRIVATE KEY-----');
  await wizard.getByRole('button', { name: 'Save target' }).click();

  // Deploy from the target's OWN row in the wizard: the header's split button defaults to the local
  // target, and a `local` target is served by publishing rather than by the deploy transport.
  const deployBtn = wizard.getByRole('button', { name: 'Deploy to Key SFTP' });
  await expect(deployBtn).toBeVisible();

  // Deploy → the streaming Deploy modal opens and reports the connection failure.
  await deployBtn.click();
  const deployModal = page.getByRole('dialog', { name: 'Deploy to Key SFTP' });
  await expect(deployModal).toBeVisible();
  await expect(deployModal.getByText(/deploy failed/i)).toBeVisible({ timeout: 25_000 });
});
