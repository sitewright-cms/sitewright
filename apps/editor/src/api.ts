import type {
  CorporateIdentity,
  Dataset,
  DeployTargetView,
  Entry,
  Form,
  FormModes,
  FormSubmission,
  InstanceSettingsInput,
  InstanceSettingsPublic,
  MediaAsset,
  Page,
  PageTranslation,
  Pattern,
  ProjectSettings,
  SmtpInput,
  SmtpPublic,
  StockProviderName,
  StockProvidersStatus,
  StockSearchResult,
  WebsiteSettings,
} from '@sitewright/schema';

export type {
  CorporateIdentity,
  DeployTargetView,
  Form,
  FormModes,
  FormSubmission,
  InstanceSettingsInput,
  InstanceSettingsPublic,
  ProjectSettings,
  SmtpInput,
  SmtpPublic,
  StockProviderName,
  StockProvidersStatus,
  StockSearchResult,
  WebsiteSettings,
};

/** The project's settings singleton as read/written via the content API (the unified shape). */
export interface SettingsBundle {
  identity: CorporateIdentity;
  website?: WebsiteSettings;
  settings: ProjectSettings;
}

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
/** A user's membership in an org (the agency's owner/admin + invited developers). */
export interface OrgMember {
  userId: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  createdAt: string;
}
/** A project a user can reach via a project-scoped membership (the client tier). */
export interface ProjectAccess {
  orgId: string;
  orgName: string;
  orgSlug: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
  role: 'owner' | 'admin' | 'member';
}
/** A pending invite (the management list never returns the token). */
export interface Invite {
  id: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  projectId: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}
/** Public context shown on the accept screen to an invite-token holder. */
export interface InvitePeek {
  email: string;
  role: 'owner' | 'admin' | 'member';
  orgName: string;
  projectName: string | null;
  expired: boolean;
  accepted: boolean;
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
  me: () =>
    request<{ userId: string; orgs: Org[]; projectAccess: ProjectAccess[]; isInstanceAdmin: boolean }>(
      'GET',
      '/me',
    ),
  version: () =>
    request<{ current: string; latest: string | null; updateAvailable: boolean; releaseUrl: string | null }>(
      'GET',
      '/version',
    ),
  projects: (orgId: string) =>
    request<{ projects: Project[] }>('GET', `/orgs/${orgId}/projects`),
  // Org members = the agency's developers/staff (owner/admin).
  listMembers: (orgId: string) =>
    request<{ members: OrgMember[] }>('GET', `/orgs/${orgId}/members`),
  removeMember: (orgId: string, userId: string) =>
    request<void>('DELETE', `/orgs/${orgId}/members/${encodeURIComponent(userId)}`),
  // Invites: developer (org admin) and client (project member). The raw token is
  // returned ONCE; the UI builds an invite link from it.
  inviteDeveloper: (orgId: string, email: string) =>
    request<{ invite: Invite; token: string }>('POST', `/orgs/${orgId}/invites`, { email }),
  inviteClient: (orgId: string, projectId: string, email: string) =>
    request<{ invite: Invite; token: string }>('POST', `/orgs/${orgId}/projects/${projectId}/invites`, { email }),
  listInvites: (orgId: string, projectId?: string) =>
    request<{ invites: Invite[] }>(
      'GET',
      `/orgs/${orgId}/invites${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`,
    ),
  revokeInvite: (orgId: string, id: string) =>
    request<void>('DELETE', `/orgs/${orgId}/invites/${encodeURIComponent(id)}`),
  peekInvite: (token: string) =>
    request<{ invite: InvitePeek }>('GET', `/invites/peek?token=${encodeURIComponent(token)}`),
  acceptInvite: (token: string) =>
    request<{ orgId: string; projectId: string | null; role: string }>('POST', '/invites/accept', { token }),
  // Project clients (project-scoped members).
  listProjectMembers: (orgId: string, projectId: string) =>
    request<{ members: OrgMember[] }>('GET', `/orgs/${orgId}/projects/${projectId}/members`),
  removeProjectMember: (orgId: string, projectId: string, userId: string) =>
    request<void>(
      'DELETE',
      `/orgs/${orgId}/projects/${projectId}/members/${encodeURIComponent(userId)}`,
    ),
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
  // Live-preview backend for the code-first template editor: render a Handlebars `template`
  // against the project context inside the isolated worker pool. `document: true` returns a
  // full styled <!doctype> document (the doc shell + the source's compiled Tailwind inlined).
  renderTemplate: (
    orgId: string,
    projectId: string,
    body: {
      template?: string;
      pageId?: string;
      page?: { title?: string; path?: string };
      document?: boolean;
    },
  ) =>
    request<{ html: string }>(
      'POST',
      `/orgs/${orgId}/projects/${projectId}/render-template`,
      body,
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

  // --- project settings singleton (Corporate Identity + website + locales) ---
  getSettings: (orgId: string, projectId: string) =>
    request<{ item: SettingsBundle }>(
      'GET',
      `/orgs/${orgId}/projects/${projectId}/content/settings/settings`,
    ),
  putSettings: (orgId: string, projectId: string, bundle: SettingsBundle) =>
    request<{ item: SettingsBundle }>(
      'PUT',
      `/orgs/${orgId}/projects/${projectId}/content/settings/settings`,
      bundle,
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

  // --- stock images (search provider-hosted photos; import = download+optimize+self-host) ---
  stockProviders: (orgId: string, projectId: string) =>
    request<StockProvidersStatus>('GET', `/orgs/${orgId}/projects/${projectId}/stock/providers`),
  searchStock: (orgId: string, projectId: string, provider: StockProviderName, q: string, page = 1) => {
    const params = new URLSearchParams({ provider, q, page: String(page) });
    return request<StockSearchResult>('GET', `/orgs/${orgId}/projects/${projectId}/stock/search?${params.toString()}`);
  },
  importStock: (orgId: string, projectId: string, provider: StockProviderName, id: string, alt?: string) =>
    request<{ item: MediaAsset }>('POST', `/orgs/${orgId}/projects/${projectId}/stock/import`, {
      provider,
      id,
      ...(alt ? { alt } : {}),
    }),

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

  // --- instance admin settings (global mail / hCaptcha / enabled form modes) ---
  getInstanceSettings: () =>
    request<{ settings: InstanceSettingsPublic }>('GET', '/admin/settings'),
  putInstanceSettings: (body: InstanceSettingsInput) =>
    request<{ settings: InstanceSettingsPublic }>('PUT', '/admin/settings', body),

  // --- web forms (definitions live as `form` content) ---
  listForms: (orgId: string, projectId: string) =>
    request<{ items: Form[] }>('GET', `/orgs/${orgId}/projects/${projectId}/content/form`),
  putForm: (orgId: string, projectId: string, form: Form) =>
    request<{ item: Form }>(
      'PUT',
      `/orgs/${orgId}/projects/${projectId}/content/form/${encodeURIComponent(form.id)}`,
      form,
    ),
  deleteForm: (orgId: string, projectId: string, id: string) =>
    request<void>('DELETE', `/orgs/${orgId}/projects/${projectId}/content/form/${encodeURIComponent(id)}`),
  /** Which mail-delivery modes the instance admin permits (for the form-mode selector). */
  formModes: (orgId: string, projectId: string) =>
    request<{ formModes: FormModes }>('GET', `/orgs/${orgId}/projects/${projectId}/form-modes`),

  // --- per-project SMTP (for the userSmtp form mode) ---
  getProjectSmtp: (orgId: string, projectId: string) =>
    request<{ smtp: SmtpPublic | null }>('GET', `/orgs/${orgId}/projects/${projectId}/smtp`),
  putProjectSmtp: (orgId: string, projectId: string, body: SmtpInput) =>
    request<{ smtp: SmtpPublic }>('PUT', `/orgs/${orgId}/projects/${projectId}/smtp`, body),
  deleteProjectSmtp: (orgId: string, projectId: string) =>
    request<void>('DELETE', `/orgs/${orgId}/projects/${projectId}/smtp`),

  // --- form submissions (inbox) ---
  listSubmissions: (orgId: string, projectId: string, formId?: string) =>
    request<{ items: FormSubmission[]; total: number }>(
      'GET',
      `/orgs/${orgId}/projects/${projectId}/submissions${formId ? `?formId=${encodeURIComponent(formId)}` : ''}`,
    ),
  deleteSubmission: (orgId: string, projectId: string, id: string) =>
    request<void>(
      'DELETE',
      `/orgs/${orgId}/projects/${projectId}/submissions/${encodeURIComponent(id)}`,
    ),
};
