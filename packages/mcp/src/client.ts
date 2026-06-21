/**
 * Minimal REST client for the Sitewright API, authenticated by a project-scoped
 * bearer token (`swk_…`). The MCP bridge is just a typed client of the one
 * guarded REST surface — all authorization (role ∩ capabilities, tenant scoping,
 * tree-safety) is enforced server-side; this layer only forwards.
 */

import type { ScreenshotViewportName } from '@sitewright/schema';

export type Capability = 'content:read' | 'content:write' | 'content:delete' | 'publish' | 'deploy';

export interface Scope {
  projectId: string;
  role: 'owner' | 'admin' | 'member';
  capabilities: Capability[];
  /** Effective agent (MCP) instructions — the admin override or the built-in default; resolved by the API. */
  agentInstructions?: string;
}

/** A non-2xx API response, carrying the status so tools can map it to MCP errors. */
export class SitewrightApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SitewrightApiError';
  }
}

/** The slice of `fetch` we use — narrow so it's trivial to mock and needs no DOM lib. */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{ ok: boolean; status: number; statusText: string; text(): Promise<string> }>;

/** One rendered viewport image (base64) from a preview screenshot request. */
export interface PreviewShot {
  base64: string;
  mimeType: string;
  width: number;
  height: number;
}
/** The /preview response: the rendered HTML + (when requested) per-viewport screenshots. */
export interface PreviewResult {
  html: string;
  token: string;
  slug?: string;
  screenshots?: Partial<Record<ScreenshotViewportName, PreviewShot>>;
}

export class SitewrightClient {
  private scope: Scope | undefined;
  private readonly baseUrl: string;
  private readonly tokenProvider: () => Promise<string | null>;
  private readonly fetchImpl: FetchLike;
  private readonly onUnauthorized?: () => Promise<string | null>;
  /** In-flight refresh, so concurrent 401s share ONE refresh (no double rotation). */
  private refreshPromise: Promise<string | null> | null = null;

  /**
   * @param tokenProvider returns the current access token, or null when the bridge is not yet
   *   authenticated (a lazy CLI login hasn't happened). A null token surfaces a clear 401-style
   *   error rather than sending `Bearer null`.
   * @param onUnauthorized optional hook called once on a 401 to obtain a fresh access token
   *   (e.g. the CLI refreshing an expired OAuth token mid-session); null gives up and surfaces
   *   the 401.
   */
  constructor(
    baseUrl: string,
    tokenProvider: () => Promise<string | null>,
    fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
    onUnauthorized?: () => Promise<string | null>,
  ) {
    // Trim a trailing slash so `${baseUrl}${path}` never double-slashes.
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.tokenProvider = tokenProvider;
    this.fetchImpl = fetchImpl;
    this.onUnauthorized = onUnauthorized;
  }

  private async request<T>(method: string, path: string, body?: unknown, freshToken?: string): Promise<T> {
    // On the post-401 retry we use the refreshed token directly (freshToken); otherwise ask the
    // provider for the current one.
    const token = freshToken ?? (await this.tokenProvider());
    if (!token) {
      throw new SitewrightApiError(401, 'not authenticated — use the login tool to connect this agent to a project');
    }
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    // A short-lived OAuth token may expire mid-session: refresh once and retry. Concurrent 401s
    // coalesce into a single refresh so the rotating refresh token isn't consumed twice (which the
    // server would treat as theft). The refreshed token is passed DIRECTLY into the retry (as
    // freshToken) — not re-read from the provider — so there's no write/read race on the store.
    if (res.status === 401 && this.onUnauthorized && freshToken === undefined) {
      const refresh = this.onUnauthorized;
      this.refreshPromise ??= refresh().finally(() => {
        this.refreshPromise = null;
      });
      const fresh = await this.refreshPromise;
      if (fresh) {
        return this.request<T>(method, path, body, fresh);
      }
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    if (!res.ok) {
      // `||` (not `??`): an HTTP/2 proxy yields an empty `statusText`, which must
      // still fall through to the numeric fallback rather than become an empty message.
      const message =
        (parsed && typeof parsed === 'object' && 'error' in parsed && typeof parsed.error === 'string'
          ? parsed.error
          : '') ||
        res.statusText ||
        `HTTP ${res.status}`;
      throw new SitewrightApiError(res.status, message);
    }
    return parsed as T;
  }

  private requireScope(): Scope {
    if (!this.scope) throw new Error('client not introspected — call introspect() first');
    return this.scope;
  }

  private projectPath(suffix: string): string {
    const { projectId } = this.requireScope();
    return `/projects/${encodeURIComponent(projectId)}${suffix}`;
  }

  /** Learns (and caches) the token's scope: which project + role + capabilities. */
  async introspect(): Promise<Scope> {
    const scope = await this.request<Scope>('GET', '/api-key/self');
    this.scope = scope;
    return scope;
  }

  async listContent(kind: string): Promise<unknown[]> {
    const res = await this.request<{ items: unknown[] }>(
      'GET',
      this.projectPath(`/content/${encodeURIComponent(kind)}`),
    );
    return res.items;
  }

  async getContent(kind: string, entityId: string): Promise<unknown> {
    const res = await this.request<{ item: unknown }>(
      'GET',
      this.projectPath(`/content/${encodeURIComponent(kind)}/${encodeURIComponent(entityId)}`),
    );
    return res.item;
  }

  async putContent(kind: string, entityId: string, data: unknown): Promise<unknown> {
    const res = await this.request<{ item: unknown }>(
      'PUT',
      this.projectPath(`/content/${encodeURIComponent(kind)}/${encodeURIComponent(entityId)}`),
      data,
    );
    return res.item;
  }

  async deleteContent(kind: string, entityId: string): Promise<void> {
    await this.request<void>(
      'DELETE',
      this.projectPath(`/content/${encodeURIComponent(kind)}/${encodeURIComponent(entityId)}`),
    );
  }

  async listRevisions(kind: string, entityId: string): Promise<unknown[]> {
    const res = await this.request<{ items: unknown[] }>(
      'GET',
      this.projectPath(`/content/${encodeURIComponent(kind)}/${encodeURIComponent(entityId)}/revisions`),
    );
    return res.items;
  }

  async restoreRevision(kind: string, entityId: string, revisionId: string): Promise<unknown> {
    const res = await this.request<{ item: unknown }>(
      'POST',
      this.projectPath(
        `/content/${encodeURIComponent(kind)}/${encodeURIComponent(entityId)}/revisions/${encodeURIComponent(revisionId)}/restore`,
      ),
    );
    return res.item;
  }

  async preview(page: unknown, opts?: { screenshot?: boolean; viewports?: string }): Promise<PreviewResult> {
    let path = this.projectPath('/preview');
    if (opts?.screenshot) {
      path += `?screenshot=1${opts.viewports ? `&viewports=${encodeURIComponent(opts.viewports)}` : ''}`;
    }
    return this.request('POST', path, page);
  }

  async publish(): Promise<unknown> {
    return this.request('POST', this.projectPath('/publish'));
  }

  async publishStatus(): Promise<unknown> {
    return this.request('GET', this.projectPath('/publish'));
  }

  async listSubmissions(opts: { formId?: string; limit?: number; offset?: number } = {}): Promise<unknown> {
    const params = new URLSearchParams();
    if (opts.formId) params.set('formId', opts.formId);
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.offset !== undefined) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return this.request('GET', this.projectPath(`/submissions${qs ? `?${qs}` : ''}`));
  }

  async stockProviders(): Promise<unknown> {
    return this.request('GET', this.projectPath('/stock/providers'));
  }

  async stockSearch(provider: string, query: string, page = 1): Promise<unknown> {
    const params = new URLSearchParams({ provider, q: query, page: String(page) });
    return this.request('GET', this.projectPath(`/stock/search?${params.toString()}`));
  }

  /** Import a stock photo: the server downloads, optimizes, and self-hosts it as a media asset. */
  async importStock(provider: string, id: string, alt?: string): Promise<unknown> {
    const res = await this.request<{ item: unknown }>(
      'POST',
      this.projectPath('/stock/import'),
      { provider, id, ...(alt ? { alt } : {}) },
    );
    return res.item;
  }

  /** List the project's media assets (optionally filtered by kind). */
  async listMedia(kind?: 'image' | 'file' | 'font'): Promise<unknown> {
    return this.request('GET', this.projectPath(`/media${kind ? `?kind=${kind}` : ''}`));
  }

  /** Import a PUBLIC https image by URL: the server downloads, optimizes, and self-hosts it. */
  async importImageUrl(url: string, folder?: string): Promise<unknown> {
    const res = await this.request<{ item: unknown }>(
      'POST',
      this.projectPath('/media/import-url'),
      { url, ...(folder ? { folder } : {}) },
    );
    return res.item;
  }
}
