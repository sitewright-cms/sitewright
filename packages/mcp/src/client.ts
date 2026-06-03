/**
 * Minimal REST client for the Sitewright API, authenticated by a project-scoped
 * bearer token (`swk_…`). The MCP bridge is just a typed client of the one
 * guarded REST surface — all authorization (role ∩ capabilities, tenant scoping,
 * tree-safety) is enforced server-side; this layer only forwards.
 */

export type Capability = 'content:read' | 'content:write' | 'publish' | 'deploy';

export interface Scope {
  projectId: string;
  role: 'owner' | 'admin' | 'member';
  capabilities: Capability[];
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

export class SitewrightClient {
  private scope: Scope | undefined;
  private readonly baseUrl: string;
  private token: string;
  private readonly fetchImpl: FetchLike;
  private readonly onUnauthorized?: () => Promise<string | null>;
  /** In-flight refresh, so concurrent 401s share ONE refresh (no double rotation). */
  private refreshPromise: Promise<string | null> | null = null;

  /**
   * @param onUnauthorized optional hook called once on a 401 to obtain a fresh
   *   access token (e.g. the CLI refreshing an expired OAuth token mid-session);
   *   returning null gives up and surfaces the 401.
   */
  constructor(
    baseUrl: string,
    token: string,
    fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
    onUnauthorized?: () => Promise<string | null>,
  ) {
    // Trim a trailing slash so `${baseUrl}${path}` never double-slashes.
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.onUnauthorized = onUnauthorized;
  }

  private async request<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.token}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    // A short-lived OAuth token may expire mid-session: refresh once and retry.
    // Concurrent 401s coalesce into a single refresh so the rotating refresh token
    // isn't consumed twice (which the server would treat as theft).
    if (res.status === 401 && this.onUnauthorized && !retried) {
      const refresh = this.onUnauthorized;
      this.refreshPromise ??= refresh().finally(() => {
        this.refreshPromise = null;
      });
      const fresh = await this.refreshPromise;
      if (fresh) {
        this.token = fresh;
        return this.request<T>(method, path, body, true);
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

  async preview(page: unknown): Promise<{ html: string; token: string }> {
    return this.request('POST', this.projectPath('/preview'), page);
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
}
