import { describe, it, expect } from 'vitest';
import { resolveRuntimeConfig } from '../src/config.js';
import { DEFAULT_ADMIN_EMAIL } from '../src/seed.js';

// A valid 32-byte base64 encryption key for the parse tests.
const KEY32 = Buffer.alloc(32, 7).toString('base64');

describe('resolveRuntimeConfig — NODE_ENV defaults to production', () => {
  it('treats an UNSET NODE_ENV as production (hardened by default)', () => {
    const cfg = resolveRuntimeConfig({});
    expect(cfg.nodeEnv).toBe('production');
    expect(cfg.isProduction).toBe(true);
  });

  it('treats an empty / whitespace NODE_ENV as production', () => {
    expect(resolveRuntimeConfig({ NODE_ENV: '' }).isProduction).toBe(true);
    expect(resolveRuntimeConfig({ NODE_ENV: '   ' }).isProduction).toBe(true);
  });

  it('honors an explicit non-production NODE_ENV', () => {
    expect(resolveRuntimeConfig({ NODE_ENV: 'development' }).isProduction).toBe(false);
    expect(resolveRuntimeConfig({ NODE_ENV: 'test' }).isProduction).toBe(false);
    expect(resolveRuntimeConfig({ NODE_ENV: 'production' }).isProduction).toBe(true);
  });
});

describe('resolveRuntimeConfig — secure cookies derive from the hosting URL', () => {
  it('an https SW_PUBLIC_URL turns Secure cookies ON with no separate flag', () => {
    expect(resolveRuntimeConfig({ SW_PUBLIC_URL: 'https://app.example.com' }).secureCookies).toBe(true);
  });

  it('an http SW_PUBLIC_URL keeps Secure cookies OFF', () => {
    expect(resolveRuntimeConfig({ SW_PUBLIC_URL: 'http://dind.local:2003' }).secureCookies).toBe(false);
  });

  it('defaults Secure cookies OFF when no hosting URL is given', () => {
    expect(resolveRuntimeConfig({}).secureCookies).toBe(false);
  });

  it('an explicit COOKIE_SECURE always wins over the derived value', () => {
    expect(resolveRuntimeConfig({ COOKIE_SECURE: 'true' }).secureCookies).toBe(true);
    expect(
      resolveRuntimeConfig({ COOKIE_SECURE: 'false', SW_PUBLIC_URL: 'https://app.example.com' }).secureCookies,
    ).toBe(false);
  });
});

describe('resolveRuntimeConfig — WebAuthn RP derives from the hosting URL', () => {
  it('derives rpId + origin from SW_PUBLIC_URL', () => {
    const cfg = resolveRuntimeConfig({ SW_PUBLIC_URL: 'https://app.example.com' });
    expect(cfg.webauthnRpId).toBe('app.example.com');
    expect(cfg.webauthnOrigin).toBe('https://app.example.com');
  });

  it('explicit SW_WEBAUTHN_* overrides win', () => {
    const cfg = resolveRuntimeConfig({
      SW_PUBLIC_URL: 'https://app.example.com',
      SW_WEBAUTHN_RP_ID: 'example.com',
      SW_WEBAUTHN_ORIGIN: 'https://login.example.com',
    });
    expect(cfg.webauthnRpId).toBe('example.com');
    expect(cfg.webauthnOrigin).toBe('https://login.example.com');
  });

  it('leaves rpId/origin undefined (request-derived downstream) when nothing is set', () => {
    const cfg = resolveRuntimeConfig({});
    expect(cfg.webauthnRpId).toBeUndefined();
    expect(cfg.webauthnOrigin).toBeUndefined();
  });
});

describe('resolveRuntimeConfig — data roots derive ONLY from SW_DATA_DIR', () => {
  it('derives every sub-root from SW_DATA_DIR', () => {
    const cfg = resolveRuntimeConfig({ SW_DATA_DIR: '/srv/data' });
    expect(cfg.dataDir).toBe('/srv/data');
    expect(cfg.mediaRoot).toBe('/srv/data/media');
    expect(cfg.publishRoot).toBe('/srv/data/sites');
    expect(cfg.previewRoot).toBe('/srv/data/preview');
    expect(cfg.sourceRefRoot).toBe('/srv/data/source-refs');
    expect(cfg.databaseUrl).toBe('file:/srv/data/sitewright.db');
  });

  it('IGNORES the retired per-root overrides (MEDIA_ROOT etc.)', () => {
    const cfg = resolveRuntimeConfig({ SW_DATA_DIR: '/srv/data', MEDIA_ROOT: '/somewhere/else' });
    expect(cfg.mediaRoot).toBe('/srv/data/media');
  });

  it('still honors an explicit DATABASE_URL override', () => {
    const cfg = resolveRuntimeConfig({ SW_DATA_DIR: '/srv/data', DATABASE_URL: 'file:/mnt/db.sqlite' });
    expect(cfg.databaseUrl).toBe('file:/mnt/db.sqlite');
  });
});

describe('resolveRuntimeConfig — validation + misc parsing', () => {
  it('throws on a malformed SW_PUBLIC_URL', () => {
    expect(() => resolveRuntimeConfig({ SW_PUBLIC_URL: 'not a url' })).toThrow(/SW_PUBLIC_URL/);
  });

  it('throws on a non-http(s) SW_PUBLIC_URL', () => {
    expect(() => resolveRuntimeConfig({ SW_PUBLIC_URL: 'ftp://host' })).toThrow(/http\(s\)/);
  });

  it('parses a valid encryption key and rejects a wrong-length one', () => {
    expect(resolveRuntimeConfig({ SW_ENCRYPTION_KEY: KEY32 }).encryptionKey?.length).toBe(32);
    expect(() => resolveRuntimeConfig({ SW_ENCRYPTION_KEY: 'deadbeef' })).toThrow(/encryption key/);
  });

  it('parses + normalizes the deploy/SMTP host allowlists', () => {
    const cfg = resolveRuntimeConfig({ SW_DEPLOY_ALLOWED_HOSTS: 'A.com, b.com.,' });
    expect(cfg.deployAllowedHosts).toEqual(['a.com', 'b.com']);
  });

  it('defaults PORT to 2002 and seed admin email to the well-known default', () => {
    const cfg = resolveRuntimeConfig({});
    expect(cfg.port).toBe(2002);
    expect(cfg.seedAdminEmail).toBe(DEFAULT_ADMIN_EMAIL);
    expect(cfg.version).toBe('0.0.0');
    expect(cfg.disableUpdateCheck).toBe(false);
  });

  it('trims a provided seed admin email and reads SW_VERSION / update-check flag', () => {
    const cfg = resolveRuntimeConfig({
      SW_ADMIN_EMAIL: '  owner@agency.io ',
      SW_VERSION: '1.4.0',
      SW_DISABLE_UPDATE_CHECK: 'true',
    });
    expect(cfg.seedAdminEmail).toBe('owner@agency.io');
    expect(cfg.version).toBe('1.4.0');
    expect(cfg.disableUpdateCheck).toBe(true);
  });
});
