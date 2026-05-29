import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';

let app: FastifyInstance;

beforeEach(async () => {
  app = createApp({ db: await makeTestDb() });
  await app.ready();
});

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}

async function setup(email: string, orgName: string) {
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'pw-secret-1', orgName },
  });
  const t = token(reg);
  const orgId = (reg.json() as { orgId: string }).orgId;
  const proj = await app.inject({
    method: 'POST',
    url: `/orgs/${orgId}/projects`,
    cookies: { sw_session: t },
    payload: { name: 'Site', slug: 'site' },
  });
  const projectId = (proj.json() as { project: { id: string } }).project.id;
  return { t, orgId, projectId };
}

const page = {
  id: 'home',
  path: '/',
  title: 'Home',
  root: {
    id: 'r',
    type: 'Section',
    children: [{ id: 'h', type: 'Heading', props: { text: 'Hello world', level: 1 } }],
  },
};

describe('preview API', () => {
  it('renders a draft page to a full HTML document', async () => {
    const { t, orgId, projectId } = await setup('a@acme.test', 'Acme');
    const res = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/projects/${projectId}/preview`,
      cookies: { sw_session: t },
      payload: page,
    });
    expect(res.statusCode).toBe(200);
    const html = (res.json() as { html: string }).html;
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('Hello world');
    expect(html).toContain('data-sw-block="Section"');
  });

  it('requires authentication', async () => {
    const { orgId, projectId } = await setup('a@acme.test', 'Acme');
    const res = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/projects/${projectId}/preview`,
      payload: page,
    });
    expect(res.statusCode).toBe(401);
  });

  it('forbids previewing another tenant’s project', async () => {
    const a = await setup('a@acme.test', 'Acme');
    const b = await setup('b@globex.test', 'Globex');
    const res = await app.inject({
      method: 'POST',
      url: `/orgs/${a.orgId}/projects/${a.projectId}/preview`,
      cookies: { sw_session: b.t },
      payload: page,
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an invalid page (400)', async () => {
    const { t, orgId, projectId } = await setup('a@acme.test', 'Acme');
    const res = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/projects/${projectId}/preview`,
      cookies: { sw_session: t },
      payload: { id: 'x', title: 'no root' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('escapes hostile content in the rendered HTML', async () => {
    const { t, orgId, projectId } = await setup('a@acme.test', 'Acme');
    const res = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/projects/${projectId}/preview`,
      cookies: { sw_session: t },
      payload: {
        id: 'x',
        path: '/x',
        title: 'X',
        root: {
          id: 'r',
          type: 'Heading',
          props: { text: '<img src=x onerror=alert(1)>' },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const html = (res.json() as { html: string }).html;
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img');
  });

  it('applies the project brand and resolves dataset bindings (incl. drafts)', async () => {
    const { t, orgId, projectId } = await setup('a@acme.test', 'Acme');
    const base = `/orgs/${orgId}/projects/${projectId}`;
    // Save brand settings.
    await app.inject({
      method: 'PUT',
      url: `${base}/content/settings/settings`,
      cookies: { sw_session: t },
      payload: { brand: { name: 'Acme', colors: { primary: '#abcdef' } }, settings: {} },
    });
    // Save a draft entry in dataset "posts".
    await app.inject({
      method: 'PUT',
      url: `${base}/content/entry/post-1`,
      cookies: { sw_session: t },
      payload: { id: 'post-1', dataset: 'posts', status: 'draft', values: { title: 'Draft Post' } },
    });

    const res = await app.inject({
      method: 'POST',
      url: `${base}/preview`,
      cookies: { sw_session: t },
      payload: {
        id: 'blog',
        path: '/blog',
        title: 'Blog',
        root: {
          id: 'r',
          type: 'Grid',
          binding: { dataset: 'posts', mode: 'list' },
          children: [{ id: 'c', type: 'Heading', props: { textField: 'title' } }],
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const html = (res.json() as { html: string }).html;
    expect(html).toContain('--sw-color-primary: #abcdef;');
    expect(html).toContain('Draft Post'); // drafts shown in preview
  });
});
