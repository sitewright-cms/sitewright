import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseBingKey, testBing } from '../src/webmaster/bing.js';
import { GOOGLE_SCOPES, GOOGLE_TOKEN_URL, googleAccessToken, parseGoogleKey, testGoogle } from '../src/webmaster/google.js';
import { WebmasterError, type WebmasterIo } from '../src/webmaster/request.js';
import type { FetchLike } from '../src/payments/executor.js';

/**
 * The Google and Bing clients against fakes: reading a key file (and refusing what is not one), the signed token
 * request Google expects, what each answer means, and that no message ever carries a secret.
 */

const { privateKey: PEM, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const EMAIL = 'sitewright-seo@sitewright-seo-123.iam.gserviceaccount.com';
const keyFile = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: 'service_account',
    project_id: 'sitewright-seo-123',
    private_key_id: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    private_key: PEM,
    client_email: EMAIL,
    client_id: '123456789012345678901',
    token_uri: GOOGLE_TOKEN_URL,
    ...over,
  });

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
function fake(answer: (call: Call) => { status: number; body: unknown }): { io: WebmasterIo; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call = { url, method: init.method, headers: init.headers, ...(init.body !== undefined ? { body: init.body } : {}) };
    calls.push(call);
    const { status, body } = answer(call);
    return { ok: status < 400, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  return { io: { fetch }, calls };
}

const expectRefusal = async (p: Promise<unknown>, kind: WebmasterError['kind'], text: RegExp): Promise<void> => {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(WebmasterError);
  expect((err as WebmasterError).kind).toBe(kind);
  expect((err as WebmasterError).message).toMatch(text);
};

describe('parseGoogleKey', () => {
  it('keeps the four fields signing needs from a real-shaped key file', () => {
    expect(parseGoogleKey(keyFile())).toEqual({
      clientEmail: EMAIL,
      privateKey: PEM,
      privateKeyId: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      projectId: 'sitewright-seo-123',
    });
  });

  it.each([
    ['not JSON', '{"type": "service_account",', /not a Google service-account key file/],
    ['an OAuth client file', JSON.stringify({ installed: { client_id: 'x' } }), /not a Google service-account key file/],
    ['a user credential', keyFile({ type: 'authorized_user' }), /not a Google service-account key file/],
    ['a JSON array', '[1,2]', /not a Google service-account key file/],
    ['no email', keyFile({ client_email: undefined }), /no service-account email/],
    ['an ordinary email', keyFile({ client_email: 'me@gmail.com' }), /no service-account email/],
    ['no key id', keyFile({ private_key_id: '' }), /no key id/],
    ['no project', keyFile({ project_id: 'X' }), /no Google Cloud project id/],
    ['no private key', keyFile({ private_key: '' }), /no private key/],
    ['a broken private key', keyFile({ private_key: '-----BEGIN PRIVATE KEY-----\nnot base64\n-----END PRIVATE KEY-----\n' }), /cannot be read/],
  ])('refuses %s, without echoing the file', (_name, text, message) => {
    let err: unknown;
    try {
      parseGoogleKey(text);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(WebmasterError);
    expect((err as WebmasterError).kind).toBe('invalid');
    expect((err as WebmasterError).message).toMatch(message);
    expect((err as WebmasterError).message).not.toContain('PRIVATE KEY');
  });

  it('refuses a key that is not RSA', () => {
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256', privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    expect(() => parseGoogleKey(keyFile({ private_key: ec.privateKey }))).toThrow(/not an RSA key/);
  });
});

describe('googleAccessToken', () => {
  it('posts a signed RS256 assertion to Google’s FIXED token endpoint, never the file’s token_uri', async () => {
    const { io, calls } = fake(() => ({ status: 200, body: { access_token: 'ya29.token', expires_in: 3599, token_type: 'Bearer' } }));
    const key = parseGoogleKey(keyFile({ token_uri: 'https://attacker.example/token' }));
    const now = new Date('2026-10-21T10:00:00Z');
    expect(await googleAccessToken(key, io, now)).toBe('ya29.token');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/token');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers['content-type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(calls[0]!.body);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [h, c, s] = form.get('assertion')!.split('.');
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT', kid: key.privateKeyId });
    expect(JSON.parse(Buffer.from(c!, 'base64url').toString())).toEqual({
      iss: EMAIL,
      scope: GOOGLE_SCOPES.join(' '),
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1792576800,
      exp: 1792580400,
    });
    expect(verify('RSA-SHA256', Buffer.from(`${h}.${c}`), createPublicKey(publicKey), Buffer.from(s!, 'base64url'))).toBe(true);
  });

  it('words each refusal itself', async () => {
    const key = parseGoogleKey(keyFile());
    const at = (status: number, body: unknown) => googleAccessToken(key, fake(() => ({ status, body })).io);
    await expectRefusal(at(400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }), 'auth', /deleted, or the service account disabled/);
    await expectRefusal(at(401, { error: 'unauthorized_client' }), 'auth', /refused the key \(unauthorized_client\)/);
    await expectRefusal(at(403, 'not json'), 'auth', /refused the key \(HTTP 403\)/);
    await expectRefusal(at(429, {}), 'rate', /limiting/);
    await expectRefusal(at(503, {}), 'unavailable', /unavailable \(HTTP 503\)/);
    await expectRefusal(at(200, { token_type: 'Bearer' }), 'unavailable', /could not read/);
  });

  it('reports an unreachable Google without the transport’s words', async () => {
    const io: WebmasterIo = {
      fetch: async () => {
        throw new Error('connect ECONNREFUSED 10.0.0.1:443 https://oauth2.googleapis.com/token');
      },
    };
    await expectRefusal(googleAccessToken(parseGoogleKey(keyFile()), io), 'unavailable', /^Google could not be reached$/);
  });
});

describe('testGoogle', () => {
  const token = { status: 200, body: { access_token: 'ya29.token' } };

  it('counts the verified sites and the Search Console sites with the token', async () => {
    const { io, calls } = fake((call) => {
      if (call.url === GOOGLE_TOKEN_URL) return token;
      if (call.url.includes('siteVerification')) return { status: 200, body: { items: [{ id: 'a' }, { id: 'b' }, null] } };
      return { status: 200, body: {} }; // Search Console leaves siteEntry out when there are none
    });
    expect(await testGoogle(parseGoogleKey(keyFile()), io)).toBe(`Connected as ${EMAIL} · 2 sites verified · 0 in Search Console`);
    expect(calls.map((c) => c.url)).toEqual([
      'https://oauth2.googleapis.com/token',
      'https://www.googleapis.com/siteVerification/v1/webResource',
      'https://www.googleapis.com/webmasters/v3/sites',
    ]);
    expect(calls[1]!.headers.authorization).toBe('Bearer ya29.token');
    expect(calls[2]!.headers.authorization).toBe('Bearer ya29.token');
  });

  it('names the API that is switched off, and the project to switch it on in', async () => {
    const disabled = (style: 'errors' | 'details') => ({
      status: 403,
      body: {
        error: {
          code: 403,
          message: 'Google Search Console API has not been used in project 123 before or it is disabled. Enable it by visiting https://console.developers.google.com/…',
          status: 'PERMISSION_DENIED',
          ...(style === 'errors' ? { errors: [{ reason: 'accessNotConfigured' }] } : { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED' }] }),
        },
      },
    });
    for (const style of ['errors', 'details'] as const) {
      const { io } = fake((call) =>
        call.url === GOOGLE_TOKEN_URL ? token : call.url.includes('siteVerification') ? { status: 200, body: { items: [] } } : disabled(style),
      );
      await expectRefusal(
        testGoogle(parseGoogleKey(keyFile()), io),
        'disabled',
        /^The Google Search Console API is not enabled in Google Cloud project sitewright-seo-123: enable it/,
      );
    }
    const { io } = fake((call) => (call.url === GOOGLE_TOKEN_URL ? token : disabled('errors')));
    await expectRefusal(testGoogle(parseGoogleKey(keyFile()), io), 'disabled', /^The Site Verification API is not enabled/);
  });

  it('tells a refused permission, throttling and an outage apart', async () => {
    const after = (status: number, body: unknown = {}) =>
      testGoogle(parseGoogleKey(keyFile()), fake((call) => (call.url === GOOGLE_TOKEN_URL ? token : { status, body })).io);
    await expectRefusal(after(403, { error: { code: 403, status: 'PERMISSION_DENIED' } }), 'auth', /refused the service account access to the Site Verification API \(HTTP 403\)/);
    await expectRefusal(after(401), 'auth', /HTTP 401/);
    await expectRefusal(after(429), 'rate', /limiting/);
    await expectRefusal(after(500), 'unavailable', /unavailable \(HTTP 500\)/);
    await expectRefusal(after(404), 'unavailable', /answered HTTP 404/);
    await expectRefusal(after(200, '<html>'), 'unavailable', /answered HTTP 200/);
  });
});

describe('Bing', () => {
  const KEY = '0123456789abcdef0123456789ABCDEF';

  it('accepts a key as issued and refuses anything else', () => {
    expect(parseBingKey(`  ${KEY}\n`)).toBe(KEY);
    for (const bad of ['', 'short', `${KEY}!`, 'a'.repeat(129), 'key with spaces in it 123']) {
      expect(() => parseBingKey(bad)).toThrow(/not a Bing Webmaster API key/);
    }
  });

  it('lists the account’s sites with the key in the query string', async () => {
    const { io, calls } = fake(() => ({
      status: 200,
      body: { d: [{ Url: 'https://a.example/', IsVerified: true }, { Url: 'https://b.example/', IsVerified: false }, null] },
    }));
    expect(await testBing(KEY, io)).toBe('Connected · 2 sites on the account, 1 verified');
    expect(calls[0]!.url).toBe(`https://ssl.bing.com/webmaster/api.svc/json/GetUserSites?apikey=${KEY}`);
    expect(await testBing(KEY, fake(() => ({ status: 200, body: { d: null } })).io)).toBe('Connected · 0 sites on the account, 0 verified');
  });

  it('words each refusal without the key, even when Bing quotes it back', async () => {
    const at = (status: number, body: unknown) => testBing(KEY, fake(() => ({ status, body })).io);
    await expectRefusal(at(400, { ErrorCode: 3, Message: 'InvalidApiKey' }), 'auth', /^Bing refused the API key$/);
    await expectRefusal(at(400, { ErrorCode: 14, Message: 'NotAuthorized' }), 'auth', /refused the API key/);
    await expectRefusal(at(401, {}), 'auth', /refused the API key/);
    await expectRefusal(at(400, { ErrorCode: 4, Message: 'ThrottleUser' }), 'rate', /limiting/);
    await expectRefusal(at(429, {}), 'rate', /limiting/);
    await expectRefusal(at(502, 'Bad Gateway'), 'unavailable', /unavailable \(HTTP 502\)/);
    const echoed = at(400, { ErrorCode: 8, Message: `InvalidParameter apikey=${KEY}` });
    await expectRefusal(echoed, 'unavailable', /^Bing answered HTTP 400 \(InvalidParameter apikey=…\)$/);
    const io: WebmasterIo = {
      fetch: async (url) => {
        throw new Error(`getaddrinfo ENOTFOUND ${url}`);
      },
    };
    await expectRefusal(testBing(KEY, io), 'unavailable', /^Bing could not be reached$/);
  });
});
