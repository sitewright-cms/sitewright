import { test, expect } from '@playwright/test';

const stamp = Date.now();

// Forms tab: author a form in the editor UI, then (via a public submission) see it
// land in the form's folded-in submissions list — the full Phase 3b loop through the
// real stack.
test('author a form in the editor and see a submission in its submissions list', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`forms-ui-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.getByLabel('Project name').fill('Forms UI Site');
  await page.getByLabel('Project slug').fill(`forms-ui-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: /Forms UI Site/ }).click();
  await page.getByRole('tab', { name: 'Forms' }).click();

  // Create + save a form.
  await page.getByLabel('New form name').fill('Contact');
  await page.getByRole('button', { name: 'Create form' }).click();
  await page.getByLabel('Recipient email').fill('leads@acme.example');
  await page.getByRole('button', { name: 'Save form' }).click();
  // The saved form appears as a row whose name is exactly "Contact" (a button). `exact` avoids both
  // the row's "Show submissions for contact"/"Delete form contact" buttons and any globally-enabled
  // `contact.php` delivery-mode option.
  await expect(page.getByRole('button', { name: 'Contact', exact: true })).toBeVisible();

  // Resolve the projectId via the API (shares the browser session cookie) and
  // submit to the public endpoint, then reveal it in the form's submissions list.
  const projects = await page.context().request.get('/projects');
  const project = (await projects.json()).projects.find((p: { slug: string }) => p.slug === `forms-ui-${stamp}`);
  const submit = await page.context().request.post(`/f/${project.id}/contact`, {
    data: { email: 'visitor@example.com', _elapsed: '5000' },
  });
  expect(submit.status()).toBe(200);

  // Submissions are now folded into the Forms tab: expand the Contact form's inline
  // submissions list (the only form here, so a single match is unambiguous).
  await page.getByRole('button', { name: /Show submissions/ }).click();
  await expect(page.getByText('1 submission')).toBeVisible();
  await expect(page.getByText('visitor@example.com')).toBeVisible();
  // Expanding the submission reveals the field breakdown (the `email` dt label is expand-only).
  await page.getByRole('button', { name: /Expand submission from contact/ }).click();
  await expect(page.getByText('email', { exact: true })).toBeVisible();
});
