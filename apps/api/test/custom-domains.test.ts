import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeHost, reservedHostReason } from '../src/repo/project-domains.js';
import { verifyDomainTxt } from '../src/net/dns-verify.js';
import { makeHarness, type Harness, type TestClient } from './harness.js';

const CANONICAL = 'https://cms.agency.test';
const SITES_DOMAIN = 'sites.agency.test';

describe('custom domains — host normalization', () => {
  it('accepts a hostname, a pasted URL, and tolerates case / trailing dot / trailing slash', () => {
    expect(normalizeHost('WWW.Client.com')).toBe('www.client.com');
    expect(normalizeHost('https://WWW.Client.com/some/path')).toBe('www.client.com');
    expect(normalizeHost('www.client.com.')).toBe('www.client.com');
    expect(normalizeHost('  client.com  ')).toBe('client.com');
  });

  it('refuses what could never be a Host a browser sends for a real site', () => {
    for (const bad of [
      '',
      'localhost', // single label
      '*.client.com', // wildcard — a row that can never match a request
      '203.0.113.9', // IP literal — no certificate can be issued for one
      'client.com:8443', // a port is not part of a routable Host here
      '_dmarc.client.com', // underscore label
      'a..b.com',
      `${'x'.repeat(64)}.com`, // label over 63 chars
    ]) {
      expect(normalizeHost(bad), bad).toBeNull();
    }
  });
});

describe('custom domains — hosts the instance owns', () => {
  it('refuses a platform origin host (claiming it would take the app offline)', () => {
    expect(reservedHostReason('cms.agency.test', { platformHosts: ['cms.agency.test'] })).toMatch(/platform itself/);
  });

  it('refuses anything inside the hosted-sites domain, apex included', () => {
    const ctx = { sitesDomain: SITES_DOMAIN };
    // That namespace is addressed BY PROJECT SLUG already — a claim here would shadow or be shadowed.
    expect(reservedHostReason(`othersite.${SITES_DOMAIN}`, ctx)).toMatch(/addressed by their project slug/);
    expect(reservedHostReason(SITES_DOMAIN, ctx)).toMatch(/addressed by their project slug/);
  });

  it('allows an ordinary client domain', () => {
    expect(reservedHostReason('www.client.com', { platformHosts: ['cms.agency.test'], sitesDomain: SITES_DOMAIN })).toBeNull();
  });
});

describe('custom domains — DNS TXT verification', () => {
  const TOKEN = 'sw-verify-abc123';

  it('verifies when the record carries the token', async () => {
    const res = await verifyDomainTxt('client.com', TOKEN, async () => [[TOKEN]]);
    expect(res.ok).toBe(true);
  });

  it('★ joins a CHUNKED TXT value before comparing', async () => {
    // DNS returns a long TXT value as several strings. Comparing the first chunk alone would reject a
    // perfectly correct record, and the operator would have no way to tell why.
    const res = await verifyDomainTxt('client.com', TOKEN, async () => [['sw-verify-', 'abc123']]);
    expect(res.ok).toBe(true);
  });

  it('checks EVERY record, since other vendors verify on the same name', async () => {
    const res = await verifyDomainTxt('client.com', TOKEN, async () => [['google-site-verification=x'], [TOKEN]]);
    expect(res.ok).toBe(true);
  });

  it('reports a missing record as PENDING, not failed', async () => {
    // The normal state for the first minutes after a DNS edit. Calling it a failure sends the operator
    // re-editing a record that is already right.
    const notFound = Object.assign(new Error('nope'), { code: 'ENOTFOUND' });
    const res = await verifyDomainTxt('client.com', TOKEN, async () => {
      throw notFound;
    });
    expect(res).toMatchObject({ ok: false, state: 'pending' });
  });

  it('reports a resolver timeout as PENDING', async () => {
    const timeout = Object.assign(new Error('slow'), { code: 'ETIMEOUT' });
    const res = await verifyDomainTxt('client.com', TOKEN, async () => {
      throw timeout;
    });
    expect(res).toMatchObject({ ok: false, state: 'pending' });
  });

  it('reports a record with the WRONG value as failed (that one is actionable)', async () => {
    const res = await verifyDomainTxt('client.com', TOKEN, async () => [['sw-verify-truncated']]);
    expect(res).toMatchObject({ ok: false, state: 'failed' });
  });

  it('asks for the token at _sitewright.<host>', async () => {
    let asked = '';
    await verifyDomainTxt('client.com', TOKEN, async (name) => {
      asked = name;
      return [[TOKEN]];
    });
    expect(asked).toBe('_sitewright.client.com');
  });
});

describe('custom domains — claim, verify, serve-eligibility (end to end)', () => {
  let harness: Harness;
  let owner: TestClient;
  let projectId: string;
  let txt: string[][] = [];

  beforeEach(async () => {
    txt = [];
    harness = await makeHarness({
      encryptionKey: randomBytes(32),
      publicUrl: CANONICAL,
      sitesDomain: SITES_DOMAIN,
      txtLookup: async () => txt,
    });
    owner = await harness.signup({ admin: true });
    projectId = await owner.createProject('Client Site', 'client-site');
  });
  afterEach(async () => {
    await harness.close();
  });

  /** Claims a host and returns the created row. */
  async function claim(host: string) {
    const res = await owner.post(`/projects/${projectId}/domains`, { host });
    return { status: res.statusCode, body: res.json() };
  }

  it('claims a host, stores it normalized, and hands back the exact DNS record to publish', async () => {
    const { status, body } = await claim('https://WWW.Client.com/');
    expect(status).toBe(201);
    expect(body.domain).toMatchObject({ host: 'www.client.com', verified: false, isPrimary: true });
    // The UI must never have to build this itself.
    expect(body.domain.dns).toMatchObject({ type: 'TXT', name: '_sitewright.www.client.com' });
    expect(body.domain.dns.value).toBe(body.domain.verificationToken);
  });

  it('a claim does NOT serve until it verifies', async () => {
    await claim('www.client.com');
    const list = (await owner.get(`/projects/${projectId}/domains`)).json().items;
    expect(list[0].verified).toBe(false);

    // Verification with no record published: pending, 200, and still not serving.
    const res = await owner.post(`/projects/${projectId}/domains/${list[0].id}/verify`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ verified: false, state: 'pending' });
  });

  it('verifies once the TXT record is published', async () => {
    const { body } = await claim('www.client.com');
    txt = [[body.domain.verificationToken]];
    const res = await owner.post(`/projects/${projectId}/domains/${body.domain.id}/verify`);
    expect(res.json()).toMatchObject({ verified: true });
    expect(res.json().domain.verifiedAt).not.toBeNull();
  });

  it('refuses a host the platform itself answers on', async () => {
    const res = await claim('cms.agency.test');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/platform itself/);
  });

  it('refuses a host inside the hosted-sites domain', async () => {
    const res = await claim(`other.${SITES_DOMAIN}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/project slug/);
  });

  it('refuses an approved ADDITIONAL platform hostname too (read live, not at boot)', async () => {
    await owner.put('/admin/settings', { additionalOrigins: ['https://edit.clientbrand.test'] });
    const res = await claim('edit.clientbrand.test');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/platform itself/);
  });

  // ── who may hold a host ───────────────────────────────────────────────────────────────────────────

  it('★ an UNVERIFIED claim does not block another project — DNS control is the tiebreaker', async () => {
    // Otherwise the first project to type a client's domain locks everyone else out of it permanently,
    // having proved nothing at all.
    await claim('www.contested.com');
    const second = await owner.createProject('Rival', 'rival');
    const res = await owner.post(`/projects/${second}/domains`, { host: 'www.contested.com' });
    expect(res.statusCode).toBe(201);

    // …and the displaced claim is gone, so the UNIQUE index never sees two rows for one host.
    expect((await owner.get(`/projects/${projectId}/domains`)).json().items).toHaveLength(0);
  });

  it('a VERIFIED claim DOES block another project (somebody proved DNS control)', async () => {
    const { body } = await claim('www.proven.com');
    txt = [[body.domain.verificationToken]];
    await owner.post(`/projects/${projectId}/domains/${body.domain.id}/verify`);

    const second = await owner.createProject('Rival 2', 'rival-2');
    const res = await owner.post(`/projects/${second}/domains`, { host: 'www.proven.com' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/verified by another project/);
  });

  it('refuses a re-claim of a host this project already holds', async () => {
    await claim('www.client.com');
    const again = await claim('www.client.com');
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already claimed by this project/);
  });

  // ── primary ───────────────────────────────────────────────────────────────────────────────────────

  it('the first host is primary; promoting another demotes it in one move', async () => {
    const first = (await claim('client.com')).body.domain;
    const second = (await claim('www.client.com')).body.domain;
    expect(first.isPrimary).toBe(true);
    expect(second.isPrimary).toBe(false);

    const res = await owner.put(`/projects/${projectId}/domains/${second.id}/primary`);
    const byHost = new Map(res.json().items.map((d: { host: string; isPrimary: boolean }) => [d.host, d.isPrimary]));
    expect(byHost.get('www.client.com')).toBe(true);
    expect(byHost.get('client.com')).toBe(false);
  });

  it('releasing the primary promotes the oldest survivor rather than leaving none', async () => {
    const first = (await claim('client.com')).body.domain;
    await claim('www.client.com');
    await owner.del(`/projects/${projectId}/domains/${first.id}`);
    const items = (await owner.get(`/projects/${projectId}/domains`)).json().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ host: 'www.client.com', isPrimary: true });
  });

  it('releasing frees the host for another project', async () => {
    const d = (await claim('www.movable.com')).body.domain;
    txt = [[d.verificationToken]];
    await owner.post(`/projects/${projectId}/domains/${d.id}/verify`);
    await owner.del(`/projects/${projectId}/domains/${d.id}`);

    const second = await owner.createProject('New Home', 'new-home');
    expect((await owner.post(`/projects/${second}/domains`, { host: 'www.movable.com' })).statusCode).toBe(201);
  });

  // ── authorization ─────────────────────────────────────────────────────────────────────────────────

  it('is OWNER-only: a project member cannot claim a domain', async () => {
    const member = await harness.signup();
    await owner.post(`/projects/${projectId}/members`, { email: 'nobody@test.local', role: 'member' }).catch(() => undefined);
    const res = await member.post(`/projects/${projectId}/domains`, { host: 'www.sneaky.com' });
    expect([403, 404]).toContain(res.statusCode);
  });

  it('★ force-verify is PLATFORM STAFF only — a non-staff project OWNER cannot bypass the DNS check', async () => {
    const { body } = await claim('www.client.com');

    // The case the guard exists for: an invited CLIENT holding project `owner` (the invite role allows
    // it). They legitimately manage this project's domains — but force-verify is the one call that
    // asserts ownership of a hostname with no evidence, so it stays with the agency.
    // Planted directly: members join by invite, and a plain signup that CREATES a project is promoted to
    // `developer` by the harness, which would make it staff and void the test.
    const client = await harness.signup({ email: 'client@test.local' });
    await harness.db.run(
      sql`insert into project_members (id, user_id, project_id, role, created_at)
          values (${'pm-client'}, ${client.userId}, ${projectId}, ${'owner'}, ${Date.now()})`,
    );
    // They really are a project owner — the owner-only read succeeds.
    expect((await client.get(`/projects/${projectId}/domains`)).statusCode).toBe(200);

    const res = await client.post(`/projects/${projectId}/domains/${body.domain.id}/force-verify`);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/force-verify a custom domain/);
    // …and nothing was verified by the attempt.
    expect((await owner.get(`/projects/${projectId}/domains`)).json().items[0].verified).toBe(false);

    // Staff can — with no DNS record published at all.
    expect(txt).toEqual([]);
    const forced = await owner.post(`/projects/${projectId}/domains/${body.domain.id}/force-verify`);
    expect(forced.statusCode).toBe(200);
    expect(forced.json()).toMatchObject({ verified: true });
  });

  // ── lifecycle invariants ──────────────────────────────────────────────────────────────────────────

  it('a reaped project takes its domain rows with it (the FK has no CASCADE)', async () => {
    await claim('www.client.com');
    await owner.del(`/projects/${projectId}`); // soft delete
    const reap = await owner.del(`/admin/deleted-projects/${projectId}`);
    expect([200, 204]).toContain(reap.statusCode);

    const left = (await harness.db.all(sql`select count(*) as n from project_domains where project_id = ${projectId}`)) as Array<{ n: number }>;
    expect(Number(left[0]?.n ?? 0)).toBe(0);
  });

  it('a custom domain does not travel with an export', async () => {
    await claim('www.client.com');
    const bundle = (await owner.project(projectId).exportBundle()).json();
    expect(JSON.stringify(bundle)).not.toContain('www.client.com');
  });
});
