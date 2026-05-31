import { test, expect } from '@playwright/test';

const stamp = Date.now();

// Forms tab: author a form in the editor UI, then (via a public submission) see it
// land in the Inbox tab — the full Phase 3b loop through the real stack.
test('author a form in the editor and see a submission in the inbox', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Organization name').fill(`Forms Agency ${stamp}`);
  await page.getByLabel('Email').fill(`forms-ui-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.getByLabel('Project name').fill('Forms UI Site');
  await page.getByLabel('Project slug').fill(`forms-ui-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: /Forms UI Site/ }).click();
  await page.getByRole('button', { name: 'forms' }).click();

  // Create + save a form.
  await page.getByLabel('New form name').fill('Contact');
  await page.getByRole('button', { name: 'Create form' }).click();
  await page.getByLabel('Recipient email').fill('leads@acme.example');
  await page.getByRole('button', { name: 'Save form' }).click();
  await expect(page.getByText('Contact')).toBeVisible();

  // Resolve the projectId via the API (shares the browser session cookie) and
  // submit to the public endpoint, then check the inbox.
  const me = await page.context().request.get('/me');
  const orgId = (await me.json()).orgs[0].id as string;
  const projects = await page.context().request.get(`/orgs/${orgId}/projects`);
  const project = (await projects.json()).projects.find((p: { slug: string }) => p.slug === `forms-ui-${stamp}`);
  const submit = await page.context().request.post(`/f/${project.id}/contact`, {
    data: { email: 'visitor@example.com', _elapsed: '5000' },
  });
  expect(submit.status()).toBe(200);

  // Inbox tab shows the submission (the summary shows the first field value).
  await page.getByRole('button', { name: 'inbox' }).click();
  await expect(page.getByText('1 submission')).toBeVisible();
  await expect(page.getByText('visitor@example.com')).toBeVisible();
  // Expanding reveals the field breakdown (the `email` dt label is expand-only).
  await page.getByText('contact').click();
  await expect(page.getByText('email', { exact: true })).toBeVisible();
});
