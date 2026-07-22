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

/** `?dataset=<slug>` suffix for entry-scoped routes (an entry id is only unique within its dataset); ''
 *  when no dataset is supplied (every non-entry kind is project-global and ignores it). */
function datasetQuery(dataset: string | undefined): string {
  return dataset ? `?dataset=${encodeURIComponent(dataset)}` : '';
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

/**
 * Render a zod `flatten()` payload (`{ fieldErrors, formErrors }`, sent by the API as `details` on a
 * 400) into a short " — field: msg; field2: msg" suffix so the caller knows exactly what to fix.
 * Returns '' when there's no usable detail.
 */
function formatZodDetails(parsed: unknown): string {
  const details = (parsed as { details?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] } } | null)?.details;
  if (!details || typeof details !== 'object') return '';
  const parts: string[] = [];
  if (details.fieldErrors) {
    for (const [field, msgs] of Object.entries(details.fieldErrors)) {
      if (Array.isArray(msgs) && msgs.length) parts.push(`${field}: ${msgs.join(', ')}`);
    }
  }
  if (Array.isArray(details.formErrors) && details.formErrors.length) parts.push(details.formErrors.join(', '));
  return parts.length ? ` — ${parts.join('; ')}` : '';
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

/** Build-vs-source screenshots for an imported page (the `compare_to_source` payload). */
export interface CompareResult {
  sourceUrl: string;
  route: string;
  /** 'cache' = the reference captured at import time; 'live' = freshly rendered now. */
  sourceFrom?: 'cache' | 'live';
  /** Epoch ms the source shots were captured. */
  capturedAt?: number;
  build: Partial<Record<ScreenshotViewportName, PreviewShot>>;
  source: Partial<Record<ScreenshotViewportName, PreviewShot>>;
}

/** The measured clone-fidelity gate result (GET /projects/:id/fidelity/:pageId). */
export interface FidelityCheckResult {
  sourceUrl: string;
  route: string;
  pass: boolean;
  body: { pass: boolean; coverage: number; matched: number; orig: number; fontMiss: number; gradFail: number; score: number };
  chrome: { pass: boolean; coverage: number; matched: number; orig: number; posOff: number; sizeOff: number; styleOff: number; metaOff: number };
  diffs: { body: string[]; chrome: string[]; meta: string[] };
}

/** One clone_audit check. `advisory` checks are reported but do NOT gate the audit's PASS (chrome element-fidelity). */
export interface AuditCheck { leg: 'structure' | 'behaviour' | 'visual'; id: string; label: string; pass: boolean; detail: string; advisory?: boolean }
/** The comprehensive clone-acceptance gate (GET /projects/:id/clone-audit/:pageId). */
export interface CloneAuditResult {
  sourceUrl: string;
  route: string;
  pass: boolean;
  /** GATING (non-advisory) checks that passed. */
  passed: number;
  /** Total GATING (non-advisory) checks — advisory checks are in `checks` but NOT counted here. */
  total: number;
  checks: AuditCheck[];
  fidelity: FidelityCheckResult;
}

/** The DETERMINISTIC visual gate (GET /projects/:id/visual-audit/:pageId): renders the LIVE original vs the
 *  clone side-by-side (desktop + mobile) and returns them + a defect RUBRIC for the CALLER to judge. No
 *  server-side AI — the driving model produces the verdict itself. */
export interface VisualAuditResult {
  sourceUrl: string;
  route: string;
  rubric: string;
  categories: string[];
  severities: string[];
  build: Partial<Record<ScreenshotViewportName, PreviewShot>>;
  source: Partial<Record<ScreenshotViewportName, PreviewShot>>;
}

/** A high-res region crop (lossless WebP, base64). */
export interface RegionCrop { base64: string; mimeType: 'image/webp'; width: number; height: number }
/** High-resolution region compare (GET /projects/:id/compare-regions/:pageId). */
export interface RegionCompareResult {
  sourceUrl: string;
  route: string;
  regions: Record<string, { build?: RegionCrop; source?: RegionCrop }>;
}

/** Lighthouse category scores, 0–100 (null when a category could not be scored). */
export interface PagespeedScores {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
}
/** One actionable, non-passing audit the author can fix. */
export interface PagespeedFinding {
  id: string;
  title: string;
  category: keyof PagespeedScores;
  score: number | null;
  displayValue?: string;
}
/** Lighthouse page-speed + SEO audit (GET /projects/:id/pagespeed-audit/:pageId). Lab-only; no CrUX field data. */
export interface PagespeedAuditResult {
  url: string;
  formFactor: 'mobile' | 'desktop';
  scores: PagespeedScores;
  metrics: {
    firstContentfulPaintMs?: number;
    largestContentfulPaintMs?: number;
    totalBlockingTimeMs?: number;
    cumulativeLayoutShift?: number;
    speedIndexMs?: number;
  };
  findings: PagespeedFinding[];
  /** Lighthouse environment notices (e.g. a slow-CPU warning) — explain a host-constrained lab score. */
  runWarnings?: string[];
  /** Chrome's CPU benchmark for the audit host; a low value means the container CPU throttled the run. */
  benchmarkIndex?: number;
  lighthouseVersion: string;
  fetchedAt: string;
}

/** One page's outcome from an autonomous server-side clone run. */
export interface CloneRunPage {
  pageId: string;
  label: string;
  passed: boolean;
  rounds: number;
}
/** The autonomous clone orchestrator's final verdict (POST /projects/:id/agent/clone) — it runs the whole
 *  import→author→gate→iterate→publish loop server-side and returns once every page has been driven to (or
 *  past its round budget short of) the acceptance gate. */
export interface CloneRunResult {
  ok: boolean;
  /** The model the server-side authoring agent ran on. */
  model: string;
  pages: CloneRunPage[];
  /** Total imported pages processed. */
  total: number;
  /** How many of them passed the acceptance gate. */
  passed: number;
}

/** The result of the agent-callable website import (`import_website`). */
export interface ImportWebsiteResult {
  ok: boolean;
  pagesImported?: number;
  pagesFound?: number;
  mediaSelfHosted?: number;
  warnings?: string[];
  [k: string]: unknown;
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
      const base =
        (parsed && typeof parsed === 'object' && 'error' in parsed && typeof parsed.error === 'string'
          ? parsed.error
          : '') ||
        res.statusText ||
        `HTTP ${res.status}`;
      // A schema (zod) rejection sends `details: { fieldErrors, formErrors }`. Fold that into the
      // message so a caller (esp. the agent) SEES which field is wrong + self-corrects, instead of
      // retrying blindly against a bare "invalid request".
      throw new SitewrightApiError(res.status, base + formatZodDetails(parsed));
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

  /** Seeds the scope WITHOUT a network round-trip — for a caller that already introspected this same
   *  token (e.g. the /mcp transport's short-lived scope cache). Every subsequent API call still carries
   *  the bearer and is re-validated server-side, so a stale seed fails closed, never open. */
  primeScope(scope: Scope): void {
    this.scope = scope;
  }

  async listContent(kind: string, dataset?: string): Promise<unknown[]> {
    const res = await this.request<{ items: unknown[] }>(
      'GET',
      this.projectPath(`/content/${encodeURIComponent(kind)}${datasetQuery(dataset)}`),
    );
    return res.items;
  }

  async getContent(kind: string, entityId: string, dataset?: string): Promise<unknown> {
    const res = await this.request<{ item: unknown }>(
      'GET',
      this.projectPath(`/content/${encodeURIComponent(kind)}/${encodeURIComponent(entityId)}${datasetQuery(dataset)}`),
    );
    return res.item;
  }

  async putContent(kind: string, entityId: string, data: unknown, opts: { merge?: boolean } = {}): Promise<unknown> {
    // `merge` PATCHES: the body is a fragment deep-merged into the existing entity (settings only) so a
    // partial write can't revert the slots it omits. Default (no flag) still REPLACES the whole entity.
    const res = await this.request<{ item: unknown }>(
      'PUT',
      this.projectPath(`/content/${encodeURIComponent(kind)}/${encodeURIComponent(entityId)}${opts.merge ? '?merge=1' : ''}`),
      data,
    );
    return res.item;
  }

  async deleteContent(kind: string, entityId: string, dataset?: string): Promise<void> {
    await this.request<void>(
      'DELETE',
      this.projectPath(`/content/${encodeURIComponent(kind)}/${encodeURIComponent(entityId)}${datasetQuery(dataset)}`),
    );
  }

  /** Add a translation-target language: appends the locale AND scaffolds an inherited variant of
   *  every default-language page, atomically (the editor's "Add language" path). */
  async addLocale(locale: string): Promise<{ locale: string; created: number; pages: unknown[] }> {
    return this.request('POST', this.projectPath('/locales'), { locale });
  }

  /** Remove a translation-target language: drops the locale from settings AND cascade-deletes every
   *  page in its subtree. The default (main) language cannot be removed. */
  async removeLocale(locale: string): Promise<{ locale: string; removed: number }> {
    return this.request('DELETE', this.projectPath(`/locales/${encodeURIComponent(locale)}`));
  }

  async listRevisions(kind: string, entityId: string, dataset?: string): Promise<unknown[]> {
    const res = await this.request<{ items: unknown[] }>(
      'GET',
      this.projectPath(`/content/${encodeURIComponent(kind)}/${encodeURIComponent(entityId)}/revisions${datasetQuery(dataset)}`),
    );
    return res.items;
  }

  async restoreRevision(kind: string, entityId: string, revisionId: string, dataset?: string): Promise<unknown> {
    const res = await this.request<{ item: unknown }>(
      'POST',
      this.projectPath(
        `/content/${encodeURIComponent(kind)}/${encodeURIComponent(entityId)}/revisions/${encodeURIComponent(revisionId)}/restore${datasetQuery(dataset)}`,
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

  /** Screenshot a page's BUILD + its imported SOURCE at the same viewports, for side-by-side comparison.
   *  The source uses the reference cached at import time; `refresh` forces a fresh live snapshot. */
  async compareToSource(pageId: string, viewports?: string, refresh?: boolean): Promise<CompareResult> {
    const qs = new URLSearchParams();
    if (viewports) qs.set('viewports', viewports);
    if (refresh) qs.set('refresh', '1');
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.request('GET', this.projectPath(`/compare/${encodeURIComponent(pageId)}${suffix}`));
  }

  /** The measured clone-fidelity gate: render BUILD vs imported SOURCE, diff computed styles, return numbers. */
  async fidelityCheck(pageId: string): Promise<FidelityCheckResult> {
    return this.request('GET', this.projectPath(`/fidelity/${encodeURIComponent(pageId)}`));
  }

  /** The COMPREHENSIVE clone-acceptance gate: structure + behaviour + visual legs, one PASS/FAIL to terminate on. */
  async cloneAudit(pageId: string): Promise<CloneAuditResult> {
    return this.request('GET', this.projectPath(`/clone-audit/${encodeURIComponent(pageId)}`));
  }

  /** The VISION acceptance gate: a vision model diffs the LIVE original vs the clone per region → tagged defects. */
  async visualAudit(pageId: string): Promise<VisualAuditResult> {
    return this.request('GET', this.projectPath(`/visual-audit/${encodeURIComponent(pageId)}`));
  }

  /** High-res region crops (header/footer) of BUILD vs SOURCE, lossless WebP, for a crisp visual compare. */
  async compareRegions(pageId: string, regions?: string): Promise<RegionCompareResult> {
    const suffix = regions ? `?regions=${encodeURIComponent(regions)}` : '';
    return this.request('GET', this.projectPath(`/compare-regions/${encodeURIComponent(pageId)}${suffix}`));
  }

  /** Lighthouse page-speed + SEO audit of a page (deploy-equivalent build). `formFactor` defaults to mobile. */
  async pagespeedAudit(pageId: string, formFactor?: 'mobile' | 'desktop'): Promise<PagespeedAuditResult> {
    const suffix = formFactor ? `?formFactor=${formFactor}` : '';
    return this.request('GET', this.projectPath(`/pagespeed-audit/${encodeURIComponent(pageId)}${suffix}`));
  }

  async publish(): Promise<unknown> {
    return this.request('POST', this.projectPath('/publish'));
  }

  /** Kick off the AUTONOMOUS server-side clone orchestrator and run it to completion (non-streaming):
   *  the server authors every imported page, gates each authoritatively, iterates to green, then returns
   *  the per-page verdict. Requires a configured AI provider (else 501). */
  async cloneSite(): Promise<CloneRunResult> {
    return this.request('POST', this.projectPath('/agent/clone'));
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
  /** Crawl + import a public website URL into the connected project (the first step of a clone). */
  async importWebsite(url: string, foundation?: boolean): Promise<ImportWebsiteResult> {
    return this.request('POST', this.projectPath('/agent/import-website'), {
      url,
      ...(foundation !== undefined ? { foundation } : {}),
    });
  }

  async importImageUrl(url: string, folder?: string): Promise<unknown> {
    const res = await this.request<{ item: unknown }>(
      'POST',
      this.projectPath('/media/import-url'),
      { url, ...(folder ? { folder } : {}) },
    );
    return res.item;
  }

  /** List the project's virtual media FOLDERS (grouping labels for the media library). */
  async listMediaFolders(): Promise<unknown> {
    return this.request('GET', this.projectPath('/media/folders'));
  }

  /** Create an (empty) media folder + any missing ancestors. */
  async createMediaFolder(path: string): Promise<unknown> {
    return this.request('POST', this.projectPath('/media/folders'), { path });
  }

  /** Rename OR move a media folder — re-roots the subtree AND re-files every asset under it. */
  async renameMediaFolder(from: string, to: string): Promise<unknown> {
    return this.request('POST', this.projectPath('/media/folders/rename'), { from, to });
  }

  /** Move (`folder`) and/or rename (`filename`) a single media asset. */
  async updateMedia(id: string, changes: { folder?: string; filename?: string }): Promise<unknown> {
    const res = await this.request<{ item: unknown }>(
      'PATCH',
      this.projectPath(`/media/${encodeURIComponent(id)}`),
      changes,
    );
    return res.item;
  }

  /** Permanently delete a media asset (DB row + binary). Needs the content:delete capability. */
  async deleteMedia(id: string): Promise<{ ok: true }> {
    await this.request('DELETE', this.projectPath(`/media/${encodeURIComponent(id)}`));
    return { ok: true };
  }

  /** Rename a dataset's slug, cascading the change to entries + page/template sources (default on). */
  async renameDataset(id: string, slug: string, name?: string, cascade = true): Promise<unknown> {
    return this.request('POST', this.projectPath(`/datasets/${encodeURIComponent(id)}/rename`), { slug, name, cascade });
  }
}
