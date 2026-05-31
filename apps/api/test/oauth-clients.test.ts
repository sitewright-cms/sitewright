import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './helpers.js';
import { OAuthClientRepository, OAuthClientError, isAcceptableRedirectUri } from '../src/repo/oauth-clients.js';
import type { Database } from '../src/db/client.js';

let db: Database;
let clients: OAuthClientRepository;

beforeEach(async () => {
  db = await makeTestDb();
  clients = new OAuthClientRepository(db);
});

describe('isAcceptableRedirectUri', () => {
  it('accepts https and loopback http; rejects everything else', () => {
    expect(isAcceptableRedirectUri('https://app.example.com/cb')).toBe(true);
    expect(isAcceptableRedirectUri('http://127.0.0.1:8976/cb')).toBe(true);
    expect(isAcceptableRedirectUri('http://localhost/cb')).toBe(true);
    expect(isAcceptableRedirectUri('http://evil.example.com/cb')).toBe(false); // non-loopback http
    expect(isAcceptableRedirectUri('https://app.example.com/cb#frag')).toBe(false); // fragment
    expect(isAcceptableRedirectUri('ftp://x/y')).toBe(false);
    expect(isAcceptableRedirectUri('not a url')).toBe(false);
    expect(isAcceptableRedirectUri(`https://x/${'a'.repeat(3000)}`)).toBe(false); // too long
  });
});

describe('OAuthClientRepository', () => {
  it('registers a public client and returns an opaque client_id', async () => {
    const client = await clients.register({ name: 'Claude', redirectUris: ['https://claude.ai/api/mcp/callback'] });
    expect(client.id).toMatch(/^swcid_/);
    expect(client.name).toBe('Claude');
    expect(client.redirectUris).toEqual(['https://claude.ai/api/mcp/callback']);
    const fetched = await clients.get(client.id);
    expect(fetched).toEqual(client);
  });

  it('returns null for an unknown client', async () => {
    expect(await clients.get('swcid_nope')).toBeNull();
  });

  it('rejects a missing/oversized name', async () => {
    await expect(clients.register({ name: '  ', redirectUris: ['https://a/b'] })).rejects.toThrow(OAuthClientError);
    await expect(clients.register({ name: 'x'.repeat(201), redirectUris: ['https://a/b'] })).rejects.toThrow(OAuthClientError);
  });

  it('rejects empty / too-many / invalid redirect URIs', async () => {
    await expect(clients.register({ name: 'A', redirectUris: [] })).rejects.toThrow(OAuthClientError);
    await expect(
      clients.register({ name: 'A', redirectUris: Array.from({ length: 6 }, (_, i) => `https://a/${i}`) }),
    ).rejects.toThrow(OAuthClientError);
    await expect(clients.register({ name: 'A', redirectUris: ['http://evil.example.com/cb'] })).rejects.toThrow(
      OAuthClientError,
    );
  });
});
