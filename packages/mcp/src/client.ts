/**
 * Minimal REST client for the Sitewright API, authenticated by a project-scoped
 * bearer token (`swk_…`). The MCP bridge is just a typed client of the one
 * guarded REST surface — all authorization (role ∩ capabilities, tenant scoping,
 * tree-safety) is enforced server-side; this layer only forwards.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { ScreenshotViewportName } from '@sitewright/schema';

/**
 * Bearer-token capabilities, as the MCP bridge knows them.
 *
 * ★ A hand-maintained MIRROR of `API_KEY_CAPABILITIES` in apps/api/src/db/schema.ts, which is the
 * single source of truth. They have to be kept in step by hand because this package must not depend
 * on the API's internals — so when a capability is added there, add it here too, or the bridge will
 * refuse a scope the server happily issues.
 *
 * `payments:provider:write` authors GATEWAY DEFINITIONS. It deliberately does NOT cover a project's
 * own payment credentials, which are session-only: an agent that can mint a live key into a project
 * can redirect that project's revenue.
 */
export type Capability =
  | 'content:read'
  | 'content:write'
  | 'content:delete'
  | 'publish'
  | 'deploy'
  | 'payments:provider:write';

/**
 * Capabilities only a MEMBER token carries — they act across an account rather than inside one
 * project. A mirror of `MEMBER_TOKEN_ADMIN_CAPABILITIES` in the API's schema, kept by hand for the
 * same reason as {@link Capability}.
 */
export type AccountCapability = 'projects:create' | 'projects:rename' | 'projects:delete' | 'members:manage' | 'members:invite';

/** A deploy target as the API lists it — the fields an agent needs, never the credentials. */
export interface DeployTargetView {
  id: string;
  name: string;
  protocol: string;
}

/** A PROJECT key's scope: one project, at a fixed role. */
export interface ProjectScope {
  kind?: 'project';
  projectId: string;
  role: 'owner' | 'admin' | 'member';
  capabilities: Capability[];
  /** Effective agent (MCP) instructions — the admin override or the built-in default; resolved by the API. */
  agentInstructions?: string;
}

/**
 * A MEMBER token's scope. It names no project and no role: the token reaches every project its owner
 * can, at whatever role they hold there, so each call has to say which project it means.
 */
export interface MemberScope {
  kind: 'member';
  capabilities: Array<Capability | AccountCapability>;
  agentInstructions?: string;
}

export type Scope = ProjectScope | MemberScope;

export function isMemberScope(scope: Scope): scope is MemberScope {
  return scope.kind === 'member';
}

/**
 * What a project id may look like (the platform's `IdSchema` alphabet).
 *
 * ★ Checked here, not left to `encodeURIComponent`: that leaves `.` alone, and a URL parser RESOLVES
 * `/projects/../content/page` to `/content/page`. So a project of `..` would send the member's bearer
 * to a path outside `/projects/<id>/` altogether — harmless only for as long as nothing happens to be
 * routed there. An id that cannot contain a dot cannot climb.
 */
const PROJECT_ID = /^[A-Za-z0-9_-]{1,128}$/;

function assertProjectId(projectId: string): void {
  if (!PROJECT_ID.test(projectId)) {
    throw new SitewrightApiError(400, 'not a project id — pass an `id` exactly as list_projects returned it');
  }
}

/** One project a member token's owner can reach (from `GET /projects`). */
export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  role: 'owner' | 'member';
}

/** `?dataset=<slug>` suffix for entry-scoped routes (an entry id is only unique within its dataset); ''
 *  when no dataset is supplied (every non-entry kind is project-global and ignores it). */
/**
 * The version-store key for a content path, or null when the path is not a single content entity.
 *
 * ANCHORED so sub-resources (`…/revisions/<id>/restore`) never collide with the entity itself, and
 * scoped by an ENTRY's dataset because an entry id is only unique within its dataset — `products/row_1`
 * and `team/row_1` are different rows. The dataset arrives as `?dataset=` on a read and in the BODY on
 * a write, exactly as the server keys it.
 */
function contentKeyOf(path: string, body?: unknown): string | null {
  const m = /^\/projects\/([^/?]+)\/content\/([^/?]+)\/([^/?]+)(?:\?|$)/.exec(path);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  let scope = '';
  if (m[2] === 'entry') {
    const q = /[?&]dataset=([^&]*)/.exec(path);
    scope =
      q?.[1] !== undefined
        ? decodeURIComponent(q[1])
        : String((body as { dataset?: unknown } | null | undefined)?.dataset ?? '');
  }
  return `${m[1]}:${m[2]}:${scope}:${decodeURIComponent(m[3])}`;
}

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
    /** A JSON payload, or raw BYTES — an inline media upload PUTs the decoded file itself. */
    body?: string | Uint8Array;
    /**
     * Aborts the request — closing it is how the server learns the caller gave up, and the long-running
     * routes (the page-speed audit) stop their work and free their render slot on that close.
     */
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; statusText: string; text(): Promise<string> }>;

/** One rendered viewport image (base64) from a preview screenshot request. */
export interface PreviewShot {
  base64: string;
  mimeType: string;
  width: number;
  height: number;
}
/**
 * Why a requested screenshot is missing. The server distinguishes a TRANSIENT refusal (the memory
 * ledger declined the browser's reservation) from a permanent failure, and says which — so a caller
 * can retry the one and stop retrying the other.
 */
export interface ScreenshotUnavailable {
  /** `memory` / `busy` (every render slot in use) are transient; `failed` is not. */
  reason: 'memory' | 'busy' | 'failed';
  retryable: boolean;
  message: string;
}

/**
 * One SEGMENTED preview image: part of the page (or of one element), at a readable scale, with where on
 * the page it came from. Several `segments` in one image are columns, left to right.
 */
export interface PreviewCapture {
  viewport: ScreenshotViewportName;
  kind: 'page' | 'element';
  base64: string;
  mimeType: string;
  /** Image px. */
  width: number;
  height: number;
  /** Image px per CSS px. */
  scale: number;
  /** 1-based segment index and its CSS px range on the page. */
  segments: Array<{ index: number; top: number; bottom: number }>;
  segmentCount: number;
  /** CSS px of the page (or element) paged through, up to the capture limit. */
  totalHeight: number;
  /** The page runs past the capture limit. */
  truncated?: boolean;
  selector?: string;
  matches?: number;
}

/** Why a viewport has no (or fewer) images — a selector that matched nothing, a segment past the end. */
export interface PreviewCaptureNote {
  viewport: ScreenshotViewportName;
  message: string;
}

/** The /preview response: the rendered HTML + (when requested) the screenshots. */
export interface PreviewResult {
  html: string;
  token: string;
  slug?: string;
  /** LEGACY: one whole-page image per viewport — the answer to a request without `segment`. */
  screenshots?: Partial<Record<ScreenshotViewportName, PreviewShot>>;
  /** SEGMENTED: the answer to a request with `segment` (an older server ignores it and sends `screenshots`). */
  captures?: PreviewCapture[];
  captureNotes?: PreviewCaptureNote[];
  /** Present INSTEAD of the images when the capture was refused or failed. */
  screenshotsUnavailable?: ScreenshotUnavailable;
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
export interface AuditCheck { leg: 'structure' | 'behaviour' | 'visual'; id: string; label: string; pass: boolean; detail: string; advisory?: boolean; na?: boolean }
/** The comprehensive clone-acceptance gate (GET /projects/:id/clone-audit/:pageId). */
export interface CloneAuditResult {
  sourceUrl: string;
  route: string;
  pass: boolean;
  /** GATING (non-advisory) checks that passed. */
  passed: number;
  /** Total GATING (non-advisory) checks — advisory checks are in `checks` but NOT counted here. */
  total: number;
  /** Gating checks that were N/A: nothing on the page for them to test (no slider, no modal trigger, no
   *  nav). Excluded from `passed`/`total` so the score reports what was actually verified. */
  na?: number;
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

/** Options for {@link SitewrightClient.importWebsite}; every one is server-defaulted when omitted. */
export interface ImportWebsiteOptions {
  foundation?: boolean;
  inferDatasets?: boolean;
  renderMode?: 'auto' | 'always';
  /** Block until the import finishes instead of returning a job id. Usually a bad idea — a real crawl
   *  outlives a tool call, which is the whole reason the async path exists. */
  wait?: boolean;
  maxPages?: number;
  maxDepth?: number;
}

/** An async import job's state (GET /projects/:id/agent/import-website/:jobId). */
export interface ImportJobView {
  id: string;
  url: string;
  status: 'running' | 'done' | 'failed';
  startedAt: number;
  finishedAt?: number;
  progress: string[];
  /** progress.length at the time of the reply — feed back as `since` to resume a long-poll. */
  progressCount?: number;
  report?: Record<string, unknown>;
  error?: string;
}

/** Outcome of a BULK media move. `moved` + `failed` together account for every requested id. */
export interface BulkMoveResult {
  moved: string[];
  failed: Array<{ id: string; error: string }>;
  requested: number;
  folder: string;
}

/** What `measure_header` reports: per width, the bar vs the token, plus the fixing CSS (null = nothing to fix). */
export interface HeaderMeasureResult {
  page: string;
  route: string;
  widths: number[];
  rows: Array<{
    width: number;
    position: string | null;
    bar: number | null;
    token: number | null;
    spacerPad: number | null;
    verdict: 'ok' | 'too-small' | 'too-large' | 'not-fixed' | 'unmeasured';
    delta: number | null;
  }>;
  css: string | null;
  advice: string[];
}

/** Outcome of a BULK alt-text write. `updated` + `failed` account for every distinct requested id. */
export interface BulkAltResult {
  updated: string[];
  failed: Array<{ id: string; error: string }>;
  requested: number;
}

/** A font's metadata as an upload or a correction states it (each optional). */
export interface FontMetadata {
  family?: string;
  weight?: number;
  style?: 'normal' | 'italic';
  fallback?: 'serif' | 'sans-serif' | 'monospace' | 'cursive';
}

/** What an upload ticket can pin besides its folder: alt text and — if the file is a font — its metadata. */
export interface UploadDescription extends FontMetadata {
  alt?: string;
}

/** A batch mint: how many tickets, and (instead of one `alt`) one alt per ticket. */
export interface UploadTicketOptions extends UploadDescription {
  count?: number;
  alts?: string[];
}

/**
 * What minting returns: ONE `uploadUrl` for a single ticket (the default — the shape every caller
 * already reads), or `tickets` for a batch, each with the alt it will stamp on its file. A batch has
 * no top-level url on purpose, so there is no "the" ticket to send every file to.
 */
export type UploadTicketGrant =
  | { uploadUrl: string; alt?: string; expiresInSeconds: number; maxBytes: number }
  | { tickets: Array<{ uploadUrl: string; alt?: string }>; expiresInSeconds: number; maxBytes: number };

/** A PATCH to one media asset: move, rename, describe, or correct a font's metadata. */
export interface MediaUpdate extends FontMetadata {
  folder?: string;
  filename?: string;
  alt?: string;
  /** Which stored face `weight`/`style` describe, when a font holds several. */
  face?: string;
}

/** What a `criticalCss` partial write reports back. */
export interface CriticalCssReceipt {
  block: string | null;
  bytes: number;
  bytesBefore: number;
  blocks: string[];
  changed: boolean;
}

/** One find-and-replace edit of a text field (see {@link SitewrightClient.patchText}). */
export interface TextEdit {
  old: string;
  new: string;
  all?: boolean;
}

/** What a text-field patch reports back — never the text itself. */
export interface TextPatchReceipt {
  kind: string;
  id: string;
  field: string;
  edits: number;
  replacements: number;
  bytes: number;
  bytesBefore: number;
  changed: boolean;
  version: string;
}

/** The short confirmation a write returns with `receipt` (instead of echoing the stored entity). */
export interface WriteReceipt {
  kind: string;
  id: string;
  bytes: number;
  created: boolean;
  /** Top-level keys that actually differ from before the write. EMPTY means the write changed nothing. */
  changed: string[];
}

/**
 * Outcome of a BULK delete (POST /projects/:id/content/:kind/bulk-delete, or …/media/bulk-delete).
 * Partial success is normal: `deleted` + `failed` together account for every requested id (after
 * de-duplication).
 */
export interface BulkDeleteResult {
  deleted: string[];
  failed: Array<{ id: string; error: string }>;
  /** How many DISTINCT ids were attempted. */
  requested: number;
}

/** One measured element from `inspect_source`. */
export interface InspectNode {
  tag: string;
  id?: string;
  classes?: string;
  rect: { x: number; y: number; width: number; height: number; pageY: number };
  styles: Record<string, string>;
  text?: string;
  html?: string;
  pseudo?: { before?: Record<string, string>; after?: Record<string, string> };
}
/** Measured styles/rects/markup for a rendered page (POST /projects/:id/inspect-source/:pageId). */
export interface InspectSourceResult {
  /** Which page was measured — the LIVE original or the agent's own build. */
  side: 'source' | 'build';
  /** The URL actually rendered. */
  url: string;
  sourceUrl: string;
  route: string;
  title: string;
  /** Every number below is only true AT this viewport. */
  viewport: { width: number; height: number };
  documentHeight: number;
  /** `count: -1` marks a selector the browser rejected as invalid syntax. */
  results: Array<{ selector: string; count: number; nodes: InspectNode[] }>;
}

/** Lighthouse category scores, 0–100 (null when a category could not be scored). */
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
  /** Estimated page-load time saved by fixing this (opportunity audits), in ms. */
  overallSavingsMs?: number;
  /** Estimated transfer saved by fixing this (opportunity audits), in bytes. */
  overallSavingsBytes?: number;
  /** The specific resources/elements this finding points at — worst-first, capped. */
  items?: PagespeedResourceItem[];
  /** How many further items exist beyond the capped `items`. */
  moreItems?: number;
}
/** One long (≥ 50 ms) main-thread task. */
export interface PagespeedLongTask {
  /** The script/page it is attributed to (origin-relative for the site's own files). */
  url?: string;
  /** Lighthouse's attribution when there is no URL ("Unattributable", "Browser GC"). */
  label?: string;
  durationMs: number;
  startMs?: number;
}
/** One element whose animation runs on the main thread instead of the compositor. */
export interface PagespeedAnimationIssue {
  label?: string;
  /** CSS animation names involved. */
  animations?: string[];
  /** The animated properties the compositor refused. */
  properties?: string[];
  reasons: string[];
}
/** Main-thread attribution — present only when blocking time or the performance score is poor. */
export interface PagespeedMainThread {
  longTasks: PagespeedLongTask[];
  moreLongTasks?: number;
  nonCompositedAnimations: PagespeedAnimationIssue[];
  moreNonCompositedAnimations?: number;
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
/** One image served larger than it can possibly need. */
export interface ImageSizingFinding {
  /** The published asset filename, e.g. `hero-xl.webp`. */
  file: string;
  /** How the page refers to it — a CSS background, or an `<img>` carrying no srcset. */
  via: 'background' | 'img';
  /** The delivery rung its filename resolves to. */
  size: string;
  /** That rung's width in px — a CEILING; the server never upscales, so a small source clamps below it. */
  rungWidth: number;
  /** What the visitor actually downloads, when the audit could read it from the build. */
  bytes?: number;
  /** How many times the page refers to it. */
  count: number;
  /** What to do about it. */
  recommendation: string;
}
/** The page's oversized-image report. */
export interface ImageSizingReport {
  findings: ImageSizingFinding[];
  /** How many image references were examined. */
  scanned: number;
  /** How many were already fine — a smaller rung, or an `<img>` with a srcset. */
  ok: number;
  /** Findings beyond the render cap. */
  truncated?: number;
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
  /** WHY the main thread was busy (long tasks, non-composited animations) — only when TBT/performance is poor. */
  mainThread?: PagespeedMainThread;
  /** Lighthouse environment notices (e.g. a slow-CPU warning) — explain a host-constrained lab score. */
  runWarnings?: string[];
  /** Chrome's CPU benchmark for the audit host; a low value means the container CPU throttled the run. */
  benchmarkIndex?: number;
  /** The page's heading (h1–h6) outline with recommendations — absent when the HTML could not be read. */
  outline?: HeadingOutline;
  /**
   * Images served at the largest rung through a path that cannot adapt — absent when there are none.
   * This covers what Lighthouse does not: its image audits read element boxes, so a CSS background is
   * invisible to them however oversized it is.
   */
  imageSizing?: ImageSizingReport;
  lighthouseVersion: string;
  fetchedAt: string;
}

/**
 * The both-devices answer of the audit route: each device that was audited, and — for one that could not
 * be (a crashed tab, no memory for its browser, a timeout) — why, so the other result is not thrown away.
 */
export interface PagespeedAuditPair {
  mobile?: PagespeedAuditResult;
  desktop?: PagespeedAuditResult;
  errors?: Partial<Record<'mobile' | 'desktop', { code: string; error: string; retryable: boolean }>>;
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

/**
 * The most a file may be when its bytes come INLINE through a tool argument.
 *
 * The limit is the CONVERSATION, not the server: the model has to emit this base64 itself, and base64
 * is ~1.37x the file plus roughly a token per 4 characters — so 256 KB already costs ~95k tokens. Past
 * that the honest answer is not a bigger cap, it is `create_media_upload`, where the bytes never enter
 * the conversation at all.
 */
export const MCP_INLINE_UPLOAD_MAX_BYTES = 256 * 1024;

/** The longest base64 STRING that can decode within the cap — checked before decoding, so a huge
 *  argument is rejected without first materialising it as a buffer. */
export const MCP_INLINE_UPLOAD_MAX_B64_CHARS = Math.ceil(MCP_INLINE_UPLOAD_MAX_BYTES / 3) * 4;

/**
 * Decode base64 STRICTLY — `Buffer.from(s, 'base64')` silently ignores anything that is not a base64
 * character, so a truncated or corrupted payload decodes to plausible-looking garbage and is stored as
 * a broken file. Better to refuse than to write rubbish into the media library under a real filename.
 *
 * Tolerates two things an agent genuinely produces: surrounding whitespace/newlines (base64 is often
 * wrapped), and a `data:<type>;base64,` prefix copied along with the payload.
 */
function decodeBase64(input: string): Buffer {
  const withoutPrefix = input.replace(/^\s*data:[^;,]*;base64,/i, '');
  const compact = withoutPrefix.replace(/\s+/g, '');
  if (compact === '' || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new SitewrightApiError(400, 'content_base64 is not valid base64');
  }
  return Buffer.from(compact, 'base64');
}

export class SitewrightClient {
  private scope: Scope | undefined;
  private readonly baseUrl: string;

  /**
   * The origin a CALLER reaches this instance at — what makes the instance's own root-relative
   * addresses (a draft `previewUrl`, an upload ticket) usable outside it. The stdio bridge already has
   * it (its `baseUrl`); the hosted endpoint talks to the API in-process with an empty base, so it sets
   * this from the incoming request. Empty = unknown (addresses stay relative).
   */
  publicOrigin = '';
  private readonly tokenProvider: () => Promise<string | null>;
  private readonly fetchImpl: FetchLike;
  private readonly onUnauthorized?: () => Promise<string | null>;
  /** In-flight refresh, so concurrent 401s share ONE refresh (no double rotation). */
  private refreshPromise: Promise<string | null> | null = null;
  /**
   * The last version this client saw per content entity — the optimistic-concurrency token sent back
   * as `If-Match`. Per client instance, so one agent's session cannot arm another's writes.
   */
  private readonly contentVersions = new Map<string, string>();
  /**
   * The project the CURRENT call is addressing, for a member token (see {@link withProject}). Async
   * local, not a field: one connection can run several tool calls at once, each against a different
   * project, and a shared field would let them overwrite one another mid-request.
   */
  private readonly activeProject = new AsyncLocalStorage<string>();

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
    this.publicOrigin = this.baseUrl;
    this.tokenProvider = tokenProvider;
    this.fetchImpl = fetchImpl;
    this.onUnauthorized = onUnauthorized;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    freshToken?: string,
    signal?: AbortSignal,
  ): Promise<T> {
    // On the post-401 retry we use the refreshed token directly (freshToken); otherwise ask the
    // provider for the current one.
    const token = freshToken ?? (await this.tokenProvider());
    if (!token) {
      throw new SitewrightApiError(401, 'not authenticated — use the login tool to connect this agent to a project');
    }
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    // OPTIMISTIC CONCURRENCY. An agent's write is a FULL REPLACE, so writing from a copy read before
    // a human touched the entity silently reverts their edit. Every content read hands back a
    // `version`; we remember it and send it as `If-Match`, and the server refuses the write (409)
    // rather than losing the other change. Skips `?merge=1`, which is deep-merged onto whatever is
    // current server-side and so is already safe to apply to a newer base.
    const key = contentKeyOf(path, body);
    const guarded = key !== null && method === 'PUT' && !/[?&]merge=(1|true)\b/.test(path);
    if (guarded) {
      const known = this.contentVersions.get(key);
      if (known) headers['if-match'] = known;
    }
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...(signal ? { signal } : {}),
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
        return this.request<T>(method, path, body, fresh, signal);
      }
    }
    if (res.status === 204) {
      if (key !== null && method === 'DELETE') this.contentVersions.delete(key);
      return undefined as T;
    }
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
      // A LOST-UPDATE refusal. The remembered version is deliberately KEPT: a blind retry must fail
      // the same way rather than fall through unguarded and clobber the other write. Re-reading is
      // what clears it, so the message names the tool that does that.
      const conflict =
        res.status === 409 &&
        parsed !== null &&
        typeof parsed === 'object' &&
        'code' in parsed &&
        parsed.code === 'version_conflict';
      const hint = conflict
        ? ' — call get_content (or get_page) to read the current entity, re-apply your change on top of it, then write again. Retrying this exact body will be refused again.'
        : '';
      throw new SitewrightApiError(res.status, base + formatZodDetails(parsed) + hint);
    }
    // Both reads and writes report the entity's CURRENT version, so a write re-arms the guard for the
    // next one without an extra read.
    if (key !== null && parsed !== null && typeof parsed === 'object' && 'version' in parsed && typeof parsed.version === 'string') {
      this.contentVersions.set(key, parsed.version);
    }
    return parsed as T;
  }

  private requireScope(): Scope {
    if (!this.scope) throw new Error('client not introspected — call introspect() first');
    return this.scope;
  }

  private projectPath(suffix: string): string {
    return `/projects/${encodeURIComponent(this.currentProjectId())}${suffix}`;
  }

  /** The project this call is for. */
  private currentProjectId(): string {
    const scope = this.requireScope();
    // A project key IS its project — nothing a caller passes can point it elsewhere. Only a member
    // token takes the project from the call.
    const projectId = isMemberScope(scope) ? this.activeProject.getStore() : scope.projectId;
    if (!projectId) {
      throw new SitewrightApiError(
        400,
        'this connection uses a member token, which reaches several projects — pass `project` (an id from list_projects) to say which one',
      );
    }
    return projectId;
  }

  /**
   * Runs `fn` with every project-scoped request addressed to `projectId`. Only meaningful for a member
   * token — a project key ignores it (see {@link projectPath}). The server still decides whether the
   * token's owner can reach that project; this only says which one is meant.
   */
  async withProject<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    assertProjectId(projectId);
    return this.activeProject.run(projectId, fn);
  }

  /** The projects this token's owner can reach. For a member token; needs `content:read`. */
  async listProjects(): Promise<ProjectSummary[]> {
    return (await this.request<{ projects: ProjectSummary[] }>('GET', '/projects')).projects;
  }

  /** Creates a project owned by the token's owner. Member token with `projects:create`. */
  async createProject(input: { name: string; slug: string }): Promise<ProjectSummary> {
    return (await this.request<{ project: ProjectSummary }>('POST', '/projects', input)).project;
  }

  /** Copies a whole project into a new one. Member token with `projects:create` + `content:read`. */
  async duplicateProject(projectId: string): Promise<ProjectSummary> {
    assertProjectId(projectId);
    return (await this.request<{ project: ProjectSummary }>('POST', `/projects/${encodeURIComponent(projectId)}/duplicate`)).project;
  }

  /** A project's members and its pending invites. Member token with `members:manage`. */
  async listMembers(): Promise<{ members: unknown[]; invites: unknown[] }> {
    const [members, invites] = await Promise.all([
      this.request<{ members: unknown[] }>('GET', this.projectPath('/members')),
      this.request<{ invites: unknown[] }>('GET', this.projectPath('/invites')),
    ]);
    return { members: members.members, invites: invites.invites };
  }

  /** Invites an address to the project as a member. Member token with `members:invite`. */
  async inviteMember(email: string): Promise<unknown> {
    return this.request('POST', this.projectPath('/invites'), { email });
  }

  /**
   * Approves a pending invite without its link, making the invitee a member now. Member token with
   * `members:invite`. For an address with no account the response carries a temporary password
   * (and `passwordExpiresAt`): its owner replaces it at first sign-in.
   */
  async approveInvite(inviteId: string): Promise<unknown> {
    // Same alphabet as a project id, for the same reason: a `..` must never reach the path.
    if (!PROJECT_ID.test(inviteId)) {
      throw new SitewrightApiError(400, 'not an invite id — pass an `id` exactly as invite_member or list_members returned it');
    }
    return this.request('POST', this.projectPath(`/invites/${encodeURIComponent(inviteId)}/approve`));
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

  /**
   * List a kind. `summary` drops the heavy body fields (a page's `source` + `data`, a template/snippet
   * `source`, an entry's `values`) and describes them under `_summary` instead — a full page list carries
   * every page's Handlebars source, which on a real imported site exceeds the tool-output ceiling.
   */
  async listContent(
    kind: string,
    dataset?: string,
    opts: { summary?: boolean; q?: string; limit?: number; offset?: number } = {},
  ): Promise<unknown[]> {
    const params = new URLSearchParams();
    if (dataset) params.set('dataset', dataset);
    if (opts.summary) params.set('summary', '1');
    // `q` SEARCHES (case-insensitive substring over the id, title, path, description and an entry's
    // values); `limit`/`offset` page. All three compose, so a large project is reachable without ever
    // materialising the whole kind.
    if (opts.q) params.set('q', opts.q);
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.offset !== undefined) params.set('offset', String(opts.offset));
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    const res = await this.request<{ items: unknown[] }>('GET', this.projectPath(`/content/${encodeURIComponent(kind)}${suffix}`));
    return res.items;
  }

  async getContent(kind: string, entityId: string, dataset?: string): Promise<unknown> {
    const res = await this.request<{ item: unknown }>(
      'GET',
      this.projectPath(`/content/${encodeURIComponent(kind)}/${encodeURIComponent(entityId)}${datasetQuery(dataset)}`),
    );
    return res.item;
  }

  /**
   * One entry of the instance-wide GLOBAL snippet/template library (nav-header, form-custom, …), read
   * through the project this call addresses — the project-scoped route is what lets a project key and a
   * member token reach it at all. `global:<id>` (how a page names a global template) is accepted too.
   */
  async getGlobalContent(kind: 'snippet' | 'template', entityId: string): Promise<unknown> {
    const res = await this.request<{ item: unknown }>('GET', this.projectPath(`/global/${kind}/${encodeURIComponent(entityId)}`));
    return res.item;
  }

  /** PARTIAL write of `website.criticalCss`. A NAMED block upserts (replace in place, else append);
   *  an unnamed write appends; an empty body with a name removes that block. Returns a receipt, never
   *  the sheet — echoing it back is the cost this exists to avoid. */
  async patchCriticalCss(css: string, block?: string): Promise<CriticalCssReceipt> {
    return this.request('POST', this.projectPath('/critical-css'), { css, ...(block ? { block } : {}) });
  }

  /** FIND-AND-REPLACE inside one text field of an entity (a page `source`, a chrome slot, the
   *  stylesheet). Each edit's `old` must match exactly once (or every time with `all`); all-or-nothing.
   *  Sends no `If-Match`: the edits are anchored on text, so the server re-applies them over a
   *  concurrent write instead of refusing. Returns a receipt, never the text.
   *
   *  The remembered version for the entity is deliberately NOT re-armed from the receipt: a later full
   *  put built from the pre-patch read would silently revert this patch, so its 409 ("re-read first")
   *  is the right answer. */
  async patchText(kind: string, entityId: string, field: string, edits: TextEdit[]): Promise<TextPatchReceipt> {
    return this.request(
      'POST',
      this.projectPath(`/content/${encodeURIComponent(kind)}/${encodeURIComponent(entityId)}/text-patch`),
      { field, edits },
    );
  }

  async putContent(kind: string, entityId: string, data: unknown, opts: { merge?: boolean; receipt?: boolean } = {}): Promise<unknown> {
    // `merge` PATCHES: the body is a fragment deep-merged into the existing entity (settings + page) so a
    // partial write can't revert the fields it omits. Default (no flag) still REPLACES the whole entity.
    //
    // `receipt` asks for a SHORT confirmation ({kind,id,bytes,created,changed}) instead of the stored
    // entity. Agent tools default it ON: echoing settings back cost ~9 KB per write for no benefit — an
    // agent that wants the entity has get_content, and `changed` says more than the echo did (an empty
    // list means the patch was a no-op). The response shape differs, so the caller decides.
    const query = [opts.merge ? 'merge=1' : '', opts.receipt ? 'receipt=1' : ''].filter(Boolean).join('&');
    const res = await this.request<{ item: unknown } | WriteReceipt>(
      'PUT',
      this.projectPath(`/content/${encodeURIComponent(kind)}/${encodeURIComponent(entityId)}${query ? `?${query}` : ''}`),
      data,
    );
    return opts.receipt ? res : (res as { item: unknown }).item;
  }

  async deleteContent(kind: string, entityId: string, dataset?: string): Promise<void> {
    await this.request<void>(
      'DELETE',
      this.projectPath(`/content/${encodeURIComponent(kind)}/${encodeURIComponent(entityId)}${datasetQuery(dataset)}`),
    );
  }

  /**
   * Delete MANY entities of one kind in a single call. Each id is attempted independently, so the
   * result reports what went and what didn't rather than aborting the batch on the first bad id.
   */
  async deleteContentBulk(kind: string, ids: readonly string[], dataset?: string): Promise<BulkDeleteResult> {
    return this.request<BulkDeleteResult>('POST', this.projectPath(`/content/${encodeURIComponent(kind)}/bulk-delete`), {
      ids,
      ...(dataset === undefined ? {} : { dataset }),
    });
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

  /**
   * Render a page (and, with `screenshot`, capture it). `segment` asks for the SEGMENTED captures from
   * that segment on; `selector` captures only the first element it matches. Without either the server
   * answers with the legacy one-image-per-viewport `screenshots`.
   */
  async preview(
    page: unknown,
    opts?: { screenshot?: boolean; viewports?: string; segment?: number; selector?: string },
  ): Promise<PreviewResult> {
    let path = this.projectPath('/preview');
    if (opts?.screenshot) {
      // encodeURIComponent, not URLSearchParams: that writes a space as `+`, and a selector is full of them.
      const qs = ['screenshot=1'];
      if (opts.viewports) qs.push(`viewports=${encodeURIComponent(opts.viewports)}`);
      if (opts.segment !== undefined) qs.push(`segment=${encodeURIComponent(String(opts.segment))}`);
      if (opts.selector !== undefined) qs.push(`shotSelector=${encodeURIComponent(opts.selector)}`);
      path += `?${qs.join('&')}`;
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

  /** The fixed header's real height at each Tailwind breakpoint vs `--sw-header-h`, with the exact fixing CSS. */
  async measureHeader(pageId: string): Promise<HeaderMeasureResult> {
    return this.request('GET', this.projectPath(`/header-measure/${encodeURIComponent(pageId)}`));
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

  /**
   * MEASURE a rendered page: settled markup + real computed styles + real rects for the given selectors.
   * `side` picks the LIVE original (default) or the agent's own build, so the same call shape answers
   * "what is the original" and "did my clone match it".
   */
  async inspectSource(
    pageId: string,
    body: { selectors: string[]; styles?: string[]; html?: boolean; viewport?: string | number; side?: 'source' | 'build' },
  ): Promise<InspectSourceResult> {
    return this.request('POST', this.projectPath(`/inspect-source/${encodeURIComponent(pageId)}`), body);
  }

  /**
   * Lighthouse page-speed + SEO audit of a page (deploy-equivalent build). This mirrors the ROUTE:
   * omit `formFactor` for BOTH devices from one build+serve (returned keyed by device). The MCP tool
   * applies its own mobile default before calling this.
   *
   * `signal` aborts the request — and the server, seeing the request close, kills the audit's Chrome
   * and frees its render slot. Pass it whenever the caller can give up (a host cancelling a tool call).
   */
  async pagespeedAudit(
    pageId: string,
    formFactor?: 'mobile' | 'desktop',
    opts: { signal?: AbortSignal } = {},
  ): Promise<unknown> {
    const suffix = formFactor ? `?formFactor=${formFactor}` : '';
    return this.request(
      'GET',
      this.projectPath(`/pagespeed-audit/${encodeURIComponent(pageId)}${suffix}`),
      undefined,
      undefined,
      opts.signal,
    );
  }

  /** Build the site into Local Hosting — for a project with a Local Hosting target, that IS its deploy. */
  async publish(): Promise<unknown> {
    return this.request('POST', this.projectPath('/publish'));
  }

  /** The project's deploy targets, never their credentials. Needs `deploy` (they carry host metadata). */
  async listDeployTargets(): Promise<{ items: DeployTargetView[] }> {
    return this.request('GET', this.projectPath('/deploy-targets'));
  }

  /** Build the site fresh and upload it to one REMOTE target (FTP/SFTP/git). Needs `deploy`. */
  async deployTarget(id: string): Promise<unknown> {
    return this.request('POST', this.projectPath(`/deploy-targets/${encodeURIComponent(id)}/deploy`));
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

  async listPreviewShares(): Promise<unknown> {
    return this.request('GET', this.projectPath('/preview-shares'));
  }

  async createPreviewShare(label: string, expiryDays?: number): Promise<unknown> {
    return this.request('POST', this.projectPath('/preview-shares'), {
      label,
      ...(expiryDays !== undefined ? { expiryDays } : {}),
    });
  }

  async revokePreviewShare(shareId: string): Promise<unknown> {
    return this.request('DELETE', this.projectPath(`/preview-shares/${encodeURIComponent(shareId)}`));
  }

  /** The built-in statistics for a range of UTC days (`GET /projects/:id/stats`). */
  async siteStats(q: { from: string; to: string; device?: string; country?: string }): Promise<unknown> {
    const params = new URLSearchParams({ from: q.from, to: q.to });
    if (q.device) params.set('device', q.device);
    if (q.country) params.set('country', q.country);
    return this.request('GET', this.projectPath(`/stats?${params.toString()}`));
  }

  /** The tracked keywords and their positions for a range of UTC days (`GET /projects/:id/rankings`). */
  async rankings(q: { from?: string; to?: string } = {}): Promise<unknown> {
    const params = new URLSearchParams();
    if (q.from) params.set('from', q.from);
    if (q.to) params.set('to', q.to);
    const query = params.toString();
    return this.request('GET', this.projectPath(`/rankings${query ? `?${query}` : ''}`));
  }

  /** The search engines the site has search data at (`GET /projects/:id/search-performance/available`). */
  async searchPerformanceAvailable(): Promise<{ services: Array<'google' | 'bing'> }> {
    return this.request('GET', this.projectPath('/search-performance/available')) as Promise<{ services: Array<'google' | 'bing'> }>;
  }

  /** One search engine's numbers for the site over the last `days` (`GET /projects/:id/search-performance`). */
  async searchPerformance(q: { service: 'google' | 'bing'; days: number }): Promise<unknown> {
    const params = new URLSearchParams({ service: q.service, days: String(q.days) });
    return this.request('GET', this.projectPath(`/search-performance?${params.toString()}`));
  }

  async listSubmissions(opts: { formId?: string; limit?: number; offset?: number } = {}): Promise<unknown> {
    const params = new URLSearchParams();
    if (opts.formId) params.set('formId', opts.formId);
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.offset !== undefined) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return this.request('GET', this.projectPath(`/submissions${qs ? `?${qs}` : ''}`));
  }

  // ---- the shop's orders (the editor's Orders inbox) ----

  async listOrders(opts: { status?: string; limit?: number; offset?: number } = {}): Promise<unknown> {
    const params = new URLSearchParams();
    if (opts.status) params.set('status', opts.status);
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.offset !== undefined) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return this.request('GET', this.projectPath(`/transactions${qs ? `?${qs}` : ''}`));
  }

  async getOrder(orderId: string): Promise<unknown> {
    return this.request('GET', this.projectPath(`/transactions/${encodeURIComponent(orderId)}`));
  }

  /** How many paid orders are still owed their shop notification / buyer receipt. */
  async undeliveredOrderMail(): Promise<unknown> {
    return this.request('GET', this.projectPath('/transactions-undelivered'));
  }

  async setOrderFulfilment(orderId: string, to: string, note?: string): Promise<unknown> {
    return this.request('PATCH', this.projectPath(`/transactions/${encodeURIComponent(orderId)}/fulfilment`), {
      to,
      ...(note !== undefined ? { note } : {}),
    });
  }

  async resendOrderMail(orderId: string, kind: 'notify' | 'receipt'): Promise<unknown> {
    return this.request('POST', this.projectPath(`/transactions/${encodeURIComponent(orderId)}/resend`), { kind });
  }

  // ---- bookings (the editor's Bookings tab) ----

  /** The project's bookings: upcoming (bookings, requests, times being paid for), the requests alone, or past ones. */
  async listBookings(view: 'upcoming' | 'requests' | 'past' = 'upcoming'): Promise<unknown> {
    return this.request('GET', this.projectPath(`/bookings?view=${view}`));
  }

  /** The business's answer to a booking: accept or decline a request, or cancel a booking. */
  async answerBooking(id: string, answer: 'accept' | 'decline' | 'cancel'): Promise<unknown> {
    return this.request('POST', this.projectPath(`/bookings/${encodeURIComponent(id)}/${answer}`), {});
  }

  /** What an offering has free in a window, as the site's booking widget sees it (`from`/`to` in epoch ms). */
  async bookingAvailability(offeringId: string, from: number, to: number): Promise<unknown> {
    const projectId = encodeURIComponent(this.currentProjectId());
    return this.request('GET', `/b/${projectId}/${encodeURIComponent(offeringId)}/availability?from=${from}&to=${to}`);
  }

  // ---- payment providers ----

  /** The providers this project can charge through, with how far its keys have got, and what would stop a checkout. */
  async listPaymentProviders(): Promise<unknown> {
    return this.request('GET', this.projectPath('/payment-gateways'));
  }

  /** Every gateway DEFINITION on the instance, in full. Instance-wide; needs `payments:provider:write`. */
  async listGatewayDefinitions(): Promise<unknown> {
    return this.request('GET', '/admin/payment-gateways');
  }

  async putGatewayDefinition(gatewayId: string, definition: unknown): Promise<unknown> {
    return this.request('PUT', `/admin/payment-gateways/${encodeURIComponent(gatewayId)}`, definition);
  }

  async forkGatewayDefinition(fromId: string, id: string, name?: string): Promise<unknown> {
    return this.request('POST', `/admin/payment-gateways/${encodeURIComponent(fromId)}/fork`, {
      id,
      ...(name !== undefined ? { name } : {}),
    });
  }

  async deleteGatewayDefinition(gatewayId: string): Promise<unknown> {
    return this.request('DELETE', `/admin/payment-gateways/${encodeURIComponent(gatewayId)}`);
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
  async importWebsite(url: string, opts: ImportWebsiteOptions = {}): Promise<ImportWebsiteResult> {
    return this.request('POST', this.projectPath('/agent/import-website'), { url, ...opts });
  }

  /** Poll an async import started by {@link importWebsite}. */
  /** `waitMs` LONG-POLLS: the request is held open until the job moves (a new progress line, or a
   *  terminal state) or the budget expires, so one call replaces a poll loop. `since` is the
   *  `progressCount` from the previous reply, so the wait resumes instead of returning on old lines. */
  async importStatus(jobId: string, opts: { waitMs?: number; since?: number } = {}): Promise<ImportJobView> {
    const q = new URLSearchParams();
    if (opts.waitMs) q.set('waitMs', String(opts.waitMs));
    if (opts.since) q.set('since', String(opts.since));
    const qs = q.toString();
    return this.request(
      'GET',
      this.projectPath(`/agent/import-website/${encodeURIComponent(jobId)}${qs ? `?${qs}` : ''}`),
    );
  }

  /** Import a PUBLIC url into the media library — optionally filed under `folder` and described by `alt`. */
  async importImageUrl(url: string, folder?: string, alt?: string): Promise<unknown> {
    const res = await this.request<{ item: unknown }>(
      'POST',
      this.projectPath('/media/import-url'),
      // An empty alt is not sent: the server would store the asset undescribed either way.
      { url, ...(folder ? { folder } : {}), ...(alt ? { alt } : {}) },
    );
    return res.item;
  }

  /**
   * Mint an UPLOAD TICKET and return it with an ABSOLUTE url the agent can curl.
   *
   * The absolute form is built from this client's own `baseUrl` — the address MCP is already talking
   * to, so it is reachable from wherever the agent runs by definition. Deriving it from the server's
   * configured public URL instead would be wrong exactly when it matters (a LAN instance, a tunnel, a
   * container talking to a host port).
   */
  async createMediaUpload(folder?: string, opts: UploadTicketOptions = {}): Promise<UploadTicketGrant> {
    const minted = await this.mintUploadTickets({ ...(folder ? { folder } : {}), ...opts });
    const { tickets, expiresInSeconds, maxBytes } = minted;
    // A single ticket echoes its alt exactly as a batch ticket does, so the agent sees what it will stamp.
    return tickets.length === 1 ? { ...tickets[0]!, expiresInSeconds, maxBytes } : minted;
  }

  /**
   * Mint a one-shot ticket that REPLACES an existing asset's bytes when redeemed, instead of creating
   * a new asset. Same mechanism, one more dimension pinned at mint time — the holder still chooses
   * only the bytes, and cannot re-point the ticket at another asset.
   */
  async createMediaReplace(assetId: string): Promise<{ uploadUrl: string; expiresInSeconds: number; maxBytes: number }> {
    return this.mintOneTicket({ replaceAssetId: assetId });
  }

  /** Mint exactly one ticket — the inline upload/replace paths, which send one file and no more. */
  private async mintOneTicket(body: Record<string, unknown>): Promise<{ uploadUrl: string; expiresInSeconds: number; maxBytes: number }> {
    const { tickets, expiresInSeconds, maxBytes } = await this.mintUploadTickets(body);
    return { uploadUrl: tickets[0]!.uploadUrl, expiresInSeconds, maxBytes };
  }

  private async mintUploadTickets(
    body: Record<string, unknown>,
  ): Promise<{ tickets: Array<{ uploadUrl: string; alt?: string }>; expiresInSeconds: number; maxBytes: number }> {
    const res = await this.request<{
      uploadPath?: string;
      tickets?: Array<{ uploadPath: string; alt?: string }>;
      expiresInSeconds: number;
      maxBytes: number;
    }>('POST', this.projectPath('/media/upload-ticket'), body);
    // A server that predates batches answers with `uploadPath` alone (the retired stdio bridge can
    // still be pointed at one).
    const minted = res.tickets ?? [{ uploadPath: res.uploadPath ?? '' }];
    return {
      tickets: minted.map((t) => ({ uploadUrl: `${this.baseUrl}${t.uploadPath}`, ...(t.alt ? { alt: t.alt } : {}) })),
      expiresInSeconds: res.expiresInSeconds,
      maxBytes: res.maxBytes,
    };
  }

  /**
   * Upload a SMALL local file whose bytes arrived inline as base64.
   *
   * Reuses the upload-ticket flow rather than adding an endpoint: mint a one-shot ticket, then PUT the
   * decoded bytes to it. The redeem route needs no credential (the ticket IS one), so this is a plain
   * fetch — and the whole path, including the per-kind media dispatch, is the one already proven by
   * `create_media_upload`. A second server route would have been a second thing to keep in step.
   */
  async uploadMediaBase64(filename: string, contentBase64: string, folder?: string, describe: UploadDescription = {}): Promise<unknown> {
    const bytes = this.decodeInline(contentBase64, 'upload_media', 'create_media_upload');
    const ticket = await this.mintOneTicket({ ...(folder ? { folder } : {}), ...describe });
    const sent = await this.redeemTicket(ticket.uploadUrl, filename, bytes, 'upload');
    return (sent as { item?: unknown } | undefined)?.item ?? sent;
  }

  /**
   * REPLACE a small asset's bytes inline, the counterpart to `uploadMediaBase64`. Returns the whole
   * receipt (not just `item`): the previous dimensions are the point — an agent that swaps a 3:2 hero
   * for a square one needs to see that the pages referencing it will reflow.
   */
  async replaceMediaBase64(assetId: string, filename: string, contentBase64: string): Promise<unknown> {
    const bytes = this.decodeInline(contentBase64, 'replace_media', 'create_media_replace');
    const ticket = await this.createMediaReplace(assetId);
    return this.redeemTicket(ticket.uploadUrl, filename, bytes, 'replace');
  }

  /** Decode inline base64 and hold it to the inline cap, naming the ticket tool to use instead. */
  private decodeInline(contentBase64: string, tool: string, ticketTool: string): Buffer {
    const bytes = decodeBase64(contentBase64);
    if (bytes.length === 0) throw new SitewrightApiError(400, 'content_base64 decoded to no bytes — is it valid base64?');
    if (bytes.length > MCP_INLINE_UPLOAD_MAX_BYTES) {
      throw new SitewrightApiError(
        413,
        `file is ${bytes.length} bytes; ${tool} is capped at ${MCP_INLINE_UPLOAD_MAX_BYTES}. Use ${ticketTool} for anything larger — it does not send the bytes through the conversation.`,
      );
    }
    return bytes;
  }

  /** PUT bytes to a one-shot ticket URL. The ticket IS the credential, so this is a plain fetch. */
  private async redeemTicket(uploadUrl: string, filename: string, bytes: Buffer, verb: string): Promise<unknown> {
    const res = await this.fetchImpl(`${uploadUrl}?filename=${encodeURIComponent(filename)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes,
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    if (!res.ok) {
      const message = (parsed as { error?: string } | undefined)?.error ?? `${verb} failed (${res.status})`;
      throw new SitewrightApiError(res.status, message);
    }
    return parsed;
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

  /** Re-file MANY assets in one call. Partial success is normal — the result accounts for every id. */
  async moveMediaBulk(ids: readonly string[], folder: string): Promise<BulkMoveResult> {
    return this.request('POST', this.projectPath('/media/bulk-move'), { ids, folder });
  }

  /** Move, rename, set the alt of, or (on a font) correct the metadata of ONE asset — the media PATCH. */
  async updateMedia(id: string, changes: MediaUpdate): Promise<unknown> {
    const res = await this.request<{ item: unknown }>(
      'PATCH',
      this.projectPath(`/media/${encodeURIComponent(id)}`),
      changes,
    );
    return res.item;
  }

  /** Set (or, with '', clear) the alt text of up to 200 assets in one call; `failed` names the ids that did not take. */
  async setMediaAlt(items: ReadonlyArray<{ id: string; alt: string }>): Promise<BulkAltResult> {
    return this.request<BulkAltResult>('POST', this.projectPath('/media/bulk-alt'), { items });
  }

  /**
   * Self-host a Google family's weights as a `kind:'font'` asset (the server downloads them — the only
   * Google contact — and a published page never loads Google). Re-selecting a family merges in the new
   * weights. Returns the font asset; a typography slot references it by `id`.
   */
  async selectGoogleFont(family: string, weights: readonly number[], folder?: string): Promise<unknown> {
    const res = await this.request<{ item: unknown }>('POST', this.projectPath('/fonts/select'), {
      family,
      weights,
      ...(folder ? { folder } : {}),
    });
    return res.item;
  }

  /** Rotate and/or crop an image — in place, or into a new asset when `saveAs` is given. */
  async transformMedia(
    id: string,
    body: {
      rotate?: 90 | 180 | 270;
      crop?: { left: number; top: number; width: number; height: number };
      format?: 'webp' | 'jpeg' | 'png';
      saveAs?: { filename: string; folder?: string };
    },
  ): Promise<unknown> {
    const res = await this.request<{ item: unknown }>(
      'POST',
      this.projectPath(`/media/${encodeURIComponent(id)}/transform`),
      body,
    );
    return res.item;
  }

  /** Move a media asset to the Recycle Bin (recoverable for 90 days). Needs the content:delete capability. */
  async deleteMedia(id: string): Promise<{ ok: true }> {
    await this.request('DELETE', this.projectPath(`/media/${encodeURIComponent(id)}`));
    return { ok: true };
  }

  /** Move up to 200 media assets to the Recycle Bin in one call; `failed` names the ids that did not go. */
  async deleteMediaBulk(ids: readonly string[]): Promise<BulkDeleteResult> {
    return this.request<BulkDeleteResult>('POST', this.projectPath('/media/bulk-delete'), { ids });
  }

  /** Rename a dataset's slug, cascading the change to entries + page/template sources (default on). */
  async renameDataset(id: string, slug: string, name?: string, cascade = true): Promise<unknown> {
    return this.request('POST', this.projectPath(`/datasets/${encodeURIComponent(id)}/rename`), { slug, name, cascade });
  }
}
