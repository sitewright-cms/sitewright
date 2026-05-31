import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { api, ApiError, eventsUrl } from '../src/api';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    json: async () => body,
  } as Response;
}

describe('api client', () => {
  it('POSTs register with a JSON body and credentials', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { userId: 'u', orgId: 'o' }));
    const res = await api.register('a@b.co', 'pw-secret-1', 'Acme');
    expect(res).toEqual({ userId: 'u', orgId: 'o' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/auth/register');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body)).toEqual({ email: 'a@b.co', password: 'pw-secret-1', orgName: 'Acme' });
  });

  it('throws ApiError with the server error message on failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { error: 'forbidden' }));
    await expect(api.projects('o')).rejects.toMatchObject({ status: 403, message: 'forbidden' });
    await expect(api.projects('o')).rejects.toBeInstanceOf(ApiError);
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

  it('builds content paths correctly', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));
    await api.listPages('org1', 'proj1');
    expect(fetchMock.mock.calls[0]![0]).toBe('/orgs/org1/projects/proj1/content/page');
  });

  it('gets a single page and builds the SSE events URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { item: { id: 'home' } }));
    const res = await api.getPage('o', 'p', 'home');
    expect(res.item.id).toBe('home');
    expect(fetchMock.mock.calls[0]![0]).toBe('/orgs/o/projects/p/content/page/home');
    expect(eventsUrl('o', 'p')).toBe('/orgs/o/projects/p/events');
  });

  it('creates a project (POST with body)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { project: { id: 'p', name: 'P', slug: 's' } }));
    await api.createProject('o', 'P', 's');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/orgs/o/projects');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'P', slug: 's' });
  });

  it('PUTs a page to its content path', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { item: {} }));
    const page = { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' } };
    await api.putPage('o', 'p', page);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/orgs/o/projects/p/content/page/home');
    expect(init.method).toBe('PUT');
  });

  it('DELETEs a page (204 → undefined)', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    expect(await api.deletePage('o', 'p', 'home')).toBeUndefined();
    expect(fetchMock.mock.calls[0]![1].method).toBe('DELETE');
  });

  it('GETs the current user', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { userId: 'u', orgs: [] }));
    expect(await api.me()).toEqual({ userId: 'u', orgs: [] });
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
    const res = await api.preview('o', 'p', page);
    expect(res.html).toContain('<!doctype html>');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/orgs/o/projects/p/preview');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ id: 'home' });
  });

  it('lists and PUTs datasets at the content path', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));
    await api.listDatasets('o', 'p');
    expect(fetchMock.mock.calls[0]![0]).toBe('/orgs/o/projects/p/content/dataset');

    fetchMock.mockResolvedValue(jsonResponse(200, { item: {} }));
    await api.putDataset('o', 'p', { id: 'posts', name: 'Posts', slug: 'posts', fields: [] });
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe('/orgs/o/projects/p/content/dataset/posts');
    expect(init.method).toBe('PUT');
  });

  it('lists, PUTs and DELETEs entries', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));
    await api.listEntries('o', 'p');
    expect(fetchMock.mock.calls[0]![0]).toBe('/orgs/o/projects/p/content/entry');

    fetchMock.mockResolvedValue(jsonResponse(200, { item: {} }));
    await api.putEntry('o', 'p', { id: 'e1', dataset: 'posts', status: 'draft', values: {} });
    expect(fetchMock.mock.calls[1]![0]).toBe('/orgs/o/projects/p/content/entry/e1');

    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    await api.deleteEntry('o', 'p', 'e1');
    expect(fetchMock.mock.calls[2]![1].method).toBe('DELETE');
  });

  it('DELETEs a dataset', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    await api.deleteDataset('o', 'p', 'posts');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/orgs/o/projects/p/content/dataset/posts');
    expect(init.method).toBe('DELETE');
  });

  it('lists media and uploads a file as multipart FormData', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));
    await api.listMedia('o', 'p');
    expect(fetchMock.mock.calls[0]![0]).toBe('/orgs/o/projects/p/media');

    fetchMock.mockResolvedValue(jsonResponse(201, { item: { id: 'm1' } }));
    const file = new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' });
    const res = await api.uploadMedia('o', 'p', file);
    expect(res.item.id).toBe('m1');
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe('/orgs/o/projects/p/media');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers).toBeUndefined(); // browser sets the multipart boundary
  });

  it('throws ApiError when an upload fails', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'unsupported or invalid image' }));
    const file = new File([new Uint8Array([0])], 'x.txt', { type: 'text/plain' });
    await expect(api.uploadMedia('o', 'p', file)).rejects.toMatchObject({
      status: 400,
      message: 'unsupported or invalid image',
    });
  });

  it('DELETEs media', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    await api.deleteMedia('o', 'p', 'm1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/orgs/o/projects/p/media/m1');
    expect(init.method).toBe('DELETE');
  });

  it('manages saved deploy targets', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));
    await api.listDeployTargets('o', 'p');
    expect(fetchMock.mock.calls[0]![0]).toBe('/orgs/o/projects/p/deploy-targets');

    fetchMock.mockResolvedValue(jsonResponse(201, { target: { id: 't1' } }));
    await api.createDeployTarget('o', 'p', {
      name: 'Prod',
      protocol: 'sftp',
      host: 'h',
      user: 'u',
      password: 'pw',
    });
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe('/orgs/o/projects/p/deploy-targets');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ name: 'Prod', host: 'h' });

    fetchMock.mockResolvedValue(jsonResponse(200, { deployed: { protocol: 'sftp', files: 4 } }));
    await api.deployToTarget('o', 'p', 't1');
    expect(fetchMock.mock.calls[2]![0]).toBe('/orgs/o/projects/p/deploy-targets/t1/deploy');

    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    await api.deleteDeployTarget('o', 'p', 't1');
    expect(fetchMock.mock.calls[3]![1].method).toBe('DELETE');
  });

  it('publishes and reads publish status', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { release: { routes: 2 }, url: '/sites/p/' }));
    const res = await api.publish('o', 'p');
    expect(res.url).toBe('/sites/p/');
    expect(fetchMock.mock.calls[0]![0]).toBe('/orgs/o/projects/p/publish');
    expect(fetchMock.mock.calls[0]![1].method).toBe('POST');

    fetchMock.mockResolvedValue(jsonResponse(200, { release: null, url: '/sites/p/' }));
    const status = await api.publishStatus('o', 'p');
    expect(status.release).toBeNull();
    expect(fetchMock.mock.calls[1]![1].method ?? 'GET').toBe('GET');
  });

  it('builds the archive download URL and POSTs a deploy config', async () => {
    expect(api.archiveUrl('o', 'p')).toBe('/orgs/o/projects/p/publish/archive');

    fetchMock.mockResolvedValue(jsonResponse(200, { deployed: { protocol: 'sftp', files: 3 } }));
    const res = await api.deploy('o', 'p', {
      protocol: 'sftp',
      host: 'example.com',
      user: 'u',
      password: 'pw',
      remoteDir: '/var/www',
    });
    expect(res.deployed.files).toBe(3);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/orgs/o/projects/p/publish/deploy');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ protocol: 'sftp', host: 'example.com' });
  });

  it('lists, creates (token once) and revokes project API keys', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));
    await api.listApiKeys('o', 'p');
    expect(fetchMock.mock.calls[0]![0]).toBe('/orgs/o/projects/p/api-keys');

    fetchMock.mockResolvedValue(jsonResponse(201, { token: 'swk_x', key: { id: 'k1', name: 'CI' } }));
    const created = await api.createApiKey('o', 'p', {
      name: 'CI',
      role: 'admin',
      capabilities: ['content:read', 'content:write'],
      expiresInDays: 30,
    });
    expect(created.token).toBe('swk_x');
    const [createUrl, createInit] = fetchMock.mock.calls[1]!;
    expect(createUrl).toBe('/orgs/o/projects/p/api-keys');
    expect(createInit.method).toBe('POST');
    expect(JSON.parse(createInit.body)).toMatchObject({ name: 'CI', role: 'admin', expiresInDays: 30 });

    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    await api.deleteApiKey('o', 'p', 'k1');
    const [delUrl, delInit] = fetchMock.mock.calls[2]!;
    expect(delUrl).toBe('/orgs/o/projects/p/api-keys/k1');
    expect(delInit.method).toBe('DELETE');
  });

  it('reads project settings (locales) from the settings singleton', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { item: { settings: { defaultLocale: 'en', locales: ['en', 'de'] } } }),
    );
    const res = await api.getSettings('o', 'p');
    expect(res.item.settings.locales).toEqual(['en', 'de']);
    expect(fetchMock.mock.calls[0]![0]).toBe('/orgs/o/projects/p/content/settings/settings');
    expect(fetchMock.mock.calls[0]![1].method ?? 'GET').toBe('GET');
  });

  it('lists, puts and deletes page translations on the generic content/translation route', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));
    await api.listTranslations('o', 'p');
    expect(fetchMock.mock.calls[0]![0]).toBe('/orgs/o/projects/p/content/translation');

    const tr = { id: 'home__de', pageId: 'home', locale: 'de', root: { id: 'r', type: 'Section' } };
    fetchMock.mockResolvedValue(jsonResponse(200, { item: tr }));
    await api.putTranslation('o', 'p', tr);
    const [putUrl, putInit] = fetchMock.mock.calls[1]!;
    expect(putUrl).toBe('/orgs/o/projects/p/content/translation/home__de');
    expect(putInit.method).toBe('PUT');
    expect(JSON.parse(putInit.body)).toEqual(tr);

    fetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);
    await api.deleteTranslation('o', 'p', 'home__de');
    const [delUrl, delInit] = fetchMock.mock.calls[2]!;
    expect(delUrl).toBe('/orgs/o/projects/p/content/translation/home__de');
    expect(delInit.method).toBe('DELETE');
  });
});
