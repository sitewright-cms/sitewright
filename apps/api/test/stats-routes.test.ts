import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatsEngine } from '../src/analytics/engine.js';
import { isPrivateAddress, registerStatsRoutes, toCsv, type StatsSiteConfig } from '../src/analytics/routes.js';
import { StatsStore } from '../src/analytics/store.js';
import { statsRouteToken } from '../src/analytics/token.js';

// The collector in isolation: the order of its checks (what a stranger's request can make it do) and the
// one-time proxy warning. The full publish → beacon → stats loop is in stats-api.test.ts.

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const P = 'proj1';

describe('the collector route', () => {
  let engine: StatsEngine;
  let app: ReturnType<typeof Fastify>;
  const siteConfig = vi.fn<(id: string) => Promise<StatsSiteConfig | null>>();
  const warn = vi.fn<(m: string) => void>();

  beforeEach(async () => {
    engine = await StatsEngine.open({ store: await StatsStore.open(':memory:'), geo: { country: () => null }, secret: 's' });
    siteConfig.mockReset();
    siteConfig.mockResolvedValue({ enabled: true, platformHosts: new Set(['site.example']), ownHosts: new Set(['site.example']), restrictToOwnHosts: false });
    warn.mockReset();
    app = Fastify();
    registerStatsRoutes(app, {
      engine,
      siteConfig,
      resolveProject: async () => {
        throw new Error('not used');
      },
      formNames: async () => new Map(),
      notice: async () => undefined,
      trustProxy: false,
      warn,
      rl: () => ({ rateLimit: { max: 1000, timeWindow: '1 minute' } }),
    });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await engine.close();
  });

  const post = (body: unknown, remoteAddress = '203.0.113.9') =>
    app.inject({ method: 'POST', url: `/a/${P}`, headers: { 'content-type': 'text/plain', 'user-agent': CHROME }, payload: JSON.stringify(body), remoteAddress });

  it('★ checks the signature BEFORE touching the site config (a forged request costs no I/O)', async () => {
    expect((await post({ r: '/', k: 'forged-token-xxx', h: 'site.example' })).statusCode).toBe(204);
    expect(siteConfig).not.toHaveBeenCalled();
    expect((await post({ r: '/', k: statsRouteToken(engine.projectKey(P), '/'), h: 'site.example' })).statusCode).toBe(204);
    expect(siteConfig).toHaveBeenCalledWith(P);
  });

  it('warns ONCE when visits arrive from a private address with no trusted proxy configured', async () => {
    const good = { r: '/', k: statsRouteToken(engine.projectKey(P), '/'), h: 'site.example' };
    await post(good, '10.0.0.5');
    await post(good, '10.0.0.6');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('TRUST_PROXY');
  });

  it('does not warn for a public address', async () => {
    await post({ r: '/', k: statsRouteToken(engine.projectKey(P), '/'), h: 'site.example' });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('collector helpers', () => {
  it('recognises private and loopback addresses, v4 and v6', () => {
    for (const ip of ['10.1.2.3', '172.20.0.1', '192.168.1.1', '127.0.0.1', '::1', '::ffff:10.0.0.1', 'fd00::1']) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '2a00:1450::1', '::ffff:8.8.8.8', 'junk']) expect(isPrivateAddress(ip)).toBe(false);
  });

  it('writes RFC 4180 CSV and neutralizes spreadsheet formulas', () => {
    expect(toCsv([['a', 'b,c', 'd"e'], ['=1+1', '@x', 'ok']])).toBe('a,"b,c","d""e"\r\n\'=1+1,\'@x,ok\r\n');
  });
});
