import type {
  Dataset,
  DeployTargetView,
  Entry,
  MediaAsset,
  Page,
  PageTranslation,
  Pattern,
  ProjectSettings,
} from '@sitewright/schema';

export type { DeployTargetView };

/** Base URL for the API. Empty = same origin (the API serves this SPA). */
const BASE = import.meta.env.VITE_API_BASE ?? '';

/**
 * Absolute URL of the sandboxed preview document for a token — loaded via the
 * preview iframe's `src` (not `srcDoc`), so the document is served under its own
 * `Content-Security-Policy: sandbox` rather than inheriting the editor's CSP.
 */
export function previewDocUrl(orgId: string, projectId: string, token: string): string {
  return `${BASE}/orgs/${orgId}/projects/${projectId}/preview/${encodeURIComponent(token)}`;
}

/** URL of the project's Server-Sent-Events change stream (for `EventSource`). */
export function eventsUrl(orgId: string, projectId: string): string {
  return `${BASE}/orgs/${orgId}/projects/${projectId}/events`;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function errorFromResponse(res: Response): Promise<ApiError> {
  let message = res.statusText;
  try {
    const json = (await res.json()) as { error?: string };
    if (json.error) message = json.error;
  } catch {
    // non-JSON error body — keep statusText
  }
  return new ApiError(res.status, message);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await errorFromResponse(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface Org {
  id: string;
  name: string;
  slug: string;
  role: string;
}
export interface Project {
  id: string;
  name: string;
  slug: string;
}
export type ApiKeyCapability = 'content:read' | 'content:write' | 'publish' | 'deploy';
/** Redacted view of a project API key (the management list never returns the token). */
export interface ApiKeyView {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
  capabilities: ApiKeyCapability[];
  tokenPrefix: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}
export interface CreateApiKeyBody {
  name: string;
  role: 'owner' | 'admin' | 'member';
  capabilities: ApiKeyCapability[];
  expiresInDays: number;
}
export interface Release {
  publishedAt: string;
  routes: number;
  bytes: number;
}
export interface DeployConfig {
  protocol: 'ftp' | 'ftps' | 'sftp';
  host: string;
  port?: number;
  user: string;
  password: string;
  remoteDir?: string;
  /** Optional SFTP host-key fingerprint (SHA-256) to pin the server. */
  hostFingerprint?: string;
}

export const api = {
  register: (email: string, password: string, orgName: string) =>
    request<{ userId: string; orgId: string }>('POST', '/auth/register', { email, password, orgName }),
  login: (email: string, password: string) =>
    request<{ userId: string }>('POST', '/auth/login', { email, password }),
  logout: () => request<void>('POST', '/auth/logout'),
  me: () => request<{ userId: string; orgs: Org[] }>('GET', '/me'),
  version: () =>
    request<{ current: string; latest: string | null; updateAvailable: boolean; releaseUrl: string | null }>(
      'GET',
      '/version',
    ),
  projects: (orgId: string) =>
    request<{ projects: Project[] }>('GET', `/orgs/${orgId}/projects`),
  createProject: (orgId: string, name: string, slug: string) =>
    request<{ project: Project }>('POST', `/orgs/${orgId}/projects`, { name, slug }),
  listPages: (orgId: string, projectId: string) =>
    request<{ items: Page[] }>('GET', `/orgs/${orgId}/projects/${projectId}/content/page`),
  getPage: (orgId: string, projectId: string, id: string) =>
    request<{ item: Page }>(
      'GET',
      `/orgs/${orgId}/projects/${projectId}/content/page/${encodeURIComponent(id)}`,
    ),
  putPage: (orgId: string, projectId: string, page: Page) =>
    request<{ item: Page }>(
      'PUT',
      `/orgs/${orgId}/projects/${projectId}/content/page/${page.id}`,
      page,
    ),
  deletePage: (orgId: string, projectId: string, id: string) =>
    request<void>('DELETE', `/orgs/${orgId}/projects/${projectId}/content/page/${id}`),
  preview: (orgId: string, projectId: string, page: Page) =>
    request<{ html: string; token: string }>(
      'POST',
      `/orgs/${orgId}/projects/${projectId}/preview`,
      page,
    ),

  // --- patterns (reusable, fork-on-insert block subtrees) ---
  listPatterns: (orgId: string, projectId: string) =>
    request<{ items: Pattern[] }>('GET', `/orgs/${orgId}/projects/${projectId}/content/pattern`),
  putPattern: (orgId: string, projectId: string, pattern: Pattern) =>
    request<{ item: Pattern }>(
      'PUT',
      `/orgs/${orgId}/projects/${projectId}/content/pattern/${pattern.id}`,
      pattern,
    ),
  deletePattern: (orgId: string, projectId: string, id: string) =>
    request<void>('DELETE', `/orgs/${orgId}/projects/${projectId}/content/pattern/${id}`),

  // --- project settings (locales live here) ---
  getSettings: (orgId: string, projectId: string) =>
    request<{ item: { settings: ProjectSettings } }>(
      'GET',
      `/orgs/${orgId}/projects/${projectId}/content/settings/settings`,
    ),

  // --- page translations (per-locale content overrides) ---
  listTranslations: (orgId: string, projectId: string) =>
    request<{ items: PageTranslation[] }>(
      'GET',
      `/orgs/${orgId}/projects/${projectId}/content/translation`,
    ),
  putTranslation: (orgId: string, projectId: string, translation: PageTranslation) =>
    request<{ item: PageTranslation }>(
      'PUT',
      `/orgs/${orgId}/projects/${projectId}/content/translation/${encodeURIComponent(translation.id)}`,
      translation,
    ),
  deleteTranslation: (orgId: string, projectId: string, id: string) =>
    request<void>(
      'DELETE',
      `/orgs/${orgId}/projects/${projectId}/content/translation/${encodeURIComponent(id)}`,
    ),

  // --- project API keys (bearer tokens for the CLI / MCP bridge) ---
  listApiKeys: (orgId: string, projectId: string) =>
    request<{ items: ApiKeyView[] }>('GET', `/orgs/${orgId}/projects/${projectId}/api-keys`),
  createApiKey: (orgId: string, projectId: string, body: CreateApiKeyBody) =>
    request<{ token: string; key: ApiKeyView }>(
      'POST',
      `/orgs/${orgId}/projects/${projectId}/api-keys`,
      body,
    ),
  deleteApiKey: (orgId: string, projectId: string, id: string) =>
    request<void>(
      'DELETE',
      `/orgs/${orgId}/projects/${projectId}/api-keys/${encodeURIComponent(id)}`,
    ),

  // --- datasets ---
  listDatasets: (orgId: string, projectId: string) =>
    request<{ items: Dataset[] }>('GET', `/orgs/${orgId}/projects/${projectId}/content/dataset`),
  putDataset: (orgId: string, projectId: string, dataset: Dataset) =>
    request<{ item: Dataset }>(
      'PUT',
      `/orgs/${orgId}/projects/${projectId}/content/dataset/${dataset.id}`,
      dataset,
    ),
  deleteDataset: (orgId: string, projectId: string, id: string) =>
    request<void>('DELETE', `/orgs/${orgId}/projects/${projectId}/content/dataset/${id}`),

  // --- entries ---
  listEntries: (orgId: string, projectId: string) =>
    request<{ items: Entry[] }>('GET', `/orgs/${orgId}/projects/${projectId}/content/entry`),
  putEntry: (orgId: string, projectId: string, entry: Entry) =>
    request<{ item: Entry }>(
      'PUT',
      `/orgs/${orgId}/projects/${projectId}/content/entry/${entry.id}`,
      entry,
    ),
  deleteEntry: (orgId: string, projectId: string, id: string) =>
    request<void>('DELETE', `/orgs/${orgId}/projects/${projectId}/content/entry/${id}`),

  // --- media ---
  listMedia: (orgId: string, projectId: string) =>
    request<{ items: MediaAsset[] }>('GET', `/orgs/${orgId}/projects/${projectId}/media`),
  uploadMedia: async (orgId: string, projectId: string, file: File): Promise<{ item: MediaAsset }> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${BASE}/orgs/${orgId}/projects/${projectId}/media`, {
      method: 'POST',
      credentials: 'include',
      body: form, // the browser sets multipart/form-data with the boundary
    });
    if (!res.ok) throw await errorFromResponse(res);
    return (await res.json()) as { item: MediaAsset };
  },
  deleteMedia: (orgId: string, projectId: string, id: string) =>
    request<void>('DELETE', `/orgs/${orgId}/projects/${projectId}/media/${id}`),

  // --- publishing ---
  publish: (orgId: string, projectId: string) =>
    request<{ release: Release; url: string }>('POST', `/orgs/${orgId}/projects/${projectId}/publish`),
  publishStatus: (orgId: string, projectId: string) =>
    request<{ release: Release | null; url: string }>(
      'GET',
      `/orgs/${orgId}/projects/${projectId}/publish`,
    ),
  /** URL of the zip artifact (used as an <a href download> — sends the session cookie). */
  archiveUrl: (orgId: string, projectId: string) =>
    `${BASE}/orgs/${orgId}/projects/${projectId}/publish/archive`,
  deploy: (orgId: string, projectId: string, config: DeployConfig) =>
    request<{ deployed: { protocol: string; files: number } }>(
      'POST',
      `/orgs/${orgId}/projects/${projectId}/publish/deploy`,
      config,
    ),

  // --- saved deploy targets ---
  listDeployTargets: (orgId: string, projectId: string) =>
    request<{ items: DeployTargetView[] }>('GET', `/orgs/${orgId}/projects/${projectId}/deploy-targets`),
  createDeployTarget: (orgId: string, projectId: string, config: DeployConfig & { name: string }) =>
    request<{ target: DeployTargetView }>(
      'POST',
      `/orgs/${orgId}/projects/${projectId}/deploy-targets`,
      config,
    ),
  deleteDeployTarget: (orgId: string, projectId: string, id: string) =>
    request<void>('DELETE', `/orgs/${orgId}/projects/${projectId}/deploy-targets/${id}`),
  deployToTarget: (orgId: string, projectId: string, id: string) =>
    request<{ deployed: { protocol: string; files: number } }>(
      'POST',
      `/orgs/${orgId}/projects/${projectId}/deploy-targets/${id}/deploy`,
    ),
};
