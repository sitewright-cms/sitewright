import type {
  CaptchaPublic,
  CaptchaInput,
  CorporateIdentity,
  Dataset,
  DeployTargetView,
  Entry,
  Form,
  FormModes,
  FormSubmission,
  ImageMap,
  ImageMapTemplate,
  InstanceSettingsInput,
  InstanceSettingsPublic,
  MediaAsset,
  MediaFolderRecord,
  Page,
  PlatformBackground,
  PageTranslation,
  ProjectSettings,
  SmtpInput,
  SmtpPublic,
  Snippet,
  StockProviderName,
  StockProvidersStatus,
  StockSearchProvider,
  StockSearchResult,
  Template,
  WebsiteSettings,
  AiConfigView,
  AiConfigInput,
  AiProviderKind,
} from '@sitewright/schema';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';

/** A registered passkey as shown in the Security tab. */
export interface PasskeyView {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Admin-panel branding from the public `/auth/config` boot (defaults applied server-side). */
export interface Branding {
  name: string;
  primary: string;
  secondary: string;
  /** A cache-busted URL to the uploaded logo, or null when none is set (use the default mark). */
  logoUrl: string | null;
}

export type {
  CaptchaPublic,
  CaptchaInput,
  CorporateIdentity,
  DeployTargetView,
  MediaAsset,
  Form,
  FormModes,
  FormSubmission,
  InstanceSettingsInput,
  InstanceSettingsPublic,
  PlatformBackground,
  ProjectSettings,
  SmtpInput,
  SmtpPublic,
  Snippet,
  StockProviderName,
  StockProvidersStatus,
  StockSearchProvider,
  StockSearchResult,
  WebsiteSettings,
  AiConfigView,
  AiConfigInput,
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
 * Downloads the whole project as a portable export zip. Points a transient anchor
 * at the export route (which replies `Content-Disposition: attachment`), so the
 * browser STREAMS the archive straight to disk — no in-browser buffering, matching
 * the server's temp-file stream. Session auth rides the same-origin cookie.
 */
export function downloadProjectExport(projectId: string): void {
  const a = document.createElement('a');
  a.href = `${BASE}/projects/${encodeURIComponent(projectId)}/export.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Absolute URL of the sandboxed preview document for a token — loaded via the
 * preview iframe's `src` (not `srcDoc`), so the document is served under its own
 * `Content-Security-Policy: sandbox` rather than inheriting the editor's CSP.
 * Addressed by the project's (immutable) slug, matching the media + published-site URLs.
 */
export function previewDocUrl(slug: string, token: string): string {
  return `${BASE}/preview/${encodeURIComponent(slug)}/${encodeURIComponent(token)}`;
}

/** URL of the project's Server-Sent-Events change stream (for `EventSource`). */
export function eventsUrl(projectId: string): string {
  return `${BASE}/projects/${projectId}/events`;
}

/**
 * Absolute URL of a page within the live whole-site PREVIEW — the always-on DRAFT browse surface
 * (rebuilt on change, no publish required). `base` is the SIGNED preview base from the API
 * (`/preview/<id>/<sig>/`); `path` is a route slug (`about`, `de/leistungen`), '' for the home page.
 * A trailing slash is appended so the page's relative assets/links resolve against the right base.
 */
export function previewUrlFrom(base: string, path = ''): string {
  const clean = path.replace(/^\/+/, '');
  const suffix = clean === '' || clean.endsWith('/') ? '' : '/';
  return `${BASE}${base}${clean}${suffix}`;
}

/**
 * URL of a single snippet's server-rendered preview document — the snippet rendered with the
 * project's brand styling + resolvable partials, served under an opaque `sandbox` CSP. Loaded via
 * the hover-preview iframe's `src` (so it gets its own CSP, like {@link previewDocUrl}).
 */
export function snippetPreviewUrl(projectId: string, id: string, scope: 'project' | 'global'): string {
  return `${BASE}/projects/${projectId}/snippets/${encodeURIComponent(id)}/preview?scope=${scope}`;
}

/** The field/form messages a Zod validation failure carries (matches `ZodError.flatten()`). */
export interface ApiErrorDetails {
  fieldErrors?: Record<string, string[]>;
  formErrors?: string[];
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Present for 400 validation failures — the per-field messages the server returned. */
    public readonly details?: ApiErrorDetails,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Joins a validation body's field + form messages into one readable sentence (de-duped). */
function validationMessage(details: ApiErrorDetails): string | undefined {
  const fieldMsgs = details.fieldErrors ? Object.values(details.fieldErrors).flat() : [];
  const all = [...fieldMsgs, ...(details.formErrors ?? [])].filter(
    (m): m is string => typeof m === 'string' && m.length > 0,
  );
  return all.length > 0 ? Array.from(new Set(all)).join(', ') : undefined;
}

// A 401 from ANY API call means the session / login token is no longer valid (expired or revoked).
// The app registers a handler here so it can drop the user back to the login screen instead of
// leaving them in a half-broken "logged in" UI whose every action fails. Module-level (no React
// context) to match this app's plain state-machine shell — see App.tsx.
let unauthorizedHandler: (() => void) | undefined;

/** Register (or clear, with `undefined`) the on-401 handler invoked when a request is unauthenticated. */
export function setUnauthorizedHandler(handler: (() => void) | undefined): void {
  unauthorizedHandler = handler;
}

/** Notify the app of a 401; the handler itself decides whether a redirect is warranted. */
function notifyIfUnauthorized(status: number): void {
  if (status === 401) unauthorizedHandler?.();
}

async function errorFromResponse(res: Response): Promise<ApiError> {
  let message = res.statusText;
  let details: ApiErrorDetails | undefined;
  try {
    const json = (await res.json()) as { error?: string; details?: ApiErrorDetails };
    if (json.error) message = json.error;
    if (json.details) {
      details = json.details;
      // The server's generic "invalid request" (a Zod failure) is opaque on its own — surface the
      // specific field messages instead (e.g. the failing password rules on signup / change-password).
      const specific = validationMessage(json.details);
      if (specific && message === 'invalid request') message = specific;
    }
  } catch {
    // non-JSON error body — keep statusText
  }
  notifyIfUnauthorized(res.status);
  return new ApiError(res.status, message, details);
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

/**
 * POSTs to an SSE endpoint and dispatches its `event:`/`data:` frames to the handlers. A non-2xx
 * response (a preflight JSON error like 409/403/503) is surfaced via `onError`. Resolves when the
 * stream ends.
 */
async function streamSse<P, D>(
  url: string,
  handlers: {
    onProgress?: (e: P) => void;
    /** Receives the RAW parsed `done` payload (callers unwrap their own envelope, e.g. `.deployed`/`.report`). */
    onDone?: (raw: D) => void;
    onError?: (message: string) => void;
  },
  opts?: { signal?: AbortSignal; init?: Pick<RequestInit, 'headers' | 'body'> },
): Promise<void> {
  // Merge only headers/body — method/credentials/signal are fixed here so a caller's init can't drop them.
  const res = await fetch(url, { method: 'POST', credentials: 'include', signal: opts?.signal, headers: opts?.init?.headers, body: opts?.init?.body });
  if (!res.ok || !res.body) {
    let message = res.statusText || 'request failed';
    try {
      const j = (await res.json()) as { error?: unknown };
      if (typeof j.error === 'string') message = j.error;
    } catch {
      /* non-JSON error body */
    }
    notifyIfUnauthorized(res.status); // a 401 mid-stream (expired session) also returns to login
    handlers.onError?.(message);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (err) {
      // An AbortController abort (modal closed mid-stream) rejects read() — end quietly.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      throw err;
    }
    if (chunk.done) break;
    buf += decoder.decode(chunk.value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      let event = 'message';
      let data = '';
      for (const line of frame.split('\n')) {
        // SSE: strip one optional leading space after the colon; join multi-line data with \n.
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).replace(/^ /, '');
      }
      if (!data) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      if (event === 'progress') handlers.onProgress?.(parsed as P);
      else if (event === 'done') handlers.onDone?.(parsed as D);
      else if (event === 'error') {
        const msg = (parsed as { message?: unknown }).message;
        handlers.onError?.(typeof msg === 'string' ? msg : 'request failed');
      }
    }
  }
}

/** A chat attachment (image or PDF) sent with a message so the agent can see it. `data` is base64. */
export interface AgentAttachment {
  kind: 'image' | 'document';
  mimeType: string;
  data: string;
  name?: string;
}

// ---- Database integrity (System Settings → Ops → "Check database integrity"). Mirrors
// apps/api/src/repo/integrity.ts; see it for what each code means and why repairs are opt-in.

export type IntegritySeverity = 'error' | 'warning' | 'info';

export type IntegrityActionId =
  | 'recreate_dataset'
  | 'reassign_entries'
  | 'fix_entry_scope'
  | 'delete_orphan_entries'
  | 'delete_orphan_history';

export interface IntegrityAction {
  id: IntegrityActionId;
  label: string;
  /** Removes rows — the UI must confirm before running it. */
  destructive: boolean;
  detail: string;
}

export interface IntegrityIssue {
  code: string;
  severity: IntegritySeverity;
  projectId: string | null;
  projectSlug: string | null;
  /** The grouping key — usually the dataset slug the rows point at. */
  subject: string;
  count: number;
  sample: string[];
  detail: string;
  actions: IntegrityAction[];
}

export interface IntegrityCheckResult {
  id: string;
  label: string;
  status: 'ok' | 'issues';
  scanned: number;
  issueCount: number;
}

export interface DatabaseIntegrityReport {
  ok: boolean;
  durationMs: number;
  projectsScanned: number;
  checks: IntegrityCheckResult[];
  issues: IntegrityIssue[];
}

export interface IntegrityProgress {
  step: number;
  total: number;
  label: string;
  project?: string;
}

export interface IntegrityActionInput {
  action: IntegrityActionId;
  projectId: string;
  subject: string;
  targetDataset?: string;
}

export interface IntegrityActionResult {
  action: IntegrityActionId;
  changed: number;
  message: string;
}

/** The result of an AI provider connectivity check (verify credentials + model). */
export interface AiTestResult {
  ok: boolean;
  /** The model the probe ran against (echoed so the UI confirms the selection). */
  model: string;
  /** Present on failure — the provider's error (auth, unknown model, unreachable endpoint, …). */
  error?: string;
}

/** Provider-neutral status events from the on-page assistant's chat stream. */
export interface AgentChatHandlers {
  onStart?: (e: { conversationId: string; model: string }) => void;
  onText?: (delta: string) => void;
  onTool?: (e: { id: string; name: string; input: unknown }) => void;
  onToolResult?: (e: { id: string; name: string; ok: boolean; summary: string }) => void;
  onUsage?: (e: { inputTokens: number; outputTokens: number; projectMonthToDate: number }) => void;
  onDone?: (message: string) => void;
  onError?: (message: string) => void;
}

/**
 * Consume the assistant's SSE chat stream. Unlike {@link streamSse} (progress/done/error), the agent
 * emits richer named events — start / text / tool / tool_result / usage / done / error — dispatched to
 * typed handlers here. Aborting `signal` (drawer closed / user stops) ends the read quietly.
 */
async function streamAgentChat(url: string, body: unknown, handlers: AgentChatHandlers, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, { method: 'POST', credentials: 'include', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    let message = res.statusText || 'request failed';
    try {
      const j = (await res.json()) as { error?: unknown };
      if (typeof j.error === 'string') message = j.error;
    } catch {
      /* non-JSON error body */
    }
    notifyIfUnauthorized(res.status);
    handlers.onError?.(message);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return; // aborted → quiet end
      throw err;
    }
    if (chunk.done) {
      buf += decoder.decode(); // flush any trailing multi-byte sequence
      break;
    }
    buf += decoder.decode(chunk.value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      let event = 'message';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).replace(/^ /, '');
      }
      if (!data) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }
      switch (event) {
        case 'start': handlers.onStart?.(parsed as { conversationId: string; model: string }); break;
        case 'text': handlers.onText?.(String(parsed.delta ?? '')); break;
        case 'tool': handlers.onTool?.(parsed as { id: string; name: string; input: unknown }); break;
        case 'tool_result': handlers.onToolResult?.(parsed as { id: string; name: string; ok: boolean; summary: string }); break;
        case 'usage': handlers.onUsage?.(parsed as { inputTokens: number; outputTokens: number; projectMonthToDate: number }); break;
        case 'done': handlers.onDone?.(String(parsed.message ?? '')); break;
        case 'error': handlers.onError?.(typeof parsed.message === 'string' ? parsed.message : 'agent error'); break;
      }
    }
  }
}

/** The user's consent grant for the assistant on a project (from GET/PUT /agent/grant). */
export interface AgentGrantView {
  configured: boolean;
  capabilities: ApiKeyCapability[];
  autonomy: 'full' | 'ask';
}

/** A project the user can reach, with their role in it (the flat surface). */
export interface Project {
  id: string;
  name: string;
  slug: string;
  role: ProjectRole;
  /** The site's favicon (`identity.icon`) — a `/media/…` ref or absolute https URL — for the selector. */
  iconUrl?: string;
  /** The site's production/live URL (`website.siteUrl`), shown in the selector when set. */
  siteUrl?: string;
}
/** A soft-deleted project awaiting restore or permanent reap (the admin "deleted projects" list). */
export interface DeletedProject {
  id: string;
  name: string;
  slug: string;
  deletedAt: string | null;
  deletedBy: string | null;
}
/** A user's role within a single project. */
export type ProjectRole = 'owner' | 'member';
/** The platform-staff role for a user (developer/admin), or null for a pure client. */
export type PlatformRole = 'admin' | 'developer' | null;
/** The role an invite/membership can carry: a project tier (owner|member) or a platform tier (admin|developer). */
export type Role = 'owner' | 'member' | 'admin' | 'developer';

/** One entry in a content entity's revision history (metadata only — no snapshot blob). */
export interface RevisionMeta {
  id: string;
  op: 'put' | 'delete' | 'restore';
  actor: 'user' | 'agent';
  note: string | null;
  /** ISO timestamp. */
  revisionAt: string;
  author: { userId: string; email: string | null; isYou: boolean };
}
/** A row in the project-wide History feed — a RevisionMeta plus which entity it belongs to. */
export interface ProjectRevisionRow extends RevisionMeta {
  kind: string;
  entityId: string;
  /** The entity's dataset scope ('' for non-entries) — passed to restoreRevision so a repeated entry id
   *  is restored in the RIGHT dataset. */
  dataset: string;
  /** A short title for the entity (from the snapshot: title → name → id). */
  label: string;
}
/**
 * A member returned by a management list. Shared by two surfaces: `/admin/users` (platform staff —
 * role `admin`|`developer`) and `/projects/:id/members` (the project team — role `owner`|`member`).
 */
export interface OrgMember {
  userId: string;
  email: string;
  role: Role;
  /** Platform role (admin/developer = agency staff) — null/absent for a plain client. Project-member
   *  lists always include it; staff members are hidden in the Clients modal and can't be removed. */
  platformRole?: PlatformRole | null;
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
  /** Whether the invited email already has an account (→ sign in instead of setting a password). */
  hasAccount: boolean;
}
export type ApiKeyCapability = 'content:read' | 'content:write' | 'content:delete' | 'publish' | 'deploy';
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
  /** `pat` = a user-minted token; `oauth` = an MCP/agent OAuth session. */
  source: 'pat' | 'oauth';
}
export interface CreateApiKeyBody {
  name: string;
  role: ProjectRole;
  capabilities: ApiKeyCapability[];
  expiresInDays: number;
}
/**
 * A live agent connection (the "AI agent details" modal + header indicator): a personal token
 * (`pat`) or an OAuth/MCP agent session (`oauth`, shown for its whole session window). `id` is an
 * opaque disconnect handle (an `oauth:<userId>` form for sessions). No secrets are ever included.
 */
export interface AgentConnection {
  id: string;
  kind: 'pat' | 'oauth';
  name: string;
  role: ProjectRole;
  capabilities: ApiKeyCapability[];
  connectedAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}
import type { PageSummary } from './page-summary';
export type { PageSummary } from './page-summary';
export { hasOwnSource } from './page-summary';

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
  /** Password auth (required for FTP/FTPS; optional for SFTP when a private key is given). */
  password?: string;
  /** SFTP key auth: the PRIVATE KEY CONTENTS (PEM/OpenSSH) + an optional passphrase. */
  privateKey?: string;
  passphrase?: string;
  remoteDir?: string;
  /** Optional SFTP host-key fingerprint (SHA-256), OR a `known_hosts` line to pin the server. */
  hostFingerprint?: string;
  /** Minify each page's HTML at build — a serve option available for EVERY target type. */
  minifyHtml?: boolean;
  /** SFTP-only: transfer with rsync-over-SSH (delta + compression) instead of per-file SFTP. */
  useRsync?: boolean;
}

/** Config for saving a `git` deploy target (commit the built site to a branch). HTTPS remote → a
 *  token; SSH remote → a private key (+ optional passphrase and pinned `known_hosts` host key). */
export type GitTargetConfig = { protocol: 'git'; repoUrl: string; branch: string; minifyHtml?: boolean } & (
  | { token: string }
  | { privateKey: string; passphrase?: string; hostFingerprint?: string }
);

/** Config for saving a `local` Local Hosting target (serve the built site on this platform at
 *  `/sites/<slug>/`). `previewToken` gates it behind `?token=` (an unlisted preview link). */
export interface LocalTargetConfig {
  protocol: 'local';
  previewToken?: string;
  minifyHtml?: boolean;
}

/** Fields for editing a saved target in place (PUT). The protocol is immutable (omit it). A credential
 *  left undefined keeps the existing encrypted secret. `clearPreviewToken` removes a local target's
 *  unlisted-link gate (a bare `previewToken` omission means "keep"). */
export interface UpdateDeployTargetConfig {
  name?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  remoteDir?: string;
  hostFingerprint?: string;
  previewToken?: string;
  clearPreviewToken?: boolean;
  minifyHtml?: boolean;
  useRsync?: boolean;
  repoUrl?: string;
  branch?: string;
  token?: string;
}

/** A streamed deploy progress event. FTP/SFTP report per-file (`connecting`/`uploading` + index/total);
 *  git reports coarse phases (`preparing`/`committing`/`pushing`) with no file count. FTP/SFTP also
 *  report the transfer diagnostics — `strategy` (per-file, or standalone rsync), `bytes`, `elapsedMs`
 *  (for throughput), and `skipped` (unchanged files served from the manifest). */
export interface DeployProgressEvent {
  phase: 'connecting' | 'checking' | 'uploading' | 'preparing' | 'committing' | 'pushing' | 'done';
  total?: number;
  index?: number;
  file?: string;
  skipped?: number;
  removed?: number;
  strategy?: 'files' | 'rsync';
  bytes?: number;
  elapsedMs?: number;
}

/** The `done` payload of a streamed deploy — FTP/SFTP report `files` + transfer diagnostics
 *  (`uploaded`/`skipped`/`removed`/`strategy`/`bytes`/`elapsedMs`); git reports `branch`/`commit`. */
export interface StreamDoneResult {
  protocol: string;
  files?: number;
  uploaded?: number;
  skipped?: number;
  removed?: number;
  strategy?: 'files' | 'rsync';
  bytes?: number;
  elapsedMs?: number;
  branch?: string;
  commit?: string;
}

/** A streamed website-import progress event (crawl / transform / host-media / assemble phases). */
export interface ImportProgressEvent {
  phase: string;
  detail?: string;
  done?: number;
  total?: number;
  fetched?: number;
  queued?: number;
  url?: string;
}

/** The `done` report of a project-zip import (a brand-new project was created). */
export interface ProjectImportReport {
  projectId: string;
  slug: string;
  name: string;
  imported: number;
  media: number;
}

/** A system Widget descriptor from GET /authoring/widgets — the slim catalog the Widgets rail browses
 *  (the body + manifest stay server-side; dropping {{> name}} provisions `datasets` on save). */
export interface WidgetCatalogEntry {
  name: string;
  label: string;
  description: string;
  component: string;
  datasets: Array<{ slug: string; name: string }>;
}

/** A "fork existing effect" snippet (GET /authoring/effect-forks) — a built-in effect as ready-to-run
 *  custom code the editor inserts into a "None / Custom Code" slot. */
export interface EffectFork {
  name: string;
  label: string;
  code: string;
}
export interface EffectForks {
  nav: EffectFork[];
  button: EffectFork[];
  preloader: EffectFork[];
}

/** Lighthouse category scores 0–100 (null when a category could not be scored). */
export interface PagespeedScores {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
}
/** One concrete resource/element a finding points at (a file to fix, or a DOM node). */
export interface PagespeedResourceItem {
  /** Origin-relative for the site's own assets; absolute for third-party. */
  url?: string;
  /** A short label when the item is a DOM node / source location rather than a plain URL. */
  label?: string;
  totalBytes?: number;
  wastedBytes?: number;
  wastedMs?: number;
}
/** One actionable, non-passing audit the author can fix. */
export interface PagespeedFinding {
  id: string;
  title: string;
  category: keyof PagespeedScores;
  score: number | null;
  displayValue?: string;
  /** Lighthouse's what-it-means + how-to-fix text (markdown; shown as the finding's advice tooltip). */
  description?: string;
  /** Estimated page-load time saved by fixing this (opportunity audits), in ms. */
  overallSavingsMs?: number;
  /** Estimated transfer saved by fixing this (opportunity audits), in bytes. */
  overallSavingsBytes?: number;
  /** The specific resources/elements this finding points at — worst-first, capped. */
  items?: PagespeedResourceItem[];
  /** How many further items exist beyond the capped `items` (so the UI can say "+N more"). */
  moreItems?: number;
}
/** One heading in the page's structure outline. */
export interface HeadingNode {
  /** Heading level, 1 (H1) … 6 (H6). */
  level: number;
  text: string;
  /** A recommendation attached to this heading (a skipped level, or empty text). */
  issue?: string;
}
/** The page's heading (h1–h6) outline plus SEO/accessibility recommendations. */
export interface HeadingOutline {
  headings: HeadingNode[];
  /** Document-level recommendations (missing / duplicate H1, no headings). */
  issues: string[];
  /** How many headings were dropped past the render cap. */
  truncated?: number;
}
/** Lighthouse page-speed + SEO audit of a page (GET /projects/:id/pagespeed-audit/:pageId). Lab-only. */
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
  /** The page's heading (h1–h6) outline with recommendations — absent when the HTML could not be read. */
  outline?: HeadingOutline;
  lighthouseVersion: string;
  fetchedAt: string;
}

export const api = {
  register: (email: string, password: string) =>
    request<{ userId: string }>('POST', '/auth/register', { email, password }),
  // Login returns the user when no second factor is set, OR a one-time `ticket` (no session yet) when
  // the account has TOTP — the caller then redeems it via loginTotp() with the code.
  login: (email: string, password: string) =>
    request<{ userId: string } | { mfaRequired: true; ticket: string }>('POST', '/auth/login', { email, password }),
  // Login step 2: redeem the ticket with a 6-digit TOTP code OR a recovery code.
  loginTotp: (ticket: string, code: string) =>
    request<{ userId: string }>('POST', '/auth/login/totp', { ticket, code }),
  logout: () => request<void>('POST', '/auth/logout'),
  // Public login-screen config — unauthenticated, no secrets: the enabled OIDC providers and the
  // admin-panel branding (so the pre-auth screen skins itself).
  loginConfig: () =>
    request<{ oidcProviders: { id: string; label: string }[]; branding: Branding; platformBackground: PlatformBackground | null }>('GET', '/auth/config'),
  // The (full) URL to begin an OIDC login — the browser navigates here (a redirect to the IdP).
  oidcStartUrl: (id: string) => `${BASE}/auth/oidc/${encodeURIComponent(id)}/start`,
  me: () =>
    request<{
      userId: string;
      email: string;
      platformRole: PlatformRole;
      isInstanceAdmin: boolean;
      totpEnabled: boolean;
      recoveryCodesRemaining: number;
      /** Whether the account has a password set (false for an OIDC-provisioned user who hasn't set one). */
      hasPassword: boolean;
      /** When true, the user must set a new password before doing anything (seeded default-password admin). */
      mustChangePassword: boolean;
      projects: Project[];
    }>('GET', '/me'),
  // Self-service account management (the header user menu). Both re-authenticate with the
  // current password server-side; a wrong password surfaces as a 403 ApiError (not a logout).
  updateEmail: (email: string, currentPassword: string) =>
    request<{ email: string }>('PUT', '/account/email', { email, currentPassword }),
  // `currentPassword` is omitted to SET an initial password for an account that has none (OIDC users).
  changePassword: (currentPassword: string | undefined, newPassword: string) =>
    request<void>('PUT', '/account/password', { currentPassword, newPassword }),
  // Two-factor (TOTP). setup → begin enrolment (secret + otpauth URI for the QR); confirm → enable +
  // get recovery codes once; disable / regenerate are password-confirmed.
  mfaSetupTotp: () =>
    request<{ secret: string; otpauthUri: string }>('POST', '/account/mfa/totp/setup'),
  mfaConfirmTotp: (code: string) =>
    request<{ recoveryCodes: string[] }>('POST', '/account/mfa/totp/confirm', { code }),
  mfaDisableTotp: (currentPassword: string) =>
    request<void>('DELETE', '/account/mfa/totp', { currentPassword }),
  mfaRegenerateRecoveryCodes: (currentPassword: string) =>
    request<{ recoveryCodes: string[] }>('POST', '/account/mfa/recovery-codes', { currentPassword }),
  // Passkeys (WebAuthn). The `options`/`response` are the structured WebAuthn JSON; `handle` is the
  // opaque challenge token threaded from options → verify.
  passkeyRegisterOptions: () =>
    request<{ options: PublicKeyCredentialCreationOptionsJSON; handle: string }>('POST', '/account/passkeys/register/options'),
  passkeyRegisterVerify: (handle: string, response: RegistrationResponseJSON, name: string) =>
    request<{ id: string; name: string }>('POST', '/account/passkeys/register/verify', { handle, response, name }),
  listPasskeys: () => request<{ items: PasskeyView[] }>('GET', '/account/passkeys'),
  renamePasskey: (id: string, name: string) =>
    request<void>('PATCH', `/account/passkeys/${encodeURIComponent(id)}`, { name }),
  deletePasskey: (id: string) => request<void>('DELETE', `/account/passkeys/${encodeURIComponent(id)}`),
  passkeyLoginOptions: () =>
    request<{ options: PublicKeyCredentialRequestOptionsJSON; handle: string }>('POST', '/auth/passkey/options'),
  passkeyLoginVerify: (handle: string, response: AuthenticationResponseJSON) =>
    request<{ userId: string } | { mfaRequired: true; ticket: string }>('POST', '/auth/passkey/verify', { handle, response }),
  version: () =>
    request<{ current: string; latest: string | null; updateAvailable: boolean; releaseUrl: string | null; build: string | null }>(
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
  /** Rename a project's display NAME and/or its SLUG (owner-only). A slug change rewrites media refs + moves
   *  media on the server; the callers refresh the project list afterwards (the id is unchanged). */
  updateProject: (id: string, patch: { name?: string; slug?: string }) =>
    request<{ project: Project }>('PATCH', `/projects/${id}`, patch),
  /** SOFT-delete (recoverable): hides the project everywhere; an admin can restore or permanently reap it. */
  deleteProject: (id: string) => request<void>('DELETE', `/projects/${id}`),
  /** Admin: every soft-deleted project (for the "deleted projects" management surface). */
  listDeletedProjects: () => request<{ projects: DeletedProject[] }>('GET', '/admin/deleted-projects'),
  /** Admin: un-delete a soft-deleted project (its rows + artifacts were retained). */
  restoreProject: (id: string) =>
    request<void>('POST', `/admin/deleted-projects/${encodeURIComponent(id)}/restore`),
  /** Admin: PERMANENTLY delete a soft-deleted project — rows, files, and orphaned client accounts. */
  reapProject: (id: string) => request<void>('DELETE', `/admin/deleted-projects/${encodeURIComponent(id)}`),
  /** Admin: permanently delete EVERY soft-deleted project. Returns how many were reaped. */
  reapAllDeletedProjects: () => request<{ reaped: number }>('DELETE', '/admin/deleted-projects'),
  listPages: (projectId: string) =>
    request<{ items: Page[] }>('GET', `/projects/${projectId}/content/page`),
  /**
   * The pages list WITHOUT every page's Handlebars source and data store — the fields that make a real
   * site's list hundreds of KB. Each omitted field is described under `_summary` instead.
   *
   * ★ A summarised page is NOT a page: writing one back would delete the very fields it omits, and any
   * predicate that reads `source` to mean "has own code" silently flips. Use {@link hasOwnSource} for
   * that question, and `getPage` before editing or copying a body.
   */
  listPageSummaries: (projectId: string) =>
    request<{ items: PageSummary[] }>('GET', `/projects/${projectId}/content/page?summary=1`),
  /** Run a Lighthouse page-speed + SEO audit of one page (deploy-equivalent build). Defaults to mobile. */
  pagespeedAudit: (projectId: string, pageId: string, formFactor?: 'mobile' | 'desktop') =>
    request<PagespeedAuditResult>(
      'GET',
      `/projects/${projectId}/pagespeed-audit/${encodeURIComponent(pageId)}${formFactor ? `?formFactor=${formFactor}` : ''}`,
    ),
  getPage: (projectId: string, id: string) =>
    request<{ item: Page }>('GET', `/projects/${projectId}/content/page/${encodeURIComponent(id)}`),
  putPage: (projectId: string, page: Page) =>
    request<{ item: Page }>('PUT', `/projects/${projectId}/content/page/${page.id}`, page),
  deletePage: (projectId: string, id: string) =>
    request<void>('DELETE', `/projects/${projectId}/content/page/${id}`),

  // --- multilingual locale management (see docs/i18n-content-model.md) ---
  // Add a translation target: scaffolds an inherit-mode variant of every default-language page.
  addLocale: (projectId: string, locale: string) =>
    request<{ locale: string; created: number; pages: Page[] }>('POST', `/projects/${projectId}/locales`, { locale }),
  // Remove a translation target: cascade-deletes every page in that language.
  // Set one project-translation cell (website.translations[key][locale]) — the inline data-sw-translate
  // editor. An empty value clears the cell (reverting to the default-language string).
  setTranslation: (projectId: string, key: string, locale: string, value: string) =>
    request<{ key: string; locale: string; value: string }>(
      'PUT',
      `/projects/${projectId}/translations`,
      { key, locale, value },
    ),
  // Set one website.data leaf (a dotted path WITHIN website.data) — the inline {{sw-control
  // target="website.data.<path>"}} editor. A GLOBAL store, so the edit applies site-wide.
  setWebsiteData: (projectId: string, key: string, value: string) =>
    request<{ key: string; value: string }>('PUT', `/projects/${projectId}/website-data`, { key, value }),
  removeLocale: (projectId: string, locale: string) =>
    request<{ locale: string; removed: number }>('DELETE', `/projects/${projectId}/locales/${encodeURIComponent(locale)}`),
  // Change the MAIN (default) language by re-labelling it to a NOT-yet-active locale code (the old
  // default is replaced in the locales list). Relabel only — no content is translated/migrated.
  setDefaultLocale: (projectId: string, locale: string) =>
    request<{ defaultLocale: string; locales: string[] }>('PUT', `/projects/${projectId}/locales/default`, { locale }),
  // Make an existing default-language page available in all (or the given) languages.
  translatePage: (projectId: string, pageId: string, locales?: string[]) =>
    request<{ created: number; pages: Page[] }>(
      'POST',
      `/projects/${projectId}/pages/${encodeURIComponent(pageId)}/translate`,
      locales ? { locales } : {},
    ),
  // Delete a page across the languages that INHERIT its code (forked/template variants are kept).
  deletePageGroup: (projectId: string, pageId: string) =>
    request<{ removed: string[]; kept: string[] }>(
      'POST',
      `/projects/${projectId}/pages/${encodeURIComponent(pageId)}/delete-group`,
    ),

  // Full-parity live preview: POST the (draft) page; the server renders it through the
  // isolated worker WITH the project skeleton slots, website head/critical CSS, and the
  // page's {{edit}} content — the same document publish produces. `token` loads the doc
  // via an iframe `src` (opaque-origin sandbox CSP), never `srcDoc`.
  // `slots` overrides the SAVED chrome for this render — how the skeleton-slot editor previews the
  // markup being typed (without it a slot editor could only ever show what was last written). The
  // server validates an override with the same gate a settings save uses.
  preview: (projectId: string, page: Page, slots?: Record<string, string>) =>
    request<{ html: string; token: string; slug: string }>(
      'POST',
      `/projects/${projectId}/preview`,
      slots ? { ...page, slots } : page,
    ),

  // --- templates (reusable code-first page layouts; globals ship in @sitewright/core) ---
  listTemplates: (projectId: string) =>
    request<{ items: Template[] }>('GET', `/projects/${projectId}/content/template`),
  getTemplate: (projectId: string, id: string) =>
    request<{ item: Template }>('GET', `/projects/${projectId}/content/template/${encodeURIComponent(id)}`),
  putTemplate: (projectId: string, template: Template) =>
    request<{ item: Template }>('PUT', `/projects/${projectId}/content/template/${encodeURIComponent(template.id)}`, template),
  deleteTemplate: (projectId: string, id: string) =>
    request<void>('DELETE', `/projects/${projectId}/content/template/${encodeURIComponent(id)}`),

  // --- image maps (interactive hotspot maps; embedded with {{sw-imagemap "id"}}) ---
  /** URL of the map-only preview document — the map alone, no site chrome (iframe `src`). */
  imageMapPreviewUrl: (projectId: string, ref: { map: string } | { template: string }): string => {
    const q = 'map' in ref ? `map=${encodeURIComponent(ref.map)}` : `template=${encodeURIComponent(ref.template)}`;
    return `${BASE}/projects/${projectId}/imagemaps/preview?${q}`;
  },
  listImageMaps: (projectId: string) =>
    request<{ items: ImageMap[] }>('GET', `/projects/${projectId}/content/imagemap`),
  getImageMap: (projectId: string, id: string) =>
    request<{ item: ImageMap }>('GET', `/projects/${projectId}/content/imagemap/${encodeURIComponent(id)}`),
  putImageMap: (projectId: string, map: ImageMap) =>
    request<{ item: ImageMap }>('PUT', `/projects/${projectId}/content/imagemap/${encodeURIComponent(map.id)}`, map),
  deleteImageMap: (projectId: string, id: string) =>
    request<void>('DELETE', `/projects/${projectId}/content/imagemap/${encodeURIComponent(id)}`),
  /** The bundled starter templates (metadata only — platform data, not project-scoped). */
  listImageMapTemplates: () => request<{ templates: ImageMapTemplate[] }>('GET', '/authoring/imagemaps'),
  /** Materialise a template INTO a project: its images are copied into the project's own media
   *  library and the config rewritten, so the new map references nothing on the platform. */
  createImageMapFromTemplate: (projectId: string, body: { template: string; id?: string; name?: string }) =>
    request<{ item: ImageMap; importedImages: number }>('POST', `/projects/${projectId}/imagemaps/from-template`, body),

  // --- snippets (code-first reusable Handlebars partials, included via {{> name}}) ---
  listSnippets: (projectId: string) =>
    request<{ items: Snippet[] }>('GET', `/projects/${projectId}/content/snippet`),
  putSnippet: (projectId: string, snippet: Snippet) =>
    request<{ item: Snippet }>('PUT', `/projects/${projectId}/content/snippet/${encodeURIComponent(snippet.id)}`, snippet),
  deleteSnippet: (projectId: string, id: string) =>
    request<void>('DELETE', `/projects/${projectId}/content/snippet/${encodeURIComponent(id)}`),

  // --- GLOBAL library (instance-wide; read by everyone, written only by an instance admin) ---
  listGlobalSnippets: () => request<{ items: Snippet[] }>('GET', '/global/snippet'),
  putGlobalSnippet: (snippet: Snippet) =>
    request<{ item: Snippet }>('PUT', `/admin/global/snippet/${encodeURIComponent(snippet.id)}`, snippet),
  deleteGlobalSnippet: (id: string) => request<void>('DELETE', `/admin/global/snippet/${encodeURIComponent(id)}`),
  // --- system Widgets (managed, data-backed drop-ins; the catalog the Widgets rail browses) ---
  listWidgets: () => request<{ widgets: WidgetCatalogEntry[] }>('GET', '/authoring/widgets'),
  /** The "fork existing effect" snippets for the Website-settings custom-code editors. */
  listEffectForks: () => request<EffectForks>('GET', '/authoring/effect-forks'),
  /** The compiled button-preview stylesheet (.btn baseline + all effect/shape/accent utilities) for the Button-effects modal. */
  buttonPreviewCss: () => request<{ css: string }>('GET', '/authoring/button-preview-css'),
  /** Same-origin URL of the Library "Parallax" builder's live preview DOCUMENT, used as the iframe
   *  `src` (NOT srcDoc) so it loads under the route's `sandbox allow-scripts` CSP and the runtime
   *  actually runs. `query` is a pre-built, encoded query string (the channel knobs). */
  parallaxPreviewUrl: (query: string) => `${BASE}/authoring/parallax-preview${query ? `?${query}` : ''}`,

  /** The SVG-animation builder preview doc URL (same sandbox-CSP route pattern as the parallax preview;
   *  loaded via iframe `src`). Config is pushed live via postMessage, so no query is needed. */
  svgAnimPreviewUrl: (query: string) => `${BASE}/authoring/svg-preview${query ? `?${query}` : ''}`,

  /** The SVG Animation Studio's live canvas doc URL (same sandbox-CSP route; content pushed via postMessage). */
  svgStudioPreviewUrl: () => `${BASE}/authoring/svg-studio-preview`,

  listGlobalTemplates: () => request<{ items: Template[] }>('GET', '/global/template'),
  putGlobalTemplate: (template: Template) =>
    request<{ item: Template }>('PUT', `/admin/global/template/${encodeURIComponent(template.id)}`, template),
  deleteGlobalTemplate: (id: string) => request<void>('DELETE', `/admin/global/template/${encodeURIComponent(id)}`),

  // --- project settings singleton (Corporate Identity + website + locales) ---
  getSettings: (projectId: string) =>
    request<{ item: SettingsBundle }>('GET', `/projects/${projectId}/content/settings/settings`),
  putSettings: (projectId: string, bundle: SettingsBundle) =>
    request<{ item: SettingsBundle }>(
      'PUT',
      `/projects/${projectId}/content/settings/settings`,
      bundle,
    ),
  /**
   * PATCH a few `website.*` fields, leaving every other setting alone (`?merge=1`, deep-merged server
   * side). For a caller that owns ONE field and never loaded the rest — the Critical CSS shortcut, say.
   * `putSettings` REPLACES the whole singleton, so using it from such a caller would silently wipe
   * whatever it didn't happen to be holding.
   */
  patchWebsiteSettings: (projectId: string, patch: Partial<WebsiteSettings>) =>
    request<{ item: SettingsBundle }>(
      'PUT',
      `/projects/${projectId}/content/settings/settings?merge=1`,
      { website: patch },
    ),

  // --- content revision history (any revisioned kind: page/template/snippet/translation/dataset/entry/form/settings) ---
  listRevisions: (projectId: string, kind: string, id: string, dataset?: string) =>
    request<{ items: RevisionMeta[] }>(
      'GET',
      `/projects/${projectId}/content/${kind}/${encodeURIComponent(id)}/revisions${dataset ? `?dataset=${encodeURIComponent(dataset)}` : ''}`,
    ),
  getRevision: (projectId: string, kind: string, id: string, revId: string) =>
    request<{ revision: RevisionMeta & { data: unknown } }>(
      'GET',
      `/projects/${projectId}/content/${kind}/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revId)}`,
    ),
  // For kind 'entry', `dataset` (its owning slug) is REQUIRED — an entry id repeats across datasets, so
  // restore must address the right one. Other kinds are project-global and ignore it.
  restoreRevision: (projectId: string, kind: string, id: string, revId: string, dataset?: string) =>
    request<{ item: unknown }>(
      'POST',
      `/projects/${projectId}/content/${kind}/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revId)}/restore${dataset ? `?dataset=${encodeURIComponent(dataset)}` : ''}`,
    ),
  /** The project-wide activity feed (History view). Optional kind/op filters + a `before` ISO cursor. */
  listProjectRevisions: (projectId: string, opts: { kind?: string; op?: string; limit?: number; before?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.kind) q.set('kind', opts.kind);
    if (opts.op) q.set('op', opts.op);
    if (opts.limit) q.set('limit', String(opts.limit));
    if (opts.before) q.set('before', opts.before);
    const qs = q.toString();
    return request<{ items: ProjectRevisionRow[]; nextBefore: string | null }>(
      'GET',
      `/projects/${projectId}/revisions${qs ? `?${qs}` : ''}`,
    );
  },

  // --- Google fonts: download a family's weights → self-host as a kind:'font' library asset ---
  selectFont: (projectId: string, family: string, weights: number[], folder = '') =>
    request<{ item: MediaAsset }>('POST', `/projects/${projectId}/fonts/select`, { family, weights, folder }),

  // --- Local font upload: a font file (magic-byte validated) → a kind:'font' library asset ---
  uploadFont: async (
    projectId: string,
    file: File,
    meta: { family: string; weight: number; style: 'normal' | 'italic'; fallback: string; folder?: string },
  ): Promise<{ item: MediaAsset }> => {
    const form = new FormData();
    form.append('file', file);
    // Font metadata + folder ride as query params (the multipart config admits no extra fields).
    const qs = new URLSearchParams({ family: meta.family, weight: String(meta.weight), style: meta.style, fallback: meta.fallback });
    if (meta.folder) qs.set('folder', meta.folder);
    const res = await fetch(`${BASE}/projects/${projectId}/media?${qs.toString()}`, {
      method: 'POST',
      credentials: 'include',
      body: form, // the browser sets multipart/form-data with the boundary
    });
    if (!res.ok) throw await errorFromResponse(res);
    return (await res.json()) as { item: MediaAsset };
  },

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
  /** Active agent connections (PATs + live OAuth/MCP sessions) — the AI agent details modal + indicator. */
  listAgentConnections: (projectId: string) =>
    request<{ items: AgentConnection[] }>('GET', `/projects/${projectId}/agent-connections`),
  /** Disconnect one connection (revokes a PAT, or fully severs an OAuth session for the project). */
  disconnectAgent: (projectId: string, id: string) =>
    request<void>('DELETE', `/projects/${projectId}/agent-connections/${encodeURIComponent(id)}`),
  /**
   * Resolve a changed page entity (a content id from the SSE stream) to its preview ROUTE, so the
   * live-preview surface can auto-navigate to the page an agent just created/edited. `{ path: null }`
   * for a non-page entity or a routeless page (the surface then just reloads the current page).
   */
  previewLocate: (projectId: string, entity: string) =>
    request<{ path: string | null }>('GET', `/projects/${projectId}/preview-locate?entity=${encodeURIComponent(entity)}`),
  /**
   * The SIGNED, share-able preview base (`/preview/<id>/<sig>/`) — members-only to mint.
   *
   * Also reports any page the draft build could not render. Those pages still SERVE (an error
   * document naming the problem, in place of the page), so the preview is never stale — this is how
   * the shell can say so while the author is looking at a page that is perfectly fine.
   */
  previewBase: (projectId: string) =>
    request<{ base: string; pageFailures?: Array<{ page: string; path: string; message: string }> }>(
      'GET',
      `/projects/${projectId}/preview-url`,
    ),
  /** What the in-flight draft build is doing, for the preview shell's loading pill. Non-blocking —
   *  `previewBase` itself waits for the whole build, so this is the only way to narrate that wait. */
  previewProgress: (projectId: string) =>
    request<{ building: boolean; phase?: string; done?: number; total?: number }>(
      'GET',
      `/projects/${projectId}/preview-progress`,
    ),
  /** Revocable, stable SHARE links for the draft preview (viewable by UNAUTHENTICATED clients). */
  listPreviewShares: (projectId: string) =>
    request<{ items: Array<{ id: string; label: string; createdAt: number; url: string }> }>('GET', `/projects/${projectId}/preview-shares`),
  createPreviewShare: (projectId: string, label: string) =>
    request<{ id: string; label: string; createdAt: number; url: string }>('POST', `/projects/${projectId}/preview-shares`, { label }),
  deletePreviewShare: (projectId: string, shareId: string) =>
    request<{ ok: boolean }>('DELETE', `/projects/${projectId}/preview-shares/${shareId}`),
  /** Member-safe agent presence COUNT for the preview surface's pill (no connection details). */
  agentPresence: (projectId: string) =>
    request<{ connected: number }>('GET', `/projects/${projectId}/agent-presence`),
  createApiKey: (projectId: string, body: CreateApiKeyBody) =>
    request<{ token: string; key: ApiKeyView }>('POST', `/projects/${projectId}/api-keys`, body),
  deleteApiKey: (projectId: string, id: string) =>
    request<void>('DELETE', `/projects/${projectId}/api-keys/${encodeURIComponent(id)}`),

  // --- datasets ---
  listDatasets: (projectId: string) =>
    request<{ items: Dataset[] }>('GET', `/projects/${projectId}/content/dataset`),
  getDataset: (projectId: string, id: string) =>
    request<{ item: Dataset }>('GET', `/projects/${projectId}/content/dataset/${encodeURIComponent(id)}`),
  putDataset: (projectId: string, dataset: Dataset) =>
    request<{ item: Dataset }>('PUT', `/projects/${projectId}/content/dataset/${encodeURIComponent(dataset.id)}`, dataset),
  deleteDataset: (projectId: string, id: string) =>
    request<void>('DELETE', `/projects/${projectId}/content/dataset/${encodeURIComponent(id)}`),
  /** Rename a dataset's slug. `cascade` (default true) also rewrites entries + page/template references. */
  renameDataset: (projectId: string, id: string, slug: string, cascade: boolean) =>
    request<{ oldSlug: string; newSlug: string; cascaded: boolean; entriesUpdated: number; pagesUpdated: number; templatesUpdated: number; referencesUpdated: number }>(
      'POST',
      `/projects/${projectId}/datasets/${encodeURIComponent(id)}/rename`,
      { slug, cascade },
    ),

  // --- entries ---
  /**
   * Entries — SCOPE THIS. Unscoped it returns every dataset's rows with their full values: measured at
   * 1.85 MB on a project with 886 entries, fetched again on every reload of the screen. Pass the dataset
   * slug whenever the caller only cares about one collection (the usual case).
   */
  listEntries: (projectId: string, dataset?: string) =>
    request<{ items: Entry[] }>(
      'GET',
      `/projects/${projectId}/content/entry${dataset ? `?dataset=${encodeURIComponent(dataset)}` : ''}`,
    ),
  /** How many entries a dataset holds, without materialising any of them (reads `total` off one row). */
  countEntries: async (projectId: string, dataset: string): Promise<number> => {
    const res = await request<{ items: Entry[]; total: number }>(
      'GET',
      `/projects/${projectId}/content/entry?dataset=${encodeURIComponent(dataset)}&limit=1&summary=1`,
    );
    return res.total;
  },
  // An entry id is only unique WITHIN its dataset, so read/delete carry the owning dataset slug as
  // `?dataset=`; put derives it from the entry body (entry.dataset).
  getEntry: (projectId: string, id: string, dataset: string) =>
    request<{ item: Entry }>('GET', `/projects/${projectId}/content/entry/${encodeURIComponent(id)}?dataset=${encodeURIComponent(dataset)}`),
  putEntry: (projectId: string, entry: Entry) =>
    request<{ item: Entry }>('PUT', `/projects/${projectId}/content/entry/${encodeURIComponent(entry.id)}`, entry),
  deleteEntry: (projectId: string, id: string, dataset: string) =>
    request<void>('DELETE', `/projects/${projectId}/content/entry/${encodeURIComponent(id)}?dataset=${encodeURIComponent(dataset)}`),

  // --- media ---
  listMedia: (projectId: string, kind?: 'image' | 'file' | 'font') =>
    request<{ items: MediaAsset[] }>('GET', `/projects/${projectId}/media${kind ? `?kind=${kind}` : ''}`),
  uploadMedia: async (projectId: string, file: File, folder = ''): Promise<{ item: MediaAsset }> => {
    const form = new FormData();
    form.append('file', file);
    // The virtual folder rides as a query param (the multipart config admits no extra fields).
    const qs = folder ? `?folder=${encodeURIComponent(folder)}` : '';
    const res = await fetch(`${BASE}/projects/${projectId}/media${qs}`, {
      method: 'POST',
      credentials: 'include',
      body: form, // the browser sets multipart/form-data with the boundary
    });
    if (!res.ok) throw await errorFromResponse(res);
    return (await res.json()) as { item: MediaAsset };
  },
  /** Download a remote URL into the library (self-host) — returns the new asset. */
  importMediaUrl: (projectId: string, url: string, folder = '') =>
    request<{ item: MediaAsset }>('POST', `/projects/${projectId}/media/import-url`, { url, folder }),
  /** Overwrite an existing SVG asset's content in place (Studio "save to the same file"); id-stable. */
  overwriteSvgMedia: (projectId: string, id: string, svg: string) =>
    request<{ item: MediaAsset }>('PUT', `/projects/${projectId}/media/${id}/svg`, { svg }),
  deleteMedia: (projectId: string, id: string) =>
    request<void>('DELETE', `/projects/${projectId}/media/${id}`),
  /** Clear the project's on-demand thumbnail cache (keeps every original; regenerated on next view). */
  pruneThumbnails: (projectId: string) =>
    request<{ removed: number }>('POST', `/projects/${projectId}/media/prune-thumbnails`, {}),
  /** Media nothing in the project refers to, with what the scan actually covered. */
  unusedMedia: (projectId: string) =>
    request<{ items: Array<MediaAsset & { onlyInHistory?: boolean }>; scanned: { assets: number; contentRows: number; globalRows: number; revisionRows: number } }>(
      'GET',
      `/projects/${projectId}/media/unused`,
    ),
  /** What this project occupies on disk, per store (reporting only — nothing enforces a quota). */
  projectStorage: (projectId: string) =>
    request<{ media: number; build: number; preview: number; sourceRefs: number; total: number; derived: number }>(
      'GET',
      `/projects/${projectId}/storage`,
    ),
  // --- media Recycle Bin (soft-delete → restore / purge) ---
  listDeletedMedia: (projectId: string) =>
    request<{ items: Array<MediaAsset & { deletedAt: number }> }>('GET', `/projects/${projectId}/media/deleted`),
  restoreMedia: (projectId: string, id: string) =>
    request<void>('POST', `/projects/${projectId}/media/${id}/restore`),
  purgeMedia: (projectId: string, id: string) =>
    request<void>('DELETE', `/projects/${projectId}/media/${id}/purge`),
  /** Empty the Recycle Bin — permanently purge EVERY soft-deleted asset. Returns how many were removed. */
  emptyRecycleBin: (projectId: string) =>
    request<{ purged: number }>('DELETE', `/projects/${projectId}/media/deleted`),
  /** Move (`folder`) and/or rename (`filename`) a single asset. */
  patchMedia: (projectId: string, id: string, patch: { folder?: string; filename?: string }) =>
    request<{ item: MediaAsset }>('PATCH', `/projects/${projectId}/media/${id}`, patch),
  /** Duplicate an asset (optionally into another folder). */
  copyMedia: (projectId: string, id: string, folder?: string) =>
    request<{ item: MediaAsset }>('POST', `/projects/${projectId}/media/${id}/copy`, folder !== undefined ? { folder } : {}),

  // --- media folders (first-class; empty folders persist) ---
  listMediaFolders: (projectId: string) =>
    request<{ items: MediaFolderRecord[] }>('GET', `/projects/${projectId}/media/folders`),
  createMediaFolder: (projectId: string, path: string) =>
    request<{ ok: true }>('POST', `/projects/${projectId}/media/folders`, { path }),
  /** Rename or move a folder (re-roots its subtree + assets). */
  renameMediaFolder: (projectId: string, from: string, to: string) =>
    request<{ ok: true }>('POST', `/projects/${projectId}/media/folders/rename`, { from, to }),
  /** Copy a folder subtree (records + duplicated assets) to a new path. */
  copyMediaFolder: (projectId: string, from: string, to: string) =>
    request<{ ok: true }>('POST', `/projects/${projectId}/media/folders/copy`, { from, to }),
  /** Delete a folder recursively (its subfolders + assets + binaries). */
  deleteMediaFolder: (projectId: string, path: string) =>
    request<void>('DELETE', `/projects/${projectId}/media/folders`, { path }),

  // --- stock images (search provider-hosted photos; import = download+optimize+self-host) ---
  stockProviders: (projectId: string) =>
    request<StockProvidersStatus>('GET', `/projects/${projectId}/stock/providers`),
  /** `provider` may be a single provider or 'all' to fan out across every available one. */
  searchStock: (projectId: string, provider: StockSearchProvider, q: string, page = 1) => {
    const params = new URLSearchParams({ provider, q, page: String(page) });
    return request<StockSearchResult>('GET', `/projects/${projectId}/stock/search?${params.toString()}`);
  },
  importStock: (projectId: string, provider: StockProviderName, id: string, alt?: string, folder?: string) =>
    request<{ item: MediaAsset }>('POST', `/projects/${projectId}/stock/import`, {
      provider,
      id,
      ...(alt ? { alt } : {}),
      ...(folder ? { folder } : {}),
    }),

  // --- publishing ---
  publish: (projectId: string) =>
    request<{ release: Release; url: string | null; dirty: boolean }>('POST', `/projects/${projectId}/publish`),
  publishStatus: (projectId: string) =>
    // `dirty` = unpublished content changes; `localHosting` = a Local Hosting deploy target exists;
    // `previewToken` = that target's soft preview-token gate (the View-live link carries it).
    // `url` is NULL unless this app is the thing serving the site (Local Hosting) — a remote FTP/SFTP/Git
    // target uploads to an origin we can't name, and with no target at all nothing serves it. `previewUrl`
    // (signed draft preview) is always present.
    request<{
      status: 'published' | 'unpublished';
      release: Release | null;
      url: string | null;
      previewUrl: string;
      dirty: boolean;
      localHosting?: boolean;
      deployTargets?: number;
      previewToken?: string;
    }>('GET', `/projects/${projectId}/publish`),
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
  createDeployTarget: (projectId: string, config: (DeployConfig | GitTargetConfig | LocalTargetConfig) & { name: string }) =>
    request<{ target: DeployTargetView }>('POST', `/projects/${projectId}/deploy-targets`, config),
  /** Edit a saved target in place. Protocol is immutable; omitted credentials keep the stored secret. */
  updateDeployTarget: (projectId: string, id: string, config: UpdateDeployTargetConfig) =>
    request<{ target: DeployTargetView }>('PUT', `/projects/${projectId}/deploy-targets/${id}`, config),
  deleteDeployTarget: (projectId: string, id: string) =>
    request<void>('DELETE', `/projects/${projectId}/deploy-targets/${id}`),
  deployToTarget: (projectId: string, id: string) =>
    request<{ deployed: { protocol: string; files: number } }>(
      'POST',
      `/projects/${projectId}/deploy-targets/${id}/deploy`,
    ),
  /**
   * Deploy a saved target while STREAMING live progress. POSTs to the SSE endpoint and parses the
   * `event:`/`data:` frames, invoking the handlers. Resolves when the stream ends. `signal` can abort.
   */
  deployTargetStream: (
    projectId: string,
    id: string,
    handlers: {
      onProgress?: (e: DeployProgressEvent) => void;
      onDone?: (deployed: StreamDoneResult) => void;
      onError?: (message: string) => void;
    },
    signal?: AbortSignal,
  ): Promise<void> =>
    streamSse<DeployProgressEvent, { deployed: StreamDoneResult }>(
      `${BASE}/projects/${projectId}/deploy-targets/${id}/deploy/stream`,
      {
        onProgress: handlers.onProgress,
        onDone: handlers.onDone ? (raw) => handlers.onDone!(raw.deployed) : undefined,
        onError: handlers.onError,
      },
      { signal },
    ),

  /**
   * Import a whole-project export ZIP as a BRAND-NEW project (staff-only), streaming progress over SSE.
   * `onDone` receives the report (new project id/slug/name + counts).
   */
  importProjectZipStream: (
    file: File,
    handlers: { onProgress?: (e: ImportProgressEvent) => void; onDone?: (report: ProjectImportReport) => void; onError?: (message: string) => void },
    signal?: AbortSignal,
  ): Promise<void> => {
    const form = new FormData();
    form.append('file', file);
    return streamSse<ImportProgressEvent, { report: ProjectImportReport }>(
      `${BASE}/projects/import/zip`,
      {
        onProgress: handlers.onProgress,
        onDone: handlers.onDone ? (raw) => handlers.onDone!(raw.report) : undefined,
        onError: handlers.onError,
      },
      { signal, init: { body: form } },
    );
  },

  /** Duplicate a project in-instance (staff-only); returns the new project. */
  duplicateProject: (projectId: string): Promise<{ project: Project }> =>
    request<{ project: Project }>('POST', `/projects/${projectId}/duplicate`),

  // --- instance admin settings (global mail / hCaptcha / enabled form modes) ---
  getInstanceSettings: () =>
    // `cookieSecretPinned` = the session-signing key is fixed via the COOKIE_SECRET env (rotation off).
    request<{ settings: InstanceSettingsPublic; cookieSecretPinned?: boolean }>('GET', '/admin/settings'),
  putInstanceSettings: (body: InstanceSettingsInput) =>
    request<{ settings: InstanceSettingsPublic }>('PUT', '/admin/settings', body),
  /** Instance-wide count of submissions still owed an email (a broken global SMTP hits every project). */
  undeliveredInstanceSubmissions: () =>
    request<{ count: number; lastError: string | null }>('GET', '/admin/submissions/undelivered'),
  /** Open a real session to the saved instance SMTP and authenticate, sending nothing. */
  testInstanceSmtp: () => request<{ ok: boolean; error?: string }>('POST', '/admin/settings/smtp/test'),
  /** Send a REAL test message through the instance SMTP. `to` is honoured for agency staff only;
   *  anyone else is served their own account address regardless of what is sent. */
  sendInstanceSmtpTest: (to?: string) =>
    request<{ ok: boolean; error?: string; to?: string }>('POST', '/admin/settings/smtp/send-test', to ? { to } : {}),
  /** Verify the platform AI provider (connectivity + model). A blank apiKey tests the stored one. */
  testInstanceAi: (body: { provider: AiProviderKind; model?: string; baseUrl?: string; apiKey?: string }) =>
    request<AiTestResult>('POST', '/admin/settings/ai/test', body),
  /** Verify a stock-image provider key with a minimal search. A blank key tests the stored one. */
  testStockKey: (body: { provider: 'unsplash' | 'pexels'; key?: string }) =>
    request<{ ok: boolean; error?: string }>('POST', '/admin/settings/stock/test', body),
  /** Rotate the session-cookie signing key — logs EVERYONE out (incl. the caller). 409 if env-pinned. */
  rotateCookieSecret: () =>
    request<{ ok: true }>('POST', '/admin/cookie-secret/rotate'),
  /** Live storage usage: the DB size (incl. WAL sidecars) + pre-migration snapshot count/size. */
  getStorage: () =>
    request<{ dbBytes: number; backups: { count: number; bytes: number } }>('GET', '/admin/storage'),
  /** Reap pre-migration DB snapshots, keeping the newest `keepLast` (≥1). Never touches the DB itself. */
  purgeBackups: (keepLast: number) =>
    request<{ removed: number; count: number; bytes: number }>('POST', '/admin/backups/purge', { keepLast }),

  /**
   * Sweep the whole database for rows that exist but cannot be reached. READ-ONLY — it never repairs.
   * Streams one `progress` frame per check (a full sweep visits every content row of every project),
   * then `done` with the report. Pass a signal so closing the modal aborts the scan.
   */
  checkDatabaseIntegrity: (
    handlers: {
      onProgress?: (p: IntegrityProgress) => void;
      onDone?: (report: DatabaseIntegrityReport) => void;
      onError?: (message: string) => void;
    },
    signal?: AbortSignal,
  ) => streamSse<IntegrityProgress, DatabaseIntegrityReport>('/admin/integrity/stream', handlers, { signal }),

  /** Apply ONE repair from an integrity report. The server re-derives the target set before acting. */
  repairIntegrity: (input: IntegrityActionInput) =>
    request<IntegrityActionResult>('POST', '/admin/integrity/repair', input),

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

  // --- per-project CAPTCHA (provider + credentials; replaced the instance-wide hCaptcha) ---
  getProjectCaptcha: (projectId: string) =>
    request<{ captcha: CaptchaPublic | null }>('GET', `/projects/${projectId}/captcha`),
  putProjectCaptcha: (projectId: string, body: CaptchaInput) =>
    request<{ captcha: CaptchaPublic }>('PUT', `/projects/${projectId}/captcha`, body),
  deleteProjectCaptcha: (projectId: string) =>
    request<void>('DELETE', `/projects/${projectId}/captcha`),
  /** Asks the provider whether the STORED secret is one it issued (a site key alone proves nothing). */
  testProjectCaptcha: (projectId: string) =>
    request<{ ok: boolean; error?: string }>('POST', `/projects/${projectId}/captcha/test`),

  // --- per-project SMTP (for the userSmtp form mode) ---
  getProjectSmtp: (projectId: string) =>
    request<{ smtp: SmtpPublic | null }>('GET', `/projects/${projectId}/smtp`),
  putProjectSmtp: (projectId: string, body: SmtpInput) =>
    request<{ smtp: SmtpPublic }>('PUT', `/projects/${projectId}/smtp`, body),
  deleteProjectSmtp: (projectId: string) =>
    request<void>('DELETE', `/projects/${projectId}/smtp`),
  /** Opens a real session to the saved SMTP and authenticates, sending nothing. */
  testProjectSmtp: (projectId: string) =>
    request<{ ok: boolean; error?: string }>('POST', `/projects/${projectId}/smtp/test`),
  /** Send a REAL test message through the project SMTP. See sendInstanceSmtpTest for who may pick `to`. */
  sendProjectSmtpTest: (projectId: string, to?: string) =>
    request<{ ok: boolean; error?: string; to?: string }>('POST', `/projects/${projectId}/smtp/send-test`, to ? { to } : {}),

  // --- per-project AI assistant config ("bring your own agent") ---
  getAiConfig: (projectId: string) =>
    request<{ aiConfig: AiConfigView | null }>('GET', `/projects/${projectId}/ai-config`),
  putAiConfig: (projectId: string, body: AiConfigInput) =>
    request<{ aiConfig: AiConfigView }>('PUT', `/projects/${projectId}/ai-config`, body),
  deleteAiConfig: (projectId: string) =>
    request<void>('DELETE', `/projects/${projectId}/ai-config`),
  /** Verify this project's BYO AI provider (connectivity + model). A blank apiKey tests the stored one. */
  testAiConfig: (projectId: string, body: { provider: AiProviderKind; model?: string; baseUrl?: string; apiKey?: string }) =>
    request<AiTestResult>('POST', `/projects/${projectId}/ai-config/test`, body),

  // --- on-page AI assistant (chat + consent grant + availability) ---
  /** Whether the assistant is available for this project (configured + the user can write). */
  agentStatus: (projectId: string) =>
    request<{ enabled: boolean }>('GET', `/projects/${projectId}/agent/status`),
  /** The user's consent grant (capabilities + autonomy); `configured:false` → show the consent panel. */
  getAgentGrant: (projectId: string) =>
    request<AgentGrantView>('GET', `/projects/${projectId}/agent/grant`),
  putAgentGrant: (projectId: string, body: { capabilities: ApiKeyCapability[]; autonomy: 'full' | 'ask' }) =>
    request<AgentGrantView>('PUT', `/projects/${projectId}/agent/grant`, body),
  /** Stream one chat turn; the server drives the agent + edits the DRAFT (the preview auto-reloads). */
  streamAgentMessage: (
    projectId: string,
    body: {
      conversationId?: string;
      message: string;
      attachments?: AgentAttachment[];
      context?: { pageId?: string; path?: string; selection?: string };
    },
    handlers: AgentChatHandlers,
    signal?: AbortSignal,
  ) => streamAgentChat(`${BASE}/projects/${projectId}/agent/messages`, body, handlers, signal),

  // --- form submissions (inbox) ---
  /** `forms` carries each form's display name + its field labels, so the inbox can show what the
   *  author called a field instead of the input `name` the submission is keyed by. */
  listSubmissions: (projectId: string, formId?: string) =>
    request<{ items: FormSubmission[]; total: number; forms?: Record<string, { name: string; labels: Record<string, string> }> }>(
      'GET',
      `/projects/${projectId}/submissions${formId ? `?formId=${encodeURIComponent(formId)}` : ''}`,
    ),
  /** How many submissions are still owed an email, and why the last one failed. */
  /** What the bot traps filtered, per form + reason. The inbox can only ever show what got THROUGH. */
  filteredSubmissions: (projectId: string, formId?: string) =>
    request<{ total: number; items: Array<{ formId: string; reason: string; count: number; lastAt: number }> }>(
      'GET',
      `/projects/${projectId}/submissions/filtered${formId ? `?formId=${encodeURIComponent(formId)}` : ''}`,
    ),
  undeliveredSubmissions: (projectId: string, formId?: string) =>
    request<{ count: number; lastError: string | null }>(
      'GET',
      `/projects/${projectId}/submissions/undelivered${formId ? `?formId=${encodeURIComponent(formId)}` : ''}`,
    ),
  /** Put one back in the queue after fixing SMTP — the next retry pass carries it. */
  resendSubmission: (projectId: string, id: string) =>
    request<{ queued: boolean }>('POST', `/projects/${projectId}/submissions/${id}/resend`),
  deleteSubmission: (projectId: string, id: string) =>
    request<void>('DELETE', `/projects/${projectId}/submissions/${encodeURIComponent(id)}`),
};
