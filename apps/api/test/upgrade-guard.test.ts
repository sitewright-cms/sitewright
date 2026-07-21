import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './helpers.js';
import { registerAccount } from '../src/repo/accounts.js';
import {
  evaluateUpgrade,
  readDataMigrationVersion,
  stampDataMigrationVersion,
  checkUpgradePath,
  DATA_MIGRATION_VERSION,
  MIN_UPGRADE_FROM,
} from '../src/db/upgrade-guard.js';
import { buildUpgradeBlockedApp } from '../src/http/upgrade-blocked.js';

let db: Awaited<ReturnType<typeof makeTestDb>>;
beforeEach(async () => {
  db = await makeTestDb();
});

describe('evaluateUpgrade (pure decision)', () => {
  it('allows when the stamp is at/above the minimum', () => {
    expect(evaluateUpgrade(2, true, 2)).toEqual({ blocked: false });
    expect(evaluateUpgrade(5, true, 2)).toEqual({ blocked: false });
  });
  it('BLOCKS an over-old instance that already holds data', () => {
    const d = evaluateUpgrade(0, true, 2, 'v0.3.0');
    expect(d.blocked).toBe(true);
    if (d.blocked) {
      expect(d.message).toContain('data version 0');
      expect(d.message).toContain('data version 2');
      expect(d.message).toContain('v0.3.0'); // tells the operator where to step through
      expect(d.message).toContain('not been touched');
    }
  });
  it('NEVER blocks a fresh DB (no projects yet), even below the minimum', () => {
    expect(evaluateUpgrade(0, false, 2)).toEqual({ blocked: false });
  });
  it('with the shipped MIN_UPGRADE_FROM (0) nothing is ever blocked', () => {
    expect(MIN_UPGRADE_FROM).toBe(0);
    expect(evaluateUpgrade(0, true).blocked).toBe(false);
  });
});

describe('data-migration version stamp (PRAGMA user_version)', () => {
  it('reads 0 on a fresh DB, round-trips a stamp, and is monotonic (never lowers)', async () => {
    expect(await readDataMigrationVersion(db)).toBe(0);
    await stampDataMigrationVersion(db, 2);
    expect(await readDataMigrationVersion(db)).toBe(2);
    // A lower stamp (e.g. an older build) must NOT lower it.
    await stampDataMigrationVersion(db, 1);
    expect(await readDataMigrationVersion(db)).toBe(2);
    // A higher one advances it.
    await stampDataMigrationVersion(db, 3);
    expect(await readDataMigrationVersion(db)).toBe(3);
  });
  it('stamps the current DATA_MIGRATION_VERSION by default', async () => {
    await stampDataMigrationVersion(db);
    expect(await readDataMigrationVersion(db)).toBe(DATA_MIGRATION_VERSION);
  });
});

describe('checkUpgradePath (wired to the DB)', () => {
  it('does not block a fresh, unstamped DB (shipped MIN_UPGRADE_FROM=0)', async () => {
    expect(await checkUpgradePath(db)).toEqual({ blocked: false });
  });
  it('does not block a stamped-current DB', async () => {
    await stampDataMigrationVersion(db);
    expect(await checkUpgradePath(db)).toEqual({ blocked: false });
  });

  // Exercise the DB-querying branch that only fires once MIN_UPGRADE_FROM > 0 (injected here).
  it('BLOCKS an old (stamp 0) instance that has users, under an injected minFrom', async () => {
    await registerAccount(db, 'op@acme.test', 'Pw-secret-1', { platformRole: 'developer' });
    const d = await checkUpgradePath(db, { minFrom: 2 });
    expect(d.blocked).toBe(true);
  });
  it('does NOT block a fresh (no users) DB even under an injected minFrom', async () => {
    expect(await checkUpgradePath(db, { minFrom: 2 })).toEqual({ blocked: false });
  });
  it('does not block a stamped-current DB even with users + an injected minFrom', async () => {
    await registerAccount(db, 'op2@acme.test', 'Pw-secret-1', { platformRole: 'developer' });
    await stampDataMigrationVersion(db, 2);
    expect(await checkUpgradePath(db, { minFrom: 2 })).toEqual({ blocked: false });
  });
});

describe('buildUpgradeBlockedApp (maintenance server)', () => {
  const MSG = 'Roll back to v0.3.0 first.';
  it('serves an HTML maintenance page (503) to a browser and JSON (503) to an API client', async () => {
    const app = buildUpgradeBlockedApp(MSG, '9.9.9');
    await app.ready();

    const page = await app.inject({ method: 'GET', url: '/', headers: { accept: 'text/html' } });
    expect(page.statusCode).toBe(503);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('Upgrade blocked');
    expect(page.body).toContain(MSG);
    // Baseline security headers (defense-in-depth; the page is scriptless + unframeable).
    expect(page.headers['x-content-type-options']).toBe('nosniff');
    expect(page.headers['x-frame-options']).toBe('DENY');
    expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'");

    const apiHit = await app.inject({ method: 'GET', url: '/projects', headers: { accept: 'application/json' } });
    expect(apiHit.statusCode).toBe(503);
    expect(apiHit.json()).toMatchObject({ status: 'upgrade-blocked', error: MSG });

    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toMatchObject({ status: 'upgrade-blocked' });

    const version = await app.inject({ method: 'GET', url: '/version' });
    expect(version.statusCode).toBe(200);
    expect(version.json()).toMatchObject({ current: '9.9.9', status: 'upgrade-blocked' });

    // Liveness stays GREEN (200) so an orchestrator doesn't restart-loop the deliberately-blocked pod.
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ ok: true });
    await app.close();
  });
  it('escapes HTML in the message (no injection into the page)', async () => {
    const app = buildUpgradeBlockedApp('<script>alert(1)</script>', '1.0.0');
    await app.ready();
    const page = await app.inject({ method: 'GET', url: '/', headers: { accept: 'text/html' } });
    expect(page.body).not.toContain('<script>alert(1)</script>');
    expect(page.body).toContain('&lt;script&gt;');
    await app.close();
  });
});
