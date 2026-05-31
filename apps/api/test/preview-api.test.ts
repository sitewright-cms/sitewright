import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';

let app: FastifyInstance;

beforeEach(async () => {
  app = await createApp({ db: await makeTestDb() });
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
  it('renders a draft page to a full HTML document + a preview token', async () => {
    const { t, orgId, projectId } = await setup('a@acme.test', 'Acme');
    const res = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/projects/${projectId}/preview`,
      cookies: { sw_session: t },
      payload: page,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { html: string; token: string };
    expect(body.html.startsWith('<!doctype html>')).toBe(true);
    expect(body.html).toContain('Hello world');
    expect(body.html).toContain('data-sw-block="Section"');
    expect(body.token).toMatch(/^[0-9a-f-]{36}$/); // an opaque uuid token
  });

  it('serves the preview document for a token under a sandbox CSP (isolated, framable)', async () => {
    const { t, orgId, projectId } = await setup('a@acme.test', 'Acme');
    const token = (
      await app.inject({
        method: 'POST',
        url: `/orgs/${orgId}/projects/${projectId}/preview`,
        cookies: { sw_session: t },
        payload: page,
      })
    ).json().token as string;

    const doc = await app.inject({
      method: 'GET',
      url: `/orgs/${orgId}/projects/${projectId}/preview/${token}`,
      cookies: { sw_session: t },
    });
    expect(doc.statusCode).toBe(200);
    expect(doc.headers['content-type']).toContain('text/html');
    // `sandbox allow-scripts` forces an opaque origin (isolated) yet runs scripts;
    // the editor must be able to frame it (SAMEORIGIN, not the default DENY).
    expect(doc.headers['content-security-policy']).toBe('sandbox allow-scripts');
    expect(doc.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(doc.body).toContain('Hello world');
  });

  it('does not serve a preview token to another tenant, or an unknown/expired token', async () => {
    const a = await setup('a@acme.test', 'Acme');
    const b = await setup('b@globex.test', 'Globex');
    const token = (
      await app.inject({
        method: 'POST',
        url: `/orgs/${a.orgId}/projects/${a.projectId}/preview`,
        cookies: { sw_session: a.t },
        payload: page,
      })
    ).json().token as string;

    // B cannot even reach A's project (not a member) → 403, before any token lookup.
    const intoA = await app.inject({
      method: 'GET',
      url: `/orgs/${a.orgId}/projects/${a.projectId}/preview/${token}`,
      cookies: { sw_session: b.t },
    });
    expect(intoA.statusCode).toBe(403);

    // And A's token presented under B's own (authorized) scope fails the token's
    // org/project/user binding → 404 (the store rejects it).
    const cross = await app.inject({
      method: 'GET',
      url: `/orgs/${b.orgId}/projects/${b.projectId}/preview/${token}`,
      cookies: { sw_session: b.t },
    });
    expect(cross.statusCode).toBe(404);

    // An unknown token under A's own scope is a 404.
    const unknown = await app.inject({
      method: 'GET',
      url: `/orgs/${a.orgId}/projects/${a.projectId}/preview/does-not-exist`,
      cookies: { sw_session: a.t },
    });
    expect(unknown.statusCode).toBe(404);
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

  it('inlines compiled Tailwind utilities (incl. brand) when the page uses classes', async () => {
    const { t, orgId, projectId } = await setup('a@acme.test', 'Acme');
    const base = `/orgs/${orgId}/projects/${projectId}`;
    await app.inject({
      method: 'PUT',
      url: `${base}/content/settings/settings`,
      cookies: { sw_session: t },
      payload: { brand: { name: 'Acme', colors: { primary: '#abcdef' } }, settings: {} },
    });
    const res = await app.inject({
      method: 'POST',
      url: `${base}/preview`,
      cookies: { sw_session: t },
      payload: {
        id: 'home',
        path: '/',
        title: 'Home',
        root: { id: 'r', type: 'Section', className: 'flex bg-primary', children: [] },
      },
    });
    expect(res.statusCode).toBe(200);
    const html = (res.json() as { html: string }).html;
    expect(html).toContain('class="flex bg-primary"');
    // The Tailwind compile ran and was inlined (banner + the compiled utility),
    // with the brand color mapped into the Tailwind theme.
    expect(html).toContain('/*! tailwindcss');
    expect(html).toContain('.bg-primary');
    expect(html).toContain('--color-primary:#abcdef');
    // No external stylesheet link in preview — it is fully self-contained.
    expect(html).not.toContain('rel="stylesheet"');
  });

  it('does not inline a utility stylesheet when the page uses no classes', async () => {
    const { t, orgId, projectId } = await setup('a@acme.test', 'Acme');
    const res = await app.inject({
      method: 'POST',
      url: `/orgs/${orgId}/projects/${projectId}/preview`,
      cookies: { sw_session: t },
      payload: page,
    });
    const html = (res.json() as { html: string }).html;
    expect(html).not.toContain('tailwindcss'); // the compiler never ran
  });
});
