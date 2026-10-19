import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundledGeoDbPath, createGeoLookup } from '../src/analytics/geo.js';
import { statsProjectKey, statsRouteOf, statsRouteToken, verifyStatsRouteToken } from '../src/analytics/token.js';

describe('the country lookup', () => {
  it('★ resolves countries from the BUNDLED DB-IP database', async () => {
    const geo = createGeoLookup(bundledGeoDbPath());
    await geo.load();
    expect(geo.country('8.8.8.8')).toBe('US');
    // heise.de, a German publisher on German address space.
    expect(geo.country('193.99.144.80')).toBe('DE');
    expect(geo.country('2a00:1450:4001:80b::200e')).toMatch(/^[A-Z]{2}$/);
  });

  it('reads an IPv4-mapped IPv6 address as IPv4 (what a dual-stack socket reports)', async () => {
    const geo = createGeoLookup(bundledGeoDbPath());
    await geo.load();
    expect(geo.country('::ffff:8.8.8.8')).toBe('US');
  });

  it('has no country for a private address or a non-address', async () => {
    const geo = createGeoLookup(bundledGeoDbPath());
    await geo.load();
    expect(geo.country('127.0.0.1')).toBeNull();
    expect(geo.country('10.1.2.3')).toBeNull();
    expect(geo.country('not-an-ip')).toBeNull();
    expect(geo.country('')).toBeNull();
  });

  it('★ loads lazily: nothing is read until the first lookup, which starts the load', async () => {
    const geo = createGeoLookup(bundledGeoDbPath());
    // The very first lookup cannot wait for an 8 MB read; it answers unknown and starts the load.
    expect(geo.country('8.8.8.8')).toBeNull();
    await geo.load();
    expect(geo.country('8.8.8.8')).toBe('US');
  });

  it('★ an unreadable database disables countries instead of failing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sw-geo-'));
    try {
      const errors: unknown[] = [];
      const missing = createGeoLookup(join(dir, 'missing.mmdb'), (e) => errors.push(e));
      await missing.load();
      expect(missing.country('8.8.8.8')).toBeNull();
      const junk = join(dir, 'junk.mmdb');
      await writeFile(junk, 'not a database');
      const broken = createGeoLookup(junk, (e) => errors.push(e));
      await broken.load();
      expect(broken.country('8.8.8.8')).toBeNull();
      expect(errors).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('route signatures', () => {
  const key = statsProjectKey('instance-secret', 'proj1');

  it('verifies the signature the publisher made, and nothing else', () => {
    const token = statsRouteToken(key, '/about/');
    expect(verifyStatsRouteToken(key, '/about/', token)).toBe(true);
    expect(verifyStatsRouteToken(key, '/other/', token)).toBe(false);
    expect(verifyStatsRouteToken(key, '/about/', `${token.slice(0, -1)}x`)).toBe(false);
    expect(verifyStatsRouteToken(key, '/about/', token.slice(0, 10))).toBe(false);
    expect(verifyStatsRouteToken(key, '/about/', '')).toBe(false);
  });

  it('★ binds a signature to its project', () => {
    const other = statsProjectKey('instance-secret', 'proj2');
    expect(verifyStatsRouteToken(other, '/about/', statsRouteToken(key, '/about/'))).toBe(false);
  });

  it('normalizes a served path to the signed route', () => {
    expect(statsRouteOf('')).toBe('/');
    expect(statsRouteOf('index.html')).toBe('/');
    expect(statsRouteOf('about')).toBe('/about/');
    expect(statsRouteOf('about/')).toBe('/about/');
    expect(statsRouteOf('de/about/index.html')).toBe('/de/about/');
    expect(statsRouteOf('v1.2/')).toBe('/v1.2/');
    expect(statsRouteOf('../etc/')).toBeNull();
    expect(statsRouteOf('other.html')).toBeNull();
  });
});
