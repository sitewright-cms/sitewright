import { randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { createApp } from '../src/http/app.js';
import { makeTestDb } from './helpers.js';

const SESSION_COOKIE = 'sw_session';
type AppOptions = Parameters<typeof createApp>[0];
type Resp = LightMyRequestResponse;

/** Reads the session token from a response's Set-Cookie (unsigned test cookies). */
export function sessionToken(res: Resp): string {
  const c = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (!c?.value) throw new Error(`no ${SESSION_COOKIE} cookie (status ${res.statusCode})`);
  return c.value;
}

/** Content + publish helpers scoped to one project. */
export interface ProjectClient {
  readonly projectId: string;
  /** `/projects/<projectId>` */
  readonly base: string;
  putContent(kind: string, key: string, payload: unknown): Promise<Resp>;
  getContent(kind: string, key: string): Promise<Resp>;
  listContent(kind: string): Promise<Resp>;
  exportBundle(): Promise<Resp>;
  importBundle(bundle: unknown): Promise<Resp>;
}

/** A request client bound to one authenticated user (session auto-attached). */
export interface TestClient {
  readonly token: string;
  readonly userId: string;
  inject(opts: InjectOptions): Promise<Resp>;
  get(url: string): Promise<Resp>;
  post(url: string, payload?: unknown): Promise<Resp>;
  put(url: string, payload?: unknown): Promise<Resp>;
  del(url: string): Promise<Resp>;
  /** Creates a project owned by this client; returns its id. */
  createProject(name?: string, slug?: string): Promise<string>;
  /** A content/publish helper bound to a project the client can access. */
  project(projectId: string): ProjectClient;
}

export interface Harness {
  readonly app: FastifyInstance;
  /** Registers a fresh user and returns a client scoped to them. */
  signup(opts?: { email?: string; password?: string }): Promise<TestClient>;
  close(): Promise<void>;
}

/**
 * Boots a fully-migrated app over a unique temp DB and returns a harness whose
 * `signup()` yields isolated, session-scoped {@link TestClient}s. Consolidates
 * the register→project→token boilerplate so integration suites stay focused
 * on behavior (multi-tenancy, RBAC, publish, …). Pass `options` to override
 * AppOptions (e.g. `encryptionKey`, `deployAllowedHosts`, `buildRunner`).
 */
export async function makeHarness(options?: Partial<AppOptions>): Promise<Harness> {
  const db = await makeTestDb();
  // Disable the background maintenance timer by default (tests don't want a live interval); a test
  // can still override via options. The sweep function is unit-tested directly.
  const app = await createApp({ db, maintenanceSweepMs: 0, ...options } as AppOptions);
  await app.ready();

  async function signup(
    opts: { email?: string; password?: string } = {},
  ): Promise<TestClient> {
    const email = opts.email ?? `u-${randomUUID()}@test.local`;
    const password = opts.password ?? 'pw-secret-1';
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password },
    });
    if (res.statusCode !== 201) throw new Error(`register failed (${res.statusCode}): ${res.body}`);
    const token = sessionToken(res);
    const { userId } = res.json() as { userId: string };

    const inject = (o: InjectOptions): Promise<Resp> =>
      app.inject({ ...o, cookies: { ...(o.cookies ?? {}), [SESSION_COOKIE]: token } });

    const client: TestClient = {
      token,
      userId,
      inject,
      get: (url) => inject({ method: 'GET', url }),
      post: (url, payload) => inject({ method: 'POST', url, payload: payload as InjectOptions['payload'] }),
      put: (url, payload) => inject({ method: 'PUT', url, payload: payload as InjectOptions['payload'] }),
      del: (url) => inject({ method: 'DELETE', url }),
      async createProject(name = 'Site', slug = `s-${randomUUID().slice(0, 8)}`) {
        const r = await inject({
          method: 'POST',
          url: `/projects`,
          payload: { name, slug },
        });
        if (r.statusCode !== 200 && r.statusCode !== 201) {
          throw new Error(`createProject failed (${r.statusCode}): ${r.body}`);
        }
        return (r.json() as { project: { id: string } }).project.id;
      },
      project(projectId: string): ProjectClient {
        const base = `/projects/${projectId}`;
        return {
          projectId,
          base,
          putContent: (kind, key, payload) =>
            inject({ method: 'PUT', url: `${base}/content/${kind}/${key}`, payload: payload as InjectOptions['payload'] }),
          getContent: (kind, key) => inject({ method: 'GET', url: `${base}/content/${kind}/${key}` }),
          listContent: (kind) => inject({ method: 'GET', url: `${base}/content/${kind}` }),
          exportBundle: () => inject({ method: 'GET', url: `${base}/export` }),
          importBundle: (bundle) =>
            inject({ method: 'POST', url: `${base}/import`, payload: bundle as InjectOptions['payload'] }),
        };
      },
    };
    return client;
  }

  return { app, signup, close: () => app.close() };
}
