import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../src/db/client.js';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';

/**
 * The deploy-target connection test, over HTTP.
 *
 * The connection cases dial 127.0.0.1 on a port nothing listens on, so they exercise the REAL
 * transport and the real error describer without needing a network or a server to stand up: a refused
 * connection is exactly what an operator with a wrong port sees, and proving it comes back as a
 * described result (rather than a 500, or the constant sentence this replaced) is the point.
 */

let app: FastifyInstance;
let db: Database;
let publishRoot: string;
const encryptionKey = randomBytes(32);
/** Nothing binds port 1; connecting to it refuses immediately. */
const CLOSED_PORT = 1;

beforeEach(async () => {
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-dtt-'));
  db = await makeTestDb();
  app = await createApp({ db, publishRoot, encryptionKey });
  await app.ready();
});
afterEach(async () => {
  await rm(publishRoot, { recursive: true, force: true });
});

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}
async function setup(email: string, slug = 'site') {
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  const t = token(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }));
  const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Site', slug } });
  return { t, projectId: (proj.json() as { project: { id: string } }).project.id };
}
const testUrl = (projectId: string) => `/projects/${projectId}/deploy-targets/test`;

describe('POST /deploy-targets/test', () => {
  it('reports a refused connection as a RESULT, naming the cause', async () => {
    const { t, projectId } = await setup('a@example.com', 'refused');
    const res = await app.inject({
      method: 'POST',
      url: testUrl(projectId),
      cookies: { sw_session: t },
      payload: { protocol: 'ftp', host: '127.0.0.1', port: CLOSED_PORT, user: 'alice', password: 'pw', remoteDir: '/' },
    });
    expect(res.statusCode).toBe(200); // a failed connection is not a failed REQUEST
    const body = res.json() as { ok: boolean; failure: { kind: string; message: string }; steps: Array<{ key: string; status: string }> };
    expect(body.ok).toBe(false);
    expect(body.failure.kind).toBe('refused');
    expect(body.failure.message).toContain('127.0.0.1:1');
    // Which step failed is most of the diagnosis, so the step list has to survive the failure.
    expect(body.steps[0]).toMatchObject({ key: 'connect', status: 'failed' });
  });

  it('reports the same for SFTP, through the SSH transport', async () => {
    const { t, projectId } = await setup('b@example.com', 'refused-sftp');
    const res = await app.inject({
      method: 'POST',
      url: testUrl(projectId),
      cookies: { sw_session: t },
      payload: { protocol: 'sftp', host: '127.0.0.1', port: CLOSED_PORT, user: 'alice', password: 'pw', remoteDir: '/' },
    });
    const body = res.json() as { ok: boolean; protocol: string; failure: { kind: string } };
    expect(body.ok).toBe(false);
    expect(body.protocol).toBe('sftp');
    expect(['refused', 'reset', 'timeout', 'unknown']).toContain(body.failure.kind);
  });

  it('defaults the FTPS port by TLS mode, so an implicit target dials 990', async () => {
    const { t, projectId } = await setup('c@example.com', 'implicit');
    const res = await app.inject({
      method: 'POST',
      url: testUrl(projectId),
      cookies: { sw_session: t },
      payload: { protocol: 'ftps', ftpsMode: 'implicit', host: '127.0.0.1', user: 'alice', password: 'pw', remoteDir: '/' },
    });
    expect((res.json() as { port: number }).port).toBe(990);
  });

  it('fills omitted credentials from a saved target, so an edit with a blank password is testable', async () => {
    const { t, projectId } = await setup('d@example.com', 'inherit');
    const created = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/deploy-targets`,
      cookies: { sw_session: t },
      payload: { name: 'FTP', protocol: 'ftp', host: '127.0.0.1', port: CLOSED_PORT, user: 'alice', password: 'stored-pw', remoteDir: '/' },
    });
    const id = (created.json() as { target: { id: string } }).target.id;
    // No password in the body — it must come from the stored secret rather than 400.
    const res = await app.inject({ method: 'POST', url: testUrl(projectId), cookies: { sw_session: t }, payload: { id } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ok: boolean }).ok).toBe(false); // still a closed port
    expect((res.json() as { host: string }).host).toBe('127.0.0.1');
  });

  it('tests what is ON SCREEN: a field sent alongside an id overrides the stored value', async () => {
    const { t, projectId } = await setup('e@example.com', 'override');
    const created = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/deploy-targets`,
      cookies: { sw_session: t },
      payload: { name: 'FTP', protocol: 'ftp', host: '127.0.0.1', port: CLOSED_PORT, user: 'alice', password: 'pw', remoteDir: '/' },
    });
    const id = (created.json() as { target: { id: string } }).target.id;
    const res = await app.inject({
      method: 'POST',
      url: testUrl(projectId),
      cookies: { sw_session: t },
      payload: { id, host: '127.0.0.2' },
    });
    expect((res.json() as { host: string }).host).toBe('127.0.0.2');
  });

  it('refuses a target type that has no connection to test', async () => {
    const { t, projectId } = await setup('f@example.com', 'local-target');
    const created = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/deploy-targets`,
      cookies: { sw_session: t },
      payload: { name: 'Local', protocol: 'local' },
    });
    const id = (created.json() as { target: { id: string } }).target.id;
    const res = await app.inject({ method: 'POST', url: testUrl(projectId), cookies: { sw_session: t }, payload: { id } });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/no connection to test/);
  });

  it('requires a host and a user when nothing is saved to inherit from', async () => {
    const { t, projectId } = await setup('g@example.com', 'incomplete');
    const res = await app.inject({
      method: 'POST',
      url: testUrl(projectId),
      cookies: { sw_session: t },
      payload: { protocol: 'ftp', password: 'pw' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('needs a session', async () => {
    const { projectId } = await setup('h@example.com', 'anon');
    const res = await app.inject({ method: 'POST', url: testUrl(projectId), payload: { protocol: 'ftp', host: '127.0.0.1', user: 'a', password: 'b' } });
    expect([401, 403]).toContain(res.statusCode);
  });
});

describe('POST /deploy-targets/test — git targets', () => {
  /** Creates a saved git target and returns its id. */
  async function gitTarget(t: string, projectId: string, payload: Record<string, unknown>): Promise<string> {
    const created = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/deploy-targets`,
      cookies: { sw_session: t },
      payload: { name: 'Git', protocol: 'git', branch: 'gh-pages', ...payload },
    });
    expect(created.statusCode).toBe(201);
    return (created.json() as { target: { id: string } }).target.id;
  }

  it('reaches the real transport and reports a refused remote as a result', async () => {
    const { t, projectId } = await setup('j@example.com', 'git-refused');
    const id = await gitTarget(t, projectId, { repoUrl: `http://127.0.0.1:${CLOSED_PORT}/acme/site.git`, token: 'ghp_x' });
    const res = await app.inject({ method: 'POST', url: testUrl(projectId), cookies: { sw_session: t }, payload: { id } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; protocol: string; host: string; port: number; failure: { kind: string } };
    expect(body.ok).toBe(false);
    expect(body.protocol).toBe('git');
    expect(body.host).toBe('127.0.0.1');
    expect(body.port).toBe(443); // the endpoint a message may NAME, not the port in the URL
    expect(['refused', 'reset', 'timeout', 'unknown']).toContain(body.failure.kind);
  });

  it('tests what is on screen: an unsaved repository URL needs no saved target', async () => {
    const { t, projectId } = await setup('k@example.com', 'git-unsaved');
    const res = await app.inject({
      method: 'POST',
      url: testUrl(projectId),
      cookies: { sw_session: t },
      payload: { protocol: 'git', repoUrl: `http://127.0.0.1:${CLOSED_PORT}/acme/site.git`, branch: 'gh-pages', token: 'ghp_x' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ok: boolean }).ok).toBe(false);
  });

  it('requires a repository URL and a branch', async () => {
    const { t, projectId } = await setup('l@example.com', 'git-incomplete');
    const res = await app.inject({
      method: 'POST',
      url: testUrl(projectId),
      cookies: { sw_session: t },
      payload: { protocol: 'git', token: 'ghp_x' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/repository URL and a branch/);
  });

  // The credential has to match the remote's transport; mismatching them is answerable HERE rather
  // than as a confusing auth failure at the far end.
  it('refuses an SSH remote with no private key', async () => {
    const { t, projectId } = await setup('m@example.com', 'git-ssh-nokey');
    const res = await app.inject({
      method: 'POST',
      url: testUrl(projectId),
      cookies: { sw_session: t },
      payload: { protocol: 'git', repoUrl: 'git@github.com:acme/site.git', branch: 'gh-pages', token: 'ghp_x' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/private key/);
  });

  it('refuses an HTTPS remote with no token', async () => {
    const { t, projectId } = await setup('n@example.com', 'git-https-notoken');
    const res = await app.inject({
      method: 'POST',
      url: testUrl(projectId),
      cookies: { sw_session: t },
      payload: { protocol: 'git', repoUrl: 'https://github.com/acme/site.git', branch: 'gh-pages' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/access token/);
  });

  it('rejects a repository URL that is not a git remote', async () => {
    const { t, projectId } = await setup('o@example.com', 'git-badurl');
    const res = await app.inject({
      method: 'POST',
      url: testUrl(projectId),
      cookies: { sw_session: t },
      payload: { protocol: 'git', repoUrl: 'not a url', branch: 'gh-pages', token: 'ghp_x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('inherits the stored token, so an edit with a blank token is testable', async () => {
    const { t, projectId } = await setup('p@example.com', 'git-inherit');
    const id = await gitTarget(t, projectId, { repoUrl: `http://127.0.0.1:${CLOSED_PORT}/acme/site.git`, token: 'ghp_stored' });
    const res = await app.inject({
      method: 'POST',
      url: testUrl(projectId),
      cookies: { sw_session: t },
      payload: { id, branch: 'main' }, // only the branch changed on screen
    });
    expect(res.statusCode).toBe(200); // reached the transport — the token came from the stored secret
  });
});

describe('POST /deploy-targets/test — SSRF allow-list', () => {
  it('refuses a host outside the configured allow-list', async () => {
    await rm(publishRoot, { recursive: true, force: true });
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-dtt-'));
    db = await makeTestDb();
    app = await createApp({ db, publishRoot, encryptionKey, deployAllowedHosts: ['allowed.example.com'] });
    await app.ready();
    const { t, projectId } = await setup('i@example.com', 'ssrf');
    const res = await app.inject({
      method: 'POST',
      url: testUrl(projectId),
      cookies: { sw_session: t },
      payload: { protocol: 'ftp', host: '127.0.0.1', port: CLOSED_PORT, user: 'a', password: 'b' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('checks a git target against the REPOSITORY host, not the target host field', async () => {
    await rm(publishRoot, { recursive: true, force: true });
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-dtt-'));
    db = await makeTestDb();
    app = await createApp({ db, publishRoot, encryptionKey, deployAllowedHosts: ['allowed.example.com'] });
    await app.ready();
    const { t, projectId } = await setup('q@example.com', 'ssrf-git');
    const res = await app.inject({
      method: 'POST',
      url: testUrl(projectId),
      cookies: { sw_session: t },
      payload: { protocol: 'git', repoUrl: 'https://github.com/acme/site.git', branch: 'gh-pages', token: 'ghp_x' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /deploy-targets/test — rsync targets', () => {
  /**
   * ★ A TEST MUST NEVER BE REFUSED ON DESTRUCTIVE-COMBINATION GROUNDS.
   *
   * The deploy schema refuses rsync + pruning + a ROOT remoteDir without an explicit acknowledgement,
   * because that combination deletes every remote file the build does not contain. That guard is
   * right for a DEPLOY and meaningless for a test, which transfers nothing and prunes nothing — yet
   * the test route parsed the config through the same schema and inherited the refusal. The result
   * was that the default shape of a new rsync target (remoteDir "/", pruning on, not yet
   * acknowledged) could not be tested AT ALL, and the error it produced talked about deleting files,
   * which is the one thing a test does not do.
   */
  it('tests an rsync target at the ROOT with pruning on, instead of refusing', async () => {
    const { t, projectId } = await setup('r@example.com', 'rsync-root');
    const res = await app.inject({
      method: 'POST',
      url: testUrl(projectId),
      cookies: { sw_session: t },
      payload: {
        protocol: 'sftp',
        host: '127.0.0.1',
        port: CLOSED_PORT,
        user: 'alice',
        password: 'pw',
        remoteDir: '/',
        useRsync: true,
        rsyncDelete: true,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; failure?: { message: string } };
    expect(body.ok).toBe(false); // the port is closed — but it got as far as TRYING
    expect(body.failure?.message ?? '').not.toMatch(/deletes every remote file|mirror the whole root/i);
  });

  it('tests an rsync target at the root with pruning OFF too', async () => {
    const { t, projectId } = await setup('s@example.com', 'rsync-root-nodelete');
    const res = await app.inject({
      method: 'POST',
      url: testUrl(projectId),
      cookies: { sw_session: t },
      payload: { protocol: 'sftp', host: '127.0.0.1', port: CLOSED_PORT, user: 'alice', password: 'pw', remoteDir: '/', useRsync: true, rsyncDelete: false },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ok: boolean }).ok).toBe(false);
  });

  it('tests a SAVED rsync target that carries the root acknowledgement', async () => {
    const { t, projectId } = await setup('u@example.com', 'rsync-saved');
    const created = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/deploy-targets`,
      cookies: { sw_session: t },
      payload: {
        name: 'rsync',
        protocol: 'sftp',
        host: '127.0.0.1',
        port: CLOSED_PORT,
        user: 'alice',
        password: 'pw',
        remoteDir: '/',
        useRsync: true,
        rsyncDelete: true,
        rsyncRootDeleteAck: true,
      },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { target: { id: string } }).target.id;
    const res = await app.inject({ method: 'POST', url: testUrl(projectId), cookies: { sw_session: t }, payload: { id } });
    expect(res.statusCode).toBe(200);
  });
});
