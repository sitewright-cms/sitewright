import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { api, ApiError, eventsUrl, setUnauthorizedHandler } from '../src/api';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(undefined);
});

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    json: async () => body,
  } as Response;
}

describe('api client', () => {
  it('POSTs register with a JSON body and credentials (no org)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { userId: 'u' }));
    const res = await api.register('a@b.co', 'Pw-secret-1');
    expect(res).toEqual({ userId: 'u' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/auth/register');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body)).toEqual({ email: 'a@b.co', password: 'Pw-secret-1' });
  });

  it('throws ApiError with the server error message on failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { error: 'forbidden' }));
    await expect(api.projects()).rejects.toMatchObject({ status: 403, message: 'forbidden' });
    await expect(api.projects()).rejects.toBeInstanceOf(ApiError);
  });

  it('returns undefined for 204 responses', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    expect(await api.logout()).toBeUndefined();
  });

  it('falls back to statusText when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);
    await expect(api.me()).rejects.toMatchObject({ status: 500, message: 'Server Error' });
  });

  it('lists accessible projects at the flat route', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { projects: [] }));
    await api.projects();
    expect(fetchMock.mock.calls[0]![0]).toBe('/projects');
  });

  it('builds content paths correctly', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));
    await api.listPages('proj1');
    expect(fetchMock.mock.calls[0]![0]).toBe('/projects/proj1/content/page');
  });

  it('locale management wrappers hit the dedicated endpoints', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { locale: 'de', created: 1, removed: 0, pages: [], kept: [] }));

    await api.addLocale('p1', 'de');
    let [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/projects/p1/locales');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ locale: 'de' });

    await api.removeLocale('p1', 'pt-BR');
    [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe('/projects/p1/locales/pt-BR');
    expect(init.method).toBe('DELETE');

    await api.translatePage('p1', 'about');
    [url, init] = fetchMock.mock.calls[2]!;
    expect(url).toBe('/projects/p1/pages/about/translate');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({});

    await api.translatePage('p1', 'about', ['de', 'fr']);
    expect(JSON.parse(fetchMock.mock.calls[3]![1].body)).toEqual({ locales: ['de', 'fr'] });

    await api.deletePageGroup('p1', 'about');
    [url, init] = fetchMock.mock.calls[4]!;
    expect(url).toBe('/projects/p1/pages/about/delete-group');
    expect(init.method).toBe('POST');
  });

  it('snippet + template wrappers hit the generic content routes (list/put/delete)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));
    await api.listSnippets('p1');
    expect(fetchMock.mock.calls[0]![0]).toBe('/projects/p1/content/snippet');

    fetchMock.mockResolvedValue(jsonResponse(200, { item: { id: 'hero', name: 'hero', source: 'x' } }));
    await api.putSnippet('p1', { id: 'hero', name: 'hero', source: 'x' });
    const [putUrl, putInit] = fetchMock.mock.calls[1]!;
    expect(putUrl).toBe('/projects/p1/content/snippet/hero');
    expect(putInit.method).toBe('PUT');
    expect(JSON.parse(putInit.body as string)).toEqual({ id: 'hero', name: 'hero', source: 'x' });

    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    await api.deleteSnippet('p1', 'hero');
    const [delUrl, delInit] = fetchMock.mock.calls[2]!;
    expect(delUrl).toBe('/projects/p1/content/snippet/hero');
    expect(delInit.method).toBe('DELETE');

    await api.deleteTemplate('p1', 'base');
    const [tplUrl, tplInit] = fetchMock.mock.calls[3]!;
    expect(tplUrl).toBe('/projects/p1/content/template/base');
    expect(tplInit.method).toBe('DELETE');
  });

  it('global library wrappers hit /global/:kind (read) and /admin/global/:kind/:id (admin write)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));
    await api.listGlobalSnippets();
    expect(fetchMock.mock.calls[0]![0]).toBe('/global/snippet');
    await api.listGlobalTemplates();
    expect(fetchMock.mock.calls[1]![0]).toBe('/global/template');

    fetchMock.mockResolvedValue(jsonResponse(200, { item: { id: 'navbar', name: 'navbar', source: '<nav/>' } }));
    await api.putGlobalSnippet({ id: 'navbar', name: 'navbar', source: '<nav/>' });
    const [snipUrl, snipInit] = fetchMock.mock.calls[2]!;
    expect(snipUrl).toBe('/admin/global/snippet/navbar');
    expect(snipInit.method).toBe('PUT');
    expect(JSON.parse(snipInit.body as string)).toEqual({ id: 'navbar', name: 'navbar', source: '<nav/>' });

    fetchMock.mockResolvedValue(jsonResponse(200, { item: { id: 'landing', name: 'Landing', source: '<main/>' } }));
    await api.putGlobalTemplate({ id: 'landing', name: 'Landing', source: '<main/>' });
    const [tplUrl, tplInit] = fetchMock.mock.calls[3]!;
    expect(tplUrl).toBe('/admin/global/template/landing');
    expect(tplInit.method).toBe('PUT');

    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    await api.deleteGlobalSnippet('navbar');
    expect(fetchMock.mock.calls[4]![0]).toBe('/admin/global/snippet/navbar');
    expect(fetchMock.mock.calls[4]![1].method).toBe('DELETE');
    await api.deleteGlobalTemplate('landing');
    expect(fetchMock.mock.calls[5]![0]).toBe('/admin/global/template/landing');
    expect(fetchMock.mock.calls[5]![1].method).toBe('DELETE');
  });

  it('builds the stock search URL with an encoded query + page', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { provider: 'openverse', page: 2, results: [] }));
    await api.searchStock('p', 'openverse', 'cats & dogs', 2);
    expect(fetchMock.mock.calls[0]![0]).toBe('/projects/p/stock/search?provider=openverse&q=cats+%26+dogs&page=2');
  });

  it('POSTs a stock import with provider/id/alt and returns the item', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { item: { id: 'asset1' } }));
    const res = await api.importStock('p', 'openverse', 'ov1', 'a cat');
    expect(res).toEqual({ item: { id: 'asset1' } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/projects/p/stock/import');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ provider: 'openverse', id: 'ov1', alt: 'a cat' });
  });

  it('importMediaUrl POSTs the url + folder and returns the new asset', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { item: { id: 'm1', kind: 'image' } }));
    const res = await api.importMediaUrl('p', 'https://cdn.test/a.png', 'Logos');
    expect(res.item.id).toBe('m1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/projects/p/media/import-url');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ url: 'https://cdn.test/a.png', folder: 'Logos' });
  });

  it('selectFont POSTs the family + weights → a kind:font library asset', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { item: { id: 'inter', kind: 'font' } }));
    const res = await api.selectFont('p', 'Inter', [400, 700]);
    expect(res.item.id).toBe('inter');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/projects/p/fonts/select');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ family: 'Inter', weights: [400, 700], folder: '' });
  });

  it('uploadFont POSTs a multipart file to /media with font metadata as query params', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { item: { id: 'up-1', kind: 'font' } }));
    const file = new File([new Uint8Array([0x77, 0x4f, 0x46, 0x32])], 'boombox.woff2', { type: 'font/woff2' });
    const res = await api.uploadFont('p', file, { family: 'Boombox', weight: 700, style: 'italic', fallback: 'serif' });
    expect(res.item.id).toBe('up-1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/projects/p/media?family=Boombox&weight=700&style=italic&fallback=serif');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBeInstanceOf(File);
  });

  it('uploadFont throws on a non-ok response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'unrecognized font file' }));
    const file = new File([new Uint8Array([1, 2, 3])], 'x.ttf', { type: 'font/ttf' });
    await expect(api.uploadFont('p', file, { family: 'X', weight: 400, style: 'normal', fallback: 'serif' })).rejects.toBeTruthy();
  });

  it('gets a single page and builds the SSE events URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { item: { id: 'home' } }));
    const res = await api.getPage('p', 'home');
    expect(res.item.id).toBe('home');
    expect(fetchMock.mock.calls[0]![0]).toBe('/projects/p/content/page/home');
    expect(eventsUrl('p')).toBe('/projects/p/events');
  });

  it('creates a project (POST with body, no org)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { project: { id: 'p', name: 'P', slug: 's', role: 'owner' } }));
    await api.createProject('P', 's');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/projects');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'P', slug: 's' });
  });

  it('deletes a project', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    expect(await api.deleteProject('p')).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/projects/p');
    expect(init.method).toBe('DELETE');
  });

  it('PUTs a page to its content path', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { item: {} }));
    const page = { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' } };
    await api.putPage('p', page);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/projects/p/content/page/home');
    expect(init.method).toBe('PUT');
  });

  it('DELETEs a page (204 → undefined)', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    expect(await api.deletePage('p', 'home')).toBeUndefined();
    expect(fetchMock.mock.calls[0]![1].method).toBe('DELETE');
  });

  it('GETs the current user (flat shape, incl. email)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { userId: 'u', email: 'u@acme.test', platformRole: null, isInstanceAdmin: false, projects: [] }),
    );
    expect(await api.me()).toEqual({ userId: 'u', email: 'u@acme.test', platformRole: null, isInstanceAdmin: false, projects: [] });
    expect(fetchMock.mock.calls[0]![0]).toBe('/me');
  });

  it('reads the unauth login config (providers) and builds the OIDC start URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { oidcProviders: [{ id: 'google', label: 'Google' }] }));
    const cfg = await api.loginConfig();
    expect(cfg.oidcProviders).toEqual([{ id: 'google', label: 'Google' }]);
    expect(fetchMock.mock.calls[0]![0]).toBe('/auth/config');
    // The start URL is a navigable path (encoded id).
    expect(api.oidcStartUrl('acme sso')).toBe('/auth/oidc/acme%20sso/start');
  });

  it('surfaces a Zod validation body as a field-specific message and keeps the raw details', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: 'invalid request',
        details: { formErrors: [], fieldErrors: { password: ['One uppercase letter', 'One number'] } },
      }),
    );
    try {
      await api.register('a@b.co', 'weak');
      throw new Error('expected the register call to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      // The generic "invalid request" is replaced by the joined, de-duped field messages.
      expect(apiErr.message).toBe('One uppercase letter, One number');
      expect(apiErr.details?.fieldErrors?.password).toEqual(['One uppercase letter', 'One number']);
    }
  });

  it('keeps a specific server error message even when details are present', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { error: 'registration is by invitation only' }));
    await expect(api.register('a@b.co', 'Str0ng-Pw!')).rejects.toMatchObject({
      status: 403,
      message: 'registration is by invitation only',
    });
  });

  it('sets an initial password (no current) for an OIDC-only account', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    await api.changePassword(undefined, 'brand-new-pw-1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/account/password');
    expect(JSON.parse(init.body)).toEqual({ newPassword: 'brand-new-pw-1' }); // currentPassword omitted
  });

  it('changes account email + password via the session-only /account routes', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { email: 'new@acme.test' }));
    const res = await api.updateEmail('new@acme.test', 'Pw-secret-1');
    expect(res).toEqual({ email: 'new@acme.test' });
    let [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/account/email');
    expect(init.method).toBe('PUT');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body)).toEqual({ email: 'new@acme.test', currentPassword: 'Pw-secret-1' });

    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    expect(await api.changePassword('Pw-secret-1', 'new-pw-9876')).toBeUndefined();
    [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe('/account/password');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ currentPassword: 'Pw-secret-1', newPassword: 'new-pw-9876' });
  });

  it('drives the TOTP two-factor endpoints (login step 2 + setup/confirm/disable/regenerate)', async () => {
    // Login step 2.
    fetchMock.mockResolvedValue(jsonResponse(200, { userId: 'u' }));
    await api.loginTotp('tkt-1', '123456');
    let [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('/auth/login/totp');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ ticket: 'tkt-1', code: '123456' });

    // Begin enrolment.
    fetchMock.mockResolvedValue(jsonResponse(200, { secret: 'S', otpauthUri: 'otpauth://totp/x' }));
    expect((await api.mfaSetupTotp()).secret).toBe('S');
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/account/mfa/totp/setup');

    // Confirm → recovery codes.
    fetchMock.mockResolvedValue(jsonResponse(200, { recoveryCodes: ['A-B'] }));
    expect((await api.mfaConfirmTotp('123456')).recoveryCodes).toEqual(['A-B']);
    [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('/account/mfa/totp/confirm');
    expect(JSON.parse(init.body)).toEqual({ code: '123456' });

    // Disable (DELETE with a password body).
    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    expect(await api.mfaDisableTotp('Pw-secret-1')).toBeUndefined();
    [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('/account/mfa/totp');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body)).toEqual({ currentPassword: 'Pw-secret-1' });

    // Regenerate recovery codes.
    fetchMock.mockResolvedValue(jsonResponse(200, { recoveryCodes: ['C-D'] }));
    expect((await api.mfaRegenerateRecoveryCodes('Pw-secret-1')).recoveryCodes).toEqual(['C-D']);
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/account/mfa/recovery-codes');
  });

  it('drives the passkey (WebAuthn) endpoints', async () => {
    // Register options + verify.
    fetchMock.mockResolvedValue(jsonResponse(200, { options: { challenge: 'c' }, handle: 'h1' }));
    expect((await api.passkeyRegisterOptions()).handle).toBe('h1');
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/account/passkeys/register/options');

    fetchMock.mockResolvedValue(jsonResponse(201, { id: 'cred-1', name: 'Laptop' }));
    await api.passkeyRegisterVerify('h1', { id: 'cred-1' } as never, 'Laptop');
    let [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('/account/passkeys/register/verify');
    expect(JSON.parse(init.body)).toEqual({ handle: 'h1', response: { id: 'cred-1' }, name: 'Laptop' });

    // List / rename / delete.
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));
    await api.listPasskeys();
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/account/passkeys');

    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    await api.renamePasskey('cred 1', 'New');
    [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('/account/passkeys/cred%201'); // id URL-encoded
    expect(init.method).toBe('PATCH');

    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    await api.deletePasskey('cred-1');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('DELETE');

    // Passwordless login options + verify.
    fetchMock.mockResolvedValue(jsonResponse(200, { options: { challenge: 'c' }, handle: 'h2' }));
    expect((await api.passkeyLoginOptions()).handle).toBe('h2');
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/auth/passkey/options');

    fetchMock.mockResolvedValue(jsonResponse(200, { userId: 'u' }));
    const res = await api.passkeyLoginVerify('h2', { id: 'cred-1' } as never);
    expect(res).toEqual({ userId: 'u' });
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/auth/passkey/verify');
  });

  it('lists and removes platform-staff via the admin routes', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { members: [] }));
    await api.listMembers();
    expect(fetchMock.mock.calls[0]![0]).toBe('/admin/users');

    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    expect(await api.removeMember('u-1')).toBeUndefined();
    const [delUrl, delInit] = fetchMock.mock.calls[1]!;
    expect(delUrl).toBe('/admin/users/u-1');
    expect(delInit.method).toBe('DELETE');
  });

  it('creates developer + client invites, lists/revokes, peeks, and accepts (flat)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { invite: { id: 'i' }, token: 'swi_x' }));
    const dev = await api.inviteDeveloper('dev@a.co');
    expect(dev.token).toBe('swi_x');
    expect(fetchMock.mock.calls[0]![0]).toBe('/admin/invites');
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ email: 'dev@a.co' });

    await api.inviteClient('p', 'client@a.co');
    expect(fetchMock.mock.calls[1]![0]).toBe('/projects/p/invites');

    fetchMock.mockResolvedValue(jsonResponse(200, { invites: [] }));
    await api.listProjectInvites('p');
    expect(fetchMock.mock.calls[2]![0]).toBe('/projects/p/invites');
    await api.listInvites();
    expect(fetchMock.mock.calls[3]![0]).toBe('/admin/invites');

    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    await api.revokeInvite('i-1');
    expect(fetchMock.mock.calls[4]![0]).toBe('/invites/i-1');
    expect(fetchMock.mock.calls[4]![1].method).toBe('DELETE');

    fetchMock.mockResolvedValue(jsonResponse(200, { invite: { email: 'c@a.co', role: 'member', projectName: 'Site', expired: false, accepted: false } }));
    await api.peekInvite('swi_x');
    expect(fetchMock.mock.calls[5]![0]).toBe('/invites/peek?token=swi_x');

    fetchMock.mockResolvedValue(jsonResponse(200, { projectId: 'p', role: 'member' }));
    const accepted = await api.acceptInvite('swi_x');
    expect(accepted.projectId).toBe('p');
    expect(fetchMock.mock.calls[6]![0]).toBe('/invites/accept');
    expect(JSON.parse(fetchMock.mock.calls[6]![1].body)).toEqual({ token: 'swi_x' });
  });

  it('lists and removes project clients (project-scoped members)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { members: [] }));
    await api.listProjectMembers('p');
    expect(fetchMock.mock.calls[0]![0]).toBe('/projects/p/members');

    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    await api.removeProjectMember('p', 'u-1');
    expect(fetchMock.mock.calls[1]![0]).toBe('/projects/p/members/u-1');
    expect(fetchMock.mock.calls[1]![1].method).toBe('DELETE');
  });

  it('GETs the version/update status', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { current: '1.0.0', latest: '1.1.0', updateAvailable: true, releaseUrl: 'u' }),
    );
    const res = await api.version();
    expect(res.updateAvailable).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toBe('/version');
  });

  it('POSTs a page to the preview endpoint and returns the html', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { html: '<!doctype html>…' }));
    const page = { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' } };
    const res = await api.preview('p', page);
    expect(res.html).toContain('<!doctype html>');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/projects/p/preview');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ id: 'home' });
  });

  it('drives the media operation endpoints (patch/copy asset, folder CRUD, stock folder)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { item: {}, items: [], ok: true }));

    await api.patchMedia('p', 'a1', { folder: 'Docs', filename: 'x.pdf' });
    let [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('/projects/p/media/a1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ folder: 'Docs', filename: 'x.pdf' });

    await api.copyMedia('p', 'a1', 'Copies');
    [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('/projects/p/media/a1/copy');
    expect(JSON.parse(init.body)).toEqual({ folder: 'Copies' });

    await api.listMediaFolders('p');
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/projects/p/media/folders');

    await api.createMediaFolder('p', 'Brand');
    [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('/projects/p/media/folders');
    expect(JSON.parse(init.body)).toEqual({ path: 'Brand' });

    await api.renameMediaFolder('p', 'Old', 'New');
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/projects/p/media/folders/rename');
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body)).toEqual({ from: 'Old', to: 'New' });

    await api.copyMediaFolder('p', 'Src', 'Dst');
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/projects/p/media/folders/copy');

    fetchMock.mockResolvedValue(jsonResponse(204, {}));
    await api.deleteMediaFolder('p', 'Trash');
    [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('/projects/p/media/folders');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body)).toEqual({ path: 'Trash' });

    fetchMock.mockResolvedValue(jsonResponse(201, { item: {} }));
    await api.importStock('p', 'openverse', 'ov1', 'a cat', 'Stock');
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body)).toEqual({ provider: 'openverse', id: 'ov1', alt: 'a cat', folder: 'Stock' });
  });

  it('lists templates and gets one (id URL-encoded) at the content path', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));
    await api.listTemplates('p');
    expect(fetchMock.mock.calls[0]![0]).toBe('/projects/p/content/template');

    fetchMock.mockResolvedValue(jsonResponse(200, { item: { id: 'promo', name: 'Promo', source: '<p/>' } }));
    const res = await api.getTemplate('p', 'promo');
    expect(res.item.id).toBe('promo');
    expect(fetchMock.mock.calls[1]![0]).toBe('/projects/p/content/template/promo');
  });

  it('lists and PUTs datasets at the content path', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));
    await api.listDatasets('p');
    expect(fetchMock.mock.calls[0]![0]).toBe('/projects/p/content/dataset');

    fetchMock.mockResolvedValue(jsonResponse(200, { item: {} }));
    await api.putDataset('p', { id: 'posts', name: 'Posts', slug: 'posts', fields: [] });
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe('/projects/p/content/dataset/posts');
    expect(init.method).toBe('PUT');
  });

  it('lists, PUTs and DELETEs entries', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));
    await api.listEntries('p');
    expect(fetchMock.mock.calls[0]![0]).toBe('/projects/p/content/entry');

    fetchMock.mockResolvedValue(jsonResponse(200, { item: {} }));
    await api.putEntry('p', { id: 'e1', dataset: 'posts', status: 'draft', values: {} });
    expect(fetchMock.mock.calls[1]![0]).toBe('/projects/p/content/entry/e1');

    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    await api.deleteEntry('p', 'e1');
    expect(fetchMock.mock.calls[2]![1].method).toBe('DELETE');
  });

  it('DELETEs a dataset', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    await api.deleteDataset('p', 'posts');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/projects/p/content/dataset/posts');
    expect(init.method).toBe('DELETE');
  });

  it('lists media and uploads a file as multipart FormData', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));
    await api.listMedia('p');
    expect(fetchMock.mock.calls[0]![0]).toBe('/projects/p/media');

    fetchMock.mockResolvedValue(jsonResponse(201, { item: { id: 'm1' } }));
    const file = new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' });
    const res = await api.uploadMedia('p', file);
    expect(res.item.id).toBe('m1');
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe('/projects/p/media');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers).toBeUndefined(); // browser sets the multipart boundary
  });

  it('throws ApiError when an upload fails', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'unsupported or invalid image' }));
    const file = new File([new Uint8Array([0])], 'x.txt', { type: 'text/plain' });
    await expect(api.uploadMedia('p', file)).rejects.toMatchObject({
      status: 400,
      message: 'unsupported or invalid image',
    });
  });

  it('DELETEs media', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    await api.deleteMedia('p', 'm1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/projects/p/media/m1');
    expect(init.method).toBe('DELETE');
  });

  it('manages saved deploy targets', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));
    await api.listDeployTargets('p');
    expect(fetchMock.mock.calls[0]![0]).toBe('/projects/p/deploy-targets');

    fetchMock.mockResolvedValue(jsonResponse(201, { target: { id: 't1' } }));
    await api.createDeployTarget('p', {
      name: 'Prod',
      protocol: 'sftp',
      host: 'h',
      user: 'u',
      password: 'pw',
    });
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe('/projects/p/deploy-targets');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ name: 'Prod', host: 'h' });

    fetchMock.mockResolvedValue(jsonResponse(200, { deployed: { protocol: 'sftp', files: 4 } }));
    await api.deployToTarget('p', 't1');
    expect(fetchMock.mock.calls[2]![0]).toBe('/projects/p/deploy-targets/t1/deploy');

    fetchMock.mockResolvedValue(jsonResponse(200, { target: { id: 't1' } }));
    await api.updateDeployTarget('p', 't1', { name: 'Prod 2', minifyHtml: true });
    const [putUrl, putInit] = fetchMock.mock.calls[3]!;
    expect(putUrl).toBe('/projects/p/deploy-targets/t1');
    expect(putInit.method).toBe('PUT');
    expect(JSON.parse(putInit.body)).toMatchObject({ name: 'Prod 2', minifyHtml: true });

    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    await api.deleteDeployTarget('p', 't1');
    expect(fetchMock.mock.calls[4]![1].method).toBe('DELETE');
  });

  it('deployTargetStream POSTs to the SSE endpoint and dispatches progress + done frames', async () => {
    const enc = new TextEncoder();
    const frames = [
      'event: progress\ndata: {"phase":"connecting","index":0,"total":2}\n\n',
      'event: progress\ndata: {"phase":"uploading","index":1,"total":2,"file":"index.html"}\n\n',
      'event: done\ndata: {"deployed":{"protocol":"sftp","files":2}}\n\n',
    ];
    let i = 0;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: { getReader: () => ({ read: async () => (i < frames.length ? { done: false, value: enc.encode(frames[i++]) } : { done: true }) }) },
    } as unknown as Response);

    const progress: unknown[] = [];
    let done: unknown;
    await api.deployTargetStream('p', 't1', { onProgress: (e) => progress.push(e), onDone: (d) => (done = d) });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/projects/p/deploy-targets/t1/deploy/stream');
    expect(init.method).toBe('POST');
    expect(progress).toEqual([
      { phase: 'connecting', index: 0, total: 2 },
      { phase: 'uploading', index: 1, total: 2, file: 'index.html' },
    ]);
    expect(done).toEqual({ protocol: 'sftp', files: 2 });
  });

  it('deployTargetStream surfaces a preflight JSON error (e.g. 409) via onError', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, statusText: 'Conflict', json: async () => ({ error: 'publish the site before deploying' }) } as Response);
    let err: string | undefined;
    await api.deployTargetStream('p', 't1', { onError: (m) => (err = m) });
    expect(err).toMatch(/publish the site/);
  });

  it('deployTargetStream emits an error frame as onError', async () => {
    const enc = new TextEncoder();
    const frames = ['event: error\ndata: {"message":"deploy failed: could not connect or transfer to the target"}\n\n'];
    let i = 0;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: { getReader: () => ({ read: async () => (i < frames.length ? { done: false, value: enc.encode(frames[i++]) } : { done: true }) }) },
    } as unknown as Response);
    let err: string | undefined;
    await api.deployTargetStream('p', 't1', { onError: (m) => (err = m) });
    expect(err).toMatch(/deploy failed/);
  });

  it('importWebsiteStream POSTs the crawl body + unwraps the report from the done frame', async () => {
    const enc = new TextEncoder();
    const frames = [
      'event: progress\ndata: {"phase":"crawl","fetched":1}\n\n',
      'event: done\ndata: {"report":{"pagesImported":2,"pagesFound":2,"mediaSelfHosted":0,"scriptsDropped":1,"chromeExtracted":false,"truncated":false,"warnings":[]}}\n\n',
    ];
    let i = 0;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: { getReader: () => ({ read: async () => (i < frames.length ? { done: false, value: enc.encode(frames[i++]) } : { done: true }) }) },
    } as unknown as Response);

    const progress: unknown[] = [];
    let report: { pagesImported?: number } | undefined;
    await api.importWebsiteStream('p', { url: 'https://x.com', maxPages: 10 }, { onProgress: (e) => progress.push(e), onDone: (r) => (report = r) });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/projects/p/import/website/stream?foundation=1'); // AI-clone flow → foundation pipeline
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ url: 'https://x.com', maxPages: 10 });
    expect(progress).toEqual([{ phase: 'crawl', fetched: 1 }]);
    expect(report?.pagesImported).toBe(2);
  });

  it('importUploadStream POSTs the file as multipart form data', async () => {
    const enc = new TextEncoder();
    const frames = ['event: done\ndata: {"report":{"pagesImported":1,"pagesFound":1,"mediaSelfHosted":0,"scriptsDropped":0,"chromeExtracted":false,"truncated":false,"warnings":[]}}\n\n'];
    let i = 0;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: { getReader: () => ({ read: async () => (i < frames.length ? { done: false, value: enc.encode(frames[i++]) } : { done: true }) }) },
    } as unknown as Response);

    let report: { pagesImported?: number } | undefined;
    await api.importUploadStream('p', new File(['PK'], 'site.zip', { type: 'application/zip' }), { onDone: (r) => (report = r) });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/projects/p/import/upload/stream?foundation=1'); // AI-clone flow → foundation pipeline
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBeInstanceOf(File);
    expect(report?.pagesImported).toBe(1);
  });

  it('importWebsiteStream surfaces a preflight error (e.g. 403) via onError', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden', json: async () => ({ error: 'only the project owner can import a website' }) } as Response);
    let err: string | undefined;
    await api.importWebsiteStream('p', { url: 'https://x.com' }, { onError: (m) => (err = m) });
    expect(err).toMatch(/only the project owner/);
  });

  it('publishes and reads publish status', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { release: { routes: 2 }, url: '/sites/p/' }));
    const res = await api.publish('p');
    expect(res.url).toBe('/sites/p/');
    expect(fetchMock.mock.calls[0]![0]).toBe('/projects/p/publish');
    expect(fetchMock.mock.calls[0]![1].method).toBe('POST');

    fetchMock.mockResolvedValue(jsonResponse(200, { release: null, url: '/sites/p/' }));
    const status = await api.publishStatus('p');
    expect(status.release).toBeNull();
    expect(fetchMock.mock.calls[1]![1].method ?? 'GET').toBe('GET');
  });

  it('builds the archive download URL and POSTs a deploy config', async () => {
    expect(api.archiveUrl('p')).toBe('/projects/p/publish/archive');

    fetchMock.mockResolvedValue(jsonResponse(200, { deployed: { protocol: 'sftp', files: 3 } }));
    const res = await api.deploy('p', {
      protocol: 'sftp',
      host: 'example.com',
      user: 'u',
      password: 'pw',
      remoteDir: '/var/www',
    });
    expect(res.deployed.files).toBe(3);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/projects/p/publish/deploy');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ protocol: 'sftp', host: 'example.com' });
  });

  it('lists, creates (token once) and revokes project API keys', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));
    await api.listApiKeys('p');
    expect(fetchMock.mock.calls[0]![0]).toBe('/projects/p/api-keys');

    fetchMock.mockResolvedValue(jsonResponse(201, { token: 'swk_x', key: { id: 'k1', name: 'CI' } }));
    const created = await api.createApiKey('p', {
      name: 'CI',
      role: 'owner',
      capabilities: ['content:read', 'content:write'],
      expiresInDays: 30,
    });
    expect(created.token).toBe('swk_x');
    const [createUrl, createInit] = fetchMock.mock.calls[1]!;
    expect(createUrl).toBe('/projects/p/api-keys');
    expect(createInit.method).toBe('POST');
    expect(JSON.parse(createInit.body)).toMatchObject({ name: 'CI', role: 'owner', expiresInDays: 30 });

    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    await api.deleteApiKey('p', 'k1');
    const [delUrl, delInit] = fetchMock.mock.calls[2]!;
    expect(delUrl).toBe('/projects/p/api-keys/k1');
    expect(delInit.method).toBe('DELETE');
  });

  it('lists agent connections and disconnects one (URL-encoding the opaque oauth id)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [{ id: 'oauth:u1', kind: 'oauth' }] }));
    const list = await api.listAgentConnections('p');
    expect(list.items[0]!.kind).toBe('oauth');
    expect(fetchMock.mock.calls[0]![0]).toBe('/projects/p/agent-connections');

    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    await api.disconnectAgent('p', 'oauth:u1');
    const [discUrl, discInit] = fetchMock.mock.calls[1]!;
    expect(discUrl).toBe('/projects/p/agent-connections/oauth%3Au1'); // colon encoded
    expect(discInit.method).toBe('DELETE');
  });

  it('reads project settings (locales) from the settings singleton', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { item: { settings: { defaultLocale: 'en', locales: ['en', 'de'] } } }),
    );
    const res = await api.getSettings('p');
    expect(res.item.settings.locales).toEqual(['en', 'de']);
    expect(fetchMock.mock.calls[0]![0]).toBe('/projects/p/content/settings/settings');
    expect(fetchMock.mock.calls[0]![1].method ?? 'GET').toBe('GET');
  });

  it('reads and writes instance admin settings', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { settings: { formModes: { globalSmtp: false, userSmtp: false, contactPhp: false, thirdParty: false } } }),
    );
    const got = await api.getInstanceSettings();
    expect(got.settings.formModes.globalSmtp).toBe(false);
    const [getUrl, getInit] = fetchMock.mock.calls[0]!;
    expect(getUrl).toBe('/admin/settings');
    expect(getInit.method).toBe('GET');
    expect(getInit.credentials).toBe('include');

    fetchMock.mockResolvedValue(
      jsonResponse(200, { settings: { formModes: { globalSmtp: true, userSmtp: false, contactPhp: false, thirdParty: false }, smtp: { host: 'h', port: 587, secure: false, fromEmail: 'a@b.co', hasPassword: true } } }),
    );
    const saved = await api.putInstanceSettings({
      formModes: { globalSmtp: true },
      smtp: { host: 'h', port: 587, secure: false, fromEmail: 'a@b.co', password: 'pw' },
    });
    expect(saved.settings.smtp?.hasPassword).toBe(true);
    const [putUrl, putInit] = fetchMock.mock.calls[1]!;
    expect(putUrl).toBe('/admin/settings');
    expect(putInit.method).toBe('PUT');
    expect(JSON.parse(putInit.body)).toMatchObject({ smtp: { host: 'h', password: 'pw' } });
  });

  it('reads cookieSecretPinned and rotates the session signing key', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { settings: { formModes: { globalSmtp: false, userSmtp: false, contactPhp: false, thirdParty: false } }, cookieSecretPinned: true }),
    );
    const got = await api.getInstanceSettings();
    expect(got.cookieSecretPinned).toBe(true);

    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    const rot = await api.rotateCookieSecret();
    expect(rot.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe('/admin/cookie-secret/rotate');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
  });

  it('lists, puts and deletes forms on the content/form route', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));
    await api.listForms('p');
    expect(fetchMock.mock.calls[0]![0]).toBe('/projects/p/content/form');

    const form = {
      id: 'contact',
      name: 'Contact',
      fields: [{ name: 'email', label: 'Email', type: 'email' as const, required: false }],
      recipient: 'a@b.co',
      submitLabel: 'Send',
      successMessage: 'ok',
      errorMessage: 'err',
      mode: 'globalSmtp' as const,
      hcaptcha: false,
    };
    fetchMock.mockResolvedValue(jsonResponse(200, { item: form }));
    await api.putForm('p', form);
    const [putUrl, putInit] = fetchMock.mock.calls[1]!;
    expect(putUrl).toBe('/projects/p/content/form/contact');
    expect(putInit.method).toBe('PUT');

    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    await api.deleteForm('p', 'contact');
    expect(fetchMock.mock.calls[2]![1].method).toBe('DELETE');

    fetchMock.mockResolvedValue(jsonResponse(200, { formModes: { globalSmtp: true, userSmtp: false, contactPhp: true, thirdParty: false } }));
    const fm = await api.formModes('p');
    expect(fm.formModes.contactPhp).toBe(true);
    expect(fetchMock.mock.calls[3]![0]).toBe('/projects/p/form-modes');
  });

  it('reads, writes, and deletes the per-project SMTP config', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { smtp: null }));
    expect((await api.getProjectSmtp('p')).smtp).toBeNull();
    expect(fetchMock.mock.calls[0]![0]).toBe('/projects/p/smtp');

    fetchMock.mockResolvedValue(jsonResponse(200, { smtp: { host: 'h', port: 587, secure: false, fromEmail: 'a@b.co', hasPassword: true } }));
    await api.putProjectSmtp('p', { host: 'h', port: 587, secure: false, fromEmail: 'a@b.co', password: 'pw' });
    const [putUrl, putInit] = fetchMock.mock.calls[1]!;
    expect(putUrl).toBe('/projects/p/smtp');
    expect(putInit.method).toBe('PUT');
    expect(JSON.parse(putInit.body)).toMatchObject({ host: 'h', password: 'pw' });

    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    await api.deleteProjectSmtp('p');
    expect(fetchMock.mock.calls[2]![1].method).toBe('DELETE');
  });

  it('lists and deletes submissions, passing the formId filter', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [], total: 0 }));
    await api.listSubmissions('p');
    expect(fetchMock.mock.calls[0]![0]).toBe('/projects/p/submissions');

    fetchMock.mockResolvedValue(jsonResponse(200, { items: [], total: 0 }));
    await api.listSubmissions('p', 'contact');
    expect(fetchMock.mock.calls[1]![0]).toBe('/projects/p/submissions?formId=contact');

    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    await api.deleteSubmission('p', 's1');
    const [delUrl, delInit] = fetchMock.mock.calls[2]!;
    expect(delUrl).toBe('/projects/p/submissions/s1');
    expect(delInit.method).toBe('DELETE');
  });

  it('lists, puts and deletes page translations on the generic content/translation route', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));
    await api.listTranslations('p');
    expect(fetchMock.mock.calls[0]![0]).toBe('/projects/p/content/translation');

    const tr = { id: 'home__de', pageId: 'home', locale: 'de', root: { id: 'r', type: 'Section' } };
    fetchMock.mockResolvedValue(jsonResponse(200, { item: tr }));
    await api.putTranslation('p', tr);
    const [putUrl, putInit] = fetchMock.mock.calls[1]!;
    expect(putUrl).toBe('/projects/p/content/translation/home__de');
    expect(putInit.method).toBe('PUT');
    expect(JSON.parse(putInit.body)).toEqual(tr);

    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    await api.deleteTranslation('p', 'home__de');
    const [delUrl, delInit] = fetchMock.mock.calls[2]!;
    expect(delUrl).toBe('/projects/p/content/translation/home__de');
    expect(delInit.method).toBe('DELETE');
  });
});

describe('unauthorized (401) handling', () => {
  it('invokes the registered handler on a 401 (expired/invalid session), still throwing the ApiError', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Not authenticated' }));
    await expect(api.me()).rejects.toMatchObject({ status: 401, message: 'Not authenticated' });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('does NOT invoke the handler on other failures or on success', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    fetchMock.mockResolvedValue(jsonResponse(403, { error: 'forbidden' }));
    await expect(api.projects()).rejects.toMatchObject({ status: 403 });
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'boom' }));
    await expect(api.projects()).rejects.toMatchObject({ status: 500 });
    fetchMock.mockResolvedValue(jsonResponse(200, { projects: [] }));
    await api.projects();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('is a no-op when no handler is registered (401 still throws normally)', async () => {
    setUnauthorizedHandler(undefined);
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Not authenticated' }));
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
  });

  it('revision-history wrappers hit the content/<kind>/<id>/revisions endpoints', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));
    await api.listRevisions('p1', 'page', 'home');
    expect(fetchMock.mock.calls[0]![0]).toBe('/projects/p1/content/page/home/revisions');

    fetchMock.mockResolvedValue(jsonResponse(200, { revision: {} }));
    await api.getRevision('p1', 'dataset', 'team', 'rev9');
    expect(fetchMock.mock.calls[1]![0]).toBe('/projects/p1/content/dataset/team/revisions/rev9');

    fetchMock.mockResolvedValue(jsonResponse(200, { item: {} }));
    await api.restoreRevision('p1', 'settings', 'settings', 'rev3');
    const [url, init] = fetchMock.mock.calls[2]!;
    expect(url).toBe('/projects/p1/content/settings/settings/revisions/rev3/restore');
    expect(init.method).toBe('POST');
  });

  it('listProjectRevisions builds the project-wide feed URL with optional filters', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [], nextBefore: null }));
    await api.listProjectRevisions('p1', { kind: 'page', op: 'delete', limit: 25, before: '2026-06-21T00:00:00.000Z' });
    expect(fetchMock.mock.calls[0]![0]).toBe('/projects/p1/revisions?kind=page&op=delete&limit=25&before=2026-06-21T00%3A00%3A00.000Z');

    await api.listProjectRevisions('p1');
    expect(fetchMock.mock.calls[1]![0]).toBe('/projects/p1/revisions'); // no opts → bare path
  });

  it('builds the thin preview / dataset / entry / stock / authoring GET URLs', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await api.previewLocate('p1', 'page:home');
    await api.previewBase('p1');
    await api.agentPresence('p1');
    await api.listDatasets('p1');
    await api.getDataset('p1', 'team');
    await api.listEntries('p1');
    await api.getEntry('p1', 'e1');
    await api.stockProviders('p1');
    await api.listMediaFolders('p1');
    await api.buttonPreviewCss();
    await api.listEffectForks();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      '/projects/p1/preview-locate?entity=page%3Ahome',
      '/projects/p1/preview-url',
      '/projects/p1/agent-presence',
      '/projects/p1/content/dataset',
      '/projects/p1/content/dataset/team',
      '/projects/p1/content/entry',
      '/projects/p1/content/entry/e1',
      '/projects/p1/stock/providers',
      '/projects/p1/media/folders',
      '/authoring/button-preview-css',
      '/authoring/effect-forks',
    ]);
  });

  it('builds the media-mutation + media-folder request URLs with the right verbs', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await api.importMediaUrl('p1', 'https://x/y.png', 'logos');
    await api.patchMedia('p1', 'm1', { folder: 'logos' });
    await api.copyMedia('p1', 'm1', 'dup');
    await api.createMediaFolder('p1', 'a/b');
    await api.renameMediaFolder('p1', 'a', 'c');
    await api.copyMediaFolder('p1', 'a', 'd');
    await api.deleteMediaFolder('p1', 'a/b');
    expect(fetchMock.mock.calls.map((c) => [c[1].method, c[0]])).toEqual([
      ['POST', '/projects/p1/media/import-url'],
      ['PATCH', '/projects/p1/media/m1'],
      ['POST', '/projects/p1/media/m1/copy'],
      ['POST', '/projects/p1/media/folders'],
      ['POST', '/projects/p1/media/folders/rename'],
      ['POST', '/projects/p1/media/folders/copy'],
      ['DELETE', '/projects/p1/media/folders'],
    ]);
  });
});
