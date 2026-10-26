import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bingRemoveSite, bingSearchStats, bingSiteCode, bingSubmitSitemap, bingVerifySite, parseBingKey, testBing } from '../src/webmaster/bing.js';
import {
  GOOGLE_SCOPES,
  GOOGLE_TOKEN_URL,
  googleAccessToken,
  googleRegisterSite,
  googleSearchAnalytics,
  googleSetOwners,
  googleSiteToken,
  googleSubmitSitemap,
  googleUnregisterSite,
  parseGoogleKey,
  testGoogle,
} from '../src/webmaster/google.js';
import { AccessTokens, requestJson, WebmasterError, type WebmasterIo } from '../src/webmaster/request.js';
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

describe('access tokens kept between calls', () => {
  const key = parseGoogleKey(keyFile());
  const T0 = new Date('2026-10-21T10:00:00Z');
  const at = (ms: number) => new Date(T0.getTime() + ms);
  /** Google hands out ya29.1, ya29.2, …; Search Console answers `site` (401 for a token in `refused`). */
  function google(refused: string[] = []) {
    let n = 0;
    const { io, calls } = fake((call) => {
      if (call.url === GOOGLE_TOKEN_URL) return { status: 200, body: { access_token: `ya29.${++n}`, expires_in: 3599 } };
      const bearer = call.headers.authorization?.slice('Bearer '.length) ?? '';
      return refused.includes(bearer) ? { status: 401, body: { error: { code: 401 } } } : { status: 200, body: { siteEntry: [] } };
    });
    return { io: { ...io, tokens: new AccessTokens() }, calls, traded: () => calls.filter((c) => c.url === GOOGLE_TOKEN_URL).length };
  }

  it('trades the key once for every call within the hour, and once for calls that arrive together', async () => {
    const { io, traded } = google();
    const [a, b] = await Promise.all([googleAccessToken(key, io, T0), googleAccessToken(key, io, T0)]);
    expect([a, b]).toEqual(['ya29.1', 'ya29.1']);
    expect(await googleAccessToken(key, io, at(54 * 60_000))).toBe('ya29.1');
    expect(traded()).toBe(1);
    // Five minutes before Google's expiry a new one is fetched: a call that starts with it still has time.
    expect(await googleAccessToken(key, io, at(55 * 60_000))).toBe('ya29.2');
    expect(traded()).toBe(2);
  });

  it('keeps a token per service account AND key: a new key is asked for its own', async () => {
    const { io, traded } = google();
    await googleAccessToken(key, io, T0);
    await googleAccessToken({ ...key, privateKeyId: 'ffffffffffffffffffffffffffffffffffffffff' }, io, T0);
    expect(traded()).toBe(2);
  });

  it('does not keep a refused trade: the next call asks again', async () => {
    let fail = true;
    const { io, calls } = fake(() => (fail ? { status: 503, body: {} } : { status: 200, body: { access_token: 'ya29.ok', expires_in: 3599 } }));
    const kept = { ...io, tokens: new AccessTokens() };
    await expectRefusal(googleAccessToken(key, kept, T0), 'unavailable', /unavailable/);
    fail = false;
    expect(await googleAccessToken(key, kept, T0)).toBe('ya29.ok');
    expect(calls).toHaveLength(2);
  });

  it('drops a token an API refused with 401, so the next call trades the key again', async () => {
    const { io, traded } = google(['ya29.1']);
    const sites = (token: string) => requestJson('Google', 'https://www.googleapis.com/webmasters/v3/sites', { method: 'GET', headers: { authorization: `Bearer ${token}` } }, io);
    expect(await googleAccessToken(key, io, T0)).toBe('ya29.1');
    expect((await sites('ya29.1')).status).toBe(401);
    expect(await googleAccessToken(key, io, T0)).toBe('ya29.2');
    expect((await sites('ya29.2')).status).toBe(200);
    expect(await googleAccessToken(key, io, T0)).toBe('ya29.2'); // a good one stays
    expect(traded()).toBe(2);
  });

  it('a read refused for a kept token is sent again with a new one, and succeeds', async () => {
    const { io, calls, traded } = google(['ya29.1']);
    expect(await googleAccessToken(key, io, T0)).toBe('ya29.1'); // kept from an earlier call; Google has since refused it
    const q = { startDate: '2026-10-01', endDate: '2026-10-07', rowLimit: 5 };
    await expect(googleSearchAnalytics(key, 'https://www.example.com/', [q, { ...q, dimensions: ['query'] }], io, T0)).resolves.toHaveLength(2);
    expect(traded()).toBe(2); // the two parallel queries shared one new trade
    const reads = calls.filter((c) => c.url.endsWith('/searchAnalytics/query')).map((c) => c.headers.authorization);
    expect(reads.sort()).toEqual(['Bearer ya29.1', 'Bearer ya29.1', 'Bearer ya29.2', 'Bearer ya29.2']);
  });

  it('a shared trade is not cut short by the deadline of the step that started it', async () => {
    const { io, traded } = google();
    const late = { ...io, deadline: Date.now() - 1 }; // a step already past its deadline
    expect(await googleAccessToken(key, late, T0)).toBe('ya29.1');
    expect(await googleAccessToken(key, io, T0)).toBe('ya29.1');
    expect(traded()).toBe(1);
  });

  it('Test saved credentials always trades the key, and keeps nothing', async () => {
    const { io, traded } = google();
    await testGoogle(key, io, T0);
    await testGoogle(key, io, T0);
    expect(traded()).toBe(2);
  });

  it('keeps a bounded number of accounts', async () => {
    const tokens = new AccessTokens(2);
    const fetch = (t: string) => async () => ({ token: t, ttlMs: 60_000 });
    await tokens.get('a', 0, fetch('A'));
    await tokens.get('b', 0, fetch('B'));
    await tokens.get('c', 0, fetch('C'));
    expect(await tokens.get('a', 0, fetch('A2'))).toBe('A2'); // the oldest went
    expect(await tokens.get('c', 0, fetch('C2'))).toBe('C');
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

describe('Google site registration', () => {
  const token = { status: 200, body: { access_token: 'ya29.token' } };
  const SITE = 'https://www.example.com/';

  it('gets the META token for the site and keeps only its content', async () => {
    const { io, calls } = fake((call) =>
      call.url === GOOGLE_TOKEN_URL ? token : { status: 200, body: { method: 'META', token: '<meta name="google-site-verification" content="AbC-123_xyz789" />' } },
    );
    expect(await googleSiteToken(parseGoogleKey(keyFile()), SITE, io)).toBe('AbC-123_xyz789');
    expect(calls[1]!.url).toBe('https://www.googleapis.com/siteVerification/v1/token');
    expect(calls[1]!.method).toBe('POST');
    expect(JSON.parse(calls[1]!.body!)).toEqual({ site: { type: 'SITE', identifier: SITE }, verificationMethod: 'META' });
    expect(calls[1]!.headers.authorization).toBe('Bearer ya29.token');
  });

  it('refuses a tag whose content could carry markup', async () => {
    for (const tag of ['<meta name="google-site-verification" content="a&quot;><script>" />', '<meta content="" />', 'nonsense']) {
      const { io } = fake((call) => (call.url === GOOGLE_TOKEN_URL ? token : { status: 200, body: { method: 'META', token: tag } }));
      await expectRefusal(googleSiteToken(parseGoogleKey(keyFile()), SITE, io), 'unavailable', /could not read/);
    }
  });

  it('verifies the site by its META tag, then adds it to Search Console', async () => {
    const { io, calls } = fake((call) => {
      if (call.url === GOOGLE_TOKEN_URL) return token;
      if (call.url.includes('siteVerification')) return { status: 200, body: { id: 'https%3A%2F%2Fwww.example.com%2F', owners: [EMAIL] } };
      return { status: 204, body: '' };
    });
    await googleRegisterSite(parseGoogleKey(keyFile()), SITE, io);
    expect(calls.slice(1).map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST https://www.googleapis.com/siteVerification/v1/webResource?verificationMethod=META',
      'PUT https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fwww.example.com%2F',
    ]);
    expect(JSON.parse(calls[1]!.body!)).toEqual({ site: { type: 'SITE', identifier: SITE } });
  });

  it('says when Google did not find the tag, and adds nothing to Search Console', async () => {
    const { io, calls } = fake((call) =>
      call.url === GOOGLE_TOKEN_URL
        ? token
        : { status: 400, body: { error: { code: 400, message: 'The necessary verification token could not be found on your site.' } } },
    );
    await expectRefusal(
      googleRegisterSite(parseGoogleKey(keyFile()), SITE, io),
      'unverified',
      /^Google could not verify https:\/\/www\.example\.com\/: The necessary verification token could not be found on your site\.$/,
    );
    expect(calls).toHaveLength(2);
  });

  it('names a switched-off API on either step', async () => {
    const disabled = { status: 403, body: { error: { code: 403, errors: [{ reason: 'accessNotConfigured' }] } } };
    const first = fake((call) => (call.url === GOOGLE_TOKEN_URL ? token : disabled));
    await expectRefusal(googleRegisterSite(parseGoogleKey(keyFile()), SITE, first.io), 'disabled', /^The Site Verification API is not enabled/);
    const second = fake((call) => (call.url === GOOGLE_TOKEN_URL ? token : call.url.includes('siteVerification') ? { status: 200, body: {} } : disabled));
    await expectRefusal(googleRegisterSite(parseGoogleKey(keyFile()), SITE, second.io), 'disabled', /^The Google Search Console API is not enabled/);
  });
});

describe('Bing site registration', () => {
  const KEY = '0123456789abcdef0123456789ABCDEF';
  const SITE = 'https://www.example.com/';
  const CODE = '0A1B2C3D4E5F60718293A4B5C6D7E8F9';

  it('reads the code of a site already on the account, without adding it again', async () => {
    const { io, calls } = fake(() => ({ status: 200, body: { d: [{ Url: 'https://WWW.example.com', AuthenticationCode: CODE, IsVerified: false }] } }));
    expect(await bingSiteCode(KEY, SITE, io)).toBe(CODE);
    expect(calls.map((c) => c.url.split('?')[0]!.split('/').pop())).toEqual(['GetUserSites']);
  });

  it('adds a new site, then reads its code', async () => {
    let added = false;
    const { io, calls } = fake((call) => {
      if (call.url.includes('/AddSite?')) {
        added = true;
        return { status: 200, body: { d: null } };
      }
      return { status: 200, body: { d: added ? [{ Url: SITE, AuthenticationCode: CODE }] : [] } };
    });
    expect(await bingSiteCode(KEY, SITE, io)).toBe(CODE);
    expect(calls.map((c) => `${c.method} ${c.url.split('?')[0]!.split('/').pop()}`)).toEqual(['GET GetUserSites', 'POST AddSite', 'GET GetUserSites']);
    expect(calls[1]!.url).toBe(`https://ssl.bing.com/webmaster/api.svc/json/AddSite?apikey=${KEY}`);
    expect(JSON.parse(calls[1]!.body!)).toEqual({ siteUrl: SITE });
  });

  it('takes "already exists" as added, and words the refusals that are about the site', async () => {
    let lists = 0;
    const exists = fake((call) =>
      call.url.includes('/AddSite?') ? { status: 400, body: { ErrorCode: 12, Message: 'AlreadyExists' } } : { status: 200, body: { d: lists++ ? [{ Url: SITE, AuthenticationCode: CODE }] : [] } },
    );
    expect(await bingSiteCode(KEY, SITE, exists.io)).toBe(CODE);
    const refusing = (code: number) => fake((call) => (call.url.includes('/AddSite?') ? { status: 400, body: { ErrorCode: code, Message: `x ${KEY}` } } : { status: 200, body: { d: [] } })).io;
    await expectRefusal(bingSiteCode(KEY, SITE, refusing(9)), 'invalid', /^The Bing account has reached its limit of sites$/);
    await expectRefusal(bingSiteCode(KEY, SITE, refusing(7)), 'invalid', /^Bing does not accept https:\/\/www\.example\.com\/ as a site$/);
    await expectRefusal(bingSiteCode(KEY, SITE, refusing(3)), 'auth', /^Bing refused the API key$/);
    await expectRefusal(bingSiteCode(KEY, SITE, refusing(8)), 'unavailable', /^Bing answered HTTP 400 \(x …\)$/);
  });

  it('refuses a code that could carry markup', async () => {
    const { io } = fake(() => ({ status: 200, body: { d: [{ Url: SITE, AuthenticationCode: '"><script>' }] } }));
    await expectRefusal(bingSiteCode(KEY, SITE, io), 'unavailable', /could not read/);
  });

  it('verifies the site, and says so when Bing did not find the tag', async () => {
    const yes = fake(() => ({ status: 200, body: { d: true } }));
    await bingVerifySite(KEY, SITE, yes.io);
    expect(yes.calls[0]!.url).toBe(`https://ssl.bing.com/webmaster/api.svc/json/VerifySite?apikey=${KEY}`);
    expect(JSON.parse(yes.calls[0]!.body!)).toEqual({ siteUrl: SITE });
    await expectRefusal(bingVerifySite(KEY, SITE, fake(() => ({ status: 200, body: { d: false } })).io), 'unverified', /did not find the verification tag/);
    await expectRefusal(bingVerifySite(KEY, SITE, fake(() => ({ status: 400, body: { ErrorCode: 14 } })).io), 'auth', /refused the API key/);
  });
});

describe('removing a site', () => {
  const token = { status: 200, body: { access_token: 'ya29.token' } };
  const SITE = 'https://www.example.com/';
  const ENC = 'https%3A%2F%2Fwww.example.com%2F';

  it('Google: out of Search Console, then the ownership given up — the resource id encoded ONCE (measured)', async () => {
    const { io, calls } = fake((call) => (call.url === GOOGLE_TOKEN_URL ? token : { status: 204, body: '' }));
    expect(await googleUnregisterSite(parseGoogleKey(keyFile()), SITE, [], io)).toBe('Removed from Search Console, and the ownership given up');
    expect(calls.slice(1).map((c) => `${c.method} ${c.url}`)).toEqual([
      `DELETE https://www.googleapis.com/webmasters/v3/sites/${ENC}`,
      `DELETE https://www.googleapis.com/siteVerification/v1/webResource/${ENC}`,
    ]);
  });

  it('Google: "not there" is removed — a 404, or a 403 saying the account does not own the site', async () => {
    const notOwned = { status: 403, body: { error: { code: 403, message: 'You are not an owner of this site.', errors: [{ reason: 'forbidden' }] } } };
    const gone = fake((call) => (call.url === GOOGLE_TOKEN_URL ? token : call.url.includes('/webmasters/') ? { status: 404, body: {} } : notOwned));
    expect(await googleUnregisterSite(parseGoogleKey(keyFile()), SITE, [], gone.io)).toBe('Nothing to remove at Google');
    // Never a second, double-encoded try: Google answers that one 400.
    expect(gone.calls.filter((c) => c.url.includes('webResource'))).toHaveLength(1);
  });

  it('Google: a 403 from Search Console means "not in the account", and the ownership is still given up', async () => {
    const forbidden = { status: 403, body: { error: { code: 403, message: "User does not have sufficient permission for site 'x'.", errors: [{ reason: 'forbidden' }] } } };
    const notListed = fake((call) => (call.url === GOOGLE_TOKEN_URL ? token : call.url.includes('/webmasters/') ? forbidden : { status: 204, body: '' }));
    expect(await googleUnregisterSite(parseGoogleKey(keyFile()), SITE, [], notListed.io)).toBe('Ownership given up (the site was not in Search Console)');
    // …unless it says the API is off: then that is the answer, after the ownership step still ran.
    const off = fake((call) =>
      call.url === GOOGLE_TOKEN_URL ? token : call.url.includes('/webmasters/') ? { status: 403, body: { error: { code: 403, errors: [{ reason: 'accessNotConfigured' }] } } } : { status: 204, body: '' },
    );
    await expectRefusal(googleUnregisterSite(parseGoogleKey(keyFile()), SITE, [], off.io), 'disabled', /^The Google Search Console API is not enabled/);
    expect(off.calls.some((c) => c.method === 'DELETE' && c.url.includes('siteVerification'))).toBe(true);
    // A quota or rate refusal is NOT "already removed": it is retried, never reported as done.
    const quota = fake((call) => (call.url === GOOGLE_TOKEN_URL ? token : { status: 403, body: { error: { code: 403, errors: [{ reason: 'rateLimitExceeded' }] } } }));
    await expectRefusal(googleUnregisterSite(parseGoogleKey(keyFile()), SITE, [], quota.io), 'rate', /limiting requests/);
    // Nor is a 403 that gives no reason at all.
    const bare = fake((call) => (call.url === GOOGLE_TOKEN_URL ? token : { status: 403, body: { error: { code: 403 } } }));
    await expectRefusal(googleUnregisterSite(parseGoogleKey(keyFile()), SITE, [], bare.io), 'auth', /\(HTTP 403\)/);
    // A token without the scope is about the account, not the site: never read as "already removed".
    const scope = fake((call) => (call.url === GOOGLE_TOKEN_URL ? token : { status: 403, body: { error: { code: 403, errors: [{ reason: 'insufficientPermissions' }] } } }));
    await expectRefusal(googleUnregisterSite(parseGoogleKey(keyFile()), SITE, [], scope.io), 'auth', /\(HTTP 403\)/);
  });

  it('Google: the owners the platform added lose the ownership FIRST, and nothing is removed if that fails', async () => {
    const resource = { id: ENC, site: { type: 'SITE', identifier: SITE }, owners: [EMAIL, 'ana@agency.example', 'own@client.example'] };
    const { io, calls } = fake((call) => {
      if (call.url === GOOGLE_TOKEN_URL) return token;
      if (call.method === 'GET') return { status: 200, body: resource };
      if (call.method === 'PUT') return { status: 200, body: { ...resource, owners: JSON.parse(call.body!).owners } };
      return { status: 204, body: '' };
    });
    expect(await googleUnregisterSite(parseGoogleKey(keyFile()), SITE, ['ana@agency.example'], io)).toBe('Removed from Search Console, and the ownership given up (1 owner removed)');
    const put = calls.find((c) => c.method === 'PUT')!;
    // The client's own owner (added at Google, not by the platform) stays.
    expect(JSON.parse(put.body!).owners).toEqual([EMAIL, 'own@client.example']);
    expect(calls.slice(1).map((c) => c.method).filter((m) => m !== 'POST')).toEqual(['GET', 'PUT', 'DELETE', 'DELETE']);

    const down = fake((call) => (call.url === GOOGLE_TOKEN_URL ? token : { status: 503, body: {} }));
    await expectRefusal(googleUnregisterSite(parseGoogleKey(keyFile()), SITE, ['ana@agency.example'], down.io), 'unavailable', /HTTP 503/);
    expect(down.calls.some((c) => c.method === 'DELETE')).toBe(false);

    // An owner Google will not take off (they verified on their own): the site is still given up, and that is said.
    const stuck = fake((call) => {
      if (call.url === GOOGLE_TOKEN_URL) return token;
      if (call.method === 'GET') return { status: 200, body: resource };
      if (call.method === 'PUT') return { status: 400, body: { error: { message: 'Delete the verification tokens of ana@agency.example first.' } } };
      return { status: 204, body: '' };
    });
    expect(await googleUnregisterSite(parseGoogleKey(keyFile()), SITE, ['ana@agency.example'], stuck.io)).toBe(
      'Removed from Search Console, and the ownership given up; the owners were not removed: Google did not change the owners: Delete the verification tokens of ana@agency.example first.',
    );
    expect(stuck.calls.filter((c) => c.method === 'DELETE')).toHaveLength(2);

    // Not owned any more: there is nobody to take off, and the rest still runs.
    const notOwned = fake((call) => (call.url === GOOGLE_TOKEN_URL ? token : call.method === 'GET' ? { status: 403, body: { error: { errors: [{ reason: 'forbidden' }] } } } : { status: 404, body: {} }));
    expect(await googleUnregisterSite(parseGoogleKey(keyFile()), SITE, ['ana@agency.example'], notOwned.io)).toBe('Nothing to remove at Google');
  });

  it('★ Google: an ownership the live site still carries the tag for is `tagged` — after Search Console and the owners went', async () => {
    // Google's answer, measured on a real site (2026-10-26).
    const message = 'You cannot unverify your ownership of this site until your verification token (meta tag, HTML file, Google Analytics tracking code, Google Tag Manager container code, or DNS record) has been removed.';
    const tagged = { status: 400, body: { error: { code: 400, message, errors: [{ message, domain: 'global', reason: 'badRequest' }] } } };
    const resource = { id: ENC, site: { type: 'SITE', identifier: SITE }, owners: [EMAIL, 'ana@agency.example'] };
    const live = fake((call) => {
      if (call.url === GOOGLE_TOKEN_URL) return token;
      if (call.method === 'GET') return { status: 200, body: resource };
      if (call.method === 'PUT') return { status: 200, body: { ...resource, owners: JSON.parse(call.body!).owners } };
      return call.url.includes('/webmasters/') ? { status: 204, body: '' } : tagged;
    });
    await expectRefusal(
      googleUnregisterSite(parseGoogleKey(keyFile()), SITE, ['ana@agency.example'], live.io),
      'tagged',
      /^Removed from Search Console \(1 owner removed\)\. Google keeps the platform's ownership while the site still carries its tag: it is given up once a deploy has taken the tag off$/,
    );
    expect(live.calls.slice(1).map((c) => c.method).filter((m) => m !== 'POST')).toEqual(['GET', 'PUT', 'DELETE', 'DELETE']);

    // Already out of Search Console (an earlier try): said as such.
    const again = fake((call) => (call.url === GOOGLE_TOKEN_URL ? token : call.url.includes('/webmasters/') ? { status: 404, body: {} } : tagged));
    await expectRefusal(googleUnregisterSite(parseGoogleKey(keyFile()), SITE, [], again.io), 'tagged', /^Not in Search Console\. Google keeps/);

    // Search Console not reachable: that is the answer (the removal is tried again whole), not the tag.
    const down = fake((call) => (call.url === GOOGLE_TOKEN_URL ? token : call.url.includes('/webmasters/') ? { status: 503, body: {} } : tagged));
    await expectRefusal(googleUnregisterSite(parseGoogleKey(keyFile()), SITE, [], down.io), 'unavailable', /HTTP 503/);

    // The same words from Search Console's DELETE are not the tag: a removal is never passed off as done.
    const scWords = fake((call) => (call.url === GOOGLE_TOKEN_URL ? token : call.url.includes('/webmasters/') ? tagged : { status: 204, body: '' }));
    await expectRefusal(googleUnregisterSite(parseGoogleKey(keyFile()), SITE, [], scWords.io), 'unavailable', /Search Console API answered HTTP 400/);

    // Another 400 is not the tag.
    const other = fake((call) => (call.url === GOOGLE_TOKEN_URL ? token : call.url.includes('/webmasters/') ? { status: 204, body: '' } : { status: 400, body: { error: { code: 400, message: 'Invalid value' } } }));
    await expectRefusal(googleUnregisterSite(parseGoogleKey(keyFile()), SITE, [], other.io), 'unavailable', /answered HTTP 400/);
  });

  it('Bing: RemoveSite, with "not found" as removed', async () => {
    const KEY = '0123456789abcdef0123456789ABCDEF';
    const ok = fake(() => ({ status: 200, body: { d: null } }));
    expect(await bingRemoveSite(KEY, SITE, ok.io)).toBe('Removed from Bing Webmaster Tools');
    expect(ok.calls[0]!.url).toBe(`https://ssl.bing.com/webmaster/api.svc/json/RemoveSite?apikey=${KEY}`);
    expect(JSON.parse(ok.calls[0]!.body!)).toEqual({ siteUrl: SITE });
    expect(await bingRemoveSite(KEY, SITE, fake(() => ({ status: 400, body: { ErrorCode: 11 } })).io)).toBe('Removed from Bing Webmaster Tools');
    await expectRefusal(bingRemoveSite(KEY, SITE, fake(() => ({ status: 400, body: { ErrorCode: 3 } })).io), 'auth', /refused the API key/);
  });
});

describe('Search Console owners', () => {
  const token = { status: 200, body: { access_token: 'ya29.token' } };
  const SITE = 'https://www.example.com/';
  const ENC = 'https%3A%2F%2Fwww.example.com%2F';
  const resource = (owners: string[]) => ({ id: ENC, site: { type: 'SITE', identifier: SITE }, owners });

  it('sends Google’s list changed only where the platform manages it, and keeps the service account', async () => {
    const { io, calls } = fake((call) => {
      if (call.url === GOOGLE_TOKEN_URL) return token;
      if (call.method === 'GET') return { status: 200, body: resource([EMAIL, 'old@agency.example', 'own@client.example']) };
      return { status: 200, body: resource(JSON.parse(call.body!).owners) };
    });
    const listed = await googleSetOwners(parseGoogleKey(keyFile()), SITE, { wanted: ['ana@agency.example'], dropped: ['old@agency.example'] }, io);
    expect(listed).toEqual(['own@client.example', 'ana@agency.example']);
    expect(calls.slice(1).map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET https://www.googleapis.com/siteVerification/v1/webResource/${ENC}`,
      `PUT https://www.googleapis.com/siteVerification/v1/webResource/${ENC}`,
    ]);
    expect(JSON.parse(calls[2]!.body!)).toEqual({ id: ENC, site: { type: 'SITE', identifier: SITE }, owners: [EMAIL, 'own@client.example', 'ana@agency.example'] });
  });

  it('changes nothing when Google already lists exactly those owners (case aside)', async () => {
    const { io, calls } = fake((call) => (call.url === GOOGLE_TOKEN_URL ? token : { status: 200, body: resource([EMAIL.toUpperCase(), 'Ana@Agency.example']) }));
    expect(await googleSetOwners(parseGoogleKey(keyFile()), SITE, { wanted: ['ana@agency.example'], dropped: [] }, io)).toEqual(['Ana@Agency.example']);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('says the site must be verified first, and passes on why Google refused a list', async () => {
    const notOwned = fake((call) => (call.url === GOOGLE_TOKEN_URL ? token : { status: 403, body: { error: { message: 'You are not an owner of this site.', errors: [{ reason: 'forbidden' }] } } }));
    await expectRefusal(googleSetOwners(parseGoogleKey(keyFile()), SITE, { wanted: ['a@b.example'], dropped: [] }, notOwned.io), 'unverified', /verify the site first/);
    const unknown = fake((call) => (call.url === GOOGLE_TOKEN_URL ? token : { status: 404, body: { error: { code: 404 } } }));
    await expectRefusal(googleSetOwners(parseGoogleKey(keyFile()), SITE, { wanted: [], dropped: ['a@b.example'] }, unknown.io), 'unverified', /verify the site first/);
    const refused = fake((call) =>
      call.url === GOOGLE_TOKEN_URL
        ? token
        : call.method === 'GET'
          ? { status: 200, body: resource([EMAIL]) }
          : { status: 400, body: { error: { code: 400, message: 'Invalid owner: nobody@nowhere.example' } } },
    );
    await expectRefusal(
      googleSetOwners(parseGoogleKey(keyFile()), SITE, { wanted: ['nobody@nowhere.example'], dropped: [] }, refused.io),
      'invalid',
      /^Google did not change the owners: Invalid owner: nobody@nowhere\.example$/,
    );
  });
});

describe('sitemap submission', () => {
  const token = { status: 200, body: { access_token: 'ya29.token' } };
  const SITE = 'https://www.example.com/';
  const SITEMAP = 'https://www.example.com/sitemap.xml';

  it('Google: PUT under the site, both addresses encoded (Google echoes the decoded feed path — measured)', async () => {
    const { io, calls } = fake((call) => (call.url === GOOGLE_TOKEN_URL ? token : { status: 204, body: '' }));
    await googleSubmitSitemap(parseGoogleKey(keyFile()), SITE, SITEMAP, io);
    expect(`${calls[1]!.method} ${calls[1]!.url}`).toBe(
      'PUT https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fwww.example.com%2F/sitemaps/https%3A%2F%2Fwww.example.com%2Fsitemap.xml',
    );
    expect(calls[1]!.body).toBeUndefined();
  });

  it('Google: words a site that is not in Search Console, a refused sitemap, and an outage', async () => {
    const answer = (status: number, body: unknown) => fake((call) => (call.url === GOOGLE_TOKEN_URL ? token : { status, body })).io;
    await expectRefusal(googleSubmitSitemap(parseGoogleKey(keyFile()), SITE, SITEMAP, answer(403, { error: { errors: [{ reason: 'forbidden' }] } })), 'unverified', /verify the site first/);
    await expectRefusal(
      googleSubmitSitemap(parseGoogleKey(keyFile()), SITE, SITEMAP, answer(400, { error: { message: 'Invalid sitemap URL.' } })),
      'invalid',
      /^Google did not take the sitemap: Invalid sitemap URL\.$/,
    );
    await expectRefusal(googleSubmitSitemap(parseGoogleKey(keyFile()), SITE, SITEMAP, answer(503, {})), 'unavailable', /HTTP 503/);
    await expectRefusal(googleSubmitSitemap(parseGoogleKey(keyFile()), SITE, SITEMAP, answer(403, { error: { errors: [{ reason: 'quotaExceeded' }] } })), 'rate', /limiting/);
  });

  it('Bing: SubmitFeed with the site and the sitemap, and its refusals', async () => {
    const KEY = '0123456789abcdef0123456789ABCDEF';
    const ok = fake(() => ({ status: 200, body: { d: null } }));
    await bingSubmitSitemap(KEY, SITE, SITEMAP, ok.io);
    expect(ok.calls[0]!.url).toBe(`https://ssl.bing.com/webmaster/api.svc/json/SubmitFeed?apikey=${KEY}`);
    expect(ok.calls[0]!.method).toBe('POST');
    expect(JSON.parse(ok.calls[0]!.body!)).toEqual({ siteUrl: SITE, feedUrl: SITEMAP });
    await expectRefusal(bingSubmitSitemap(KEY, SITE, SITEMAP, fake(() => ({ status: 400, body: { ErrorCode: 11 } })).io), 'unverified', /verify the site first/);
    await expectRefusal(bingSubmitSitemap(KEY, SITE, SITEMAP, fake(() => ({ status: 400, body: { ErrorCode: 7 } })).io), 'invalid', /does not accept/);
    await expectRefusal(bingSubmitSitemap(KEY, SITE, SITEMAP, fake(() => ({ status: 400, body: { ErrorCode: 3, Message: `bad ${KEY}` } })).io), 'auth', /^Bing refused the API key$/);
  });
});

describe('a step deadline', () => {
  it('starts no request after it, and cuts a running one off at it', async () => {
    const calls: string[] = [];
    const slow: FetchLike = (url, init) =>
      new Promise((resolve, reject) => {
        calls.push(url);
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        setTimeout(() => resolve({ ok: true, status: 200, text: async () => '{}' }), 5_000);
      });
    const late = { fetch: slow, deadline: Date.now() - 1 };
    await expectRefusal(testBing('0123456789abcdef0123456789ABCDEF', late), 'unavailable', /^Bing took too long to answer$/);
    expect(calls).toEqual([]);
    const started = Date.now();
    await expectRefusal(testBing('0123456789abcdef0123456789ABCDEF', { fetch: slow, deadline: Date.now() + 50 }), 'unavailable', /could not be reached/);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('reading search numbers', () => {
  const token = { status: 200, body: { access_token: 'ya29.token' } };
  const SITE = 'https://www.example.com/';

  it('Google: one token for every query, each a web search with fresh days, numbers read defensively', async () => {
    const { io, calls } = fake((call) =>
      call.url === GOOGLE_TOKEN_URL ? token : { status: 200, body: { rows: [{ keys: ['roof'], clicks: 3, impressions: 'x', ctr: 0.5, position: -1 }] } },
    );
    const q = { startDate: '2026-10-01', endDate: '2026-10-07', rowLimit: 25 };
    const answers = await googleSearchAnalytics(parseGoogleKey(keyFile()), SITE, [{ ...q, dimensions: ['query'] }, q], io);
    expect(calls.filter((c) => c.url === GOOGLE_TOKEN_URL)).toHaveLength(1);
    expect(calls[1]!.url).toBe('https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fwww.example.com%2F/searchAnalytics/query');
    expect(JSON.parse(calls[1]!.body!)).toEqual({ ...q, dimensions: ['query'], type: 'web', dataState: 'all' });
    expect(JSON.parse(calls[2]!.body!).dimensions).toEqual([]);
    expect(answers[0]).toEqual([{ keys: ['roof'], clicks: 3, impressions: 0, ctr: 0.5, position: 0 }]);
  });

  it('Google: a site no longer in Search Console says so', async () => {
    const { io } = fake((call) => (call.url === GOOGLE_TOKEN_URL ? token : { status: 403, body: { error: { errors: [{ reason: 'forbidden' }] } } }));
    await expectRefusal(googleSearchAnalytics(parseGoogleKey(keyFile()), SITE, [{ startDate: '2026-10-01', endDate: '2026-10-07', rowLimit: 1 }], io), 'unverified', /verify the site again/);
  });

  it('Bing: three reads with the site in the query string (the key too, never in a message)', async () => {
    const KEY = '0123456789abcdef0123456789ABCDEF';
    const { io, calls } = fake((call) =>
      call.url.includes('/GetRankAndTrafficStats?')
        ? { status: 200, body: { d: [{ Date: '/Date(1792652400000-0700)/', Clicks: 2, Impressions: 9 }, { Date: 'not a date', Clicks: 1 }] } }
        : call.url.includes('/GetQueryStats?')
          ? { status: 200, body: { d: [{ Date: '/Date(1792652400000-0700)/', Query: 'roof', Clicks: 1, Impressions: 4, AvgImpressionPosition: 2.5 }] } }
          : { status: 200, body: { d: null } },
    );
    const stats = await bingSearchStats(KEY, SITE, io);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(
      ['GetRankAndTrafficStats', 'GetQueryStats', 'GetPageStats'].map((m) => `GET https://ssl.bing.com/webmaster/api.svc/json/${m}?siteUrl=https%3A%2F%2Fwww.example.com%2F&apikey=${KEY}`),
    );
    expect(stats).toEqual({
      daily: [{ date: '2026-10-22', key: '', clicks: 2, impressions: 9, position: null }],
      queries: [{ date: '2026-10-22', key: 'roof', clicks: 1, impressions: 4, position: 2.5 }],
      pages: [],
    });
    await expectRefusal(bingSearchStats(KEY, SITE, fake(() => ({ status: 400, body: { ErrorCode: 11 } })).io), 'unverified', /verify the site again/);
    await expectRefusal(bingSearchStats(KEY, SITE, fake(() => ({ status: 200, body: { d: 'nonsense' } })).io), 'unavailable', /could not read/);
  });
});
