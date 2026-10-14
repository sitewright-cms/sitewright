import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { signInAsAdmin } from './helpers.js';

const stamp = Date.now();

/** Create a project over the API (as the signed-in admin) and return its id. */
async function createProject(api: APIRequestContext, slug: string): Promise<string> {
  const res = await api.post('/projects', { data: { name: slug, slug } });
  expect(res.status(), `creating ${slug}`).toBe(201);
  return ((await res.json()) as { project: { id: string } }).project.id;
}

async function put(api: APIRequestContext, projectId: string, kind: string, id: string, data: Record<string, unknown>) {
  const res = await api.put(`/projects/${projectId}/content/${kind}/${id}`, { data });
  expect(res.status(), `PUT ${kind}/${id}`).toBe(200);
}

async function del(api: APIRequestContext, projectId: string, kind: string, id: string) {
  const res = await api.delete(`/projects/${projectId}/content/${kind}/${id}`);
  expect(res.status(), `DELETE ${kind}/${id}`).toBe(204);
}

/** Open System settings from the header gear (the project view is up, so the gear is reachable). */
async function openSystemSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'System Settings' }).click();
  const modal = page.getByRole('dialog', { name: 'System settings' });
  await expect(modal).toBeVisible();
  return modal;
}

/** Land in a project so no project-selector overlay covers the header. */
async function landInProject(page: Page, name: string) {
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill(name);
  // `-ui-` keeps it apart from the project each test creates over the API with the same stamp.
  await page.getByLabel('Project slug').fill(`${name.toLowerCase()}-ui-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
}

/** The id of a project the signed-in user can see, by slug. */
async function projectIdOf(api: APIRequestContext, slug: string): Promise<string> {
  const { projects } = (await (await api.get('/projects')).json()) as { projects: Array<{ id: string; slug: string }> };
  const found = projects.find((p) => p.slug === slug);
  expect(found, `project ${slug}`).toBeDefined();
  return found!.id;
}

// Deleting a page used to leave its children pointing at it and its translated titles targeting it —
// the integrity check's two most common findings. Now the delete takes them along.
test('deleting a page with a sub-page moves the sub-page up and leaves nothing for the integrity check', async ({ page }) => {
  await signInAsAdmin(page);
  const api = page.request;
  await landInProject(page, 'Rooted');
  const projectId = await projectIdOf(api, `rooted-ui-${stamp}`);
  await put(api, projectId, 'page', 'services', { id: 'services', path: 'services', title: 'Services', parent: 'home' });
  await put(api, projectId, 'page', 'web', { id: 'web', path: 'web', title: 'Web', parent: 'services' });
  await put(api, projectId, 'translation', 'services__de', { id: 'services__de', pageId: 'services', locale: 'de', title: 'Leistungen' });

  // The editor says what happens to the sub-page before it happens.
  await page.getByRole('button', { name: 'Delete Services' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete page' });
  await expect(confirm.getByText(/Its sub-page moves up one level, to where it was\./)).toBeVisible();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('button', { name: /^Services/ })).toHaveCount(0);

  const web = (await (await api.get(`/projects/${projectId}/content/page/web`)).json()) as { item: { parent?: string } };
  expect(web.item.parent).toBe('home');
  const titles = (await (await api.get(`/projects/${projectId}/content/translation`)).json()) as { items: unknown[] };
  expect(titles.items).toEqual([]);
  const report = (await (await api.get(`/projects/${projectId}/integrity`)).json()) as { ok: boolean; issues: unknown[] };
  expect(report).toMatchObject({ ok: true, issues: [] });
});

// The integrity sweep is INSTANCE-wide, so Fix all may also repair what other specs left behind on this
// slot. Everything asserted here is about this spec's own project, read back from the API.
test('Fix all issues repairs a page written before its parent, and ignores a deleted dataset', async ({ page }) => {
  await signInAsAdmin(page);
  const api = page.request;
  const projectId = await createProject(api, `integrity-${stamp}`);

  // What can still be written: a page whose parent is not there (yet) — a single write may create a
  // subtree child-first, so it is allowed, and stays broken if the parent never arrives.
  await put(api, projectId, 'page', 'early', { id: 'early', path: 'early', title: 'Early', parent: 'not-yet' });
  // …and a dataset deleted through the product. Its entries' history is its UNDO, not damage, and used to
  // be reported as an issue whose only fix destroyed it — which kept Fix all from ever appearing.
  await put(api, projectId, 'dataset', 'items', { id: 'items', name: 'Items', slug: 'items', fields: [{ name: 'title', type: 'text' }] });
  await put(api, projectId, 'entry', 'e1', { id: 'e1', dataset: 'items', values: { title: 'One' } });
  await del(api, projectId, 'dataset', 'items');

  const before = (await (await api.get(`/projects/${projectId}/integrity`)).json()) as { issues: Array<{ code: string }> };
  expect(before.issues.map((i) => i.code)).toEqual(['missing_page_parent']);

  await landInProject(page, 'Integrity');
  const settings = await openSystemSettings(page);
  await settings.getByRole('tab', { name: 'Ops' }).click();
  await settings.getByRole('button', { name: 'Check database integrity' }).click();

  const modal = page.getByRole('dialog', { name: 'Database integrity' });
  const fixAll = modal.getByRole('button', { name: /^Fix all issues \(\d+\)$/ });
  await expect(fixAll).toBeEnabled({ timeout: 60_000 });
  await expect(modal.getByRole('button', { name: 'Move under the home page' }).first()).toBeVisible();

  await fixAll.click();
  const confirm = page.getByRole('dialog', { name: /^Fix \d+ issues?\?$/ });
  await expect(confirm.getByText(/Repairs — nothing is removed/)).toBeVisible();
  await confirm.getByRole('button', { name: 'Fix them' }).click();

  await expect(modal.getByRole('status').filter({ hasText: /Repaired \d+ issues?\./ })).toBeVisible({ timeout: 60_000 });
  // The modal re-scans after repairing; this project is clean, read back from the database.
  const after = (await (await api.get(`/projects/${projectId}/integrity`)).json()) as { ok: boolean; issues: unknown[] };
  expect(after).toMatchObject({ ok: true, issues: [] });
  const early = (await (await api.get(`/projects/${projectId}/content/page/early`)).json()) as { item: { parent?: string } };
  expect(early.item.parent).toBe('home');
});

// Instance-global: set, read back through a project created after it, then RESTORE the default so no
// other spec on this slot creates a project under a cap it did not expect.
test('System settings → New projects: the default image size cap seeds projects created after it', async ({ page }) => {
  await signInAsAdmin(page);
  const api = page.request;
  await landInProject(page, 'Capped');
  const settings = await openSystemSettings(page);
  const field = settings.getByLabel('Default image size cap in pixels');
  try {
    await expect(field).toHaveValue('2400');
    await field.fill('1600');
    await settings.getByRole('button', { name: 'Save settings' }).click();
    await expect(settings.getByText('Saved.')).toBeVisible();

    const projectId = await createProject(api, `capped-${stamp}`);
    const s = (await (await api.get(`/projects/${projectId}/content/settings/settings`)).json()) as {
      item: { website?: { imageUploadCap?: number } };
    };
    expect(s.item.website?.imageUploadCap).toBe(1600);
  } finally {
    expect((await api.put('/admin/settings', { data: { defaultImageUploadCap: null } })).status()).toBe(200);
  }
});
