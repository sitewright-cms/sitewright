import { test, expect } from '@playwright/test';

const stamp = Date.now();

// Deploy settings (the DEPLOY tab of the Publish & Deploy modal): save an SFTP target authenticated
// by a PRIVATE KEY, then deploy it — the deploy runs in a streaming modal whose progress/result/error
// is shown live. Here the target points at a closed port, so the modal surfaces the failure.
test('deploy: save an SFTP key-auth target and stream the deploy (failure shows in the deploy modal)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`deploy-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Deploy Site');
  await page.getByLabel('Project slug').fill(`deploy-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Author + publish (deploying requires a published artifact).
  await page.getByRole('button', { name: /^Home/ }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('<h1>Ship it</h1>');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('link', { name: /Preview/ })).toBeVisible();

  // Open the Publish & Deploy modal directly on its DEPLOY tab via the publish ⋯ menu (the path
  // publish.spec uses). Page-wide field locators (there is one deploy form on the page).
  await page.getByRole('button', { name: 'Publish actions' }).click();
  await page.getByRole('menuitem', { name: 'Deploy…' }).click();

  // Configure an SFTP target authenticated by a PRIVATE KEY (the key-auth UI), at a closed port.
  await page.getByLabel('Deploy protocol').selectOption('sftp');
  await page.getByLabel('Deploy host', { exact: true }).fill('127.0.0.1'); // exact: 'Deploy host' is a substring of 'Deploy host fingerprint'
  await page.getByLabel('Deploy port').fill('1');
  await page.getByLabel('Deploy user').fill('deployer');
  await page.getByLabel('Deploy auth method').selectOption('key');
  await page
    .getByLabel('Deploy private key')
    .fill('-----BEGIN OPENSSH PRIVATE KEY-----\nZHVtbXkta2V5LWNvbnRlbnRz\n-----END OPENSSH PRIVATE KEY-----');
  await page.getByLabel('Target name').fill('Key SFTP');
  await page.getByRole('button', { name: 'Save target' }).click();
  const deployBtn = page.getByRole('button', { name: 'Deploy to Key SFTP' });
  await expect(deployBtn).toBeVisible();

  // Deploy → the streaming Deploy modal opens and reports the connection failure.
  await deployBtn.click();
  const deployModal = page.getByRole('dialog', { name: 'Deploy to Key SFTP' });
  await expect(deployModal).toBeVisible();
  await expect(deployModal.getByText(/deploy failed/i)).toBeVisible({ timeout: 25_000 });
});
