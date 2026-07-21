import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, cp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ProjectBundle } from '@sitewright/core';
import type { Form, Page } from '@sitewright/schema';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { buildSite } from '../src/publish/build.js';
import { deploySite, DeployConfigSchema, type DeployConfig, type DeployTransport } from '../src/publish/adapters.js';

// Belt-and-suspenders: a form-bearing site, built for an OFF-PLATFORM deploy (absolute endpoint),
// arrives intact across EVERY remote transport and its submission is accepted by the platform — plus
// the guard refuses a remote deploy that would silently ship a broken (root-relative) form endpoint.

const at = '2026-05-31T00:00:00.000Z';

const contactForm = (over: Partial<Form> = {}): Form =>
  ({
    id: 'contact',
    name: 'Contact form',
    fields: [{ name: 'email', label: 'Email', type: 'email', required: true }],
    submitLabel: 'Send',
    successMessage: 'Thanks!',
    errorMessage: 'Oops.',
    recipient: 'secret@acme.com',
    subject: 'New lead',
    mode: 'globalSmtp',
    hcaptcha: false,
    ...over,
  }) as Form;

function bundle(projectId: string, forms: Form[], pages: Partial<Page>[]): ProjectBundle {
  return {
    project: {
      formatVersion: 2 as const,
      id: projectId,
      name: 'Acme',
      slug: 'acme',
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en'] },
    },
    pages: pages.map((p) => ({ root: { id: 'r', type: 'Section' as const }, ...p })),
    datasets: [],
    entries: [],
    forms,
  } as unknown as ProjectBundle;
}

// Temp dirs created by these tests, cleaned up even when an assertion throws mid-test (the repo had a
// /tmp-growth incident — never leak build/deploy scratch dirs).
const tmpDirs: string[] = [];
const mkTmp = async (prefix: string): Promise<string> => {
  const d = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
};
afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

// A fake transport that "deploys" by copying the built dir to a local capture dir, so the uploaded
// bytes can be read back and asserted — exercising deploySite's per-target orchestration server-free.
// `remoteDir` is intentionally ignored: the fake captures bytes, it doesn't model remote-path layout.
function capturing(dest: string): (cfg: DeployConfig) => DeployTransport {
  return () => ({
    async connect() {},
    async readManifest() {
      return null; // no prior manifest → deploySite uploads every file (a full capture)
    },
    async writeManifest() {},
    // The fake captures the uploaded bytes at their relative paths; it doesn't model remote layout.
    async upload(_remoteDir, files) {
      for (const file of files) {
        const target = join(dest, file.rel);
        await mkdir(dirname(target), { recursive: true });
        await cp(file.abs, target);
      }
    },
    async remove() {},
    async close() {},
  });
}

const REMOTE_PROTOCOLS = ['ftp', 'ftps', 'sftp'] as const;
const remoteCfg = (protocol: (typeof REMOTE_PROTOCOLS)[number]): DeployConfig =>
  DeployConfigSchema.parse({ protocol, host: 'deployed.example', user: 'u', password: 'p', remoteDir: '/var/www' });

const sessionOf = (res: { cookies: Array<{ name: string; value: string }> }): string =>
  res.cookies.find((c) => c.name === 'sw_session')?.value ?? '';

describe('form submission across deploy targets', () => {
  it('ships a working ABSOLUTE form endpoint to every remote target, and submissions are accepted + stored', async () => {
    const db = await makeTestDb();
    const app = await createApp({ db });
    await app.ready();
    // Project creation is agency-staff-only now; seed the creator as `developer` (agency staff). The
    // register route is invite-only, so seed via the repo, then log in for a session cookie.
    await registerAccount(db, 'o@acme.test', 'Pw-secret-1', { platformRole: 'developer' });
    const t = sessionOf(await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'o@acme.test', password: 'Pw-secret-1' } }));
    const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Site', slug: 'acme' } });
    const pid = (proj.json() as { project: { id: string } }).project.id;
    await app.inject({ method: 'PUT', url: `/projects/${pid}/content/form/contact`, cookies: { sw_session: t }, payload: contactForm() });

    // Build the artifact an off-platform deploy ships: `publicBaseUrl` → the form endpoint is ABSOLUTE.
    const builtDir = await mkTmp('sw-built-');
    await buildSite({
      publishedAt: at,
      outDir: builtDir,
      bundle: bundle(pid, [contactForm()], [{ id: 'contact', path: 'contact', title: 'Contact', source: '<section>{{sw-form "contact"}}</section>' }]),
      publicBaseUrl: 'https://app.sitewright.example',
    });
    const absEndpoint = `https://app.sitewright.example/f/${pid}/contact`;
    const endpointPath = new URL(absEndpoint).pathname; // /f/<pid>/contact
    // The GIT target force-pushes this build verbatim, so its page carries the absolute endpoint too
    // (the git transport's byte-fidelity is covered by the git-deploy suite; here we assert the artifact).
    expect(await readFile(join(builtDir, 'contact', 'index.html'), 'utf8')).toContain(`data-sw-endpoint="${absEndpoint}"`);

    // FTP / FTPS / SFTP: deploy via each transport, capture the upload, assert the page shipped intact,
    // then submit cross-origin to the absolute endpoint exactly as a visitor's browser would.
    for (const protocol of REMOTE_PROTOCOLS) {
      const dest = await mkTmp(`sw-deployed-${protocol}-`);
      const result = await deploySite(builtDir, remoteCfg(protocol), capturing(dest));
      expect(result.protocol).toBe(protocol);
      const deployedHtml = await readFile(join(dest, 'contact', 'index.html'), 'utf8');
      expect(deployedHtml, protocol).toContain(`data-sw-endpoint="${absEndpoint}"`);

      const submit = await app.inject({
        method: 'POST',
        url: endpointPath,
        headers: { origin: 'https://deployed.example', 'content-type': 'application/json' },
        payload: { email: `lead-${protocol}@x.co`, _elapsed: '5000' },
      });
      expect(submit.statusCode, protocol).toBe(200);
      expect(submit.json()).toEqual({ ok: true });
      expect(submit.headers['access-control-allow-origin']).toBe('*'); // cross-domain post allowed
    }

    // Every target's submission reached the platform inbox (stored independently of mail delivery).
    const inbox = await app.inject({ method: 'GET', url: `/projects/${pid}/submissions`, cookies: { sw_session: t } });
    expect((inbox.json() as { total: number }).total).toBe(REMOTE_PROTOCOLS.length);

    await app.close();
  });

  it('REFUSES a remote deploy of a platform-routed form when no public URL is configured (would 404 on the remote host)', async () => {
    const publishRoot = await mkTmp('sw-pub-');
    // No `publicUrl` → the form endpoint would be baked root-relative, broken on a remote host.
    const db = await makeTestDb();
    const app = await createApp({ db, publishRoot, encryptionKey: Buffer.alloc(32, 9) });
    await app.ready();
    // Project creation is agency-staff-only now; seed the creator as `developer` (agency staff). The
    // register route is invite-only, so seed via the repo, then log in for a session cookie.
    await registerAccount(db, 'g@acme.test', 'Pw-secret-1', { platformRole: 'developer' });
    const t = sessionOf(await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'g@acme.test', password: 'Pw-secret-1' } }));
    const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Site', slug: 'guard' } });
    const pid = (proj.json() as { project: { id: string } }).project.id;
    await app.inject({ method: 'PUT', url: `/projects/${pid}/content/form/contact`, cookies: { sw_session: t }, payload: contactForm() });
    await app.inject({
      method: 'PUT',
      url: `/projects/${pid}/content/page/contact`,
      cookies: { sw_session: t },
      payload: { id: 'contact', path: 'contact', title: 'Contact', source: '<section>{{sw-form "contact"}}</section>' },
    });

    // The deploy is refused at build time (before any transfer) with an actionable 409.
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${pid}/publish/deploy`,
      cookies: { sw_session: t },
      payload: { protocol: 'sftp', host: 'deployed.example', user: 'u', password: 'p', remoteDir: '/var/www' },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toMatch(/SW_PUBLIC_URL/);

    await app.close();
  });
});
