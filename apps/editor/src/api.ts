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
export function previewDocUrl(projectId: string, token: string): string {
  return `${BASE}/projects/${projectId}/preview/${encodeURIComponent(token)}`;
}

/** URL of the project's Server-Sent-Events change stream (for `EventSource`). */
export function eventsUrl(projectId: string): string {
  return `${BASE}/projects/${projectId}/events`;
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

/** A project the user can reach, with their role in it (the flat surface). */
export interface Project {
  id: string;
  name: string;
  slug: string;
  role: ProjectRole;
}
/** A user's role within a single project. */
export type ProjectRole = 'owner' | 'member';
/** The platform-staff role for a user (developer/admin), or null for a pure client. */
export type PlatformRole = 'admin' | 'developer' | null;
/** The role an invite/membership can carry: a project tier (owner|member) or a platform tier (admin|developer). */
export type Role = 'owner' | 'member' | 'admin' | 'developer';
/**
 * A member returned by a management list. Shared by two surfaces: `/admin/users` (platform staff —
 * role `admin`|`developer`) and `/projects/:id/members` (the project team — role `owner`|`member`).
 */
export interface OrgMember {
  userId: string;
  email: string;
  role: Role;
  createdAt: string;
}
/** A pending invite (the management list never returns the token). */
export interface Invite {
  id: string;
  email: string;
  role: Role;
  projectId: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}
/** Public context shown on the accept screen to an invite-token holder. */
export interface InvitePeek {
  email: string;
  role: Role;
  projectName: string | null;
  expired: boolean;
  accepted: boolean;
}
export type ApiKeyCapability = 'content:read' | 'content:write' | 'publish' | 'deploy';
/** Redacted view of a project API key (the management list never returns the token). */
export interface ApiKeyView {
  id: string;
  name: string;
  role: ProjectRole;
  capabilities: ApiKeyCapability[];
  tokenPrefix: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}
export interface CreateApiKeyBody {
  name: string;
  role: ProjectRole;
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
  register: (email: string, password: string) =>
    request<{ userId: string }>('POST', '/auth/register', { email, password }),
  login: (email: string, password: string) =>
    request<{ userId: string }>('POST', '/auth/login', { email, password }),
  logout: () => request<void>('POST', '/auth/logout'),
  me: () =>
    request<{
      userId: string;
      platformRole: PlatformRole;
      isInstanceAdmin: boolean;
      projects: Project[];
    }>('GET', '/me'),
  version: () =>
    request<{ current: string; latest: string | null; updateAvailable: boolean; releaseUrl: string | null }>(
      'GET',
      '/version',
    ),
  projects: () => request<{ projects: Project[] }>('GET', '/projects'),
  // Platform staff (instance-wide developers/admins) live under /admin/users.
  listMembers: () => request<{ members: OrgMember[] }>('GET', '/admin/users'),
  removeMember: (userId: string) =>
    request<void>('DELETE', `/admin/users/${encodeURIComponent(userId)}`),
  // Invites: a platform-staff (developer) invite and a project-scoped (client) invite.
  // The raw token is returned ONCE; the UI builds an invite link from it.
  inviteDeveloper: (email: string, role?: string) =>
    request<{ invite: Invite; token: string }>('POST', '/admin/invites', {
      email,
      ...(role ? { role } : {}),
    }),
  inviteClient: (projectId: string, email: string) =>
    request<{ invite: Invite; token: string }>('POST', `/projects/${projectId}/invites`, { email }),
  /** Platform-staff invites (instance-wide). */
  listInvites: () => request<{ invites: Invite[] }>('GET', '/admin/invites'),
  /** A project's pending (client) invites. */
  listProjectInvites: (projectId: string) =>
    request<{ invites: Invite[] }>('GET', `/projects/${projectId}/invites`),
  revokeInvite: (id: string) =>
    request<void>('DELETE', `/invites/${encodeURIComponent(id)}`),
  peekInvite: (token: string) =>
    request<{ invite: InvitePeek }>('GET', `/invites/peek?token=${encodeURIComponent(token)}`),
  acceptInvite: (token: string) =>
    // `projectId` is null for a platform-staff invite (which sets the user's platform role).
    request<{ projectId: string | null; role: Role }>('POST', '/invites/accept', { token }),
  // Project clients (project-scoped members).
  listProjectMembers: (projectId: string) =>
    request<{ members: OrgMember[] }>('GET', `/projects/${projectId}/members`),
  removeProjectMember: (projectId: string, userId: string) =>
    request<void>('DELETE', `/projects/${projectId}/members/${encodeURIComponent(userId)}`),
  createProject: (name: string, slug: string) =>
    request<{ project: Project }>('POST', '/projects', { name, slug }),
  deleteProject: (id: string) => request<void>('DELETE', `/projects/${id}`),
  listPages: (projectId: string) =>
    request<{ items: Page[] }>('GET', `/projects/${projectId}/content/page`),
  getPage: (projectId: string, id: string) =>
    request<{ item: Page }>('GET', `/projects/${projectId}/content/page/${encodeURIComponent(id)}`),
  putPage: (projectId: string, page: Page) =>
    request<{ item: Page }>('PUT', `/projects/${projectId}/content/page/${page.id}`, page),
  deletePage: (projectId: string, id: string) =>
    request<void>('DELETE', `/projects/${projectId}/content/page/${id}`),
  preview: (projectId: string, page: Page) =>
    request<{ html: string; token: string }>('POST', `/projects/${projectId}/preview`, page),
  // Live-preview backend for the code-first template editor: render a Handlebars `template`
  // against the project context inside the isolated worker pool. `document: true` returns a
  // full styled <!doctype> document (the doc shell + the source's compiled Tailwind inlined).
  renderTemplate: (
    projectId: string,
    body: {
      template?: string;
      pageId?: string;
      page?: { title?: string; path?: string };
      document?: boolean;
    },
  ) =>
    // `token` is present when `document: true` — load the styled doc via an iframe `src`
    // (opaque-origin sandbox CSP) instead of `srcDoc`.
    request<{ html: string; token?: string }>('POST', `/projects/${projectId}/render-template`, body),

  // --- patterns (reusable, fork-on-insert block subtrees) ---
  listPatterns: (projectId: string) =>
    request<{ items: Pattern[] }>('GET', `/projects/${projectId}/content/pattern`),
  putPattern: (projectId: string, pattern: Pattern) =>
    request<{ item: Pattern }>('PUT', `/projects/${projectId}/content/pattern/${pattern.id}`, pattern),
  deletePattern: (projectId: string, id: string) =>
    request<void>('DELETE', `/projects/${projectId}/content/pattern/${id}`),

  // --- project settings singleton (Corporate Identity + website + locales) ---
  getSettings: (projectId: string) =>
    request<{ item: SettingsBundle }>('GET', `/projects/${projectId}/content/settings/settings`),
  putSettings: (projectId: string, bundle: SettingsBundle) =>
    request<{ item: SettingsBundle }>(
      'PUT',
      `/projects/${projectId}/content/settings/settings`,
      bundle,
    ),

  // --- page translations (per-locale content overrides) ---
  listTranslations: (projectId: string) =>
    request<{ items: PageTranslation[] }>('GET', `/projects/${projectId}/content/translation`),
  putTranslation: (projectId: string, translation: PageTranslation) =>
    request<{ item: PageTranslation }>(
      'PUT',
      `/projects/${projectId}/content/translation/${encodeURIComponent(translation.id)}`,
      translation,
    ),
  deleteTranslation: (projectId: string, id: string) =>
    request<void>(
      'DELETE',
      `/projects/${projectId}/content/translation/${encodeURIComponent(id)}`,
    ),

  // --- project API keys (bearer tokens for the CLI / MCP bridge) ---
  listApiKeys: (projectId: string) =>
    request<{ items: ApiKeyView[] }>('GET', `/projects/${projectId}/api-keys`),
  createApiKey: (projectId: string, body: CreateApiKeyBody) =>
    request<{ token: string; key: ApiKeyView }>('POST', `/projects/${projectId}/api-keys`, body),
  deleteApiKey: (projectId: string, id: string) =>
    request<void>('DELETE', `/projects/${projectId}/api-keys/${encodeURIComponent(id)}`),

  // --- datasets ---
  listDatasets: (projectId: string) =>
    request<{ items: Dataset[] }>('GET', `/projects/${projectId}/content/dataset`),
  putDataset: (projectId: string, dataset: Dataset) =>
    request<{ item: Dataset }>('PUT', `/projects/${projectId}/content/dataset/${dataset.id}`, dataset),
  deleteDataset: (projectId: string, id: string) =>
    request<void>('DELETE', `/projects/${projectId}/content/dataset/${id}`),

  // --- entries ---
  listEntries: (projectId: string) =>
    request<{ items: Entry[] }>('GET', `/projects/${projectId}/content/entry`),
  putEntry: (projectId: string, entry: Entry) =>
    request<{ item: Entry }>('PUT', `/projects/${projectId}/content/entry/${entry.id}`, entry),
  deleteEntry: (projectId: string, id: string) =>
    request<void>('DELETE', `/projects/${projectId}/content/entry/${id}`),

  // --- media ---
  listMedia: (projectId: string) =>
    request<{ items: MediaAsset[] }>('GET', `/projects/${projectId}/media`),
  uploadMedia: async (projectId: string, file: File): Promise<{ item: MediaAsset }> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${BASE}/projects/${projectId}/media`, {
      method: 'POST',
      credentials: 'include',
      body: form, // the browser sets multipart/form-data with the boundary
    });
    if (!res.ok) throw await errorFromResponse(res);
    return (await res.json()) as { item: MediaAsset };
  },
  deleteMedia: (projectId: string, id: string) =>
    request<void>('DELETE', `/projects/${projectId}/media/${id}`),

  // --- stock images (search provider-hosted photos; import = download+optimize+self-host) ---
  stockProviders: (projectId: string) =>
    request<StockProvidersStatus>('GET', `/projects/${projectId}/stock/providers`),
  searchStock: (projectId: string, provider: StockProviderName, q: string, page = 1) => {
    const params = new URLSearchParams({ provider, q, page: String(page) });
    return request<StockSearchResult>('GET', `/projects/${projectId}/stock/search?${params.toString()}`);
  },
  importStock: (projectId: string, provider: StockProviderName, id: string, alt?: string) =>
    request<{ item: MediaAsset }>('POST', `/projects/${projectId}/stock/import`, {
      provider,
      id,
      ...(alt ? { alt } : {}),
    }),

  // --- publishing ---
  publish: (projectId: string) =>
    request<{ release: Release; url: string; dirty: boolean }>('POST', `/projects/${projectId}/publish`),
  publishStatus: (projectId: string) =>
    // `dirty` = there are unpublished content changes (drives the green publish button).
    request<{ release: Release | null; url: string; dirty: boolean }>('GET', `/projects/${projectId}/publish`),
  /** URL of the zip artifact (used as an <a href download> — sends the session cookie). */
  archiveUrl: (projectId: string) => `${BASE}/projects/${projectId}/publish/archive`,
  deploy: (projectId: string, config: DeployConfig) =>
    request<{ deployed: { protocol: string; files: number } }>(
      'POST',
      `/projects/${projectId}/publish/deploy`,
      config,
    ),

  // --- saved deploy targets ---
  listDeployTargets: (projectId: string) =>
    request<{ items: DeployTargetView[] }>('GET', `/projects/${projectId}/deploy-targets`),
  createDeployTarget: (projectId: string, config: DeployConfig & { name: string }) =>
    request<{ target: DeployTargetView }>('POST', `/projects/${projectId}/deploy-targets`, config),
  deleteDeployTarget: (projectId: string, id: string) =>
    request<void>('DELETE', `/projects/${projectId}/deploy-targets/${id}`),
  deployToTarget: (projectId: string, id: string) =>
    request<{ deployed: { protocol: string; files: number } }>(
      'POST',
      `/projects/${projectId}/deploy-targets/${id}/deploy`,
    ),

  // --- instance admin settings (global mail / hCaptcha / enabled form modes) ---
  getInstanceSettings: () =>
    request<{ settings: InstanceSettingsPublic }>('GET', '/admin/settings'),
  putInstanceSettings: (body: InstanceSettingsInput) =>
    request<{ settings: InstanceSettingsPublic }>('PUT', '/admin/settings', body),

  // --- web forms (definitions live as `form` content) ---
  listForms: (projectId: string) =>
    request<{ items: Form[] }>('GET', `/projects/${projectId}/content/form`),
  putForm: (projectId: string, form: Form) =>
    request<{ item: Form }>(
      'PUT',
      `/projects/${projectId}/content/form/${encodeURIComponent(form.id)}`,
      form,
    ),
  deleteForm: (projectId: string, id: string) =>
    request<void>('DELETE', `/projects/${projectId}/content/form/${encodeURIComponent(id)}`),
  /** Which mail-delivery modes the instance admin permits (for the form-mode selector). */
  formModes: (projectId: string) =>
    request<{ formModes: FormModes }>('GET', `/projects/${projectId}/form-modes`),

  // --- per-project SMTP (for the userSmtp form mode) ---
  getProjectSmtp: (projectId: string) =>
    request<{ smtp: SmtpPublic | null }>('GET', `/projects/${projectId}/smtp`),
  putProjectSmtp: (projectId: string, body: SmtpInput) =>
    request<{ smtp: SmtpPublic }>('PUT', `/projects/${projectId}/smtp`, body),
  deleteProjectSmtp: (projectId: string) =>
    request<void>('DELETE', `/projects/${projectId}/smtp`),

  // --- form submissions (inbox) ---
  listSubmissions: (projectId: string, formId?: string) =>
    request<{ items: FormSubmission[]; total: number }>(
      'GET',
      `/projects/${projectId}/submissions${formId ? `?formId=${encodeURIComponent(formId)}` : ''}`,
    ),
  deleteSubmission: (projectId: string, id: string) =>
    request<void>('DELETE', `/projects/${projectId}/submissions/${encodeURIComponent(id)}`),
};
