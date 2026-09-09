import { test, expect } from '@playwright/test';
import { deployLocally, signUp } from './helpers.js';

const stamp = Date.now();

// Deploy settings (the DEPLOY tab of the Publish & Deploy modal): save an SFTP target authenticated
// by a PRIVATE KEY, then deploy it — the deploy runs in a streaming modal whose progress/result/error
// is shown live.
//
// ★ The key below is a PLACEHOLDER, not a real one, and the modal now says so. That distinction is the
// whole point of describing failures: the target also points at a closed port, and under the old
// single-sentence error ("deploy failed") an unreadable key and an unreachable host were the same
// message. ssh2 rejects the key before it ever dials, so naming the key is the accurate report.
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
  // The described cause AND its hint — proving the richer failure payload survives the whole path
  // (adapter → route → SSE `failure` frame → modal), not just the headline sentence.
  await expect(deployModal.getByText(/The private key could not be read/i)).toBeVisible({ timeout: 25_000 });
  await expect(deployModal.getByText(/BEGIN and END lines/i)).toBeVisible();
});

// The connection TEST, which is the point of the feature: it answers before a deploy is attempted, and
// works on a target that has NOT been saved — the moment configuration actually goes wrong.
test('deploy: test an unsaved FTP target and see which step failed', async ({ page }) => {
  await signUp(page, `deploytest-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Test Conn');
  await page.getByLabel('Project slug').fill(`testconn-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Publish & Deploy Options' }).click();
  const wizard = page.getByRole('dialog', { name: 'Deploy targets' });
  await wizard.getByRole('button').filter({ hasText: 'FTP / FTPS Upload' }).first().click();
  await wizard.getByLabel('Name', { exact: true }).fill('Unsaved FTP');
  await wizard.getByLabel('Host', { exact: true }).fill('127.0.0.1');
  await wizard.getByLabel('Port', { exact: true }).fill('1');
  await wizard.getByLabel('User', { exact: true }).fill('u');
  await wizard.getByLabel(/^Password/).fill('pw');

  // No "Save target" click — the test runs against what is on screen.
  await wizard.getByRole('button', { name: 'Test connection' }).click();
  await expect(wizard.getByText(/Nothing accepted a connection on 127\.0\.0\.1:1/i)).toBeVisible({ timeout: 30_000 });
  // Which STEP failed is most of the diagnosis, so the step list has to reach the operator.
  await expect(wizard.getByText(/Connect to 127\.0\.0\.1:1/i)).toBeVisible();
  await expect(wizard.getByText(/Check the port \(1\)/i)).toBeVisible();
});
