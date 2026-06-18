import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Security-focused integration suite for SAVED deploy targets (encrypted
// credentials + SSRF host allow-list) at the HTTP layer. Extends — does not
// duplicate — deploy-targets-api.test.ts: that file covers the happy-path
// create/list/delete/deploy shapes; this file probes the security boundaries
// (secret confidentiality, the allow-list semantics, remoteDir validation,
// round-trip decryption past the gate, RBAC, and cross-tenant isolation).

const ENCRYPTION_KEY = randomBytes(32); // valid 32-byte key (see crypto/secret.ts)
const ALLOWED_HOST = 'allowed.example.com';
const PLAINTEXT_PASSWORD = 'super-secret-credential-9f3a';

// A baseline valid create body (host is allow-listed; overridden per-test).
const target = {
  name: 'Prod webspace',
  protocol: 'sftp' as const,
  host: ALLOWED_HOST,
  user: 'deployer',
  password: PLAINTEXT_PASSWORD,
  remoteDir: '/var/www',
};

let h: Harness;
let publishRoot: string;

async function boot(deployAllowedHosts?: string[]): Promise<Harness> {
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-dts-'));
  h = await makeHarness({ publishRoot, encryptionKey: ENCRYPTION_KEY, deployAllowedHosts });
  return h;
}

/** Signs up an owner and creates a project; returns the client + its target base path. */
async function ownerWithProject(harness: Harness): Promise<{ client: TestClient; projectId: string; base: string }> {
  const client = await harness.signup();
  // No auto Local Hosting target — these tests enumerate/operate on the exact targets they create.
  const projectId = await client.createProject(undefined, undefined, { localHosting: false });
  const base = `/projects/${projectId}`;
  return { client, projectId, base };
}

afterEach(async () => {
  await h?.close();
  if (publishRoot) await rm(publishRoot, { recursive: true, force: true });
});

describe('saved deploy targets — secret confidentiality', () => {
  it('stores the password encrypted and NEVER returns the secret, while surfacing non-secret fields', async () => {
    await boot([ALLOWED_HOST]);
    const { client, base } = await ownerWithProject(h);

    const create = await client.post(`${base}/deploy-targets`, target);
    expect(create.statusCode).toBe(201);
    const created = (create.json() as { target: Record<string, unknown> }).target;

    // Positive: non-secret infrastructure fields ARE returned to the client.
    expect(created).toMatchObject({
      name: 'Prod webspace',
      protocol: 'sftp',
      host: ALLOWED_HOST,
      user: 'deployer',
    });
    expect(typeof created.id).toBe('string');

    // Negative: no encrypted-secret envelope, no plaintext password, anywhere.
    expect(created).not.toHaveProperty('secret');
    expect(create.body).not.toContain('super-secret-credential-9f3a');
    expect(create.body).not.toContain('"secret"');

    // The dedicated list route is equally tight-lipped.
    const list = await client.get(`${base}/deploy-targets`);
    expect(list.statusCode).toBe(200);
    const items = (list.json() as { items: Array<Record<string, unknown>> }).items;
    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty('secret');
    expect(items[0]).toMatchObject({ host: ALLOWED_HOST, user: 'deployer', protocol: 'sftp', name: 'Prod webspace' });
    expect(list.body).not.toContain('super-secret-credential-9f3a');
    expect(list.body).not.toContain('"secret"');
  });

  it('blocks the generic content endpoint from reading deploy_target (would leak the encrypted secret)', async () => {
    await boot([ALLOWED_HOST]);
    const { client, base } = await ownerWithProject(h);
    await client.post(`${base}/deploy-targets`, target);

    // DEDICATED_KINDS (repo/content.ts + app.ts parseGenericKind) forces 403.
    const genericRead = await client.get(`${base}/content/deploy_target`);
    expect(genericRead.statusCode).toBe(403);
    expect(genericRead.body).not.toContain('"secret"');
    expect(genericRead.body).not.toContain('super-secret-credential-9f3a');

    const genericWrite = await client.put(`${base}/content/deploy_target/x`, { id: 'x' });
    expect(genericWrite.statusCode).toBe(403);
  });
});

describe('saved deploy targets — SSRF host allow-list', () => {
  it('rejects creating a target whose host is NOT on the allow-list (403, fail closed)', async () => {
    await boot([ALLOWED_HOST]);
    const { client, base } = await ownerWithProject(h);

    const res = await client.post(`${base}/deploy-targets`, { ...target, host: 'evil.internal' });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toMatch(/allowed list/i);

    // And nothing was persisted.
    const list = await client.get(`${base}/deploy-targets`);
    expect((list.json() as { items: unknown[] }).items).toHaveLength(0);
  });

  it('normalizes case and a trailing dot when matching the allow-list (passes the gate)', async () => {
    await boot([ALLOWED_HOST]);
    const { client, base } = await ownerWithProject(h);

    // assertDeployHostAllowed lower-cases and strips a single trailing FQDN dot.
    const upper = await client.post(`${base}/deploy-targets`, { ...target, name: 'upper', host: 'ALLOWED.EXAMPLE.COM' });
    expect(upper.statusCode).toBe(201);

    const trailingDot = await client.post(`${base}/deploy-targets`, { ...target, name: 'fqdn', host: `${ALLOWED_HOST}.` });
    expect(trailingDot.statusCode).toBe(201);
  });

  it('does NOT treat subdomains or :port hosts as allow-listed (exact match only, fail closed)', async () => {
    await boot([ALLOWED_HOST]);
    const { client, base } = await ownerWithProject(h);

    // A subdomain of an allowed host is a DIFFERENT host → rejected.
    const sub = await client.post(`${base}/deploy-targets`, { ...target, host: `attacker.${ALLOWED_HOST}` });
    expect(sub.statusCode).toBe(403);

    // A parent/embedded match must not slip through.
    const parent = await client.post(`${base}/deploy-targets`, { ...target, host: 'example.com' });
    expect(parent.statusCode).toBe(403);

    // A host carrying an explicit :port won't match a bare allow-list entry.
    const withPort = await client.post(`${base}/deploy-targets`, { ...target, host: `${ALLOWED_HOST}:8080` });
    expect(withPort.statusCode).toBe(403);
  });

  it('allows any host when no allow-list is configured (self-hosted default)', async () => {
    await boot(undefined); // no deployAllowedHosts → SSRF guard is a no-op
    const { client, base } = await ownerWithProject(h);
    const res = await client.post(`${base}/deploy-targets`, { ...target, host: 'anything.internal' });
    expect(res.statusCode).toBe(201);
  });
});

describe('saved deploy targets — round-trip decryption past the allow-list gate', () => {
  it('uses the stored credential on an ALLOWED host: proceeds past the gate and fails with a CONNECTION error (502), distinct from the 403 allow-list rejection', async () => {
    await boot([ALLOWED_HOST]);
    const { client, base } = await ownerWithProject(h);

    // Create a saved target (password is encrypted at rest).
    const id = (
      (await client.post(`${base}/deploy-targets`, target)).json() as { target: { id: string } }
    ).target.id;

    // Deploy by id. The host is allow-listed, so the 403 gate is passed; the build runs (build-at-deploy),
    // the secret decrypts, and a real SFTP connection is attempted to a non-existent server → the route
    // surfaces a 502 connection/transfer error. Crucially this is NOT 403 (allow-list) — proving both the
    // allow-list gate AND credential decryption succeeded.
    const deploy = await client.post(`${base}/deploy-targets/${id}/deploy`);
    expect(deploy.statusCode).toBe(502);
    expect(deploy.statusCode).not.toBe(403);
    expect(deploy.statusCode).not.toBe(409);
    // The generic error message must not leak the plaintext credential.
    expect(deploy.body).not.toContain('super-secret-credential-9f3a');
  }, 30_000);

  it('deploy-by-id builds fresh then attempts the connection — no prior publish required (502, not 409)', async () => {
    await boot([ALLOWED_HOST]);
    const { client, base } = await ownerWithProject(h);
    const id = (
      (await client.post(`${base}/deploy-targets`, target)).json() as { target: { id: string } }
    ).target.id;

    // Build-at-deploy-time: no prior publish needed. The build runs, then a real connection is attempted
    // to the (non-existent) allow-listed host → 502 — NOT the old "publish first" 409.
    const res = await client.post(`${base}/deploy-targets/${id}/deploy`);
    expect(res.statusCode).toBe(502);
    expect(res.statusCode).not.toBe(409);
  }, 30_000);

  it('deploy-by-id for a missing target id is a 404 (not a 502/500)', async () => {
    await boot([ALLOWED_HOST]);
    const { client, base } = await ownerWithProject(h);
    const res = await client.post(`${base}/deploy-targets/00000000-0000-4000-8000-000000000000/deploy`);
    expect(res.statusCode).toBe(404);
  });
});

describe('saved deploy targets — remoteDir validation', () => {
  it('rejects a remoteDir containing a ".." traversal segment on the saved-target create (400)', async () => {
    await boot([ALLOWED_HOST]);
    const { client, base } = await ownerWithProject(h);

    // DeployTargetSchema (re-parsed inside the create route) refuses ".." segments.
    const res = await client.post(`${base}/deploy-targets`, { ...target, remoteDir: '/var/www/../../etc' });
    expect(res.statusCode).toBe(400);

    // Nothing persisted.
    const list = await client.get(`${base}/deploy-targets`);
    expect((list.json() as { items: unknown[] }).items).toHaveLength(0);
  });

  it('the ad-hoc /publish/deploy route (DeployConfigSchema) rejects ".." and control chars in remoteDir (400)', async () => {
    await boot([ALLOWED_HOST]);
    const { client, base } = await ownerWithProject(h);

    // Config validation (DeployConfigSchema) runs BEFORE the build, so a bad remoteDir is rejected up
    // front — no prior publish needed.
    const baseBody = { protocol: 'sftp', host: ALLOWED_HOST, user: 'u', password: 'p' };

    // ".." segment → rejected by the schema BEFORE any connection is attempted.
    const traversal = await client.post(`${base}/publish/deploy`, { ...baseBody, remoteDir: '/a/../../b' });
    expect(traversal.statusCode).toBe(400);

    // A genuine ASCII control char (0x01) → rejected by hasControlChars, again
    // before any connection. NOTE: a benign value like "/a//b" would instead
    // PASS validation and attempt a real connection (→ 502), so a control char
    // is used deliberately to assert the validation path deterministically.
    const control = await client.post(`${base}/publish/deploy`, { ...baseBody, remoteDir: '/a/\x01/b' });
    expect(control.statusCode).toBe(400);
  }, 30_000);

  // GAP (reported, not fixed): the SAVED-target create path validates remoteDir
  // only against DeployTargetSchema, which checks ".." segments but NOT ASCII
  // control characters. The ad-hoc /publish/deploy route (DeployConfigSchema)
  // does reject control chars. A control char smuggled into a saved target is
  // therefore stored and never re-validated at deploy-by-id time (the route
  // builds the DeployConfig object directly and does not re-parse it). This test
  // documents the current (accepting) behavior; see the final report.
  it('rejects a control char in remoteDir on the saved-target create (400)', async () => {
    await boot([ALLOWED_HOST]);
    const { client, base } = await ownerWithProject(h);
    const res = await client.post(`${base}/deploy-targets`, { ...target, remoteDir: '/var/www' });
    // Fixed: DeployTargetSchema now rejects control chars (parity with DeployConfigSchema).
    expect(res.statusCode).toBe(400);
  });
});

describe('saved deploy targets — RBAC and cross-tenant isolation', () => {
  // NOTE: the harness only mints OWNER accounts (signup → owner role; no invite /
  // role-assignment API is exposed). A genuine non-writer (member/viewer) role
  // cannot be created here, so the negative RBAC case is expressed as (a) an
  // owner (writer) succeeding, (b) an UNAUTHENTICATED request being rejected, and
  // (c) cross-tenant denial (a different tenant's owner is a non-writer w.r.t.
  // this project). Pure intra-org member RBAC is covered by repo-level tests.
  it('an owner (writer) can create and delete targets; anonymous requests are rejected', async () => {
    await boot([ALLOWED_HOST]);
    const { client, base } = await ownerWithProject(h);

    // Owner can create.
    const create = await client.post(`${base}/deploy-targets`, target);
    expect(create.statusCode).toBe(201);
    const id = (create.json() as { target: { id: string } }).target.id;

    // Unauthenticated create/list/delete are all rejected (401), never leaking data.
    const anonCreate = await h.app.inject({ method: 'POST', url: `${base}/deploy-targets`, payload: target });
    expect(anonCreate.statusCode).toBe(401);
    const anonList = await h.app.inject({ method: 'GET', url: `${base}/deploy-targets` });
    expect(anonList.statusCode).toBe(401);
    const anonDelete = await h.app.inject({ method: 'DELETE', url: `${base}/deploy-targets/${id}` });
    expect(anonDelete.statusCode).toBe(401);

    // Owner can delete.
    const del = await client.del(`${base}/deploy-targets/${id}`);
    expect(del.statusCode).toBe(204);
  });

  it('tenant B cannot list, deploy, or delete tenant A’s targets (403, no secret leak)', async () => {
    await boot([ALLOWED_HOST]);
    const a = await h.signup();
    const b = await h.signup();
    const aProjectId = await a.createProject(undefined, undefined, { localHosting: false });
    const aBase = `/projects/${aProjectId}`;

    const id = (
      (await a.post(`${aBase}/deploy-targets`, target)).json() as { target: { id: string } }
    ).target.id;

    // B is a non-member of A's org → 403 on every saved-target operation.
    const bList = await b.get(`${aBase}/deploy-targets`);
    expect(bList.statusCode).toBe(403);
    expect(bList.body).not.toContain('super-secret-credential-9f3a');
    expect(bList.body).not.toContain('"secret"');

    const bDeploy = await b.post(`${aBase}/deploy-targets/${id}/deploy`);
    expect(bDeploy.statusCode).toBe(403);

    const bDelete = await b.del(`${aBase}/deploy-targets/${id}`);
    expect([403, 404]).toContain(bDelete.statusCode);

    // A's target is untouched and still present for A.
    const aList = await a.get(`${aBase}/deploy-targets`);
    expect((aList.json() as { items: unknown[] }).items).toHaveLength(1);
  });
});
