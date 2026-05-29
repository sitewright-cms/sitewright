import type { Dataset, Entry, MediaAsset, Page } from '@sitewright/schema';

/** Base URL for the API. Empty = same origin (the API serves this SPA). */
const BASE = import.meta.env.VITE_API_BASE ?? '';

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

export const api = {
  register: (email: string, password: string, orgName: string) =>
    request<{ userId: string; orgId: string }>('POST', '/auth/register', { email, password, orgName }),
  login: (email: string, password: string) =>
    request<{ userId: string }>('POST', '/auth/login', { email, password }),
  logout: () => request<void>('POST', '/auth/logout'),
  me: () => request<{ userId: string; orgs: Org[] }>('GET', '/me'),
  projects: (orgId: string) =>
    request<{ projects: Project[] }>('GET', `/orgs/${orgId}/projects`),
  createProject: (orgId: string, name: string, slug: string) =>
    request<{ project: Project }>('POST', `/orgs/${orgId}/projects`, { name, slug }),
  listPages: (orgId: string, projectId: string) =>
    request<{ items: Page[] }>('GET', `/orgs/${orgId}/projects/${projectId}/content/page`),
  putPage: (orgId: string, projectId: string, page: Page) =>
    request<{ item: Page }>(
      'PUT',
      `/orgs/${orgId}/projects/${projectId}/content/page/${page.id}`,
      page,
    ),
  deletePage: (orgId: string, projectId: string, id: string) =>
    request<void>('DELETE', `/orgs/${orgId}/projects/${projectId}/content/page/${id}`),
  preview: (orgId: string, projectId: string, page: Page) =>
    request<{ html: string }>('POST', `/orgs/${orgId}/projects/${projectId}/preview`, page),

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
};
