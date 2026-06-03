import { describe, it, expect } from 'vitest';
import type { FetchLike } from '../src/client.js';
import { deviceLogin, refreshAccess, OAuthLoginError, CLI_CLIENT_ID } from '../src/oauth.js';

const URL = 'http://dind.local:2003';

/** Build a FetchLike that returns scripted responses keyed by which endpoint is hit. */
function fetchStub(
  handler: (path: string, fields: Record<string, string>) => { status: number; body: unknown },
): { impl: FetchLike; calls: Array<{ path: string; fields: Record<string, string> }> } {
  const calls: Array<{ path: string; fields: Record<string, string> }> = [];
  const impl: FetchLike = async (input, init) => {
    const path = input.replace(/^https?:\/\/[^/]+/, '');
    const fields = Object.fromEntries(new URLSearchParams(init?.body ?? '').entries());
    calls.push({ path, fields });
    const r = handler(path, fields);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: '',
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
    };
  };
  return { impl, calls };
}

const noSleep = async () => {};
const clock = (start = 0) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

describe('deviceLogin (RFC 8628)', () => {
  it('requests a code, notifies the user, polls past authorization_pending, returns tokens', async () => {
    let polls = 0;
    const { impl, calls } = fetchStub((path) => {
      if (path === '/oauth/device_authorization') {
        return { status: 200, body: { device_code: 'dev-1', user_code: 'ABCD-1234', verification_uri: `${URL}/oauth/device`, verification_uri_complete: `${URL}/oauth/device?user_code=ABCD-1234`, interval: 1, expires_in: 300 } };
      }
      // First two polls pending, then approved.
      polls += 1;
      if (polls < 3) return { status: 400, body: { error: 'authorization_pending' } };
      return { status: 200, body: { access_token: 'acc-1', refresh_token: 'ref-1', scope: 'content:read content:write publish' } };
    });
    const notified: Array<{ verificationUri: string; userCode: string }> = [];
    const c = clock();
    const creds = await deviceLogin({
      url: URL, fetchImpl: impl, sleep: noSleep, now: c.now,
      notify: (i) => notified.push(i),
    });
    expect(creds).toMatchObject({ accessToken: 'acc-1', refreshToken: 'ref-1', scope: 'content:read content:write publish' });
    expect(creds.obtainedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    // The user was shown where to approve (the project-picker page) + the code.
    expect(notified[0]).toMatchObject({ userCode: 'ABCD-1234' });
    expect(notified[0]?.verificationUri).toContain('/oauth/device');
    // The device-authorization request used the built-in CLI client + requested editing scopes.
    expect(calls[0]?.fields).toMatchObject({ client_id: CLI_CLIENT_ID, scope: 'content:read content:write publish' });
    expect(calls.at(-1)?.fields).toMatchObject({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: 'dev-1' });
  });

  it('backs off on slow_down', async () => {
    let polls = 0;
    const { impl } = fetchStub((path) => {
      if (path === '/oauth/device_authorization') return { status: 200, body: { device_code: 'd', user_code: 'X', verification_uri: 'u', interval: 1, expires_in: 300 } };
      polls += 1;
      if (polls === 1) return { status: 400, body: { error: 'slow_down' } };
      return { status: 200, body: { access_token: 'a', refresh_token: 'r', scope: '' } };
    });
    const creds = await deviceLogin({ url: URL, fetchImpl: impl, sleep: noSleep, now: clock().now, notify: () => {} });
    expect(creds.accessToken).toBe('a');
    expect(polls).toBe(2);
  });

  it('throws (does not store "undefined") when the token response is missing fields', async () => {
    const { impl } = fetchStub((path) =>
      path === '/oauth/device_authorization'
        ? { status: 200, body: { device_code: 'd', user_code: 'X', verification_uri: 'u', interval: 1, expires_in: 300 } }
        : { status: 200, body: { scope: 'content:read' } }, // 200 but no access_token/refresh_token
    );
    await expect(deviceLogin({ url: URL, fetchImpl: impl, sleep: noSleep, now: clock().now, notify: () => {} })).rejects.toThrow(/no access\/refresh token/);
  });

  it('throws on access_denied', async () => {
    const { impl } = fetchStub((path) =>
      path === '/oauth/device_authorization'
        ? { status: 200, body: { device_code: 'd', user_code: 'X', verification_uri: 'u', interval: 1, expires_in: 300 } }
        : { status: 400, body: { error: 'access_denied' } },
    );
    await expect(deviceLogin({ url: URL, fetchImpl: impl, sleep: noSleep, now: clock().now, notify: () => {} })).rejects.toBeInstanceOf(OAuthLoginError);
  });

  it('times out once expires_in elapses', async () => {
    const c = clock();
    const { impl } = fetchStub((path) =>
      path === '/oauth/device_authorization'
        ? { status: 200, body: { device_code: 'd', user_code: 'X', verification_uri: 'u', interval: 1, expires_in: 2 } }
        : { status: 400, body: { error: 'authorization_pending' } },
    );
    await expect(
      deviceLogin({ url: URL, fetchImpl: impl, sleep: async () => c.advance(1000), now: c.now, notify: () => {} }),
    ).rejects.toThrow(/timed out/);
  });
});

describe('refreshAccess', () => {
  it('exchanges a refresh token for a fresh pair', async () => {
    const { impl, calls } = fetchStub(() => ({ status: 200, body: { access_token: 'a2', refresh_token: 'r2', scope: 'content:read' } }));
    const creds = await refreshAccess({ url: URL, refreshToken: 'r1', fetchImpl: impl, now: clock().now });
    expect(creds).toMatchObject({ accessToken: 'a2', refreshToken: 'r2', scope: 'content:read' });
    expect(calls[0]?.fields).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'r1', client_id: CLI_CLIENT_ID });
  });

  it('throws on an invalid refresh token', async () => {
    const { impl } = fetchStub(() => ({ status: 400, body: { error: 'invalid_grant' } }));
    await expect(refreshAccess({ url: URL, refreshToken: 'bad', fetchImpl: impl })).rejects.toThrow(/refresh failed/);
  });
});
