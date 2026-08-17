import { timingSafeEqual, createHmac, createHash, randomUUID } from 'node:crypto';
import { gzip as gzipCb } from 'node:zlib';
import { promisify } from 'node:util';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, mkdir, open, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { newId, isShortAssetId } from '../id.js';
import { readTemplateConfig, readTemplateImage } from '../imagemap-assets.js';
import { readTexture } from '../textures.js';
import { mintAssetId as mintUniqueAssetId } from '../media/mint-id.js';
import { sql } from 'drizzle-orm';
import { dbFilePath, dbSizeBytes, backupsSummary, purgeBackups, backupsDir } from '../db/backup.js';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyBaseLogger } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { parse as secureJsonParse } from 'secure-json-parse';
import { z } from 'zod';
import {
  type CaptchaProvider,
  type CaptchaRenderConfig,
  MediaFolderSchema,
  targetsPrivateHost,
  ImageAssetSchema,
  FileAssetSchema,
  VideoAssetSchema,
  VIDEO_CONTENT_TYPES,
  isVideoExt,
  StylesheetAssetSchema,
  ScriptAssetSchema,
  FontWeightSchema,
  FontFamilyNameSchema,
  FONT_WEIGHTS,
  PageSchema,
  InstanceSettingsInputSchema,
  maskInstanceSettings,
  DEFAULT_HSTS,
  frameAncestorsFor,
  type LogLevel,
  DEFAULT_NEW_PROJECT_LOCALE,
  DEFAULT_PLATFORM_NAME,
  DEFAULT_BRAND_PRIMARY,
  DEFAULT_BRAND_SECONDARY,
  passwordSchema,
  websiteEffectsClasses,
  websiteEffectsCustomCode,
  stickyHeaderUsesRuntime,
  isLinkPage,
  type StickyHeaderSetting,
  type CorporateIdentity,
  type Dataset,
  type Entry,
  type FileAsset,
  type VideoAsset,
  type StylesheetAsset,
  type ScriptAsset,
  type MediaFolderRecord,
  type Form,
  type ImageMap,
  IMAGE_MAP_TEMPLATES,
  isImageMapTemplateId,
  toPublicForm,
  type ImageAsset,
  type MediaAsset,
  type Snippet,
  type DeployTarget,
  type Page,
  type PageTranslation,
  type Template,
  COMPONENT_CATALOG,
  isScreenshotViewportName,
  DEFAULT_SCREENSHOT_VIEWPORTS,
  PREVIEW_DEFAULT_VIEWPORTS,
  siteCspHeaderFromHtml,
  DatasetSlugSchema,
  OrderSchema,
  AiConfigSchema,
  PREVIEW_SANDBOX_CSP,
  SLOT_MAX,
} from '@sitewright/schema';
import { downloadGoogleFont, FontFetchError } from '../fonts/service.js';
import { detectFontFormat, MAX_FONT_BYTES } from '../fonts/upload.js';
import { createFontAsset as storeFontAsset, mergeFontFaces } from '../fonts/asset.js';
import {
  renderDocument,
  componentTypesInSource,
  componentAssets,
  renderImageMapMarkup,
  systemI18nData,
  usesDialog,
  usesParallax,
  usesFixedBackground,
  FIXED_BG_PREVIEW_CSS,
  FIXED_BG_PREVIEW_JS,
  parallaxPreviewDoc,
  svgAnimPreviewDoc,
  svgStudioPreviewDoc,
  usesNavEffects,
  NAV_EFFECTS_JS,
  STICKY_HEADER_JS,
  usesScrollSpy,
  SCROLLSPY_JS,
  usesButtonEffects,
  BUTTON_EFFECTS_JS,
  usesThemeToggle,
  THEME_TOGGLE_CSS,
  THEME_TOGGLE_JS,
  resolveShopChannels,
  resolveFormEndpoints,
  validateTemplate,
  findUnknownHelpers,
  findSkeletonLandmark,
  TemplateError,
  mediaForRender,
  decorateNav,
  NAV_LINK_JS,
  searchIcons,
  renderIconSvg,
  PHOSPHOR_NAMES,
  PHOSPHOR_WEIGHTS,
  searchTextures,
  TEXTURE_NAMES,
  RICH_CONTENT_SAFELIST,
  ciRichClasses,
} from '@sitewright/blocks';
import { compileUtilityCss, brandToTailwindTheme } from '@sitewright/tailwind';
import {
  storeOriginal,
  generateThumbnail,
  isThumbnailable,
  isSvgFile,
  isSizeToken,
  isThumbFormat,
  sanitizeSvg,
  svgIntrinsicSize,
  MAX_SVG_BYTES,
  thumbFileName,
  THUMB_SIZES,
  DEFAULT_SIZE,
  type SizeToken,
  type ThumbFormat,
} from '@sitewright/image-pipeline';
import {
  buildNav,
  extractClassNames,
  isGlobalTemplate,
  publishedPages,
  resolveTemplateSource,
  resolveCodeRef,
  resolveLocaleDatasets,
  resolveDatasetPageRefs,
  compareEntryOrder,
  keyedDatasets,
  translationsOf,
  resolveTranslations,
  localeOf,
  pagesInLocale,
  pagePath,
  pagesById,
  pathToSlug,
  childrenView,
  parentPageView,
  pagesContext,
  referencesChildren,
  referencesParentPage,
  widgetDatasetsForSources,
  WIDGET_PARTIALS,
  GLOBAL_WIDGETS,
  nextOrderAfter,
  spacedOrders,
  GLOBAL_SNIPPET_PARTIALS,
  type ProjectBundle,
} from '@sitewright/core';
import type { Database } from '../db/client.js';
import {
  seedGlobalLibrary,
  globalSnippetPartials,
  listGlobalTemplates,
  globalTemplateMap,
  globalCtx,
  GLOBAL_SCOPE_ID,
} from '../repo/global-library.js';
import { MediaStorage } from '../media/storage.js';
import { buildProjectExportZip, collectExportMedia, ExportSizeLimitError } from '../export/build-zip.js';
import { buildExportManifest, exportBundleOverCap } from '../export/manifest.js';
import { buildThumbSkipMap } from '../export/thumb-skip.js';
import {
  readProjectZip,
  extractProjectMedia,
  DEFAULT_PROJECT_ZIP_LIMITS,
} from '../import/unpack-project-zip.js';
import { rewriteMediaSlug } from '../import/rewrite-slug.js';
import { pinnedFetchDetailed, type PinnedResult } from '../import/pinned-fetch.js';
import { UploadError } from '../import/upload.js';
import { MediaValidationError } from '../media/errors.js';
import { ancestorPaths, isUnderFolder, reparentPath, validateFolderMove } from '../media/folders.js';
import {
  PublishError,
  slotHint,
  replacePreviewPdfEmbeds,
  replacePreviewStorageEmbeds,
  type PageBuildFailure,
  type BuildProgress,
  type ReleaseManifest,
} from '../publish/build.js';
import { bodyEffectStyles, previewBodyEffectScripts } from '../publish/effect-runtimes.js';
import { fetchJsonData, JsonDataError } from '../publish/json-data.js';
import { InProcessBuildRunner, type BuildRunner } from '../publish/runner.js';
import { AiProviderError, type AiProvider } from '../ai/provider.js';
import type { AgentProvider } from '../ai/agent-provider.js';
import { registerAiAgentRoutes, type ResolvedAgent } from './ai-agent-routes.js';
import { registerAiConfigRoutes, AiTestBodySchema } from './ai-config-routes.js';
import { buildAgentProvider } from '../ai/build-provider.js';
import { isActiveAgentToken } from '../ai/agent-token.js';
import { testAiProvider } from '../ai/connectivity.js';
import { decryptSecret } from '../crypto/secret.js';
import { PublishStore, PDF_MEDIA_CSP } from '../publish/store.js';
import { PREVIEW_SITE_RUNTIME_JS, PREVIEW_SCROLL_BRIDGE_JS } from './preview-site-runtime.js';
import { isPreviewAssetPath } from './preview-asset-path.js';
import { signPreview, verifyPreview, signShare, verifyShare } from './preview-token.js';
import { PreviewStore } from './preview-store.js';
import { UploadTicketStore } from './upload-ticket-store.js';
import { PREVIEW_BRIDGE_JS } from './preview-bridge.js';
import { archiveSite, deploySite, DeployConfigSchema } from '../publish/adapters.js';
import { deployRsync } from '../publish/rsync-deploy.js';
import { assertRemoteFormEndpointsReachable } from '../publish/form-guard.js';
import { writePhpSmtpConfig } from '../publish/php-smtp.js';
import { isNewer } from '../version/checker.js';
import { registerDeployTargetRoutes } from './deploy-targets.js';
import { registerLocaleRoutes } from './locales.js';
import { registerWebsiteDataRoutes } from './website-data.js';
import { buildEffectForks } from './effect-forks.js';
import { buttonPreviewCss } from './button-preview.js';
import { tailwindReferencePayload } from './tailwind-reference.js';
import { registerFormRoutes } from './form-routes.js';
import { runDueDeliveries } from '../mail/delivery-runner.js';
import { makeDeliveryResolver } from '../mail/delivery-resolver.js';
import type { DeliveryRunResult } from '../mail/delivery-runner.js';
import { registerProjectSmtpRoutes, SmtpSendTestBodySchema } from './project-smtp-routes.js';
import { registerStockRoutes, type StockServiceLike } from './stock-routes.js';
import { registerImportRoutes, streamImport } from './import-routes.js';
import { StockService } from '../stock/service.js';
import { defaultStockProviders } from '../stock/providers.js';
import { SubmissionRepository } from '../repo/submissions.js';
import { GlobalSmtpMailer, ProjectSmtpMailer, loadProjectSmtp, verifySmtpConnection, sendSmtpTestMessage, type SubmissionMailer, type ProjectMailer, type TransportConfig } from '../mail/mailer.js';
import { HttpCaptchaVerifier, type CaptchaVerifier } from '../mail/captcha.js';
import { registerProjectCaptchaRoutes, loadProjectCaptchaById } from './project-captcha-routes.js';
import { migrateInstanceHcaptchaToProjects } from '../repo/captcha-migration.js';
import { ReleaseRepository } from '../repo/releases.js';
import { sweepDerivedStorage, projectStorage } from '../repo/storage-reaper.js';
import { findUnusedMedia } from '../repo/media-usage.js';
import { createSession, revokeOtherSessions, revokeSession, validateSession } from '../auth/sessions.js';
import { LoginThrottle } from '../auth/login-throttle.js';
import {
  changeEmail,
  changePassword,
  isPasswordChangeRequired,
  getPlatformRole,
  getUserEmail,
  listPlatformUsers,
  listProjectAccessForUser,
  listProjectClientUserIds,
  listProjectMembers,
  projectCardsFor,
  login,
  reapOrphanedClients,
  registerAccount,
  removeProjectMember,
  resolveProjectRole,
  setPlatformRole,
  verifyUserPassword,
  userHasPassword,
  resolveOidcUser,
} from '../repo/accounts.js';
import { MfaError, MfaRepository } from '../repo/mfa.js';
import { sweepExpiredAuthRows, reapDeletedMedia, reapUnusedOAuthClients, reapDeadPats } from '../repo/maintenance.js';
import { PasskeyRepository } from '../repo/passkeys.js';
import { OidcRepository } from '../repo/oidc.js';
import { completeOidcAuth, startOidcAuth, OidcError } from '../auth/oidc.js';
import {
  authenticationOptions,
  encodePublicKey,
  firstForwardedValue,
  registrationOptions,
  resolveRp,
  verifyAuthentication,
  verifyRegistration,
  type RpConfig,
} from '../auth/webauthn.js';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import {
  acceptInvite,
  createInvite,
  getInvite,
  hasPendingInvite,
  listInvites,
  peekInvite,
  revokeInvite,
} from '../repo/invites.js';
import { InstanceSettingsRepository, EncryptionUnavailableError, InvalidOidcConfigError } from '../repo/instance-settings.js';
import { ProjectRepository } from '../repo/projects.js';
import { checkProjectIntegrity, checkDatabaseIntegrity, runIntegrityAction } from '../repo/integrity.js';
import { AiUsageRepository } from '../repo/ai-usage.js';
import { AgentGrantsRepository } from '../repo/agent-grants.js';
import { ApiKeyRepository, type ResolvedApiKey } from '../repo/api-keys.js';
import { sharedMemoryBudget, type Reservation } from '../runtime/memory-budget.js';
import { FairGate, GateFullError, TenantShareError } from '../runtime/fair-gate.js';
import { hashApiToken } from '../auth/api-keys.js';
import { OAuthRepository } from '../repo/oauth.js';
import { OAuthClientRepository } from '../repo/oauth-clients.js';
import { registerOAuthRoutes } from './oauth-routes.js';
import { renderPlatformSecurityTxt } from './security-txt.js';
import { registerMcpRoutes } from './mcp-routes.js';
import { registerRevisionRoutes } from './revisions-routes.js';
import { entryScope } from './content-scope.js';
import { ProjectEventBus } from '../events/bus.js';
import {
  ContentRepository,
  CONTENT_KINDS,
  MAX_SEARCH_QUERY,
  SETTINGS_ENTITY_ID,
  type Settings,
} from '../repo/content.js';
import { deepMerge } from '../repo/merge.js';
import { applyCriticalCssPatch, listCriticalCssBlocks, CSS_BLOCK_NAME } from '../repo/critical-css.js';
import { normalizeEntryValues } from '../repo/entry-values.js';
import { summarizeContentList } from '../repo/content-summary.js';
import { writeReceipt } from '../repo/write-receipt.js';
import { RevisionsRepository } from '../repo/revisions.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  type ProjectContext,
} from '../repo/context.js';
import { RenderPool, RenderUnavailableError } from '../render/render-pool.js';
import { captureScreenshots, closeScreenshotBrowser, withRenderSlot, type ViewportName, type Shot } from '../render/screenshot.js';
import { clampShots } from '../render/mcp-image.js';
import { captureUrlShots, captureUrlElements, captureUrlRegions, captureUrlInspect, captureBehaviour, scoreFidelity, DEFAULT_COMPARE_REGIONS, compareTargets, type ComparePageInput, type RegionShot, captureIssue
} from '../render/compare.js';
import { INSPECT_LIMITS } from '../render/inspect-probe.js';
import { structuralChecks, behaviouralChecks, visualChecks, assembleAudit, type AuditCheck } from '../render/clone-audit.js';
import { VISUAL_AUDIT_RUBRIC, VISUAL_DEFECT_CATEGORIES, VISUAL_DEFECT_SEVERITIES } from '../render/visual-audit.js';
import { runPagespeedAudit, redactOrigin, rebaseFindingUrls, PagespeedUnavailableError, type FormFactor } from '../render/pagespeed-audit.js';
import { extractHeadings, analyzeHeadingOutline, type HeadingOutline } from '../render/heading-outline.js';
import { serveBuiltSite, mimeTypeForFilename } from '../render/serve-built-site.js';
import { checkNativeMarkers } from '../ai/clone-orchestrator.js';
import { SourceRefStore, captureSourceRefs, type ReferencePage } from '../render/source-ref.js';
import { API_KEY_CAPABILITIES, type ApiKeyCapability, type ContentKind } from '../db/schema.js';

const SESSION_COOKIE = 'sw_session';
const RL_WINDOW = '1 minute';
/** Cap concurrent live-preview (SSE) connections per project (bounds sockets + listeners). */
const MAX_EVENT_SUBSCRIBERS_PER_PROJECT = 20;
/** Per-route rate-limit config for an expensive/sensitive endpoint. */
const rl = (max: number) => ({ rateLimit: { max, timeWindow: RL_WINDOW } });
// Static-asset + signed-preview serving fans out into MANY sub-requests per page view (fonts, CSS,
// images/thumbnails, JS). On the shared GLOBAL cap that fan-out can exhaust it and 429 the HTML document
// itself — a blank preview until reload, and intermittently missing CSS/images. @fastify/rate-limit gives
// each route with its own `config.rateLimit` an ISOLATED counter store, so we give these routes their own
// generous per-client buckets: heavy assets can't starve the document/API, yet each keeps a finite ceiling
// (NOT an exemption). The one expensive path — on-demand thumbnail GENERATION — stays bounded independently
// by the `?size`/`?format` allow-list clamp (finite, immutably-cached outputs) + ensureThumb's optimize queue.
const MEDIA_ASSET_RL_MAX = 1000;
// Global-bucket ceiling for API-KEY (bearer) traffic — the agent-fleet lane. See the rate-limit
// registration for why this has to exceed the `/mcp` cap rather than sit under it.
const API_KEY_RL_MAX = 1500;
// Per-route ceiling for API-KEY traffic on the hot-loop AUTHORING routes (see `rlAgent`). Matches the
// `/mcp` cap: every one of those calls lands on a content route, so a lower number here would just move
// the wall inward and surface as a TOOL failure instead of a clean, retry-able 429 at the MCP boundary.
const AGENT_RL_MAX = 600;
// The signed whole-site preview route serves the (version-cached, coalesced) HTML doc AND its per-page
// assets under one route; its own bucket keeps that fan-out off the shared global cap.
const PREVIEW_SITE_RL_MAX = 600;
const IMPORT_BODY_LIMIT = 4 * 1024 * 1024; // 4 MiB for a full project import
const PREVIEW_BODY_LIMIT = 2 * 1024 * 1024; // 2 MiB for a single draft page
// A content write can carry a full settings object: 5 chrome slots at SLOT_MAX (256 KiB each, e.g. a
// nativized site-wide `bottom` of deduped modals) + head/criticalCss + JSON envelope ~= 1.7 MiB, above
// Fastify's 1 MiB default. 4 MiB gives headroom so a nativized settings save doesn't 413 in the editor/MCP.
const CONTENT_BODY_LIMIT = 4 * 1024 * 1024;
// 15 MiB was sized for an IMAGE and quietly became the ceiling for every upload — a real background
// video is tens of megabytes, so the media library simply could not hold one. The limit now matches the
// project-zip path (200 MiB), which the same disk already accepts.
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
/** Images still go through sharp, which must not be handed an arbitrarily huge buffer. */
const MAX_IMAGE_UPLOAD_BYTES = 15 * 1024 * 1024;
const PROJECT_EXPORT_MAX_BYTES = 500 * 1024 * 1024; // 500 MiB cap on a whole-project export zip
const MAX_CONCURRENT_EXPORTS = 2; // whole-instance ceiling on simultaneous export builds (disk/CPU guard)
const PROJECT_IMPORT_UPLOAD_MAX_BYTES = 200 * 1024 * 1024; // compressed project-zip upload cap
const MAX_CONCURRENT_PROJECT_IMPORTS = 2; // whole-instance ceiling on simultaneous project imports/duplicates
const IMPORT_TIMEOUT_MS = 10_000; // import-url: per-socket INACTIVITY timeout + the deadline for a normal import
/**
 * Whole-operation deadline for a LARGE (playable-media) import.
 *
 * The deadline has to scale with the CAP or the cap is a lie: at 10s a 200MB allowance needs 20MB/s
 * sustained, so a real video answered `400 could not fetch the URL` no matter how high the byte
 * ceiling went. Measured against a deployed container: an 83MB import aborted at exactly 10.0s.
 * (Unit tests could not see this — they inject a fetcher, so no clock runs.)
 *
 * 180s over the 200MB ceiling is a ~1.1MB/s floor. This does NOT reopen the slow-loris hole the
 * deadline exists for: `timeoutMs` above is still a per-socket inactivity timeout, so a server that
 * stops sending dies in 10s regardless, and `largeImportGate` bounds how many of these can be
 * open at once.
 */
const LARGE_IMPORT_DEADLINE_MS = 180_000;
/** Never attempt a gated import for less than this; below it the path is not worth its reservation. */
const MIN_LARGE_IMPORT_BYTES = 8 * 1024 * 1024;
/** Share of free headroom one import may claim, so it cannot take every last byte for itself. */
const LARGE_IMPORT_HEADROOM = 0.75;
// Cap the time to RECEIVE a full request (headers + body) — a slow-loris mitigation. This bounds the
// request side only; it does NOT limit how long a handler runs, so streaming responses (AI assistant,
// import SSE) and large-but-steady uploads (project zips) are unaffected. Generous so a genuinely slow
// upload still completes.
const REQUEST_TIMEOUT_MS = 5 * 60_000; // 5 minutes
const MAX_IMPORT_REDIRECTS = 4; // import-url: follow this many redirects (each re-checked vs the SSRF guard)

/** Font metadata accompanying an upload (query params) — sensible defaults for a generic drop. */
const FontUploadMeta = z.object({
  family: FontFamilyNameSchema, // CSS-safe at the boundary (matches the schema's downstream check)
  weight: z.coerce
    .number()
    .int()
    .refine((w) => (FONT_WEIGHTS as readonly number[]).includes(w), 'invalid weight')
    .default(400),
  style: z.enum(['normal', 'italic']).default('normal'),
  fallback: z.enum(['serif', 'sans-serif', 'monospace', 'cursive']).default('sans-serif'),
});
// In the flat tenancy model every project member (owner OR member) may write — the safe
// "content-only" surface is a UI default, not a hard gate (see PR1 security note). Bearer keys
// are additionally constrained by capabilities in resolveProject.
const WRITE_ROLES: ReadonlySet<string> = new Set(['owner', 'member']);
const API_PREFIXES = ['/auth', '/projects', '/me', '/health', '/admin', '/f', '/invites', '/ai', '/api-key', '/authoring'];

const MEDIA_CONTENT_TYPES = new Map<string, string>([
  ['avif', 'image/avif'],
  ['webp', 'image/webp'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['gif', 'image/gif'],
  ['tiff', 'image/tiff'],
  ['tif', 'image/tiff'],
]);

/**
 * A `kind:'font'` asset's stored face file (`<family-slug>-<weight>[-italic].<ext>`, e.g.
 * `playfair-display-700.woff2`; the older `<weight>[-italic].<ext>` form also matches) — served
 * INLINE as font/*. Path-safe + font-extension only, FLAT (no nested quantifiers → no ReDoS).
 * Mirrors FontFileNameSchema.
 */
const FONT_FACE_FILE = /^[a-z0-9][a-z0-9-]{0,150}\.(woff2|woff|ttf|otf)$/;
const FONT_CONTENT_TYPES = new Map<string, string>([
  ['woff2', 'font/woff2'],
  ['woff', 'font/woff'],
  ['ttf', 'font/ttf'],
  ['otf', 'font/otf'],
]);

// Bound concurrent image optimization — each run spawns several sharp encoders, so unbounded
// parallel uploads could saturate CPU/memory on the single container. The queue is bounded too: the
// public on-demand thumbnail endpoint could otherwise pile up an unbounded backlog of pending
// encodes (each allocating its source image once its slot is granted).
//
// Fairness here is about ORDER, not refusal. This gate serves PUBLIC visitors, where a first visit to
// a gallery legitimately misses fifteen variants at once and a refusal is a broken image — so a busy
// project waits behind a quieter neighbour rather than being turned away. `queuePerTenant` keeps four
// places free so that neighbour can always get INTO the queue to be scheduled ahead.
const MAX_CONCURRENT_OPTIMIZE = 3;
const MAX_OPTIMIZE_QUEUE = 24;
const optimizeGate = new FairGate({
  label: 'image encodes',
  limit: MAX_CONCURRENT_OPTIMIZE,
  queue: MAX_OPTIMIZE_QUEUE,
  queuePerTenant: MAX_OPTIMIZE_QUEUE - 4,
});
/**
 * What one encode is assumed to cost while it runs.
 *
 * Measured: twenty distinct images served cold cost ~184 MB — roughly 9 MB each with the source
 * buffer, the decode and the encoded output all live at once. Rounded up, because under-reserving
 * is what an OOM looks like and over-reserving only costs a little throughput.
 */
const OPTIMIZE_RESERVE_BYTES = 12 * 1024 * 1024;

/**
 * Hard ceiling on a paginated page size. A caller asking for `?limit=100000` would defeat the point
 * of paginating, so the request is honoured up to this bound rather than refused.
 */
const CONTENT_PAGE_MAX = 500;

/**
 * Reserved per screenshot request. Measured: the first capture adds ~123MB (the browser launch plus
 * five Chrome processes), later concurrent captures ~24MB each. Reserving the launch-sized figure for
 * every capture is deliberately pessimistic — the alternative is admitting three, all of them
 * launching, and being OOM-killed, which is the behaviour this replaces.
 */
const SCREENSHOT_RESERVE_BYTES = 128 * 1024 * 1024;

/** How long an admitted-or-refused decision may wait for memory to free up before shedding. */
const ADMISSION_WAIT_MS = 3_000;

/**
 * What an unpaginated list actually costs, as a multiple of its stored bytes.
 *
 * Measured on a 61-page project: a 13MB payload peaked 37MB (~2.8x) because the rows, the normalised
 * copies and the serialised response body are all live at once. Rounded UP — under-reserving on the
 * everyday editing path is how three concurrent File Manager opens took a container to its cap.
 */
const LIST_AMPLIFICATION = 3;

/** Below this a list is not worth a ledger round-trip; the estimate costs more than the memory does. */
const LIST_ADMIT_FLOOR_BYTES = 2 * 1024 * 1024;

/**
 * Run an image encode under the optimize gate, then under the memory ledger.
 *
 * Two different limits, deliberately in this order. Counting slots bounds how MANY encodes run; it
 * cannot see how much memory is left. Take the slot first (so the queue still shapes the load), then
 * check we can actually afford the work — and if we cannot, the gate's `finally` gives the slot
 * straight back to the next waiter.
 */
async function withOptimizeSlot<T>(tenant: string, fn: () => Promise<T>): Promise<T> {
  return optimizeGate.run(tenant, async () => {
    const reservation = await admitMemory(OPTIMIZE_RESERVE_BYTES, 'image processing');
    try {
      return await fn();
    } finally {
      reservation.release();
    }
  });
}

/**
 * The instance memory ledger. Every gate below counts REQUESTS; this one counts BYTES, which is the
 * thing that actually runs out. Measured on a 1 GiB container: ten concurrent list calls rode to the
 * cap and survived, then three concurrent screenshots produced exit 137 — an OOM kill, so every
 * in-flight request died. Admission against real headroom turns that into a 503 the caller can retry.
 *
 * Initialised at boot (`initMemoryBudget`); until then `tryReserve` sees a zero limit and admits
 * nothing, so it is deliberately only consulted once init has run.
 */
const memoryBudget = sharedMemoryBudget;
let memoryBudgetReady = false;
export async function initMemoryBudget(): Promise<void> {
  await memoryBudget.init();
  memoryBudgetReady = true;
}

/**
 * Test seam: pretend a limit/usage so the DENIAL branch can be exercised over real HTTP.
 *
 * Without this, integration tests never set `memoryBudgetReady`, so `admitMemory` always took the
 * unconditional-admit fallback and no test could reach a 503 — which is exactly how a shed request
 * surfacing as an opaque 500 went unnoticed on the upload paths.
 */
/**
 * Test seam: how many encodes the optimize gate has admitted since boot.
 *
 * Lets a test assert that work was kept OUT of the gate. Without it, "an unknown project slug 404s"
 * proves nothing — a missing FILE also 404s, just after taking a slot and a queue place under an
 * invented tenant, which is the whole vulnerability.
 */
export function _optimizeGateAdmittedForTest(): number {
  return optimizeGate.admitted;
}

export function _setMemoryBudgetForTest(limitBytes: number, usedBytes: number): void {
  memoryBudget._setForTest(limitBytes, usedBytes);
  memoryBudgetReady = true;
}

/**
 * Reserve `bytes` for a piece of work, or throw a RETRYABLE 503.
 *
 * The message matters as much as the status: an agent that reads a refusal as fatal abandons work
 * (a 413 with no way forward is exactly why a clone hotlinked an 83 MB video instead of uploading
 * it). Say plainly that this is transient and worth retrying.
 */
async function admitMemory(bytes: number, label: string): Promise<Reservation> {
  if (!memoryBudgetReady) return memoryBudget.forceReserve(bytes, label);
  // Wait BRIEFLY for headroom before refusing: a transient spike is the common case, and a slower
  // success beats a 503. Bounded — the ledger caps both the wait and how many may queue, because a
  // queue is memory as surely as the work is, and a hang is worse for a caller than a retryable 503.
  const held = await memoryBudget.tryReserve(bytes, label, ADMISSION_WAIT_MS);
  if (held) return held;
  throw Object.assign(new Error(`not enough memory for ${label} right now — this is temporary, retry shortly`), {
    statusCode: 503,
    retryable: true,
  });
}

// Bound concurrent LARGE url-imports the same way, and for the same reason one level up: this route
// is an AMPLIFIER. A few hundred bytes of request makes the server fetch, fully buffer and store up
// to MAX_UPLOAD_BYTES from a third party — unlike the local-upload paths, which are self-limiting
// because the caller must actually transmit the bytes. The body is buffered several times over
// (chunks → Buffer.concat → Uint8Array → Buffer.from), so peak is a small multiple of the payload,
// and `rl(20)` alone would allow ~20 of those in flight at once. Only the LARGE path is gated:
// image-sized imports were never the problem and must not pay new latency for this.
const MAX_CONCURRENT_LARGE_IMPORT = 2;
// A short queue, not an unbounded one — a waiter costs nothing yet, but admitting it eventually
// allocates a full payload, so past this depth say "later" with a retryable 503 instead.
const MAX_LARGE_IMPORT_QUEUE = 6;
/**
 * Unlike the optimize gate, this one REFUSES a project that already has one in flight rather than
 * queueing it. The callers here are agents, and a slot is held for up to `LARGE_IMPORT_DEADLINE_MS`
 * — so queueing behind two of them means a three-minute wait dressed up as success, where a prompt
 * "retry shortly" lets the agent get on with other work.
 *
 * `queuePerTenant` is therefore unreachable while `maxInFlightPerTenant` is 1 (a project is refused
 * before it can queue at all). Kept as the backstop that still applies if that ever rises.
 */
const largeImportGate = new FairGate({
  label: 'large media imports',
  limit: MAX_CONCURRENT_LARGE_IMPORT,
  queue: MAX_LARGE_IMPORT_QUEUE,
  queuePerTenant: MAX_LARGE_IMPORT_QUEUE - 2,
  maxInFlightPerTenant: Math.max(1, Math.ceil(MAX_CONCURRENT_LARGE_IMPORT / 2)),
});

function isApiPath(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return API_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
const CONTENT_KIND_SET: ReadonlySet<string> = new Set(CONTENT_KINDS);

function parseKind(kind: string): ContentKind {
  if (!CONTENT_KIND_SET.has(kind)) throw new NotFoundError(`unknown content kind: ${kind}`);
  return kind as ContentKind;
}

// Media binaries and deploy-target secrets are managed only through their
// dedicated endpoints — the generic content routes must not read OR write them
// (a generic read of `deploy_target` would otherwise leak the encrypted secret;
// a write could forge a media `url` or an attacker-chosen secret blob).
const DEDICATED_KINDS: ReadonlySet<ContentKind> = new Set(['media', 'mediafolder', 'deploy_target', 'project_smtp', 'project_captcha', 'ai_config']);
function parseGenericKind(kind: string): ContentKind {
  const parsed = parseKind(kind);
  if (DEDICATED_KINDS.has(parsed)) {
    throw new ForbiddenError(`${parsed} must be accessed via its dedicated endpoints`);
  }
  return parsed;
}


/**
 * Save-time WIDGET provisioning. When a page is saved, ensure the dataset(s) any composed Widget
 * (`{{> name}}` with a `provides` manifest) declares exist for this project. Create-if-missing,
 * seed entries ONLY on a fresh create (so a user's edited slides are never overwritten on re-save),
 * and path-independent (typed / pasted / agent-authored all provision the same). The dataset/entry
 * writes go through the same content:write context that authorized the page save and are validated
 * by DatasetSchema/EntrySchema in `put`.
 */
async function ensureWidgetDatasets(repo: ContentRepository, ctx: ProjectContext, source: unknown, log: FastifyBaseLogger): Promise<void> {
  if (typeof source !== 'string') return;
  for (const ds of widgetDatasetsForSources([source])) {
    try {
      const exists = await repo.get(ctx, 'dataset', ds.slug).then(
        () => true,
        (err: unknown) => {
          if (err instanceof NotFoundError) return false;
          throw err;
        },
      );
      if (exists) {
        // RECONCILE (APPEND-ONLY, RACE-SAFE): a widget manifest can GAIN fields after a project already
        // provisioned its dataset (e.g. the hero widget's new `height`). Backfill any manifest field the
        // stored dataset is missing so the new control shows up in the entry editor for existing projects
        // — in ONE transaction so a concurrent dataset edit can't be lost, appending only (never removing/
        // reordering/overwriting an existing field or any entry). No-op when nothing is missing.
        await repo.reconcileDatasetFields(ctx, ds.slug, ds.fields);
        continue;
      }
      await repo.put(ctx, 'dataset', ds.slug, { id: ds.slug, name: ds.name, slug: ds.slug, fields: ds.fields });
      for (const e of ds.seed ?? []) {
        await repo.put(ctx, 'entry', e.id, { id: e.id, dataset: ds.slug, status: 'published', values: e.values });
      }
    } catch (err) {
      // BEST-EFFORT: provisioning is a side-effect of the save, never its gate. A concurrent
      // save of the same page (TOCTOU between the exists-check and the insert) or any transient
      // must not fail the user's page save — create-only means the winning save still provisions,
      // and the next save retries the rest.
      log.warn({ err, slug: ds.slug, project: ctx.projectId }, 'widget dataset provisioning skipped');
    }
  }
}

/** The two content kinds that have a GLOBAL (instance-wide, admin-managed) variant. */
function parseLibraryKind(kind: string): 'snippet' | 'template' {
  if (kind !== 'snippet' && kind !== 'template') {
    throw new ForbiddenError('only snippet and template have a global library');
  }
  return kind;
}

/**
 * An AbortController that fires when the client disconnects, so an in-flight browser render is torn down
 * instead of holding a render slot for a request nobody is waiting for. Exported (and injectable) so the
 * abort wiring itself is testable — inline `req.raw.on('close', …)` closures never are.
 */
export function abortOnClose(req: { raw: { on: (event: 'close', cb: () => void) => unknown } }): AbortController {
  const abort = new AbortController();
  req.raw.on('close', () => abort.abort());
  return abort;
}

/** Kinds whose Handlebars `source` is checked at SAVE time, not just at render. */
const SOURCE_KINDS = new Set(['page', 'template', 'snippet']);

/**
 * Carry the importer's `data.swImport` provenance marker across a full page REPLACE.
 *
 * `put_page` is a total replace, so a legitimate partial write (e.g. `{id, path, title, nav}` to relabel a
 * nav entry) silently deleted the marker — and with it the page's ability to be audited at all, since every
 * fidelity tool refuses a page with no import source. The marker is importer-owned metadata the agent never
 * authors, so re-attaching it is a repair, not a policy: an author who genuinely wants it gone sends an
 * explicit `data.swImport: null`, which this leaves alone.
 */
export function carryImportMarker(current: unknown, next: unknown): unknown {
  const prev = (current as { data?: Record<string, unknown> } | null | undefined)?.data?.swImport;
  if (prev === undefined || !next || typeof next !== 'object' || Array.isArray(next)) return next;
  const body = next as { data?: unknown };
  const data = body.data;
  // An explicit key (including `null`) is the author speaking — respect it.
  if (data !== undefined && (!isPlainRecord(data) || Object.hasOwn(data, 'swImport'))) return next;
  return { ...body, data: { ...(isPlainRecord(data) ? data : {}), swImport: prev } };
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
/**
 * The HTML chrome slots on `settings.website` that the SKELETON wraps in a semantic landmark (so their
 * content must be landmark-free + template-safe, exactly like a page `source`). `head`/`scripts` are
 * excluded — they legitimately hold `<style>`/`<link>` and self-hosted `<script src>`; `criticalCss` is
 * CSS. Label is the editor's name for the slot, used in the error so the user/agent knows WHICH to fix.
 */
const CHROME_HTML_SLOTS: ReadonlyArray<readonly [slot: string, label: string]> = [
  ['mainNav', 'Main Navigation'],
  ['footer', 'Footer'],
  ['sidebarLeft', 'Left Sidebar'],
  ['sidebarRight', 'Right Sidebar'],
  ['bottom', 'Bottom'],
];
/**
 * Validate-on-save: reject an unsafe template `source` when it's written, so a broken page/template/
 * snippet fails fast with a precise, located message (TemplateError → 400) instead of being stored
 * and only caught at publish (409) — and so an MCP agent's put_page surfaces the error immediately.
 * Skipped when there's no own source (a template-based page) or the body is malformed (the kind's
 * Zod schema in contentRepo.put rejects that).
 *
 * For `settings`, the same safety check runs on each HTML CHROME SLOT — previously a landmark tag
 * (`<footer>`/`<nav>`/…) in a chrome slot was accepted silently and then dropped at render (the old
 * chrome kept showing), with no error to the user or agent. Now it fails LOUDLY (400) naming the slot.
 */
/**
 * Reject a call to a helper the engine doesn't have — at SAVE, where the author can still fix it.
 *
 * Render stays lenient on purpose (an unknown helper becomes an inert comment rather than 400ing the
 * page), but that marker is only *discoverable* in body text: inside an attribute
 * (`data-sw-delay="{{multiply @index 90}}"`) it is invisible garbage that nothing reports. So the write
 * is where this has to be caught. The message names the helper and points at it.
 */
function rejectUnknownHelpers(source: string, label?: string): void {
  const [first] = findUnknownHelpers(source);
  if (!first) return;
  const where = first.inAttribute ? ' (inside an attribute value, where it would render as invisible garbage)' : '';
  throw new TemplateError(
    `${label ? `the "${label}" ` : ''}template calls {{${first.name} …}}, which is not a helper${where}. ` +
      'Check the spelling against get_reference (or the Template reference in the editor). ' +
      'Arithmetic is {{sw-add}}/{{sw-sub}}/{{sw-mul}}/{{sw-div}}/{{sw-mod}} (not add/multiply), ' +
      'comparison is (sw-lt)/(sw-gt)/(eq); to stagger a loop use {{sw-stagger @index 90}}.',
    { line: first.line, column: first.column },
  );
}

function validateSourceOnSave(kind: string, body: unknown): void {
  if (SOURCE_KINDS.has(kind)) {
    const source = (body as { source?: unknown } | null | undefined)?.source;
    if (typeof source === 'string' && source.trim() !== '') {
      validateTemplate(source);
      rejectUnknownHelpers(source);
    }
    return;
  }
  if (kind === 'settings') {
    const website = (body as { website?: Record<string, unknown> } | null | undefined)?.website;
    if (!website) return;
    // Reject a skeleton LANDMARK (<nav>/<footer>/<aside>/<main>) in a chrome slot LOUDLY at save — the
    // platform wraps each slot in that landmark, so a repeat was silently dropped at render (the old
    // chrome kept showing, with no error). Landmark-ONLY on purpose: other slot issues (e.g. a stray
    // <script>) keep the established lenient-preview / strict-publish flow rather than failing the save.
    for (const [slot, label] of CHROME_HTML_SLOTS) {
      // eslint-disable-next-line security/detect-object-injection -- `slot` is from the constant CHROME_HTML_SLOTS list
      const val = website[slot];
      if (typeof val !== 'string' || val.trim() === '') continue;
      const found = findSkeletonLandmark(val);
      if (found) {
        throw new TemplateError(`the "${label}" chrome slot can't contain a <${found.tag}> element — ${found.hint}.`);
      }
      // Full template-safety check on the slot — the SAME gate the publisher/renderer runs (unsafe
      // interpolation, a bare {{x}} in a URL attribute, {{{raw}}}, <script>, …). Run it at SAVE so a
      // broken chrome slot fails LOUDLY here with the offending slot named, instead of saving fine,
      // rendering the slot BLANK, and only 409ing at publish (which also made compare_to_source silently
      // fall back to the last good build). No content that publish accepts is newly rejected.
      try {
        validateTemplate(val);
      } catch (err) {
        if (err instanceof TemplateError) {
          throw new TemplateError(`the "${label}" chrome slot has an invalid template — ${err.message}`);
        }
        throw err;
      }
      rejectUnknownHelpers(val, label); // a typo'd helper in the chrome shows on EVERY page
    }
  }
}

const RegisterBody = z.object({
  email: z.string().email(),
  // The shared account-password policy (length + character classes); see @sitewright/schema.
  password: passwordSchema,
  // Accepted for backward compatibility with older clients but ignored — there is no org to name.
  orgName: z.string().min(1).max(120).optional(),
});
const LoginBody = z.object({
  // 254 = the RFC 5321 ceiling for a deliverable address. Bounded so an absurd value can't drive pointless
  // scrypt work, and so the failed-attempt throttle's per-account key has a bounded input.
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});
// Self-service account changes. Both re-authenticate with the current password (a live session
// alone must not suffice to change a credential). New-password strength mirrors RegisterBody.
const ChangeEmailBody = z.object({
  email: z.string().email(),
  currentPassword: z.string().min(1).max(200),
});
const ChangePasswordBody = z.object({
  // Optional: required+verified when the account has a password; omitted to SET an initial password
  // for an OIDC-provisioned account that has none (the server enforces which applies).
  currentPassword: z.string().min(1).max(200).optional(),
  // The new password must satisfy the shared account-password policy (same as registration).
  newPassword: passwordSchema,
});
// MFA. `code` is a 6-digit TOTP OR a recovery code (XXXXX-XXXXX) at login step 2; just a TOTP at
// enrolment-confirm. Kept loose (≤64) so the route logic — not zod — decides validity.
const LoginTotpBody = z.object({
  ticket: z.string().min(1).max(200),
  code: z.string().min(1).max(64),
});
const MfaCodeBody = z.object({ code: z.string().min(1).max(64) });
const MfaPasswordBody = z.object({ currentPassword: z.string().min(1).max(200) });
// WebAuthn. The browser-produced credential response is a structured JSON object; the server-side
// verify does the real cryptographic validation, so the body is accepted permissively and cast.
const WebAuthnResponse = z.object({ id: z.string().min(1) }).passthrough();
const PasskeyRegisterVerifyBody = z.object({ handle: z.string().min(1).max(200), response: WebAuthnResponse, name: z.string().trim().min(1).max(80) });
const PasskeyRenameBody = z.object({ name: z.string().trim().min(1).max(80) });
const PasskeyAuthVerifyBody = z.object({ handle: z.string().min(1).max(200), response: WebAuthnResponse });
/** Upper bound on passkeys per user (prevents unbounded credential accumulation from one session). */
const MAX_PASSKEYS_PER_USER = 20;
const AiGenerateBody = z.object({
  instruction: z.string().min(1).max(4000),
  // No client-selectable model: the agency operator pins the funded model via
  // SW_AI_MODEL. Quotas meter tokens, not dollars, so letting a caller pick a
  // premium model would let it drain the budget faster within the same cap.
});

/** Start of the current UTC month — the window for monthly AI token quotas. */
function startOfMonthUTC(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * The project-wide skeleton shell around a source-page preview — the validated slots (already
 * rendered to HTML) plus the raw owner-only head/criticalCss/scripts. Gives the editor WYSIWYG
 * parity with publish: the author sees their page inside the shared header/footer/sidebars.
 */
interface PreviewShell {
  mainNav?: string;
  sidebarLeft?: string;
  sidebarRight?: string;
  footer?: string;
  bottom?: string;
  head?: string;
  criticalCss?: string;
  customScripts?: string;
  /** Site-wide content width → `--sw-container` (the `.sw-container` helper consumes it). */
  containerWidth?: string;
  /** Custom preloader overlay (the "None / Custom Code" preloader) — first body child. */
  preloader?: string;
  /** Emit the brand's text-on-brand tokens (custom effect code references them). */
  emitBrandContentTokens?: boolean;
  /** `<html lang>` for the preview — the previewed page's locale (publish parity). */
  lang?: string;
  /** Site-wide nav/button effect scheme classes for `<body>` (`sw-nav-*` / `sw-btn-*`). */
  bodyClass?: string;
  /**
   * Coordinates for the encoded submission-endpoint resolver (`window.__swf`). The preview is
   * SAME-ORIGIN, so its base is empty — but it still needs the blob, because a platform-routed form now
   * carries only its id and the runtime has nothing to submit to without it.
   */
  formApi?: { base: string; project: string; preview?: boolean };
  /**
   * Sticky/fixed top-header mode (`website.effects.stickyHeader`) — passed straight to renderDocument,
   * which normalizes it. Typed AS STORED, so a retired value read back off a project still flows
   * through instead of failing to typecheck at every call site.
   */
  stickyHeader?: StickyHeaderSetting;
  /** Opt-in light/dark color schemes (Website settings) — passed through to renderDocument. */
  theme?: { enabled: boolean; default?: 'auto' | 'light' | 'dark' };
  /** Locale-resolved translation catalog → the SYSTEM i18n dict for component runtimes (window.__SW_T__). */
  systemT?: Record<string, unknown>;
  /** Self-hosted FONT media + an ABSOLUTE url resolver, forwarded straight to renderDocument so the editor
   *  preview emits `@font-face`. Without them the preview sets the `--sw-font-*` vars but never declares the
   *  fonts → fallback typography in the editor canvas. The url is root-absolute (`/media/<slug>/…`) so it
   *  resolves inside the opaque-origin sandboxed preview iframe. See `previewFontShell`. */
  media?: readonly MediaAsset[];
  mediaUrl?: (asset: MediaAsset, file: string) => string;
}

/** The self-hosted FONT assets (from an already-loaded media list) + an absolute `/media/<slug>/…` url
 *  resolver, so a styledSourceDocument preview emits `@font-face` (the editor canvas otherwise falls back to
 *  system fonts). Pure — the caller loads media via its in-scope `contentRepo`. The url is root-absolute so
 *  it resolves inside the opaque-origin sandboxed preview iframe. */
function fontMediaShell(media: readonly MediaAsset[], slug: string): Pick<PreviewShell, 'media' | 'mediaUrl'> {
  // Per-face url in the shape matching the asset's id: flat `<id>-<face>` for short (new) ids, legacy
  // `<id>/<face>` for un-migrated uuid fonts — so it survives the legacy routes' removal in the migration.
  return {
    media: media.filter((m) => m.kind === 'font'),
    mediaUrl: (a, f) => (isShortAssetId(a.id) ? `/media/${slug}/${a.id}-${f}` : `/media/${slug}/${a.id}/${f}`),
  };
}

/**
 * Wrap a worker-rendered code-first body in the publish document shell (+ the skeleton `shell`)
 * and inline the body's + slots' own Tailwind utilities — the shared "styled document" used by
 * both the editor preview (render-template `document:true`) and the member-facing source-page
 * preview (`/preview`). `extractClassNames` dedupes + caps the candidate set, so an adversarial
 * class list cannot spike the Tailwind compiler.
 */
async function styledSourceDocument(
  page: Page,
  brand: CorporateIdentity,
  rawBody: string,
  shell: PreviewShell = {},
): Promise<string> {
  // Same two sandbox-imposed swaps the whole-site draft preview makes (build.ts), applied here so BOTH
  // preview surfaces agree: Chromium won't run its PDF viewer in a sandboxed frame, and a YouTube/Vimeo
  // player can't instantiate on the opaque origin the sandbox forces. Left alone, each paints a blank
  // box with nothing to say why; swapped, the author sees the real box plus a way to open the content.
  // Publish is untouched — build.ts gates its copies on previewMode, and this shell is preview-only.
  const body = replacePreviewStorageEmbeds(replacePreviewPdfEmbeds(rawBody));
  // The slots' Tailwind/DaisyUI classes must be in the inlined preview sheet too, else the shared
  // header/footer renders unstyled in the editor.
  const slotHtml = [shell.mainNav, shell.sidebarLeft, shell.sidebarRight, shell.footer, shell.bottom]
    .filter(Boolean)
    .join(' ');
  // Include the `<body>` effect classes in the scan so the preview sheet carries those schemes.
  const scanHtml = `${body} ${slotHtml} ${shell.bodyClass ?? ''}`;
  const classNames = extractClassNames(scanHtml);
  // `shell.bodyClass` is a BARE class string (not a `class="…"` attribute), so extractClassNames — which
  // only reads `class="…"` — never sees it. Extract its tokens explicitly + prepend, so the site-wide
  // nav / button effect + shape + accent schemes ALWAYS compile into the preview sheet (the publish path
  // adds them the same way via `themeClassNames`). Without this the selected global button configuration
  // is not applied in the page-editor preview.
  // The on-page `data-sw-html` WYSIWYG toolbar (preview-bridge) applies its utilities to the LIVE DOM of
  // this very document — long after this sheet was compiled. A scan of the rendered body therefore never
  // sees them: the author picked a colour, the class landed, and nothing changed on screen until a save
  // re-rendered the page and the class finally became a candidate. Compile the toolbar's whole BOUNDED
  // vocabulary (standard palettes + this project's CI colour/font classes) into the preview sheet up
  // front, so every control takes effect the moment it is clicked.
  //
  // This is an EDITING surface, so the full set ships unconditionally — unlike publish/build.ts, which
  // feeds only the classes a project's stored content actually uses, keeping a utility-free site
  // utility-free. Bounded either way: ~34 standard classes plus the project's own brand tokens.
  const compileCandidates = [
    ...new Set([
      ...(shell.bodyClass ?? '').split(/\s+/).filter(Boolean),
      ...classNames,
      ...RICH_CONTENT_SAFELIST,
      ...ciRichClasses(brand),
    ]),
  ];
  // Platform-runtime markers in the rendered body/slots → inline the first-party runtime(s) so they work
  // live in the sandboxed preview (its CSP allows scripts). The marker-gated BODY-effect runtimes
  // (animation, parallax, svg-anim, marquee, lazyload, ripple, cart, consent) are resolved from the
  // SHARED registry (effect-runtimes.ts) that the publish path also uses — so the preview can never again
  // drift behind deploy. cart/consent are 'style-only' there (CSS in, JS inert: their floating overlays +
  // click handlers would fight the click-to-edit bridge; the live behaviour runs on /sites/<slug>/).
  // The runtime CSS goes BEFORE the utility sheet, so Tailwind wins at equal specificity.
  const parallaxed = usesParallax(scanHtml); // also gates the preview scroll bridge below
  // Fixed backgrounds need re-creating in THIS shell only — it is the one the device modes scale.
  const fixedBg = usesFixedBackground(scanHtml);
  // Color-scheme toggle: style + run it live in the preview (unlike the cart, it's harmless — it only
  // flips <html data-sw-theme> + localStorage, so the author can preview light/dark by clicking it).
  const themeToggle = usesThemeToggle(scanHtml);
  // Interactive components (modal / tabs / carousel / lightbox / banner / form) authored in
  // CODE-FIRST source carry their `data-sw-component="…"` marker into the rendered body/slots — scan
  // for them here (the block tree is an empty stub for code-first), mirroring the publish path.
  const componentTypes = componentTypesInSource(scanHtml);
  const { css: componentCss, js: componentJs } = componentAssets(componentTypes);
  // The nav-link runtime opens a <dialog> (global modal) / smooth-scrolls a #section. Ship it for the
  // preview when the rendered body or slots embed a <dialog> — WYSIWYG parity, so an authored modal
  // (incl. a global modal in the bottom slot) actually opens when its trigger is clicked.
  const dialog = usesDialog(scanHtml);
  // JS-backed nav schemes (sliding indicator / cursor-following spotlight) — the body effect class is
  // in scanHtml, so run their runtime live in the preview for WYSIWYG parity (harmless: it only injects
  // an indicator span + reads pointer position).
  const navRuntime = usesNavEffects(scanHtml);
  // Button-effects runtime — ripple on every .btn (+ magnetic / spotlight); inline it live for preview parity.
  const btnRuntime = usesButtonEffects(scanHtml);
  // STICKY top-header — the caller passes the validated mode via `shell.stickyHeader` (carried into
  // renderDocument by the `...shell` spread below, so the fixed `#main-nav` + offset token render in
  // the preview — WYSIWYG layout). Inline the scroll-state runtime for the JS-backed modes (hide/shrink).
  const stickyHeaderRuntime = stickyHeaderUsesRuntime();
  // SCROLLSPY — the marker `sw-scrollspy` is in scanHtml via either a per-element `data-sw-scrollspy`
  // attribute (rendered body/slots) or the site-wide `sw-scrollspy` body class (shell.bodyClass). Run it
  // live in the preview (harmless: it only toggles .active/aria-current, so it never fights the bridge).
  const scrollSpyRuntime = usesScrollSpy(scanHtml);
  // A RAW-HTML page (the explicit page setting) renders free-form: renderDocument omits the platform base
  // CSS, the linked utility sheet, and the platform JS. The editor canvas INLINES a per-page utility sheet
  // (renderDocument can't skip a linked one here), so we ALSO skip that compile + every platform
  // runtime/component style below for parity — the page brings its own CSS/JS. (Skipping the utility
  // compile also avoids foreign classes like Bootstrap `w-100` colliding with Tailwind utility NAMES.)
  const rawFidelity = page.rawHtml === true;
  const inlineStyles = rawFidelity
    ? []
    : [
        ...(componentCss ? [componentCss] : []),
        // Shared registry: every marker-gated body-effect runtime's CSS (animation, parallax, svg-anim,
        // marquee, lazyload, ripple, cart, consent) — same set + order as the publish path.
        ...bodyEffectStyles(scanHtml),
        ...(fixedBg ? [FIXED_BG_PREVIEW_CSS] : []),
        ...(themeToggle ? [THEME_TOGGLE_CSS] : []),
      ];
  // ★ The compiled utilities travel in their OWN field, NOT as a trailing `inlineStyles` entry — the two
  // sit on opposite sides of the author's criticalCss (see RenderDocumentOptions.utilityCss). As an
  // `inlineStyles` entry this sheet landed BEFORE criticalCss, so every equal-specificity tie between an
  // author rule and a utility class resolved the opposite way here than on the built site: a header
  // classed `hidden lg:flex` over a criticalCss `.ph-tabs{display:flex}` collapsed in the whole-site
  // draft preview and on the published site, and never collapsed in this canvas. The publish path has
  // always LINKED the sheet (build.ts `stylesheets`), which is emitted after criticalCss — this is the
  // inline surface catching up to it, so both now agree by construction.
  const utilityCss =
    rawFidelity || compileCandidates.length === 0
      ? undefined
      : await compileUtilityCss([compileCandidates.join(' ')], brandToTailwindTheme(brand));
  const inlineScripts = rawFidelity
    ? // Raw-HTML page: only the editor↔preview bridge runs (no platform component/effect JS).
      [PREVIEW_BRIDGE_JS]
    : [
        // The editor preview scrolls on <body> (styled scrollbar), so bridge body-scroll → window
        // FIRST, before any scroll-linked effect attaches its `window` scroll listener. Self-guarded,
        // so it no-ops if the viewport ever scrolls natively. Fixes sticky-header (.sw-scrolled),
        // parallax, scrollspy + back-to-top in this shell (the whole-site preview has its own bridge).
        ...(parallaxed || stickyHeaderRuntime || scrollSpyRuntime ? [PREVIEW_SCROLL_BRIDGE_JS] : []),
        // This canvas is SCALED by the responsive device modes, and a scaled iframe paints
        // `background-attachment: fixed` as `scroll` (Chromium — measured for transform, zoom and a
        // transformed iframe alike). Re-create the fixed paint with a viewport-fixed layer, which does
        // survive scaling. Marker-gated, so a page with no fixed background ships nothing.
        ...(fixedBg ? [FIXED_BG_PREVIEW_JS] : []),
        ...(componentJs ? [componentJs] : []),
        // Shared registry: the 'run' body-effect runtimes' JS (animation, parallax, svg-anim, lazyload,
        // ripple). cart/consent are 'style-only' (excluded) — styled but inert in the editor canvas.
        ...previewBodyEffectScripts(scanHtml),
        ...(navRuntime ? [NAV_EFFECTS_JS] : []),
        ...(btnRuntime ? [BUTTON_EFFECTS_JS] : []),
        ...(stickyHeaderRuntime ? [STICKY_HEADER_JS] : []),
        ...(scrollSpyRuntime ? [SCROLLSPY_JS] : []),
        // NAV_LINK_JS smooth-scrolls #section links + opens <dialog> modals; ship it for a <dialog> OR for
        // scrollspy (its nav is in-page section navigation, so the links must smooth-scroll in the preview too).
        ...(dialog || scrollSpyRuntime ? [NAV_LINK_JS] : []),
        // The editor↔preview bridge (scroll preserve/restore + inline-edit). Preview-only — this shell
        // is never the publish path (build.ts calls renderDocument directly), so it can't leak.
        PREVIEW_BRIDGE_JS,
      ];
  return renderDocument(page, {
    brand,
    bodyHtml: body,
    // A still-faithful imported page renders as a raw replica (no platform base CSS) in preview too.
    rawFidelity,
    inlineStyles: inlineStyles.length > 0 ? inlineStyles : undefined,
    // Emitted AFTER criticalCss (renderDocument), exactly where the publish path's linked sheet goes.
    utilityCss,
    inlineScripts: inlineScripts.length > 0 ? inlineScripts : undefined,
    // The toggle's no-flash init, inlined SYNC in <head> (preview's sandboxed CSP allows inline JS).
    headInlineScripts: themeToggle ? [THEME_TOGGLE_JS] : undefined,
    // SYSTEM i18n dict for the component runtimes (only when a component ships).
    systemI18n: componentJs ? systemI18nData(shell.systemT) : undefined,
    // `...shell` carries `stickyHeader` straight through to renderDocument (fixed `#main-nav` + offset).
    ...shell,
  });
}

/** Why a requested screenshot is missing, so the caller can SAY so instead of silently omitting it. */
export interface ScreenshotUnavailable {
  /** `memory` is transient backpressure; `failed` is this document/environment (no Chromium, a render error). */
  reason: 'memory' | 'failed';
  retryable: boolean;
  message: string;
}

/**
 * Best-effort server-side screenshots of a preview document, taken only when the caller passes
 * `?screenshot=1` (the MCP preview_page tool does). Renders against the API's OWN loopback origin so the
 * page's self-hosted media resolves.
 *
 * Returns undefined when NO screenshot was asked for. When one was asked for and could not be taken it
 * returns a REASON rather than nothing: a shed request used to be indistinguishable from "this build has
 * no Chromium", so an agent got HTML with no picture and no explanation and had no way to know that
 * simply retrying would work. Same principle as `slotErrors` on this response.
 */
async function previewScreenshots(
  req: FastifyRequest,
  html: string,
): Promise<{ shots?: Partial<Record<ViewportName, Shot>>; unavailable?: ScreenshotUnavailable } | undefined> {
  const q = req.query as { screenshot?: string; viewports?: string } | undefined;
  const want = String(q?.screenshot ?? '').toLowerCase();
  if (want !== '1' && want !== 'true') return undefined;
  const port = req.socket.localPort ?? (Number(process.env.PORT) || 80);
  const viewports = (q?.viewports ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v): v is ViewportName => isScreenshotViewportName(v));
  // A capture costs a browser context, and the FIRST one also pays the browser launch (measured
  // +123MB, five Chrome processes). Reserve for it so three concurrent previews shed with a 503
  // instead of taking the container out — which is exactly what happened under a 1GiB cap.
  let shotReservation: Reservation;
  try {
    shotReservation = await admitMemory(SCREENSHOT_RESERVE_BYTES, 'preview screenshot');
  } catch {
    // Still best-effort — the caller returns the HTML — but SAY that this one is worth retrying.
    return {
      unavailable: {
        reason: 'memory',
        retryable: true,
        message: 'the screenshot was skipped because the instance is temporarily out of memory — the HTML is complete; retry shortly for the image',
      },
    };
  }
  try {
    const shots = await clampShots(await captureScreenshots(html, {
      originHostPort: `127.0.0.1:${port}`,
      // Default a plain preview to desktop + mobile (2), and halve the raster (scale 0.5) — a big cut in
      // the vision-token cost of design iteration. The agent can still request more viewports explicitly.
      viewports: viewports.length ? viewports : [...PREVIEW_DEFAULT_VIEWPORTS],
      scale: 0.5,
    }));
    return { shots };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log?.warn({ err: message }, 'preview screenshot failed');
    // NOT retryable: a render error or a build with no Chromium will fail again immediately. Saying
    // so keeps an agent from looping on something that cannot succeed.
    return { unavailable: { reason: 'failed', retryable: false, message: `the screenshot could not be taken: ${message}` } };
  } finally {
    shotReservation.release();
  }
}

const InviteBody = z.object({
  email: z.string().email(),
  // Optional, platform invites only (admin|developer). Project invites always grant `member`.
  // Defaults to `developer` when omitted.
  role: z.enum(['admin', 'developer']).optional(),
});
const AcceptInviteBody = z.object({
  token: z.string().min(1).max(200),
});

const ProjectSlug = z
  .string()
  .max(64)
  // eslint-disable-next-line security/detect-unsafe-regex -- linear (hyphen separator), length-capped by .max()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase alphanumeric with hyphens');
const CreateProjectBody = z.object({ name: z.string().min(1).max(200), slug: ProjectSlug });
// Rename a project: name and/or slug; at least one must be present.
const UpdateProjectBody = z
  .object({ name: z.string().min(1).max(200).optional(), slug: ProjectSlug.optional() })
  .refine((b) => b.name !== undefined || b.slug !== undefined, 'nothing to update');
// Content kinds whose serialized value can embed a `/media/<slug>/…` reference (credentials/folders can't).
const CreateApiKeyBody = z.object({
  name: z.string().min(1).max(120),
  // The token's base role; the repo refuses to mint above the creator's role.
  role: z.enum(['owner', 'member']).default('member'),
  capabilities: z
    .array(z.enum(API_KEY_CAPABILITIES as unknown as [ApiKeyCapability, ...ApiKeyCapability[]]))
    .min(1)
    .max(API_KEY_CAPABILITIES.length),
  // Expressed as a TTL in days (clearer for clients than an absolute timestamp;
  // the repo enforces the absolute max).
  expiresInDays: z.number().int().min(1).max(365),
});

/**
 * Parse a `Range:` header against a buffer. Returns the slice + its `Content-Range`, `'unsatisfiable'`
 * for a range past the end, or null when there is no (single, byte) range to honour.
 *
 * Shared because BOTH media routes need it and only one of them had it: advertising `accept-ranges`
 * while ignoring `Range` makes a browser believe it can seek, then silently drops it back to 0.
 */
export function partialContent(
  body: Buffer,
  header: string | string[] | undefined,
): { body: Buffer; contentRange: string } | 'unsatisfiable' | null {
  const raw = Array.isArray(header) ? header[0] : header;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(raw ?? ''));
  if (!m) return null;
  const size = body.length;
  const startRaw = m[1];
  const endRaw = m[2];
  // `bytes=-N` = the last N bytes; `bytes=N-` = N to the end.
  const start = startRaw ? Number(startRaw) : Math.max(0, size - Number(endRaw || 0));
  const end = startRaw ? (endRaw ? Math.min(Number(endRaw), size - 1) : size - 1) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return 'unsatisfiable';
  return { body: body.subarray(start, end + 1), contentRange: `bytes ${start}-${end}/${size}` };
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Runs ONE retry pass over undelivered form notifications. The interval lives in server.ts —
     *  see the decoration site for why this is not scheduled inside createApp. */
    runDueFormDeliveries: (opts?: { now?: () => number; limit?: number }) => Promise<DeliveryRunResult>;
  }
}

export interface AppOptions {
  db: Database;
  cookieSecret?: string;
  secureCookies?: boolean;
  logger?: boolean;
  /** Initial pino log level at boot (the admin `logLevel` setting, else env, else 'info'). Logger-on only. */
  logLevel?: LogLevel;
  /** The RAW LOG_LEVEL env (no stored setting baked in) — the fallback when an admin CLEARS logLevel live. */
  envLogLevel?: LogLevel;
  /** Data directory + DB URL — for storage introspection (DB / backups sizes) and the backup-purge action. */
  dataDir?: string;
  databaseUrl?: string;
  /** Isolated template render pool (child-process workers). Absent → /render-template 503s. */
  renderPool?: RenderPool;
  /** Absolute path to the built editor SPA to serve at `/` (single-container mode). */
  editorDist?: string;
  /** Absolute path to the media storage root; enables media upload/serve (incl. fonts) when set. */
  mediaRoot?: string;
  /** Absolute path to the published-sites root; enables publish/serve when set. */
  publishRoot?: string;
  /**
   * Called once per registered route (Fastify's `onRoute`). Exists so the committed route contract
   * (`contract/http-routes.json`) can be generated EXACTLY — see the hook's registration for why
   * `printRoutes` cannot be trusted for this. Not set by the server; the contract test passes it.
   */
  onRoute?: (route: { method: string | string[]; url: string }) => void;
  /**
   * Absolute path to the live-PREVIEW draft-sites root; enables the always-on whole-site
   * preview (`/preview-site/:projectId/:sig/*`, minted member-only via `/projects/:id/preview-url`)
   * when set. Separate from `publishRoot`: these are ephemeral, rebuilt-on-change draft builds
   * (include drafts), never served as the canonical public site. Distinct dir so a draft build
   * never collides with the deployable artifact.
   */
  previewRoot?: string;
  /**
   * Root dir for cached source-reference screenshots (one JSON per imported page), captured at import
   * time and served by `compare_to_source`. Omit to disable caching (compare then always renders the
   * live source). Separate from previewRoot: references are long-lived snapshots, not rebuilt drafts.
   */
  sourceRefRoot?: string;
  /**
   * Trust `X-Forwarded-For` so `req.ip` is the real client IP behind a reverse
   * proxy (required for correct per-IP rate limiting). `true`, or a CIDR/list of
   * trusted proxy addresses. Leave unset for direct connections.
   */
  trustProxy?: boolean | string | string[];
  /** 32-byte key for encrypting stored secrets (saved deploy-target passwords). */
  encryptionKey?: Buffer;
  /**
   * WebAuthn Relying Party overrides. By default the rpID is the request host (without port) and the
   * origin is scheme + host — correct for direct connections. Behind a proxy where the public host
   * differs, set these explicitly (SW_WEBAUTHN_RP_ID / SW_WEBAUTHN_ORIGIN).
   */
  webauthnRpId?: string;
  webauthnOrigin?: string;
  /** When set, deploy targets are restricted to these exact hostnames (SaaS SSRF guard). */
  deployAllowedHosts?: string[];
  /** When set, per-project SMTP hosts are restricted to these exact hostnames (SaaS SSRF guard). */
  smtpAllowedHosts?: string[];
  /**
   * How often (ms) to sweep expired ephemeral auth rows (sessions, MFA tickets, WebAuthn
   * challenges). Default 1h. Set to 0 to disable the timer (e.g. in tests that don't want a
   * background timer); the sweep is also opportunistic at access time, so disabling only skips the
   * periodic pass.
   */
  maintenanceSweepMs?: number;
  /** How long an untouched preview build / source reference survives. Default 30 days; 0 disables. */
  derivedRetentionMs?: number;
  /**
   * Whether to ENFORCE the seeded default-password admin's forced password change (the
   * `must_change_password` flag → a 403 `password-change-required` guard + the editor's forced screen).
   * Default `true` (the embeddable factory + the test suite). The production entry point (`server.ts`)
   * passes `NODE_ENV === 'production'`, so a real deployment enforces it but a local DEV run does NOT —
   * the default `admin@sitewright.example` / `123456` just works while developing. The seed still RECORDS
   * the flag regardless (it's a fact about the password), so flipping to production re-enforces it.
   */
  forcePasswordChange?: boolean;
  /** Current running version (for the pull-based update check). */
  version?: string;
  /** Overrides the project-export archive size cap (bytes). Defaults to {@link PROJECT_EXPORT_MAX_BYTES}. */
  exportMaxBytes?: number;
  /** Provider of the latest released version tag (cached; null when unavailable). */
  latestVersion?: () => Promise<string | null>;
  /** URL shown in the update banner linking to the latest release. */
  releaseUrl?: string;
  /** Build executor (default: in-process). Swap for an isolated worker in SaaS. */
  buildRunner?: BuildRunner;
  /** Online AI completion provider (agency-funded). Omit to disable the AI endpoints. */
  aiProvider?: AiProvider;
  /** Streaming, tool-using provider for the on-page AI assistant. Omit to disable the assistant. */
  agentProvider?: AgentProvider;
  /** Form-submission mailer (Mode A). Defaults to the global-SMTP mailer; tests inject a fake. */
  mailer?: SubmissionMailer;
  /** Per-project SMTP mailer (Mode B / userSmtp). Defaults to ProjectSmtpMailer; tests inject a fake. */
  projectMailer?: ProjectMailer;
  /** Captcha verifier for form submissions. Defaults to the live siteverify client; tests inject a fake. */
  captcha?: CaptchaVerifier;
  /** Stock-image search/import service. Defaults to the live providers; tests inject a fake. */
  stockService?: StockServiceLike;
  /**
   * The outbound fetcher for `media/import-url`. Defaults to {@link pinnedFetchDetailed} — the
   * connect-pinned, SSRF-validated transport shared with the website importer. Tests inject a fake
   * (there is no global `fetch` to stub: pinning deliberately bypasses it to kill the DNS-rebinding
   * TOCTOU window that a resolve-then-fetch guard leaves open).
   */
  importUrlFetch?: typeof pinnedFetchDetailed;
  /**
   * The platform's public ORIGIN (e.g. `https://cms.agency.com`; origin-only, no path). Sourced from
   * `SW_PUBLIC_URL`. Uses: baked into exported `Form` blocks so the static site posts submissions back
   * here; the OIDC redirect base; and — when set — the canonical OAuth/MCP issuer + `resource` (see
   * `issuerOf`), which is how self-hosters behind a TLS-terminating proxy avoid `http://` metadata.
   * Unset → derived per-request (same-origin `/f/…`; request-derived issuer).
   */
  publicUrl?: string;
  /**
   * `Contact` URIs for this instance's `/.well-known/security.txt`, most-preferred first
   * (`SW_SECURITY_CONTACT`). Empty/unset → the upstream advisory channel; see `security-txt.ts`.
   */
  securityContacts?: readonly string[];
  /**
   * Base domain for SUBDOMAIN routing of locally-hosted sites. When set (e.g. `agency.site`), a
   * request whose Host is `<slug>.<sitesDomain>` is served as that local site at the ROOT path
   * (the canonical "View live" URL); the path form `/sites/<slug>/` keeps working too. Requires
   * wildcard DNS `*.<sitesDomain>` → this host. Unset → subdomain routing off.
   */
  sitesDomain?: string;
  /** Monthly token quotas for agency-funded metering. Unset/0 = unlimited. */
  aiQuota?: { orgMonthlyTokens?: number; userMonthlyTokens?: number; projectMonthlyTokens?: number };
}

/**
 * What the RENDERER is allowed to see of a project's captcha config: the provider and the public site
 * key, never the secret. A config with no usable site key yields `undefined`, which leaves a
 * captcha-flagged form INERT (no widget, no vendor script) rather than emitting a broken one.
 */
function captchaRenderConfig(stored: { provider: CaptchaProvider; siteKey: string } | null): CaptchaRenderConfig | undefined {
  if (!stored || !stored.siteKey) return undefined;
  return { provider: stored.provider, siteKey: stored.siteKey };
}

export async function createApp(opts: AppOptions): Promise<FastifyInstance> {
  const { db } = opts;
  // `__Host-` prefix (HTTPS/production only — the prefix REQUIRES `Secure`, which a dev/http instance
  // can't set, so browsers would reject the cookie) hardens the session against COOKIE-TOSSING from a
  // sibling site subdomain: it makes the browser refuse to set this name WITH a `Domain` attribute, so
  // a locally-hosted site at `<slug>.<sitesDomain>` (same registrable domain as the app, and now able
  // to run foreign JS) can't shadow or fixate the session cookie. The cookie is already host-only +
  // `path=/` (the prefix's other requirements). The bare name is kept where `secureCookies` is off.
  const sessionCookie = opts.secureCookies ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE;
  const projects = new ProjectRepository(db);
  // In-process change bus: content writes (from any channel) publish here; the
  // SSE endpoint below relays them to live-preview clients.
  const events = new ProjectEventBus();
  // Built before the content repo so the revision policy (coalesce window / retention) can read the
  // admin instance settings live (see further `instanceSettingsRepo` uses below — this is the one site).
  const instanceSettingsRepo = new InstanceSettingsRepository(db, opts.encryptionKey);
  // Per-IP failed-login throttle (in-memory, per-process) for the /auth/login(/totp) routes.
  const loginThrottle = new LoginThrottle();
  // Session-cookie signing secret. An explicit `cookieSecret` (from `COOKIE_SECRET` env) PINS it;
  // otherwise it's auto-generated + persisted on first boot and live-rotatable from System Settings.
  // Held in a mutable ref so a rotation takes effect immediately — existing cookies stop verifying,
  // so everyone re-logs-in (the intended effect). It only signs the cookie WRAPPER: the real session
  // is a hashed token row, so the secret can't forge a session even if leaked.
  const cookieSecretPinned = opts.cookieSecret !== undefined;
  let currentCookieSecret = opts.cookieSecret ?? (await instanceSettingsRepo.getOrCreateCookieSecret());
  // Current HSTS policy (admin instance setting; OFF by default). Cached in a mutable ref — loaded once
  // at boot and refreshed after a settings PUT — so the per-response security hook doesn't hit the DB and
  // an admin change still takes effect without a restart.
  let hstsPolicy = await instanceSettingsRepo.getHstsPolicy();
  // Who may FRAME the admin panel (admin instance setting; denied by default). Cached in the same
  // mutable-ref style as hstsPolicy, and pre-resolved to the `frame-ancestors` source list (or null =
  // stay denied) so the per-response hook does no work beyond a null check.
  let frameAncestors = frameAncestorsFor(await instanceSettingsRepo.getEmbedding());
  // Custom HMAC sign/verify for the session cookie (NOT @fastify/cookie's `signed`, whose secret is
  // fixed at plugin-registration time) so a runtime rotation of `currentCookieSecret` applies live.
  const signSession = (token: string): string =>
    `${token}.${createHmac('sha256', currentCookieSecret).update(token).digest('base64url')}`;
  // NOTE: this is our own `<token>.<base64url-hmac>` format, distinct from @fastify/cookie's previous
  // `<token>.<base64-sig>` signing — so upgrading from an old COOKIE_SECRET-pinned deployment forces a
  // one-time re-login of existing sessions (acceptable: sessions are short-lived + this is a clean break).
  const unsignSession = (raw: string): string | undefined => {
    const dot = raw.lastIndexOf('.');
    if (dot <= 0) return undefined;
    const token = raw.slice(0, dot);
    const sig = Buffer.from(raw.slice(dot + 1));
    const expected = Buffer.from(createHmac('sha256', currentCookieSecret).update(token).digest('base64url'));
    return sig.length === expected.length && timingSafeEqual(sig, expected) ? token : undefined;
  };
  const revisionsRepo = new RevisionsRepository(db, { policy: () => instanceSettingsRepo.getRevisionPolicy() });
  const contentRepo = new ContentRepository(db, events, revisionsRepo);
  // Populate the editable global snippet/template library from the built-in constants on first boot
  // (idempotent — only fills an empty kind, so an admin's deletions aren't resurrected).
  await seedGlobalLibrary(db, contentRepo);
  // ONE-TIME: hand the legacy instance-wide hCaptcha to the projects that were actually using it.
  // Idempotent and self-clearing, so it costs one settings read per boot once it has run.
  await migrateInstanceHcaptchaToProjects(db, instanceSettingsRepo)
    .then((r) => {
      if (r.moved.length) app.log.info({ projects: r.moved }, 'migrated instance hCaptcha to per-project captcha config');
    })
    .catch((err: unknown) => app.log.error({ err }, 'instance hCaptcha migration failed; the legacy config is untouched'));
  const mediaStorage = opts.mediaRoot ? new MediaStorage(opts.mediaRoot) : undefined;
  const publishStore = opts.publishRoot ? new PublishStore(opts.publishRoot) : undefined;
  // The live-preview draft-site store: same on-disk layout as a published site (so the
  // proven path-safe serving logic is reused verbatim), but a separate root holding
  // ephemeral, rebuilt-on-change DRAFT builds served only to authenticated members.
  const previewSiteStore = opts.previewRoot ? new PublishStore(opts.previewRoot) : undefined;
  /** The signed DRAFT-preview base for a project, or null when this instance serves no draft previews.
   *  Handed out by the page endpoints + publish status as the reliable "where can I SEE this" answer.
   *  The `/preview-site/*` routes only exist when `previewRoot` is configured, so emitting the URL
   *  unconditionally would repeat the very bug it replaces — an address that 404s. Declared HERE, beside
   *  the store it depends on, so the guard can't drift away from the thing being guarded. */
  const draftPreviewBase = (projectId: string): string | null =>
    previewSiteStore ? `/preview-site/${projectId}/${signPreview(projectId, currentCookieSecret)}/` : null;
  /** A page's preview URL, or null when the row is not a renderable page. The route is the PARENT-CHAIN
   *  path (`pagePath`, what the publisher itself uses via allRoutes) — NOT the page's own `path` field,
   *  which is only the last segment: a child page would otherwise get a URL missing its parent's folder,
   *  i.e. exactly the kind of confidently-wrong address this whole change exists to stop emitting.
   *
   *  A `kind:"link"` row is a NAV ENTRY, not a page — it has no source and its `path` is empty, so it
   *  would resolve to the site ROOT. A real clone hit this: five `#anchor` nav placeholders each came
   *  back advertising the home page's URL, so following one renders the home page while claiming to be
   *  "About Us". Emitting nothing is the honest answer; there is no page to see. */
  const pagePreviewUrl = (base: string, page: Page, byId: ReadonlyMap<string, Page>): string | null =>
    page.kind === 'link' ? null : `${base}${pagePath(page, byId).replace(/^\//, '')}`;
  // Cached source-reference screenshots (captured at import) for compare_to_source.
  const sourceRefStore = opts.sourceRefRoot ? new SourceRefStore(opts.sourceRefRoot) : undefined;
  // Live-preview draft-build state, keyed by project id: the content version currently built,
  // any in-flight build (so concurrent requests coalesce onto one), and the last failed
  // version+time (a short cooldown so a persistently-broken project can't spin a fresh build on
  // every request). Defined unconditionally + cleared on project delete so they can't leak.
  const previewBuiltVersion = new Map<string, string>();
  const previewBuilds = new Map<string, Promise<void>>();
  const previewBuildFail = new Map<string, { version: string; at: number }>();
  // What the IN-FLIGHT draft build is doing right now, so the preview shell can say so instead of
  // showing an unexplained wait. Present only while a build is running (the entry is deleted when it
  // settles), which is also how the shell knows to stop asking.
  const previewProgress = new Map<string, BuildProgress>();
  // Pages the LAST draft build could not render (it served each an error document and carried on).
  // Reported with the preview URL so the shell can say so even when the author is looking at a page
  // that is perfectly fine — the whole point being that a broken page is now a local problem.
  const previewPageFailures = new Map<string, PageBuildFailure[]>();
  // Short-lived store of rendered preview docs, so they can be served (via a token
  // URL) under a `Content-Security-Policy: sandbox` for true WYSIWYG interactivity.
  const previewStore = new PreviewStore();
  // Short-lived, single-use tickets that let an AGENT hand a LOCAL file to the media library — see
  // UploadTicketStore for why the bytes cannot travel through the MCP tool call itself.
  const uploadTickets = new UploadTicketStore();
  const buildRunner = opts.buildRunner ?? new InProcessBuildRunner();
  const aiProvider = opts.aiProvider;
  const agentProvider = opts.agentProvider;
  const aiUsageRepo = new AiUsageRepository(db);
  const agentGrantsRepo = new AgentGrantsRepository(db);
  const apiKeysRepo = new ApiKeyRepository(db);
  const oauthRepo = new OAuthRepository(db);
  const oauthClients = new OAuthClientRepository(db);
  // TOTP second factor: the shared secret is encrypted at rest under the operator's key (same key as
  // instance secrets) — so TOTP enrolment/verification is unavailable (503) when no key is configured.
  const mfaRepo = new MfaRepository(db, opts.encryptionKey);
  // Passkeys (WebAuthn). The Relying Party is resolved per-request from the host (overridable via
  // opts) — passkeys bind to that rpID, so they don't transfer across deploy hosts. Behind a
  // TLS-terminating reverse proxy the connection to the container is plain HTTP, so req.protocol/host
  // describe the proxy→app hop, not the browser's real origin; honor the standard X-Forwarded-Proto /
  // X-Forwarded-Host the proxy sets (else expectedOrigin is `http://…` while the browser sent
  // `https://…` → verifyRegistration rejects → "could not verify this passkey"). The env override wins.
  const passkeyRepo = new PasskeyRepository(db);
  const rpFor = (req: FastifyRequest): RpConfig => {
    // Constrain the forwarded values (a spoofed scheme/host can't bypass the ceremony — the browser
    // binds origin/rpID — but validating keeps attacker-controlled junk out of the rpID + logs).
    const fwdProto = firstForwardedValue(req.headers['x-forwarded-proto']);
    const protocol = fwdProto === 'http' || fwdProto === 'https' ? fwdProto : req.protocol;
    const fwdHost = firstForwardedValue(req.headers['x-forwarded-host']);
    const host = fwdHost && /^[a-zA-Z0-9.-]+(:\d+)?$/.test(fwdHost) ? fwdHost : req.headers.host;
    return resolveRp(host, protocol, { rpID: opts.webauthnRpId, origin: opts.webauthnOrigin });
  };
  // OIDC single sign-on (the platform as a Relying Party). Provider config (incl. the encrypted
  // client secret) lives in instance settings; this repo holds the single-use login state + identities.
  const oidcRepo = new OidcRepository(db);
  // The public base used for BOTH the redirect_uri and the callback-URL reconstruction, so they
  // agree (openid-client matches the redirect_uri at token exchange). Prefer the configured public
  // URL; fall back to the request origin.
  const oidcPublicBase = (req: FastifyRequest): string => (opts.publicUrl ?? `${req.protocol}://${req.headers.host}`).replace(/\/$/, '');
  const oidcRedirectUri = (req: FastifyRequest, providerId: string): string =>
    `${oidcPublicBase(req)}/auth/oidc/${encodeURIComponent(providerId)}/callback`;
  const submissionsRepo = new SubmissionRepository(db);
  const releasesRepo = new ReleaseRepository(db);
  const mailer = opts.mailer ?? new GlobalSmtpMailer(instanceSettingsRepo);
  const projectMailer = opts.projectMailer ?? new ProjectSmtpMailer(db, instanceSettingsRepo, opts.encryptionKey);
  const captchaVerifier = opts.captcha ?? new HttpCaptchaVerifier();
  const stockService = opts.stockService ?? new StockService(defaultStockProviders(), instanceSettingsRepo);
  // The SSRF-safe outbound for `media/import-url` (see that route). Injectable for tests only.
  const importUrlFetch = opts.importUrlFetch ?? pinnedFetchDetailed;
  const aiQuota = opts.aiQuota ?? {};
  // Isolated template renderer (child-process worker pool). Injected in tests; in
  // production server.ts constructs one. Absent → the render route returns 503.
  const renderPool = opts.renderPool;
  // Subdomain routing for locally-hosted sites: `<slug>.<sitesDomain>` → serve that local site at
  // the root. `siteSubdomainSlug` extracts the slug from a Host header (a single valid DNS/slug
  // label, not the apex and not `www`); used by `rewriteUrl` below (to route the request into the
  // existing `/sites/:slug/*` handler) and by that handler (to emit root-relative redirects/cookies).
  const sitesDomain = opts.sitesDomain?.replace(/^\.+|\.+$/g, '').toLowerCase() || undefined;
  const siteSubdomainSlug = (host: string | undefined): string | null => {
    if (!sitesDomain || !host) return null;
    const h = (host.split(':')[0] ?? '').toLowerCase(); // strip any :port
    if (!h.endsWith(`.${sitesDomain}`)) return null;
    const label = h.slice(0, h.length - sitesDomain.length - 1);
    // one valid DNS/slug label (≤63 per DNS), not the reserved `www`.
    if (label.length > 63 || !/^[a-z0-9-]+$/.test(label) || label === 'www') return null;
    return label;
  };
  /** The canonical "View live" URL for a locally-hosted site. When a sites domain is configured the site
   *  RUNS on its isolated `<slug>.<sitesDomain>` subdomain (author JS included) and the `/sites/<slug>/`
   *  path form only 301-redirects there — so the advertised link is the subdomain itself. Scheme + any
   *  non-standard port come from `SW_PUBLIC_URL` (the app's public origin); with no public URL set we emit
   *  a protocol-relative link (inherits the editor's scheme). No sites domain → the path form fallback. */
  const servedSiteUrl = (slug: string): string => {
    if (!sitesDomain) return `/sites/${slug}/`;
    if (opts.publicUrl) {
      const u = new URL(opts.publicUrl);
      return `${u.protocol}//${slug}.${sitesDomain}${u.port ? `:${u.port}` : ''}/`;
    }
    return `//${slug}.${sitesDomain}/`;
  };

  const app = Fastify({
    // A `<slug>.<sitesDomain>` request is rewritten (BEFORE routing) into the existing path-based
    // site route, so subdomain + `/sites/<slug>/` share one serving code path. The Host header is
    // untouched, so the handler can still tell it was reached via the subdomain.
    rewriteUrl(req) {
      const slug = siteSubdomainSlug(req.headers.host);
      if (!slug) return req.url ?? '/';
      const url = req.url && req.url !== '/' ? req.url : '/';
      // The PUBLIC form-submission API (`POST /f/<projectId>/<formId>` + its OPTIONS preflight) must
      // reach the platform route even on a site subdomain: a published page posts to the root-relative
      // `/f/<id>/<form>`, which on `<slug>.<sitesDomain>` resolves to THIS origin. Don't rewrite it into
      // the site namespace (it isn't a site asset → would 404). Gated to POST/OPTIONS (the only verbs
      // the endpoint serves) + the exact 2-segment shape (optional trailing slash) so a real site page
      // path under `/f/…` is unaffected. A GET `/f/<a>/<b>` still rewrites to the site namespace — if the
      // form endpoint ever gains a GET handler, add GET here too. (Externally deployed copies instead
      // post to the absolute `publicBaseUrl` endpoint — cross-origin + the endpoint's `*` CORS.)
      if (
        (req.method === 'POST' || req.method === 'OPTIONS') &&
        /^\/f\/[^/]+\/[^/]+\/?$/.test(url.split('?')[0] ?? url)
      ) {
        return url;
      }
      return `/sites/${slug}${url}`;
    },
    // Redact deploy credentials defensively (Fastify omits bodies by default, but
    // guard against any future body logging).
    logger: opts.logger
      ? {
          level: opts.logLevel ?? 'info',
          redact: [
            // Bearer tokens (incl. the short-lived agent token used for in-process /mcp injects) — never
            // log them, even if a future plugin serializes request headers.
            'req.headers.authorization',
            // Covers the auth login/register password AND the project-SMTP PUT
            // (SmtpInput.password is top-level) AND deploy-target create.
            'req.body.password',
            // Self-service account changes (PUT /account/email, /account/password).
            'req.body.currentPassword',
            'req.body.newPassword',
            // MFA: the TOTP/recovery code and the single-use login ticket.
            'req.body.code',
            'req.body.ticket',
            // Deploy-target SFTP key auth: never log the private key or its passphrase.
            'req.body.privateKey',
            'req.body.passphrase',
            'req.body.hostFingerprint',
            // Instance-settings PUT carries plaintext secrets in nested fields.
            'req.body.smtp.password',
            // The per-PROJECT captcha PUT carries its provider secret as a bare `secret` field.
            // (The instance-wide hCaptcha settings this replaced are gone.)
            'req.body.secret',
            'req.body.stock.unsplash',
            'req.body.stock.pexels',
            // AI keys (plaintext on input before encryption): the platform key on /admin/settings and
            // the per-project BYO key on /projects/:id/ai-config.
            'req.body.ai.apiKey',
            'req.body.apiKey',
            // Not a secret, but the base64 logo upload would otherwise bloat the log line.
            'req.body.platformLogo.data',
          ],
        }
      : false,
    // Behind a reverse proxy, trust X-Forwarded-For so req.ip (the rate-limit key)
    // is the real client IP instead of the proxy's (which would collapse all
    // clients to one bucket).
    trustProxy: opts.trustProxy ?? false,
    // Slow-loris mitigation: abort a connection that hasn't delivered a full request within this window.
    // Request-side only — long-running RESPONSES (streaming/SSE) are unaffected. See REQUEST_TIMEOUT_MS.
    requestTimeout: REQUEST_TIMEOUT_MS,
  });

  // Introspection seam for the COMMITTED route contract (`contract/http-routes.json`). Fastify's only
  // post-`ready()` introspection is `printRoutes`, and that pretty-printer is LOSSY: it collapses every
  // wildcard route — including `/sites/:slug/*` and `/preview-site/:projectId/:sig/*`, two of the routes
  // published output depends on — into a single unprefixed `*`. A contract artifact generated from a
  // source that silently drops routes is worse than none, so the hook reports them exactly. Unset in
  // production; adding it here (before any route registers) is the only point `onRoute` can be attached.
  if (opts.onRoute) app.addHook('onRoute', opts.onRoute);

  // Plugins that integrate per-route (rate-limit hooks `onRoute`) must finish
  // loading BEFORE routes are registered, so these are awaited up front.
  // No `secret` here: the session cookie is signed/verified by our own HMAC (signSession/unsignSession)
  // so a runtime secret rotation applies live. The plugin is still needed for cookie PARSING + setCookie.
  await app.register(cookie, {});
  if (mediaStorage) {
    await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0 } });
  }
  // Parse `application/json` ourselves so an EMPTY body is tolerated. Fastify's built-in parser rejects
  // an empty body under `Content-Type: application/json` with FST_ERR_CTP_EMPTY_JSON_BODY (statusCode
  // 400) — and our error handler, which only allow-lists 429/413, would surface that as an opaque 500.
  // A bodyless request that carries a default `application/json` header is common (many HTTP clients set
  // it on every DELETE/POST), so an empty body parses to `undefined` and the route proceeds (a DELETE
  // ignores the body; a route that needs one fails its own schema validation with a clean 400). Non-empty
  // bodies use `secure-json-parse` — the same prototype-pollution-safe parser Fastify uses by default —
  // so this is drop-in for every JSON write path, only changing the empty-body case.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : '';
    if (text.trim() === '') {
      done(null, undefined);
      return;
    }
    try {
      done(null, secureJsonParse(text));
    } catch (err) {
      // Surface as a client error so the handler returns 400, not 500 (matches Fastify's own JSON
      // parser). Build a NEW error carrying the status rather than mutating the library's (the handler
      // sends a generic message, so the original detail isn't exposed — keep it as `cause` for logs).
      const badBody = Object.assign(new Error('invalid json body'), { statusCode: 400, cause: err });
      done(badBody, undefined);
    }
  });

  // Parse `application/x-www-form-urlencoded` (the OAuth token endpoint + the
  // consent form post). Our forms carry no repeated keys, so a flat object is fine.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    } catch (err) {
      done(err as Error);
    }
  });

  // Baseline security headers (the API also serves the SPA in single-container mode).
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    // Default to `same-origin`, but let a route opt into a stricter policy (the signed preview doc
    // sets `no-referrer` so its bearer URL can't leak via the Referer header).
    if (!reply.hasHeader('referrer-policy')) reply.header('referrer-policy', 'same-origin');
    // HSTS is admin OPT-IN (OFF by default — the `hsts` instance setting). It's sticky and dangerous, so
    // the operator turns it on only when the origin is reliably on TLS. A served client site
    // (`<slug>.<sitesDomain>` or `/sites/…`) is EXCLUDED unless `applyToServedSites`, because those hosts
    // have independent (often plain-HTTP / non-app-cert) TLS and pinning them to HTTPS would hard-break them.
    // Is this response a locally-hosted CLIENT site rather than the app itself? Both the HSTS opt-in
    // and the framing allowlist need the distinction, so it is computed once.
    const servedSite = siteSubdomainSlug(req.headers.host) !== null || (req.url ?? '').startsWith('/sites/');
    if (hstsPolicy.enabled && !reply.hasHeader('strict-transport-security')) {
      if (!servedSite || hstsPolicy.applyToServedSites) {
        let value = `max-age=${hstsPolicy.maxAgeSeconds}`;
        if (hstsPolicy.includeSubDomains) value += '; includeSubDomains';
        if (hstsPolicy.preload) value += '; preload';
        reply.header('strict-transport-security', value);
      }
    }
    // A route may set its OWN Content-Security-Policy (the sandboxed preview-doc,
    // which needs `sandbox allow-scripts` + to be framable by the editor). When it
    // does, don't override its CSP — and skip the default DENY framing too, since
    // that route opts into its own framing policy.
    if (!reply.hasHeader('content-security-policy')) {
      // Framing: denied unless an admin has allowlisted origins (the `embedding` instance setting),
      // and then ONLY for the app origin — a locally-hosted client site keeps the strict default, so
      // opting the admin panel into an iframe never makes every tenant's site framable too.
      const allowFraming = frameAncestors !== null && !servedSite;
      // X-Frame-Options cannot express an allowlist (ALLOW-FROM is dead in every browser), so when
      // framing is permitted it is OMITTED rather than set to a value that would contradict the CSP.
      // `frame-ancestors` is the real guard; see EmbeddingSchema.
      if (!allowFraming) reply.header('x-frame-options', 'DENY');
      // `img-src … https:` lets the editor's stock picker preview provider-CDN
      // thumbnails (Unsplash/Pexels/Openverse sources). Their terms require
      // hotlinking previews (no proxy/cache); imported images are still downloaded
      // + self-hosted under 'self'. Published exports reference 'self' images only.
      reply.header(
        'content-security-policy',
        "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; " +
          `frame-ancestors ${allowFraming ? frameAncestors : "'none'"}`,
      );
    }
  });

  // Gzip served-site TEXT responses (local-hosting `/sites/…` + the `<slug>.<sitesDomain>` subdomain) so
  // deployed-on-platform pages transfer like a real compressing host — the biggest byte win for HTML/CSS/
  // JS. SCOPED strictly on the rewritten `/sites/` URL prefix: `rewriteUrl` (above) rewrites EVERY genuine
  // served-site subdomain request to `/sites/<slug>/…` before routing, and deliberately does NOT rewrite
  // the public `POST /f/…` form endpoint — so a URL-prefix check (not a Host check) compresses exactly the
  // served-site responses and never an app-origin API/JSON body. The SSE `/events` stream is additionally
  // immune (it `reply.hijack()`s, bypassing all onSend hooks). Binary assets (images/fonts, already
  // compressed) and streamed / already-encoded / tiny / pathologically-large bodies are skipped.
  const gzip = promisify(gzipCb);
  const GZIP_MIN_BYTES = 1024; // a gzip header/trailer isn't worth it below this
  const GZIP_MAX_BYTES = 4 * 1024 * 1024; // don't burn CPU per-request gzipping a huge (rare) asset
  const SITE_COMPRESSIBLE = new Set([
    'text/html',
    'text/css',
    'text/javascript',
    'application/javascript',
    'application/json',
    'image/svg+xml',
    'application/xml',
    'text/plain',
  ]);
  app.addHook('onSend', async (req, reply, payload) => {
    if (!(req.url ?? '').startsWith('/sites/') || reply.hasHeader('content-encoding')) return payload;
    // Only compress a materialized string/Buffer body — never a stream or null.
    if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload;
    const ct = String(reply.getHeader('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!SITE_COMPRESSIBLE.has(ct)) return payload;
    const accept = req.headers['accept-encoding'];
    const acceptStr = Array.isArray(accept) ? accept.join(',') : (accept ?? '');
    if (!/\bgzip\b/.test(acceptStr)) return payload;
    const raw = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
    if (raw.length < GZIP_MIN_BYTES || raw.length > GZIP_MAX_BYTES) return payload;
    const gz = await gzip(raw);
    reply.header('content-encoding', 'gzip');
    reply.header('content-length', gz.length);
    // Append to any existing Vary (asset responses already set `Vary: Host`) — don't clobber it.
    const varyList = new Set(
      String(reply.getHeader('vary') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    varyList.add('Accept-Encoding');
    reply.header('vary', [...varyList].join(', '));
    return gz;
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof UnauthorizedError) return reply.code(401).send({ error: err.message });
    if (err instanceof ForbiddenError) return reply.code(403).send({ error: err.message });
    if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
    if (err instanceof ConflictError) return reply.code(409).send({ error: err.message });
    // Recoverable MFA-management errors (wrong enrolment code, no setup in progress) → 400.
    if (err instanceof MfaError) return reply.code(400).send({ error: err.message });
    // TOTP needs the at-rest encryption key (to store/read the secret); without it, unavailable.
    if (err instanceof EncryptionUnavailableError) return reply.code(503).send({ error: err.message });
    // Unsafe template source caught at SAVE time (validate-on-save) → 400 with the position.
    if (err instanceof TemplateError) {
      return reply.code(400).send({ error: err.message, line: err.line, column: err.column });
    }
    if (err instanceof z.ZodError) {
      return reply.code(400).send({ error: 'invalid request', details: err.flatten() });
    }
    // Tree-depth / range guards reject oversized input.
    if (err instanceof RangeError) return reply.code(400).send({ error: 'input too large' });
    // Upstream AI provider failures are transient/external, not server faults:
    // surface 5xx/429 as 503 (overloaded/retryable) and other 4xx as 502 (bad
    // gateway) — never the raw upstream body (could carry provider detail).
    if (err instanceof AiProviderError) {
      const code = err.upstreamStatus >= 500 || err.upstreamStatus === 429 ? 503 : 502;
      app.log.error(err);
      return reply.code(code).send({ error: 'AI provider unavailable — please try again' });
    }
    // Known library errors that carry their own status: rate-limit (429) and
    // body-too-large (413). Allowlisted (not the whole 4xx range) so a future
    // plugin's error message can't leak through.
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.code(429).send({ error: 'rate limit exceeded — slow down' });
    // A 503 here is BACKPRESSURE, not a fault: the memory ledger or a concurrency queue shed this
    // request. Without this branch it fell past the 4xx passthrough into the opaque 500 below, so a
    // shed caller was told "the server is broken" instead of "come back in a moment" — and an agent
    // that reads a 500 as fatal abandons work. Fixed message, like 429/413, so a plugin's own error
    // text can never leak through.
    if (status === 503) {
      return reply.code(503).send({ error: 'temporarily out of capacity — this is transient, retry shortly' });
    }
    if (status === 413) return reply.code(413).send({ error: 'request body too large' });
    // A library/parse error that carries a 4xx status is a CLIENT fault (e.g. a malformed JSON body →
    // FST_ERR_CTP_INVALID_JSON, 400) — report it as such with a generic message rather than mislabeling
    // it a 500 server fault. Only Fastify/plugins set `statusCode` for client errors; a genuine server
    // fault (DB, render, etc.) has none and still falls through to the opaque 500 below.
    if (status !== undefined && status >= 400 && status < 500) return reply.code(status).send({ error: 'invalid request' });
    app.log.error(err);
    return reply.code(500).send({ error: 'internal error' });
  });

  function sessionToken(req: FastifyRequest): string | undefined {
    // eslint-disable-next-line security/detect-object-injection -- sessionCookie is a constant cookie name
    const raw = req.cookies[sessionCookie];
    if (!raw) return undefined;
    // Only accept a correctly-signed cookie (our own HMAC, against the CURRENT secret — so a rotated
    // secret rejects cookies signed with the old one).
    return unsignSession(raw);
  }

  /** Extracts a `Authorization: Bearer swk_…` project API token, if present. */
  function bearerToken(req: FastifyRequest): string | undefined {
    const header = req.headers.authorization;
    if (!header) return undefined;
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    return match ? match[1] : undefined;
  }

  /**
   * Tokens PROVEN to resolve to a live API key, so the limiter can tell an agent from an attacker.
   *
   * The rate-limit hook runs BEFORE authentication, so it cannot resolve a key itself — that would put a
   * DB lookup on every unauthenticated request, which is an amplifier, not a defence. So the auth path
   * records each success here and the limiter merely reads it. Consequences, both wanted:
   *   - An UNAUTHENTICATED request never reaches the raised lane, no matter what `Authorization` header
   *     it invents. Gating on the mere PRESENCE of a bearer (the first cut of this) handed the higher
   *     ceiling to anyone who typed the word "Bearer" — including on `/auth/login`, which has no
   *     route-level cap of its own and so rides the global bucket.
   *   - A real agent's FIRST call is measured at the ordinary cap and every one after it at the raised
   *     one, since each success re-marks the token.
   * Keyed by SHA-256, never the raw token (the DB stores hashes too), with a TTL and a size bound so a
   * flood of distinct valid keys can't grow it without limit.
   */
  const VERIFIED_KEY_TTL_MS = 5 * 60_000;
  const VERIFIED_KEY_MAX = 5_000;
  const verifiedApiKeys = new Map<string, number>();
  function markApiKeyVerified(token: string): void {
    const hash = hashApiToken(token);
    verifiedApiKeys.delete(hash); // re-insert so Map iteration order is LRU-ish for the eviction below
    verifiedApiKeys.set(hash, Date.now() + VERIFIED_KEY_TTL_MS);
    if (verifiedApiKeys.size > VERIFIED_KEY_MAX) {
      const oldest = verifiedApiKeys.keys().next();
      if (!oldest.done) verifiedApiKeys.delete(oldest.value);
    }
  }
  /** Whether THIS request carries a bearer that recently authenticated. Cheap: one hash + one Map get. */
  function isVerifiedApiKey(req: FastifyRequest): boolean {
    const token = bearerToken(req);
    // eslint-disable-next-line security/detect-possible-timing-attacks -- an is-it-absent check, not a credential comparison. Nothing here grants access: it picks a rate-limit ceiling from a set of ALREADY-verified hashes. Authentication happens later, in apiKeysRepo.resolve.
    if (token === undefined) return false;
    const hash = hashApiToken(token);
    const expires = verifiedApiKeys.get(hash);
    if (expires === undefined) return false;
    if (expires <= Date.now()) {
      verifiedApiKeys.delete(hash);
      return false;
    }
    return true;
  }

  /**
   * Rate-limit config for a HOT-LOOP AUTHORING route — one an agent fleet hammers (content read/write,
   * the draft preview). Browser/session traffic and UNVERIFIED callers keep the route's normal `max`;
   * a verified API key is lifted to AGENT_RL_MAX.
   *
   * This is deliberately OPT-IN per route rather than a blanket lift inside `rl()`. The 60/120 tiers also
   * contain routes that must NOT be opened up for a bearer: stock-image search (bills an external API per
   * call), the SMTP/deploy/AI-config endpoints, media import-url (an SSRF surface), and the low tiers are
   * security throttles outright. Raising a cap has to be a decision someone made about THAT route, and
   * `rlAgent` at the call site is what makes it greppable.
   */
  const rlAgent = (max: number) => ({
    rateLimit: {
      max: (req: FastifyRequest) => (isVerifiedApiKey(req) ? Math.max(max, AGENT_RL_MAX) : max),
      timeWindow: RL_WINDOW,
    },
  });

  // Rate limiting: a generous global cap keyed per-user (session) or per-IP, with
  // stricter caps on expensive/sensitive routes (each route sets its own via config).
  // NOTE: behind a reverse proxy, enable Fastify `trustProxy` so req.ip is the real
  // client IP rather than the proxy's.
  await app.register(rateLimit, {
    global: true,
    // Browser traffic keeps the modest per-session cap. API-KEY (bearer) traffic gets a much higher one,
    // because it is where an agent FLEET lives: several agents, each on a different project, sharing one
    // project key. Raising the `/mcp` route cap alone does nothing for them — every MCP tool call
    // re-enters the app IN-PROCESS via app.inject carrying the same bearer, so the real ceiling was this
    // global bucket, not `/mcp`. MEASURED: with /mcp at 600 and this at 200, a REST-backed tool
    // (list_pages) still died at call ~121 with `Error 429: rate limit exceeded` surfaced as a TOOL
    // failure — which is the worst shape for it, since tool failures also count toward the agent loop's
    // flail ceiling (MAX_TOTAL_TOOL_FAILURES). One tool call costs ~1.6 injects, so this is set above
    // 2× MCP_RL_MAX to keep `/mcp` the binding limit — the one that answers with a proper JSON-RPC 429
    // + retry-after that a host can back off on. Still finite: a runaway agent is stopped, just later.
    // Session cookies and anonymous IPs are unaffected. The server-side agent loop's own in-flight
    // tokens remain fully exempt via `allowList` below.
    max: (req) => (isVerifiedApiKey(req) ? API_KEY_RL_MAX : 200),
    timeWindow: RL_WINDOW,
    cache: 20_000, // explicit LRU key cap (bounds memory; documents intent)
    keyGenerator: (req) => sessionToken(req) ?? bearerToken(req) ?? req.ip,
    // Exempt the server-side agent loop's own scoped token: one "build the page in stages" turn fires
    // many rapid tool calls (each an in-process /mcp + content inject on the same bearer) and would
    // otherwise self-throttle into spurious 429s the model reads as hard failures. Only server-minted,
    // in-flight agent tokens are ever in this set (they never reach the browser), and this skips ONLY
    // rate-limiting — auth still applies. The loop stays bounded by iterations + token metering.
    allowList: (req) => isActiveAgentToken(bearerToken(req)),
  });

  // Resolve the session user ONCE per request and memoize it for the request's lifetime (keyed by the
  // request object; GC'd with it). The forced-password preHandler, requireUserId, and currentUserId all
  // funnel through here, so a single write request hits the sessions table once, not three times.
  const sessionUserMemo = new WeakMap<FastifyRequest, string | null>();
  async function resolveSessionUserId(req: FastifyRequest): Promise<string | null> {
    const cached = sessionUserMemo.get(req);
    if (cached !== undefined) return cached;
    const token = sessionToken(req);
    const userId = token ? await validateSession(db, token) : null;
    sessionUserMemo.set(req, userId);
    return userId;
  }

  async function requireUserId(req: FastifyRequest): Promise<string> {
    const userId = await resolveSessionUserId(req);
    if (!userId) throw new UnauthorizedError('authentication required');
    return userId;
  }

  // Soft variant for the OAuth authorize page: resolve the session user, or null
  // (so we can render a sign-in prompt rather than throw a JSON 401).
  async function currentUserId(req: FastifyRequest): Promise<string | null> {
    return resolveSessionUserId(req);
  }

  // ---- Forced password change (the seeded default-password admin) ----
  // While a session user still carries the `mustChangePassword` flag (set ONLY for an admin left on
  // the well-known default password), block every STATE-CHANGING request with a `password-change-
  // required` sentinel the editor recognizes — so the known default credentials can't actually DO
  // anything until a new password is set. Reads (GET/HEAD) pass through so the SPA can load `/me` and
  // render the forced screen. The escape hatch — changing the password — and signing out are
  // allowlisted. Only the interactive SESSION path is gated: a Bearer (API-key) caller is a project
  // integration, never a fresh forced-change human, so it's skipped (and would have no flag anyway).
  // Fastify normalizes the URL (resolves `..`, collapses `//`, decodes) before routing, so a literal
  // match of the query-stripped path against the two escape routes can't be tricked into mismatching a
  // real /account/password (or into smuggling another route INTO the allowlist).
  // ENFORCE the forced change in production; a local DEV run (server.ts passes NODE_ENV==='production')
  // skips it entirely so the default admin just works. The flag is still recorded at seed time, and
  // `mustChangePassword` is only ever surfaced/enforced when this is on.
  const forcePasswordChange = opts.forcePasswordChange ?? true;
  const passwordChangeEscapes = (req: FastifyRequest): boolean => {
    const path = (req.url.split('?')[0] ?? '').replace(/\/+$/, '') || '/';
    return (req.method === 'PUT' && path === '/account/password') || (req.method === 'POST' && path === '/auth/logout');
  };
  if (forcePasswordChange) {
    app.addHook('preHandler', async (req, reply) => {
      if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
      if (bearerToken(req) !== undefined) return; // API-key path — not a forced-change human
      if (passwordChangeEscapes(req)) return; // the change-password + logout escape hatches
      const userId = await resolveSessionUserId(req);
      if (!userId) return; // anonymous / expired sessions are each route's own concern (its requireUserId)
      if (await isPasswordChangeRequired(db, userId)) {
        return reply.code(403).send({ error: 'password-change-required' });
      }
    });
  }

  // Instance/platform admin = a user whose persisted DB `platform_role` is `admin` (the first admin is
  // seeded on first boot — see seed.ts — and further admins are granted via a platform invite with
  // `role:'admin'`). This is the SINGLE source of truth: there is no env email allowlist. Instance
  // settings are global, decided here — never by a project role. Bearer (API-key) callers are never
  // instance admins — admin config is session-only.
  async function isInstanceAdmin(userId: string): Promise<boolean> {
    return (await getPlatformRole(db, userId)) === 'admin';
  }

  async function requireInstanceAdmin(req: FastifyRequest): Promise<string> {
    // session-only: a Bearer token must never reach instance-admin operations.
    if (bearerToken(req) !== undefined) {
      throw new ForbiddenError('this operation requires an interactive session');
    }
    const userId = await requireUserId(req);
    if (!(await isInstanceAdmin(userId))) {
      throw new ForbiddenError('instance admin access required');
    }
    return userId;
  }

  /**
   * Who an SMTP test message may be addressed to.
   *
   * Agency staff (instance admin or developer) may type any address — they are the ones diagnosing
   * deliverability, and often need to see how the mail lands somewhere other than their own inbox.
   * Everyone else gets their OWN account email and nothing else: a project `member` is an invited
   * client, and "send a message from this server to an address I choose" is not a capability a
   * client should hold. Enforced here rather than by hiding the field, because a hidden field is a
   * suggestion and this is a rule.
   */
  async function resolveSmtpTestRecipient(req: FastifyRequest, requested?: string): Promise<string> {
    const userId = await requireUserId(req);
    const own = await getUserEmail(db, userId);
    if (!own) throw new ForbiddenError('your account has no email address to send a test message to');
    if (!requested || requested.trim().toLowerCase() === own.toLowerCase()) return own;
    const role = await getPlatformRole(db, userId);
    if (role !== 'admin' && role !== 'developer') {
      throw new ForbiddenError('only agency staff can send the test message to another address');
    }
    return requested.trim();
  }

  // Platform STAFF = the agency: an instance admin OR a developer. Session-only. Gates actions that are
  // the agency's to take rather than a client's — currently creating projects (invited clients, who are
  // project `member`s, must never self-provision new projects).
  async function requirePlatformStaff(req: FastifyRequest): Promise<string> {
    if (bearerToken(req) !== undefined) {
      throw new ForbiddenError('this operation requires an interactive session');
    }
    const userId = await requireUserId(req);
    const role = await getPlatformRole(db, userId);
    if (role !== 'admin' && role !== 'developer') {
      throw new ForbiddenError('only agency staff can create projects');
    }
    return userId;
  }


  // The access a project route requires. A `Capability` is enforced for bearer
  // (API-key) requests — the key must hold it — and ignored for interactive
  // sessions (which are gated by role as before). `'session-only'` forbids the
  // bearer path entirely (key management, agency-funded AI): operations a
  // non-interactive token must never perform.
  type RequiredAccess = ApiKeyCapability | 'session-only';

  // Resolves a project context for either auth path:
  //  - session cookie → the caller's effective project role (platform admin → owner; else a
  //    `project_members` row), or 403 if they have no access;
  //  - `Authorization: Bearer swk_…` → resolve the project-scoped key, confirm it is bound to THIS
  //    project, and enforce the route's capability.
  // Returns the ProjectContext, the project record, and the resolved key (so routes can apply extra
  // restraint to non-interactive callers).
  async function resolveProject(
    req: FastifyRequest<{ Params: { projectId: string } }>,
    access: RequiredAccess,
  ): Promise<{
    ctx: ProjectContext;
    project: Awaited<ReturnType<ProjectRepository['get']>>;
    apiKey: ResolvedApiKey | null;
  }> {
    // The reserved global-library scope is NOT a real, member-accessible project — it is reachable
    // only via the dedicated `/global` + admin-gated `/admin/global` routes. Reject it here so a
    // platform admin (who resolves to `owner` on every project) can't write the library through the
    // per-project content routes, bypassing the `requireInstanceAdmin` (session-only) gate.
    if (req.params.projectId === GLOBAL_SCOPE_ID) throw new NotFoundError('project not found');
    const bearer = bearerToken(req);
    // Reject ambiguous dual-credential requests rather than silently letting one
    // win — so an injected Authorization header can never override a session (or
    // vice-versa).
    if (bearer !== undefined && sessionToken(req) !== undefined) {
      throw new UnauthorizedError('supply either a session cookie or a Bearer token, not both');
    }
    if (bearer !== undefined) {
      if (access === 'session-only') {
        throw new ForbiddenError('this operation requires an interactive session');
      }
      const key = await apiKeysRepo.resolve(bearer);
      if (!key) throw new UnauthorizedError('invalid or expired API key');
      markApiKeyVerified(bearer); // the limiter's agent lane opens only for a token proven live here
      // The key is bound to one project; reject any other route (no cross-project
      // reach). 404 — not 403 — so a key cannot probe which projects exist.
      if (key.projectId !== req.params.projectId) {
        throw new NotFoundError('project not found');
      }
      if (!key.capabilities.includes(access)) {
        throw new ForbiddenError(`this API key lacks the "${access}" capability`);
      }
      const ctx: ProjectContext = {
        userId: key.createdBy,
        role: key.role,
        projectId: key.projectId,
        actor: 'agent', // bearer token = an API key / MCP agent (drives the editor's "agent editing" indicator)
      };
      // Re-load the project so a stale key whose project was deleted resolves to a clean 404.
      const project = await projects.get(req.params.projectId);
      if (project.deletedAt) throw new NotFoundError('project not found'); // soft-deleted → unreachable
      return { ctx, project, apiKey: key };
    }

    const userId = await requireUserId(req);
    // A platform admin reaches every project as owner; everyone else reaches only the projects they
    // hold a membership for (a clean 403 otherwise — they cannot probe other projects).
    const role = await resolveProjectRole(db, userId, req.params.projectId);
    if (!role) throw new ForbiddenError('you do not have access to this project');
    const project = await projects.get(req.params.projectId);
    if (project.deletedAt) throw new NotFoundError('project not found'); // soft-deleted → unreachable
    return { ctx: { userId, role, projectId: project.id, actor: 'user' }, project, apiKey: null };
  }

  // Optional SSRF guard for deploy targets (multi-tenant SaaS): when an allow-list
  // is configured, only those exact hosts may be deployed to. Default (self-hosted):
  // any host, trusting the authenticated owner/admin operator.
  function assertDeployHostAllowed(host: string): void {
    const allow = opts.deployAllowedHosts;
    if (!allow || allow.length === 0) return;
    // Normalize for a case-insensitive, FQDN-trailing-dot-insensitive match. A
    // host carrying a `:port` simply won't match a bare entry → rejected (fail closed).
    const normalized = host.trim().toLowerCase().replace(/\.$/, '');
    if (!allow.includes(normalized)) {
      throw new ForbiddenError('deploy target host is not in the allowed list');
    }
  }

  // Optional SSRF guard for per-project SMTP hosts (multi-tenant SaaS): when set,
  // only these exact hosts may be saved as a project's SMTP. Default: any host
  // (the owner/admin is trusted, single-tenant). Checked when SMTP config is saved.
  function assertSmtpHostAllowed(host: string): void {
    const allow = opts.smtpAllowedHosts;
    if (!allow || allow.length === 0) return;
    const normalized = host.trim().toLowerCase().replace(/\.$/, '');
    if (!allow.includes(normalized)) {
      throw new ForbiddenError('SMTP host is not in the allowed list');
    }
  }
  // Serialize deploys per project (shared by ad-hoc and saved-target deploys).
  const activeDeploys = new Set<string>();
  // …and publishes, likewise per project. Declared out here (not inside the publish block) because the
  // deploy-target DELETE route must be able to SEE an in-flight build: its cleanup removes the very
  // directory `buildToDir` writes into, so the two must never overlap.
  const activePublishes = new Set<string>();
  // Whole-instance ceiling on concurrent project-export builds (each writes up to
  // PROJECT_EXPORT_MAX_BYTES of temp data + reads the media tree) — mirrors the image
  // optimize slot guard. Incremented for the BUILD phase only; streaming the finished
  // temp file to the client holds no slot.
  let activeExports = 0;
  // Whole-instance ceiling on concurrent project imports + duplicates (each unpacks an archive
  // and writes a whole project's content + media).
  let activeProjectImports = 0;

  // Brute-force protection for the LOGIN routes: a FAILED-attempt throttle (successful logins never
  // consume the budget). The threshold is the admin `authMaxFailures` setting (default 10), read live per
  // request. Flood protection for the whole auth surface is the GLOBAL 200/min limiter.
  //
  // TWO budgets, because either alone has a hole:
  //  - per-IP bounds one source guessing many accounts;
  //  - per-ACCOUNT bounds many sources guessing ONE account — a rotating-IP/botnet attack, which the IP
  //    key cannot see at all.
  // The account budget is a MULTIPLE of the per-IP one on purpose. A per-account lockout is itself a
  // griefing vector (anyone who knows an email can burn its budget), so it is a backstop against
  // distributed guessing, not a primary lockout — and the window is short (60s), so an account griefed
  // this way recovers on its own. The 429 body is IDENTICAL for both, so it never reveals whether an
  // account exists or is under attack.
  const ACCOUNT_FAILURE_MULTIPLIER = 5;
  const ipKey = (ip: string): string => `ip:${ip}`;
  // Normalized to match `login()`'s lookup, so "A@X.com " and "a@x.com" share one budget, then HASHED to a
  // fixed-width key. Hashing matters because this key is caller-supplied text (an IP is not): it keeps a
  // bucket's memory constant no matter what was submitted, and keeps plaintext emails out of the throttle
  // map. Truncated to ~132 bits — far past any collision concern for a 60s counter.
  const accountKey = (account: string): string =>
    `account:${createHash('sha256').update(account.trim().toLowerCase()).digest('base64url').slice(0, 22)}`;
  const authFailLimit = (): Promise<number> => instanceSettingsRepo.getAuthMaxFailures();
  /** Record ONE failed sign-in against both budgets (the account key only when we know who was targeted). */
  function recordLoginFailure(ip: string, account?: string): void {
    loginThrottle.recordFailure(ipKey(ip));
    if (account) loginThrottle.recordFailure(accountKey(account));
  }
  async function loginThrottleBlocked(reply: FastifyReply, ip: string, account?: string): Promise<boolean> {
    const max = await authFailLimit();
    const blocked =
      loginThrottle.isBlocked(ipKey(ip), max) ||
      (account !== undefined && loginThrottle.isBlocked(accountKey(account), max * ACCOUNT_FAILURE_MULTIPLIER));
    if (!blocked) return false;
    reply.code(429).send({ error: 'too many failed sign-in attempts — please wait a minute and try again' });
    return true;
  }
  // A fixed per-IP, per-route ALL-REQUESTS cap for the OTHER credential-verifying / sensitive auth routes
  // (account password/email re-verify, MFA, passkey, OIDC) — they don't get the failed-login throttle but
  // still need tighter-than-global anti-abuse. NOT on /auth/register (→ global 200/min, so the E2E harness
  // registers freely) nor /auth/login(/totp) (→ the throttle). Fixed, not env-driven (SW_AUTH_RATE_LIMIT_MAX
  // is gone).
  const authRl = rl(20);

  app.post('/auth/register', async (req, reply) => {
    const body = RegisterBody.parse(req.body);
    // Registration is INVITATION-ONLY: only an email holding a pending invite may register (then accept
    // it). There is no self-registration toggle. The instance admin is seeded out-of-band (seed.ts),
    // never registered, so this never locks the operator out.
    if (!(await hasPendingInvite(db, body.email))) {
      return reply.code(403).send({ error: 'registration is by invitation only' });
    }
    const { userId } = await registerAccount(db, body.email, body.password);
    const { token, expiresAt } = await createSession(db, userId);
    reply.setCookie(sessionCookie, signSession(token), {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      secure: opts.secureCookies ?? false,
      expires: expiresAt,
    });
    return reply.code(201).send({ userId });
  });

  // Creates a session for `userId` and writes the session cookie. Shared by the login paths so the
  // cookie attributes stay identical everywhere a session is issued.
  async function issueSessionCookie(reply: FastifyReply, userId: string): Promise<void> {
    const { token, expiresAt } = await createSession(db, userId);
    reply.setCookie(sessionCookie, signSession(token), {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      secure: opts.secureCookies ?? false,
      expires: expiresAt,
    });
  }

  app.post('/auth/login', async (req, reply) => {
    const body = LoginBody.parse(req.body);
    if (await loginThrottleBlocked(reply, req.ip, body.email)) return reply;
    let userId: string;
    try {
      userId = await login(db, body.email, body.password);
    } catch (err) {
      // Count only FAILED credential checks. An UNKNOWN email accrues against its account key exactly
      // like a real one, so the throttle never becomes an account-existence oracle.
      recordLoginFailure(req.ip, body.email);
      throw err;
    }
    // Password OK. If the user has a CONFIRMED TOTP factor, don't issue a session yet — hand back a
    // single-use, short-lived ticket and require the code at /auth/login/totp (step 2). No cookie is
    // set, so a stolen password alone never yields a session.
    if (await mfaRepo.isTotpEnabled(userId)) {
      const ticket = await mfaRepo.createLoginTicket(userId);
      return reply.send({ mfaRequired: true, ticket });
    }
    await issueSessionCookie(reply, userId);
    return reply.send({ userId });
  });

  // Login step 2: redeem the ticket from step 1 with a TOTP code OR a one-time recovery code. The
  // ticket is consumed only on SUCCESS, so a mistyped code can be retried within the ticket TTL; the
  // per-IP failed-attempt throttle bounds brute force. Generic failures — never reveal which factor failed.
  app.post('/auth/login/totp', async (req, reply) => {
    const body = LoginTotpBody.parse(req.body);
    // Step 2 carries an opaque ticket, not an email, so the account budget can only be consulted once the
    // ticket resolves — the IP budget still gates the unresolved case.
    if (await loginThrottleBlocked(reply, req.ip)) return reply;
    const userId = await mfaRepo.resolveLoginTicket(body.ticket);
    if (!userId) {
      recordLoginFailure(req.ip);
      throw new UnauthorizedError('invalid or expired login request — please sign in again');
    }
    if (await loginThrottleBlocked(reply, req.ip, userId)) return reply;
    const ok = (await mfaRepo.verifyTotpCode(userId, body.code)) || (await mfaRepo.consumeRecoveryCode(userId, body.code));
    if (!ok) {
      recordLoginFailure(req.ip, userId);
      throw new UnauthorizedError('invalid code');
    }
    await mfaRepo.consumeLoginTicket(body.ticket);
    await issueSessionCookie(reply, userId);
    return reply.send({ userId });
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = sessionToken(req);
    if (token) await revokeSession(db, token);
    // Match the set-time attributes so a `__Host-`-prefixed cookie's deletion isn't rejected (the
    // prefix requires `Secure` + `path=/` on every Set-Cookie carrying that name, deletions included)
    // and the clearing header stays byte-identical to the set-time one.
    reply.clearCookie(sessionCookie, { path: '/', secure: opts.secureCookies ?? false, sameSite: 'strict' });
    return reply.code(204).send();
  });

  app.get('/me', { config: rl(60) }, async (req, reply) => {
    const userId = await requireUserId(req);
    const [email, platformRole, access, instanceAdmin, totpEnabled, recoveryCodesRemaining, hasPassword, mustChangePassword] =
      await Promise.all([
        getUserEmail(db, userId),
        getPlatformRole(db, userId),
        // Projects the caller can reach: a platform admin → all; everyone else → their memberships.
        listProjectAccessForUser(db, userId),
        isInstanceAdmin(userId),
        mfaRepo.isTotpEnabled(userId),
        mfaRepo.remainingRecoveryCodes(userId),
        userHasPassword(db, userId),
        // Only surface the forced-change flag when enforcement is on (off in dev) — so the editor never
        // shows the forced screen for a feature the server isn't enforcing.
        forcePasswordChange ? isPasswordChangeRequired(db, userId) : Promise.resolve(false),
      ]);
    // The favicon + production URL per project, for the project selector (one batched query).
    const cards = await projectCardsFor(db, access.map((a) => a.projectId));
    const projects = access.map((a) => {
      const card = cards.get(a.projectId);
      return {
        id: a.projectId,
        name: a.projectName,
        slug: a.projectSlug,
        role: a.role,
        ...(card?.iconUrl ? { iconUrl: card.iconUrl } : {}),
        ...(card?.siteUrl ? { siteUrl: card.siteUrl } : {}),
      };
    });
    // email is non-null for a live session (the row exists); coerce the theoretical TOCTOU-deleted
    // case to '' so the response always matches the client's `email: string` contract.
    return reply.send({ userId, email: email ?? '', platformRole, isInstanceAdmin: instanceAdmin, totpEnabled, recoveryCodesRemaining, hasPassword, mustChangePassword, projects });
  });

  // ---- Self-service account management (the header "Account" / user menu) ----
  // Interactive-session only: a Bearer (API-key) caller must never change a human's credentials.
  // Each route re-authenticates with the current password before applying the change.
  app.put('/account/email', { config: authRl },async (req, reply) => {
    if (bearerToken(req) !== undefined) {
      throw new ForbiddenError('this operation requires an interactive session');
    }
    const userId = await requireUserId(req);
    const body = ChangeEmailBody.parse(req.body);
    const { email } = await changeEmail(db, userId, body.email, body.currentPassword);
    // The login identity changed — treat it like a credential change: cut off any OTHER sessions
    // (a stale/stolen token elsewhere) while keeping THIS browser signed in.
    const current = sessionToken(req);
    if (current) await revokeOtherSessions(db, userId, current);
    return reply.send({ email });
  });

  app.put('/account/password', { config: authRl },async (req, reply) => {
    if (bearerToken(req) !== undefined) {
      throw new ForbiddenError('this operation requires an interactive session');
    }
    const userId = await requireUserId(req);
    const body = ChangePasswordBody.parse(req.body);
    await changePassword(db, userId, body.currentPassword, body.newPassword);
    // Cut off any other sessions (a leaked/stale token elsewhere) but keep THIS browser signed in.
    const current = sessionToken(req);
    if (current) await revokeOtherSessions(db, userId, current);
    return reply.code(204).send();
  });

  // ---- Two-factor (TOTP) management (the user menu → Security tab) ----
  // All session-only. Enrolment (setup/confirm) only ADDS protection, so a session suffices; the
  // security-weakening actions (disable, rotate recovery codes) re-authenticate with the password.
  // Requires the instance encryption key (the TOTP secret is encrypted at rest) → 503 without it.
  const requireAccountSession = async (req: FastifyRequest): Promise<string> => {
    if (bearerToken(req) !== undefined) throw new ForbiddenError('this operation requires an interactive session');
    return requireUserId(req);
  };

  // Begin enrolment: returns the secret + otpauth URI for the QR. Staged UNCONFIRMED until /confirm.
  // Re-enrolling while TOTP is ALREADY active re-authenticates with the password — a stolen session
  // alone must not be able to swap the second factor and rotate recovery codes. (The normal UI path
  // disables first, which is itself password-gated, so it never hits this branch.)
  app.post('/account/mfa/totp/setup', { config: authRl },async (req, reply) => {
    const userId = await requireAccountSession(req);
    if (await mfaRepo.isTotpEnabled(userId)) {
      const { currentPassword } = MfaPasswordBody.parse(req.body);
      if (!(await verifyUserPassword(db, userId, currentPassword))) {
        throw new ForbiddenError('current password is incorrect');
      }
    }
    const email = await getUserEmail(db, userId);
    if (!email) throw new UnauthorizedError('authentication required');
    // The authenticator app shows the platform name as the issuer (the configured brand, or default).
    const { secret, otpauthUri } = await mfaRepo.beginTotpSetup(userId, email, await instanceSettingsRepo.getPlatformName());
    return reply.send({ secret, otpauthUri });
  });

  // Confirm enrolment with a code from the app → enables TOTP + returns recovery codes ONCE.
  app.post('/account/mfa/totp/confirm', { config: authRl },async (req, reply) => {
    const userId = await requireAccountSession(req);
    const body = MfaCodeBody.parse(req.body);
    const recoveryCodes = await mfaRepo.confirmTotpSetup(userId, body.code);
    return reply.send({ recoveryCodes });
  });

  // Disable TOTP entirely (wipes secret + recovery codes). Password-confirmed.
  app.delete('/account/mfa/totp', { config: authRl },async (req, reply) => {
    const userId = await requireAccountSession(req);
    const body = MfaPasswordBody.parse(req.body);
    if (!(await verifyUserPassword(db, userId, body.currentPassword))) {
      throw new ForbiddenError('current password is incorrect');
    }
    await mfaRepo.disableTotp(userId);
    return reply.code(204).send();
  });

  // Regenerate recovery codes (invalidates the old set). Password-confirmed; returns the new set once.
  app.post('/account/mfa/recovery-codes', { config: authRl },async (req, reply) => {
    const userId = await requireAccountSession(req);
    const body = MfaPasswordBody.parse(req.body);
    if (!(await verifyUserPassword(db, userId, body.currentPassword))) {
      throw new ForbiddenError('current password is incorrect');
    }
    if (!(await mfaRepo.isTotpEnabled(userId))) throw new MfaError('two-factor authentication is not enabled');
    const recoveryCodes = await mfaRepo.regenerateRecoveryCodes(userId);
    return reply.send({ recoveryCodes });
  });

  // ---- Passkeys (WebAuthn) management (user menu → Security tab) — session-only ----

  // Begin registering a new passkey: returns the creation options + an opaque challenge `handle` the
  // client echoes back at verify. The challenge is bound to this user.
  app.post('/account/passkeys/register/options', { config: authRl },async (req, reply) => {
    const userId = await requireAccountSession(req);
    const email = await getUserEmail(db, userId);
    if (!email) throw new UnauthorizedError('authentication required');
    const existing = await passkeyRepo.credentialsForUser(userId);
    // Cap per-user passkeys so a session can't accumulate them without bound.
    if (existing.length >= MAX_PASSKEYS_PER_USER) throw new ConflictError(`you can register at most ${MAX_PASSKEYS_PER_USER} passkeys`);
    const options = await registrationOptions({ rp: rpFor(req), userId, userName: email, existing, rpName: await instanceSettingsRepo.getPlatformName() });
    const handle = await passkeyRepo.createChallenge('reg', options.challenge, userId);
    return reply.send({ options, handle });
  });

  // Finish registration: verify the attestation against the stored challenge and persist the credential.
  app.post('/account/passkeys/register/verify', { config: authRl },async (req, reply) => {
    const userId = await requireAccountSession(req);
    const body = PasskeyRegisterVerifyBody.parse(req.body);
    const ch = await passkeyRepo.consumeChallenge(body.handle, 'reg');
    // The challenge must exist, be unexpired, and have been issued to THIS user.
    if (!ch || ch.userId !== userId) throw new UnauthorizedError('passkey registration expired — please try again');
    let verification;
    try {
      verification = await verifyRegistration({ rp: rpFor(req), response: body.response as unknown as RegistrationResponseJSON, expectedChallenge: ch.challenge });
    } catch {
      throw new ForbiddenError('could not verify this passkey');
    }
    if (!verification.verified || !verification.registrationInfo) throw new ForbiddenError('could not verify this passkey');
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    await passkeyRepo.create({
      id: credential.id,
      userId,
      publicKey: encodePublicKey(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      name: body.name,
    });
    return reply.code(201).send({ id: credential.id, name: body.name });
  });

  app.get('/account/passkeys', { config: rl(30) }, async (req, reply) => {
    const userId = await requireAccountSession(req);
    return reply.send({ items: await passkeyRepo.listForUser(userId) });
  });

  app.patch('/account/passkeys/:id', { config: authRl },async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const userId = await requireAccountSession(req);
    const { name } = PasskeyRenameBody.parse(req.body);
    if (!(await passkeyRepo.rename(userId, req.params.id, name))) throw new NotFoundError('passkey not found');
    return reply.code(204).send();
  });

  app.delete('/account/passkeys/:id', { config: authRl },async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const userId = await requireAccountSession(req);
    if (!(await passkeyRepo.remove(userId, req.params.id))) throw new NotFoundError('passkey not found');
    return reply.code(204).send();
  });

  // ---- Passwordless passkey login (no session) ----

  // Usernameless: returns authentication options for a DISCOVERABLE credential + a challenge handle.
  // No user is named, so there is no account-existence oracle.
  app.post('/auth/passkey/options', { config: authRl },async (req, reply) => {
    const options = await authenticationOptions({ rp: rpFor(req), allow: [] });
    const handle = await passkeyRepo.createChallenge('auth', options.challenge, null);
    return reply.send({ options, handle });
  });

  // Verify the assertion. The credential identifies the user; on success we either issue a session or,
  // if that user also has TOTP, hand back an MFA ticket — TOTP gates on TOP of a passkey (by design).
  app.post('/auth/passkey/verify', { config: authRl },async (req, reply) => {
    const body = PasskeyAuthVerifyBody.parse(req.body);
    const ch = await passkeyRepo.consumeChallenge(body.handle, 'auth');
    if (!ch) throw new UnauthorizedError('passkey sign-in expired — please try again');
    const credId = (body.response as { id: string }).id;
    const passkey = await passkeyRepo.getById(credId);
    if (!passkey) throw new UnauthorizedError('unrecognized passkey');
    let verification;
    try {
      verification = await verifyAuthentication({
        rp: rpFor(req),
        response: body.response as unknown as AuthenticationResponseJSON,
        expectedChallenge: ch.challenge,
        credential: { id: credId, publicKey: passkey.publicKey, counter: passkey.counter, transports: passkey.transports },
      });
    } catch {
      throw new UnauthorizedError('passkey verification failed');
    }
    if (!verification.verified) throw new UnauthorizedError('passkey verification failed');
    await passkeyRepo.recordUse(credId, verification.authenticationInfo.newCounter);
    if (await mfaRepo.isTotpEnabled(passkey.userId)) {
      const ticket = await mfaRepo.createLoginTicket(passkey.userId);
      return reply.send({ mfaRequired: true, ticket });
    }
    await issueSessionCookie(reply, passkey.userId);
    return reply.send({ userId: passkey.userId });
  });

  // ---- OIDC single sign-on (the platform as an OIDC Relying Party) ----
  // Redirect-based, so failures redirect back to the SPA with `?oidc_error=` rather than returning
  // JSON. `/auth/config` is unauthenticated so the login screen knows which buttons to show.
  // Returns the reply (Fastify's documented idiom: always `return reply.send()/redirect()` from an
  // async handler, never fire-and-forget) so `return oidcErrorRedirect(…)` resolves the handler WITH
  // the in-flight send. The previous void-discard resolved the handler with `undefined` while the
  // send was still starting, so Fastify's wrapThenable race-guard sent a SECOND reply — an unhandled
  // ERR_HTTP_HEADERS_SENT rejection on every OIDC error path (10 per test run).
  const oidcErrorRedirect = (reply: FastifyReply, code: string): FastifyReply =>
    reply.redirect(`/?oidc_error=${encodeURIComponent(code)}`);

  app.get('/auth/config', { config: rl(60) }, async (_req, reply) => {
    // ONE snapshot of the settings row drives the provider buttons AND the admin-panel branding the
    // (pre-auth) login screen needs to skin itself.
    const { stored, updatedAtMs } = await instanceSettingsRepo.getStoredWithUpdatedAt();
    // The logo is MUTABLE, so bust the cache with the row's mtime rather than relying on ETag infra.
    const logoUrl = stored.platformLogo ? `/branding/logo?v=${updatedAtMs}` : null;
    return reply.send({
      oidcProviders: (stored.oidcProviders ?? []).filter((p) => p.enabled).map((p) => ({ id: p.id, label: p.label })),
      branding: {
        name: stored.platformName ?? DEFAULT_PLATFORM_NAME,
        primary: stored.brandPrimary ?? DEFAULT_BRAND_PRIMARY,
        secondary: stored.brandSecondary ?? DEFAULT_BRAND_SECONDARY,
        logoUrl,
      },
      // The admin-set WebGL background (or null), needed pre-auth so the login screen renders it too.
      platformBackground: stored.platformBackground ?? null,
    });
  });

  // The uploaded admin-panel logo (unauthenticated — the login screen + favicon need it pre-auth).
  // Mutable, so `no-store`; the URL is cache-busted with `?v=<mtime>`. nosniff is set globally.
  app.get('/branding/logo', { config: rl(60) }, async (_req, reply) => {
    const logo = await instanceSettingsRepo.getLogo();
    if (!logo) return reply.code(404).send();
    return reply.type(logo.mime).header('cache-control', 'no-store').send(Buffer.from(logo.data, 'base64'));
  });

  // Step 1: build the IdP authorization URL, persist the single-use state, and redirect there.
  app.get('/auth/oidc/:id/start', { config: authRl },async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const providerId = req.params.id;
    try {
      const provider = await instanceSettingsRepo.getEnabledOidcProvider(providerId);
      if (!provider) return oidcErrorRedirect(reply, 'unknown_provider');
      const start = await startOidcAuth(provider, oidcRedirectUri(req, providerId));
      await oidcRepo.createLoginState({ state: start.state, providerId, nonce: start.nonce, pkceVerifier: start.codeVerifier });
      return reply.redirect(start.url);
    } catch (err) {
      req.log.warn({ err, providerId }, 'oidc start failed');
      return oidcErrorRedirect(reply, 'provider_unavailable');
    }
  });

  // Step 2: validate the callback, resolve/provision the user (existing-or-invited only), then issue
  // a session — or an MFA ticket when the user has TOTP (TOTP gates on top of OIDC).
  app.get('/auth/oidc/:id/callback', { config: authRl },async (req: FastifyRequest<{ Params: { id: string }; Querystring: { state?: string } }>, reply) => {
    const providerId = req.params.id;
    try {
      const provider = await instanceSettingsRepo.getEnabledOidcProvider(providerId);
      if (!provider) return oidcErrorRedirect(reply, 'unknown_provider');
      const state = req.query.state;
      if (!state) return oidcErrorRedirect(reply, 'invalid_state');
      const stored = await oidcRepo.consumeLoginState(state, providerId);
      if (!stored) return oidcErrorRedirect(reply, 'invalid_state');

      const currentUrl = new URL(req.url, oidcPublicBase(req));
      let claims;
      try {
        claims = await completeOidcAuth(provider, currentUrl, { state, nonce: stored.nonce, codeVerifier: stored.pkceVerifier });
      } catch (err) {
        if (!(err instanceof OidcError)) throw err;
        req.log.warn({ err, providerId }, 'oidc callback verification failed');
        return oidcErrorRedirect(reply, 'verification_failed');
      }

      const resolution = await resolveOidcUser(
        db,
        oidcRepo,
        { issuer: claims.iss, subject: claims.sub, email: claims.email, emailVerified: claims.emailVerified },
      );
      if (!resolution.ok) return oidcErrorRedirect(reply, resolution.reason);

      if (await mfaRepo.isTotpEnabled(resolution.userId)) {
        const ticket = await mfaRepo.createLoginTicket(resolution.userId);
        return reply.redirect(`/?mfa_ticket=${encodeURIComponent(ticket)}`);
      }
      await issueSessionCookie(reply, resolution.userId);
      return reply.redirect('/');
    } catch (err) {
      req.log.error({ err, providerId }, 'oidc callback failed');
      return oidcErrorRedirect(reply, 'sign_in_failed');
    }
  });

  // ---- Instance admin settings (global mail / hCaptcha / enabled form modes) ----
  // Not org/project-scoped: gated on the instance-admin email allowlist. Secrets
  // are encrypted at rest and never returned (the read view masks them).
  app.get('/admin/settings', { config: rl(30) }, async (req, reply) => {
    await requireInstanceAdmin(req);
    const stored = await instanceSettingsRepo.getStored();
    return reply.send({
      settings: maskInstanceSettings(stored),
      // Whether the cookie secret is pinned via the COOKIE_SECRET env (rotation is then disabled).
      cookieSecretPinned,
    });
  });

  // Rotate the session-cookie signing key. Takes effect immediately: every existing session cookie stops
  // verifying, so all users (including this admin) must sign in again. Refused when pinned via env.
  app.post('/admin/cookie-secret/rotate', { config: rl(20) }, async (req, reply) => {
    const userId = await requireInstanceAdmin(req);
    if (cookieSecretPinned) {
      return reply.code(409).send({ error: 'the session signing key is pinned via the COOKIE_SECRET environment variable and cannot be rotated here' });
    }
    currentCookieSecret = await instanceSettingsRepo.rotateCookieSecret();
    app.log.info({ userId }, 'session signing key rotated');
    // The caller's own cookie is now invalid too — clear it so the browser drops the dead cookie
    // immediately (don't rely on a follow-up 401). Match the set-time attributes (incl. the __Host- name).
    reply.clearCookie(sessionCookie, { path: '/', secure: opts.secureCookies ?? false, sameSite: 'strict' });
    return reply.send({ ok: true });
  });

  // Tests the INSTANCE SMTP by opening a real session and authenticating, sending nothing. Form
  // delivery is best-effort by design — the visitor is thanked whether or not the mail leaves — so
  // this is the only place an admin can find out their SMTP is broken before leads go missing.
  app.post('/admin/settings/smtp/test', { config: rl(10) }, async (req, reply) => {
    await requireInstanceAdmin(req);
    const stored = await instanceSettingsRepo.getStored();
    if (!stored.smtp) return reply.code(404).send({ error: 'no instance SMTP is configured' });
    // SMTP, not deploy: `assertDeployHostAllowed` here made SW_SMTP_ALLOWED_HOSTS a no-op on the
    // instance surface while looking like enforcement. The stored host can also predate an
    // allowlist being configured, which is why it is re-checked at use rather than trusted.
    assertSmtpHostAllowed(stored.smtp.host);
    const config: TransportConfig = { host: stored.smtp.host, port: stored.smtp.port, secure: stored.smtp.secure };
    let password: string | null = null;
    try {
      password = await instanceSettingsRepo.getSmtpPassword();
    } catch {
      return reply.send({ ok: false, error: 'The stored password could not be decrypted — re-enter it and save.' });
    }
    if (stored.smtp.user && password) config.auth = { user: stored.smtp.user, pass: password };
    return reply.send(await verifySmtpConnection(config));
  });

  // Sends a REAL message through the instance SMTP. Separate from the connection test above because
  // a successful login proves nothing about whether mail arrives — a rejected sender address or an
  // SPF/DKIM failure both pass `verify()` and then silently swallow every lead.
  app.post('/admin/settings/smtp/send-test', { config: rl(5) }, async (req, reply) => {
    await requireInstanceAdmin(req);
    const { to } = SmtpSendTestBodySchema.parse(req.body ?? {});
    const recipient = await resolveSmtpTestRecipient(req, to);
    const stored = await instanceSettingsRepo.getStored();
    if (!stored.smtp) return reply.code(404).send({ error: 'no instance SMTP is configured' });
    assertSmtpHostAllowed(stored.smtp.host);
    const config: TransportConfig = { host: stored.smtp.host, port: stored.smtp.port, secure: stored.smtp.secure };
    let password: string | null = null;
    try {
      password = await instanceSettingsRepo.getSmtpPassword();
    } catch {
      return reply.send({ ok: false, error: 'The stored password could not be decrypted — re-enter it and save.' });
    }
    if (stored.smtp.user && password) config.auth = { user: stored.smtp.user, pass: password };
    const result = await sendSmtpTestMessage(config, {
      to: recipient,
      fromEmail: stored.smtp.fromEmail,
      ...(stored.smtp.fromName ? { fromName: stored.smtp.fromName } : {}),
      origin: 'the instance mail settings',
    });
    return reply.send({ ...result, to: recipient });
  });

  // Instance-wide undelivered count. A broken GLOBAL SMTP breaks every project at once, and an
  // admin looking at the mail settings is exactly the person who can fix it — so the number belongs
  // next to those settings, not only inside each project's inbox.
  app.get('/admin/submissions/undelivered', { config: rl(60) }, async (req, reply) => {
    await requireInstanceAdmin(req);
    return reply.send(await submissionsRepo.undeliveredSummary());
  });

  app.put('/admin/settings', { config: rl(30) }, async (req, reply) => {
    const userId = await requireInstanceAdmin(req);
    const input = InstanceSettingsInputSchema.parse(req.body);
    try {
      const settings = await instanceSettingsRepo.put(input);
      // Refresh the cached HSTS policy from the just-written settings (non-secret, surfaced as-is) so the
      // security-headers hook reflects the change on the next request — no second DB read. NOTE: this is a
      // single-process cache (like currentCookieSecret / the render pool / preview store — this app is
      // single-container by design); a multi-replica deployment would need cross-replica invalidation.
      hstsPolicy = settings.hsts ?? { ...DEFAULT_HSTS };
      frameAncestors = frameAncestorsFor(settings.embedding);
      // Apply a log-level change live (pino's level is mutable) so an admin can dial verbosity without a
      // restart. On CLEAR (settings.logLevel undefined) fall back to the raw ENV level (not opts.logLevel,
      // which has any prior stored value baked in at boot). Only meaningful when the logger is active.
      if (opts.logger) app.log.level = settings.logLevel ?? opts.envLogLevel ?? 'info';
      // Audit trail for an instance-wide config change (userId only — no PII).
      app.log.info({ userId }, 'instance settings updated');
      return reply.send({ settings });
    } catch (err) {
      if (err instanceof EncryptionUnavailableError) {
        return reply.code(503).send({ error: err.message });
      }
      if (err instanceof InvalidOidcConfigError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
  });

  // Storage introspection for the System-Settings "Storage & backups" panel: the live DB size (incl. its
  // WAL sidecars) + the pre-migration snapshot count/size. Admin-only.
  app.get('/admin/storage', { config: rl(30) }, async (req, reply) => {
    await requireInstanceAdmin(req);
    const dbBytes = await dbSizeBytes(opts.databaseUrl ? dbFilePath(opts.databaseUrl) : null);
    const backups = opts.dataDir ? await backupsSummary(backupsDir(opts.dataDir)) : { count: 0, bytes: 0 };
    return reply.send({ dbBytes, backups });
  });

  // Reap pre-migration snapshots on demand, keeping the newest `keepLast` (default 1). Admin-only; the DB
  // itself is NEVER touched — only the *.pre-migration.bak files under <dataDir>/backups.
  const PurgeBackupsBody = z.object({ keepLast: z.number().int().min(1).max(100).default(1) });
  app.post('/admin/backups/purge', { config: rl(10) }, async (req, reply) => {
    const userId = await requireInstanceAdmin(req);
    const { keepLast } = PurgeBackupsBody.parse(req.body ?? {});
    if (!opts.dataDir) return reply.send({ removed: 0, count: 0, bytes: 0 });
    const result = await purgeBackups(backupsDir(opts.dataDir), keepLast, (m) => app.log.info({ userId }, m));
    app.log.info({ userId, removed: result.removed, keepLast }, 'backups purged');
    return reply.send(result);
  });

  // ---- Database integrity: an operator-run sweep for rows that exist but cannot be reached, plus the
  // narrow set of repairs safe to offer for what it finds. Admin-only. The check NEVER writes; repairs
  // are a separate, explicit call. Nothing here runs on a schedule — an automatic repair would turn a
  // display bug into data loss, so the decision stays with a person.
  //
  // Streamed over SSE because a full sweep touches every content row of every project: the client shows
  // real per-check progress instead of an indefinite spinner. `event: progress` per check, then
  // `event: done` with the report, or `event: error`.
  app.post('/admin/integrity/stream', { config: rl(10) }, async (req, reply) => {
    const userId = await requireInstanceAdmin(req);
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // no proxy buffering, so each check flushes as it completes
    });
    const send = (event: string, data: unknown): void => {
      raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    try {
      const report = await checkDatabaseIntegrity(db, (p) => send('progress', p));
      app.log.info({ userId, ok: report.ok, issues: report.issues.length, ms: report.durationMs }, 'database integrity check');
      send('done', report);
    } catch (err) {
      app.log.error({ userId, errMsg: err instanceof Error ? err.message : String(err) }, 'database integrity check failed');
      send('error', { message: 'the integrity check could not complete' });
    } finally {
      raw.end();
    }
  });

  const IntegrityActionBody = z.object({
    action: z.enum(['recreate_dataset', 'reassign_entries', 'fix_entry_scope', 'delete_orphan_entries', 'delete_orphan_history']),
    projectId: z.string().min(1).max(64),
    subject: z.string().max(200),
    targetDataset: z.string().max(200).optional(),
  });

  // Apply ONE repair. Each action re-derives its target set from the live DB (a report can be minutes
  // old), and destructive ones tombstone every row first so they stay restorable from History.
  app.post('/admin/integrity/repair', { config: rl(20) }, async (req, reply) => {
    const userId = await requireInstanceAdmin(req);
    const body = IntegrityActionBody.parse(req.body);
    const result = await runIntegrityAction(db, contentRepo, userId, body);
    app.log.warn({ userId, ...body, changed: result.changed }, 'database integrity repair applied');
    return reply.send(result);
  });

  // Verify the platform AI provider — connectivity + model. Tests the just-typed key if present, else
  // the stored one. Admin-only; heavily rate-limited (it makes an outbound provider call).
  app.post('/admin/settings/ai/test', { config: rl(10) }, async (req, reply) => {
    await requireInstanceAdmin(req);
    const input = AiTestBodySchema.parse(req.body);
    const stored = await instanceSettingsRepo.getAiConfig();
    const apiKey = input.apiKey ?? stored?.apiKey ?? undefined;
    if (!apiKey) return reply.send({ ok: false, model: input.model ?? '', error: 'Enter an API key to test.' });
    return reply.send(await testAiProvider({ provider: input.provider, apiKey, model: input.model, baseUrl: input.baseUrl }));
  });

  // Verify a stock-image provider key with a minimal search. Tests the just-typed key if present, else
  // the stored one. Admin-only; heavily rate-limited.
  const StockTestBody = z.object({ provider: z.enum(['unsplash', 'pexels']), key: z.string().min(1).max(512).optional() });
  app.post('/admin/settings/stock/test', { config: rl(10) }, async (req, reply) => {
    await requireInstanceAdmin(req);
    const body = StockTestBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid provider' });
    return reply.send(await stockService.testKey(body.data.provider, body.data.key));
  });

  // Introspection for a project API key: a bearer client (the CLI / MCP bridge)
  // learns the scope it was granted — which project to address and what it may do —
  // without being pre-configured with those ids. Reveals only the token's OWN scope;
  // never a secret. Bearer-only (a session has no single project scope).
  app.get('/api-key/self', { config: rl(30) }, async (req, reply) => {
    const bearer = bearerToken(req);
    if (bearer === undefined) throw new UnauthorizedError('API key required');
    // Reject ambiguous dual-credential requests, consistent with resolveProject.
    if (sessionToken(req) !== undefined) {
      throw new UnauthorizedError('supply either a session cookie or a Bearer token, not both');
    }
    const key = await apiKeysRepo.resolve(bearer);
    if (!key) throw new UnauthorizedError('invalid or expired API key');
    markApiKeyVerified(bearer);
    return reply.send({
      projectId: key.projectId,
      role: key.role,
      capabilities: key.capabilities,
      // The agent's system instructions (admin override or built-in default) — the MCP bridge
      // sets these as the server's `instructions`. Not secret; readable by any valid token.
      agentInstructions: await instanceSettingsRepo.getEffectiveAgentInstructions(),
    });
  });

  // Session-only project access for management ops (invites, members). Resolves the caller's
  // effective project role (platform admin → owner) and, when `ownerOnly`, requires owner. A Bearer
  // token must never reach these interactive operations.
  async function requireProjectAccess(
    req: FastifyRequest,
    projectId: string,
    ownerOnly: boolean,
  ): Promise<ProjectContext> {
    if (bearerToken(req) !== undefined) {
      throw new ForbiddenError('this operation requires an interactive session');
    }
    const userId = await requireUserId(req);
    const role = await resolveProjectRole(db, userId, projectId);
    if (!role) throw new ForbiddenError('you do not have access to this project');
    if (ownerOnly && role !== 'owner') throw new ForbiddenError('insufficient role for this operation');
    return { userId, role, projectId, actor: 'user' }; // session-only path (bearer rejected above)
  }

  app.get('/projects', { config: rl(60) }, async (req, reply) => {
    const userId = await requireUserId(req);
    const access = await listProjectAccessForUser(db, userId);
    // The favicon + production URL for each project, batch-read in one query, for the project selector.
    const cards = await projectCardsFor(db, access.map((a) => a.projectId));
    // Map to the project shape the editor expects (id/name/slug + role) plus the selector display card.
    const list = access.map((a) => {
      const card = cards.get(a.projectId);
      return {
        id: a.projectId,
        name: a.projectName,
        slug: a.projectSlug,
        role: a.role,
        ...(card?.iconUrl ? { iconUrl: card.iconUrl } : {}),
        ...(card?.siteUrl ? { siteUrl: card.siteUrl } : {}),
      };
    });
    return reply.send({ projects: list });
  });

  // ---- Platform team (admins/developers). Managed by a platform admin only. ----
  app.get('/admin/users', { config: rl(30) }, async (req, reply) => {
    await requireInstanceAdmin(req);
    const users = await listPlatformUsers(db);
    // Only the staff tier (admins/developers) — plain clients are not "platform members".
    const members = users
      .filter((u) => u.platformRole !== null)
      .map((u) => ({ userId: u.userId, email: u.email, role: u.platformRole, createdAt: u.createdAt }));
    return reply.send({ members });
  });

  app.delete<{ Params: { userId: string } }>(
    '/admin/users/:userId',
    { config: rl(20) },
    async (req, reply) => {
      const callerId = await requireInstanceAdmin(req);
      if (req.params.userId === callerId) {
        throw new ForbiddenError('you cannot remove your own platform role');
      }
      // Demote to a plain client (revokes admin/developer staff access).
      await setPlatformRole(db, req.params.userId, null);
      return reply.code(204).send();
    },
  );

  // ---- Deleted (soft-deleted) projects. Listed / restored / permanently reaped by a platform admin. ----
  app.get('/admin/deleted-projects', { config: rl(30) }, async (req, reply) => {
    await requireInstanceAdmin(req);
    const deleted = await projects.listDeleted();
    const items = await Promise.all(
      deleted.map(async (p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        deletedAt: p.deletedAt?.toISOString() ?? null,
        // Resolve the deleter's email for display; null if that account is itself gone.
        deletedBy: p.deletedBy ? await getUserEmail(db, p.deletedBy).catch(() => null) : null,
      })),
    );
    return reply.send({ projects: items });
  });

  app.post<{ Params: { id: string } }>(
    '/admin/deleted-projects/:id/restore',
    { config: rl(20) },
    async (req, reply) => {
      await requireInstanceAdmin(req);
      if (req.params.id === GLOBAL_SCOPE_ID) throw new NotFoundError('project not found'); // never the global scope
      const project = await projects.get(req.params.id); // NotFound if absent
      if (!project.deletedAt) throw new NotFoundError('project not found'); // only deleted projects restore
      await projects.restore(req.params.id);
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/admin/deleted-projects/:id',
    { config: rl(20) },
    async (req, reply) => {
      await requireInstanceAdmin(req);
      const project = await projects.get(req.params.id); // NotFound if absent
      // Only a SOFT-deleted project can be permanently reaped (a live one must be deleted first).
      if (!project.deletedAt) throw new ForbiddenError('only a deleted project can be permanently removed');
      await reapProject(req.params.id);
      return reply.code(204).send();
    },
  );

  app.delete('/admin/deleted-projects', { config: rl(10) }, async (req, reply) => {
    await requireInstanceAdmin(req);
    const deleted = await projects.listDeleted();
    // Isolate each reap: one failure must not abort the sweep, and the returned count reflects what
    // actually succeeded (not the pre-loop list length).
    let reaped = 0;
    for (const p of deleted) {
      try {
        await reapProject(p.id);
        reaped += 1;
      } catch (err) {
        app.log.error({ id: p.id, err: err instanceof Error ? err.message : String(err) }, 'reap-all: failed to reap a project');
      }
    }
    return reply.send({ reaped });
  });

  // ---- Invites: staff (platform admin/developer) or a project member joins only by accepting an
  // invite while signed in as the invited email — no direct add, so there is no account-existence
  // oracle and no unaccepted membership. ----
  // Platform staff invites (admin/developer) — platform admin only.
  app.post('/admin/invites', { config: rl(20) }, async (req, reply) => {
    const userId = await requireInstanceAdmin(req);
    const body = InviteBody.parse(req.body);
    // Platform staff invite → developer by default; a platform admin may invite another admin.
    const result = await createInvite(db, userId, { email: body.email, role: body.role ?? 'developer' });
    return reply.code(201).send(result);
  });

  app.get('/admin/invites', { config: rl(30) }, async (req, reply) => {
    await requireInstanceAdmin(req);
    return reply.send({ invites: await listInvites(db, {}) });
  });

  // Project-scoped client invites (member) — the project owner or a platform admin.
  app.post<{ Params: { projectId: string } }>(
    '/projects/:projectId/invites',
    { config: rl(20) },
    async (req, reply) => {
      const ctx = await requireProjectAccess(req, req.params.projectId, true);
      const body = InviteBody.parse(req.body);
      const result = await createInvite(db, ctx.userId, {
        email: body.email,
        role: 'member',
        projectId: req.params.projectId,
      });
      return reply.code(201).send(result);
    },
  );

  app.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/invites',
    { config: rl(30) },
    async (req, reply) => {
      await requireProjectAccess(req, req.params.projectId, true);
      return reply.send({ invites: await listInvites(db, { projectId: req.params.projectId }) });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/invites/:id',
    { config: rl(20) },
    async (req, reply) => {
      // Require an authenticated session BEFORE the lookup, so an anonymous caller can't probe
      // whether an invite id exists (404 vs 401). Revoking is session-only anyway.
      if (bearerToken(req) !== undefined) {
        throw new ForbiddenError('this operation requires an interactive session');
      }
      await requireUserId(req);
      const invite = await getInvite(db, req.params.id);
      if (!invite) throw new NotFoundError('invite not found');
      // A project invite is revocable by that project's owner (or a platform admin); a platform
      // invite only by a platform admin.
      if (invite.projectId) {
        await requireProjectAccess(req, invite.projectId, true);
      } else {
        await requireInstanceAdmin(req);
      }
      await revokeInvite(db, req.params.id);
      return reply.code(204).send();
    },
  );

  // Accept an invite (interactive session only — never a Bearer key) for the signed-in
  // user; the repo enforces the email match.
  app.post('/invites/accept', { config: rl(20) }, async (req, reply) => {
    const userId = await requireUserId(req);
    const body = AcceptInviteBody.parse(req.body);
    return reply.send(await acceptInvite(db, userId, body.token));
  });

  // Public peek so the accept screen can show context to a token holder (no auth: they
  // already hold the token; this leaks nothing they were not sent).
  app.get<{ Querystring: { token?: string } }>(
    '/invites/peek',
    { config: rl(30) },
    async (req, reply) => {
      const token = req.query.token;
      if (!token) throw new NotFoundError('invite not found');
      const peek = await peekInvite(db, token);
      if (!peek) throw new NotFoundError('invite not found');
      return reply.send({ invite: peek });
    },
  );

  // ---- Project members (the project's team) management (owner or platform admin) ----
  app.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/members',
    { config: rl(30) },
    async (req, reply) => {
      const ctx = await requireProjectAccess(req, req.params.projectId, true);
      return reply.send({ members: await listProjectMembers(db, ctx) });
    },
  );

  app.delete<{ Params: { projectId: string; userId: string } }>(
    '/projects/:projectId/members/:userId',
    { config: rl(20) },
    async (req, reply) => {
      const ctx = await requireProjectAccess(req, req.params.projectId, true);
      await removeProjectMember(db, ctx, req.params.userId);
      return reply.code(204).send();
    },
  );

  app.post('/projects', async (req, reply) => {
    // Project creation is an AGENCY action: only platform staff (admin/developer) may create a project
    // and become its owner. Invited clients are project `member`s and must not self-provision projects.
    // Session-only (a non-interactive token must not create projects).
    const userId = await requirePlatformStaff(req);
    const body = CreateProjectBody.parse(req.body);
    // Atomic: the project + the creator's owner membership are written together (never an
    // ownerless, unreachable project).
    const project = await projects.create(body, userId);
    const ownerCtx = { userId, projectId: project.id, role: 'owner' as const, actor: 'user' as const };
    // The instance-admin's "default locale for new projects" (unset → English) seeds this
    // project's defaultLocale + sole initial locale. See docs/i18n-content-model.md.
    const newProjectLocale = (await instanceSettingsRepo.getStored()).defaultLocale ?? DEFAULT_NEW_PROJECT_LOCALE;
    // Seed a Corporate Identity with a sensible DEFAULT BRAND COLOR (blue), so DaisyUI
    // components are themed out of the box and the preview looks intentional immediately.
    await contentRepo.put(ownerCtx, 'settings', 'settings', {
      identity: { name: body.name, colors: { primary: '#2563eb' } },
      settings: { defaultLocale: newProjectLocale, locales: [newProjectLocale] },
      // Ship the platform DEFAULT navigation + footer (the nav-header / nav-footer recipes) so a fresh
      // project has a working, data-driven Main Navigation (desktop bar + mobile drawer) out of the box.
      website: { mainNav: GLOBAL_SNIPPET_PARTIALS['nav-header'] ?? '', footer: GLOBAL_SNIPPET_PARTIALS['nav-footer'] ?? '' },
    });
    // Every project starts with a HOME page (the tree root: empty slug → "/", header nav),
    // so the pages list, auto-nav, and the first publish work out of the box. Same scaffold
    // idea as the editor's "Add page" starter: a brand binding + one client-editable region.
    await contentRepo.put(ownerCtx, 'page', 'home', {
      id: 'home',
      path: '',
      title: 'Home',
      // Page content goes inside the skeleton's <main id="page-content"> wrapper, so the source
      // itself uses a neutral <section> (the validator rejects a nested <main>).
      source:
        '<section class="mx-auto max-w-3xl px-6 py-16">\n' +
        '  <h1 class="text-4xl font-bold tracking-tight">{{ company.name }}</h1>\n' +
        '  <p class="mt-4 text-lg opacity-70" data-sw-text="tagline">Welcome — edit this tagline.</p>\n' +
        '</section>\n',
      order: 0,
      nav: { slots: ['header'] },
    });
    // Carry the creator's ROLE, exactly as GET /projects does. Without it the editor's freshly-created
    // project has `role: undefined`, and every owner-gated surface reads as NOT-OWNED until something
    // refetches the list — the Account modal told the creator "open a project you own to manage its
    // access keys" about the project they had just made.
    return reply.code(201).send({ project: { ...project, role: 'owner' as const } });
  });

  app.get<{ Params: { id: string } }>(
    '/projects/:id',
    async (req, reply) => {
      const userId = await requireUserId(req);
      const role = await resolveProjectRole(db, userId, req.params.id);
      if (!role) throw new ForbiddenError('you do not have access to this project');
      const project = await projects.get(req.params.id);
      if (project.deletedAt) throw new NotFoundError('project not found'); // soft-deleted → hidden
      return reply.send({ project });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/projects/:id',
    { config: rl(20) },
    async (req, reply) => {
      // The reserved global-library scope is not a real, deletable project.
      if (req.params.id === GLOBAL_SCOPE_ID) throw new NotFoundError('project not found');
      // A project may be deleted by its owner or a platform admin (both resolve to owner).
      const userId = await requireUserId(req);
      const role = await resolveProjectRole(db, userId, req.params.id);
      if (role !== 'owner') throw new ForbiddenError('insufficient role to delete this project');
      const project = await projects.get(req.params.id);
      if (project.deletedAt) throw new NotFoundError('project not found'); // already deleted
      // SOFT-delete (recoverable): the project leaves every member list, its routes + published site
      // 404, but ALL rows + on-disk artifacts are RETAINED so an instance admin can restore it. The
      // permanent REAP (rows + disk + orphaned client accounts) happens from the admin surface.
      await projects.softDelete(req.params.id, userId);
      // Drop the in-memory preview-build bookkeeping so a hidden project keeps no stale builds.
      previewBuiltVersion.delete(project.id);
      previewBuilds.delete(project.id);
      previewBuildFail.delete(project.id);
      previewPageFailures.delete(project.id);
      previewProgress.delete(project.id);
      return reply.code(204).send();
    },
  );

  // Rename a project's display NAME and/or its SLUG (owner-only). A slug change is a heavier operation:
  // media URLs embed the slug (`/media/<slug>/…`) in content AND on disk. We COPY the media to the new slug
  // dir FIRST (non-destructive — the old dir stays intact), then rewrite every content ref old→new, then
  // flip the project row, then remove the old dir. Copy-first is what keeps it recoverable: because the new
  // dir exists BEFORE any content points at it, no single-step failure ever 404s a media URL. A mid-flight
  // failure can leave a transient inconsistency (some refs rewritten / the row lagging the content), but both
  // dirs resolve so nothing breaks, and a retry heals it (already-rewritten items skip the `includes(from)`
  // guard). It is NOT a fully atomic operation — the row flip can still race a concurrent rename to the same
  // slug (that loser's rename() throws ConflictError; the copy/rewrite it did are orphaned + retryable).
  app.patch<{ Params: { id: string } }>('/projects/:id', { config: rl(20) }, async (req, reply) => {
    if (req.params.id === GLOBAL_SCOPE_ID) throw new NotFoundError('project not found');
    const userId = await requireUserId(req);
    const role = await resolveProjectRole(db, userId, req.params.id);
    if (role !== 'owner') throw new ForbiddenError('insufficient role to rename this project');
    const body = UpdateProjectBody.parse(req.body);
    const project = await projects.get(req.params.id);
    if (project.deletedAt) throw new NotFoundError('project not found');
    const ctx = { userId, projectId: project.id, role, actor: 'user' as const };
    const slugChanged = body.slug !== undefined && body.slug !== project.slug;
    // A slug rename touches THREE things — the media directory, every `/media/<slug>/` reference in the
    // project's content, and the project row itself. They must agree: a project whose slug says one thing
    // while its pages say another has every image broken, with no way for the owner to recover. So the two
    // DB mutations commit in ONE transaction, and the only step before it (the file copy) is one whose
    // failure leaves the database completely untouched.
    let updated: Awaited<ReturnType<ProjectRepository['rename']>>;
    if (slugChanged && body.slug) {
      const newSlug = body.slug;
      // ---- PREFLIGHT — every user-correctable failure is raised here, BEFORE anything is mutated.
      // A soft-deleted project still holds its slug until reaped; name that case so the owner has a path
      // to resolution. rename() re-checks inside the transaction, closing the race this pre-check leaves.
      const existing = await projects.getBySlug(newSlug).catch(() => null);
      if (existing) {
        throw new ConflictError(
          existing.deletedAt
            ? 'a deleted project is holding this slug — restore or permanently remove it first'
            : 'a project with this slug already exists',
        );
      }
      // Files first: the rewrite below repoints content at `/media/<newSlug>/`, so those files have to
      // exist by the time it commits. A failure here has touched no content and no project row.
      await mediaStorage?.copyProjectMedia(project.slug, newSlug);
      try {
        updated = await db.transaction(async (tx) => {
          const exec = tx as unknown as typeof db;
          await contentRepo.rewriteMediaSlug(ctx, project.slug, newSlug, exec);
          return projects.rename(project.id, { name: body.name, slug: newSlug }, exec);
        });
      } catch (err) {
        // The transaction rolled back, so the project is intact — but the copied directory is not part of
        // that rollback. Drop it, or a retry would find a populated target dir and the operator would be
        // left guessing whether the previous attempt half-succeeded.
        await mediaStorage
          ?.removeProject(newSlug)
          .catch((cleanupErr: unknown) => app.log.warn({ err: cleanupErr, project: project.id, slug: newSlug }, 'could not remove the copied media dir after a failed slug rename'));
        throw err;
      }
    } else {
      updated = await projects.rename(project.id, { name: body.name, slug: body.slug });
    }
    // Keep the on-site company name (identity.name) in sync with the display name.
    if (body.name && body.name !== project.name) {
      const settings = (await contentRepo.get(ctx, 'settings', 'settings').catch(() => null)) as { identity?: Record<string, unknown> } | null;
      if (settings) await contentRepo.put(ctx, 'settings', 'settings', { ...settings, identity: { ...(settings.identity ?? {}), name: body.name } }, { op: 'put', note: 'project rename' });
    }
    if (slugChanged) {
      await mediaStorage?.removeProject(project.slug).catch((err: unknown) => app.log.warn({ err, project: project.id }, 'old media dir cleanup after slug rename failed (orphaned, harmless)'));
      // The BUILT OUTPUT is keyed by slug too, and used to be left behind: the old directory kept a full
      // copy of the site under a slug nothing points at any more. It is unreachable (serving resolves the
      // project's CURRENT slug) but it is not harmless — it is a stale, unserved copy of a customer's
      // content sitting on disk indefinitely, and it accumulates one rename at a time. Measured on a real
      // instance: 46 published directories, 4 of them actually served, and 2 outliving their projects
      // entirely. Both artefacts are DERIVED and rebuild on the next publish, so dropping them costs
      // nothing; failures only warn, because a cleanup must never fail a rename that already committed.
      const staleSlug = project.slug;
      await publishStore
        ?.removeProject(staleSlug)
        .catch((err: unknown) => app.log.warn({ err, project: project.id, slug: staleSlug }, 'stale published site cleanup after slug rename failed (orphaned)'));
      await previewSiteStore
        ?.removeProject(staleSlug)
        .catch((err: unknown) => app.log.warn({ err, project: project.id, slug: staleSlug }, 'stale preview build cleanup after slug rename failed (orphaned)'));
      previewBuiltVersion.delete(project.id);
      previewBuilds.delete(project.id);
      previewProgress.delete(project.id);
      previewPageFailures.delete(project.id);
    }
    return reply.send({ project: updated });
  });

  /**
   * REAP a (soft-deleted) project: permanently delete its rows, then its on-disk artifacts, then any
   * CLIENT account left orphaned of every project (never staff). The row delete is the transactional
   * core; on-disk + orphaned-client cleanup is best-effort/post-commit (a failure there must not undo
   * the reap). The published site / preview build / media dirs are all keyed by the (immutable) slug.
   */
  async function reapProject(id: string): Promise<void> {
    if (id === GLOBAL_SCOPE_ID) throw new NotFoundError('project not found'); // never reap the global scope
    const project = await projects.get(id); // NotFound if absent
    const clientIds = await listProjectClientUserIds(db, id); // snapshot BEFORE membership rows go
    await projects.remove(id);
    const onCleanupError = (what: string) => (err: unknown) =>
      app.log.warn(
        { what, errCode: (err as NodeJS.ErrnoException).code, errMsg: err instanceof Error ? err.message : String(err) },
        'project asset cleanup failed on reap',
      );
    await publishStore?.removeProject(project.slug).catch(onCleanupError('publish'));
    await previewSiteStore?.removeProject(project.slug).catch(onCleanupError('preview'));
    await sourceRefStore?.removeProject(project.slug).catch(onCleanupError('source-refs'));
    previewBuiltVersion.delete(project.id);
    previewBuilds.delete(project.id);
    previewBuildFail.delete(project.id);
    previewPageFailures.delete(project.id);
    previewProgress.delete(project.id);
    await mediaStorage?.removeProject(project.slug).catch(onCleanupError('media'));
    await reapOrphanedClients(db, clientIds).catch(onCleanupError('orphan-clients'));
  }

  // ---- Project content (tenant + project scoped) ----
  type ContentParams = { projectId: string; kind: string; entityId: string };

  // The generic content routes are the incremental authoring API (editor saves,
  // MCP edits). Cap them tighter than the global 200/min — reads generously, writes
  // at 60/min (ample for interactive + agent editing; large imports use the dedicated
  // bundle endpoint, not per-entity PUTs). This bounds a compromised token's ability
  // to flood the site-wide settings (criticalCss/head/scripts) write.
  app.get<{
    Params: Pick<ContentParams, 'projectId' | 'kind'>;
    Querystring: { dataset?: string; summary?: string; limit?: string; offset?: string; q?: string };
  }>(
    '/projects/:projectId/content/:kind',
    { config: rlAgent(120) },
    async (req, reply) => {
      const { ctx, project: proj } = await resolveProject(req, 'content:read');
      const kind = parseGenericKind(req.params.kind);
      // `?q=` SEARCHES (case-insensitive substring over the id + the human-facing fields). Bounded:
      // a search term, not a document — an unbounded string is just a more expensive scan.
      const rawQ = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (rawQ.length > MAX_SEARCH_QUERY) return reply.code(400).send({ error: 'invalid `q` query parameter' });
      // An ENTRY id is unique only PER-dataset, so `?dataset=<slug>` scopes the list to one dataset's
      // rows. Validated against the slug charset; ignored for every other (project-global) kind.
      let scope: string | undefined;
      if (kind === 'entry' && req.query.dataset !== undefined) {
        const parsed = DatasetSlugSchema.safeParse(req.query.dataset);
        if (!parsed.success) return reply.code(400).send({ error: 'invalid `dataset` query parameter' });
        scope = parsed.data;
      }
      const filter = { ...(scope === undefined ? {} : { scope }), ...(rawQ ? { q: rawQ } : {}) };
      // `?limit=` PAGINATES. Opt-in, exactly like `?summary=1`: the unpaginated list is the shape
      // every existing caller expects, and silently truncating it would turn a memory problem into a
      // data problem. Measured on a 61-page project: one full list peaked 37 MB and three concurrent
      // peaked 206 MB, so a large project can exhaust a small container through ordinary editing.
      // A paginated caller reads a bounded slice and gets `total` back to walk the rest.
      const rawLimit = Number(req.query.limit);
      const paginate = Number.isFinite(rawLimit) && rawLimit > 0;
      // An UNPAGINATED list is the one path that can exhaust an instance through ordinary editing —
      // no gate, no bound, and every caller (File Manager, render, exports, fonts) uses it. Price it
      // from the stored bytes before reading any, and admit against the ledger like every other
      // expensive path. A paginated caller reads a bounded slice, so it needs no admission for what it
      // MATERIALISES.
      //
      // ★ A SEARCH is admitted even when paginated, because what it costs is not what it returns.
      // `?q=` has no index behind it: SQLite reads and `json_extract`s every row of the kind whatever
      // `limit` says, so `?q=a&limit=1` is a full scan wearing a cheap-looking request. Pricing it by
      // the SCANNED set (the filter WITHOUT `q`) puts it behind the same ledger as every other
      // expensive path, so concurrent searches queue and shed instead of competing for the one CPU
      // this single-container deployment has.
      const scanned = rawQ ? { ...filter, q: undefined } : filter;
      let listReservation: Reservation | undefined;
      if (!paginate || rawQ) {
        const estimate = await contentRepo.estimateListBytes(ctx, kind, scanned) * LIST_AMPLIFICATION;
        if (estimate > LIST_ADMIT_FLOOR_BYTES) listReservation = await admitMemory(estimate, `list ${kind}`);
      }
      try {
      const page = paginate
        ? await contentRepo.listPaged(ctx, kind, {
            limit: Math.min(rawLimit, CONTENT_PAGE_MAX),
            offset: Number(req.query.offset) || 0,
            ...filter,
          })
        : null;
      const items = page ? page.items : await contentRepo.list(ctx, kind, filter);
      // `?summary=1` drops the heavy BODY fields (a page's `source` + `data`, a template/snippet `source`,
      // an entry's `values`) and describes them instead. A full page list carries every page's Handlebars
      // source — 337 KB for a 22-page imported site, past the MCP tool-output ceiling — so listing the
      // pages of a real site was impossible without it. Opt-IN here (no change for existing callers); the
      // MCP `list_pages` tool opts in by default because `get_page` already exists for the body.
      const wantSummary = req.query.summary === '1' || req.query.summary === 'true';
      // Every PAGE carries the signed DRAFT-preview URL that shows it. Publishing is not the way to look at
      // a page — most projects have no deploy target, so there is no live URL at all (see hostingState) —
      // and an agent with no viewable address either guesses one or reports work it has never seen. The
      // signature is one HMAC for the whole list, composed with each page's own path.
      const previewBase = kind === 'page' ? (draftPreviewBase(proj.id) ?? '') : '';
      // byId comes from the RAW list (before any summarising) so the parent chain is always complete.
      const pageById = previewBase ? pagesById(items as Page[]) : undefined;
      // The RAW row decides, not the summarised one: summarizeContentList may drop `kind`, and a
      // `kind:"link"` nav placeholder must not be handed a URL (see pagePreviewUrl).
      const withPreview = (list: unknown[]): unknown[] =>
        previewBase && pageById
          ? list.map((it) => {
              if (!it || typeof it !== 'object') return it;
              const row = it as Record<string, unknown>;
              const raw = pageById.get(String(row.id));
              const url = raw ? pagePreviewUrl(previewBase, raw, pageById) : null;
              return url ? { ...row, previewUrl: url } : row;
            })
          : list;
      const project = (list: unknown[]): unknown[] =>
        withPreview(wantSummary ? summarizeContentList(kind, list) : list);
      // `page` is only set when the caller asked to paginate, so an existing caller's response shape
      // is byte-identical to before — the extra keys appear only for a caller that opted in.
      return reply.send(
        page
          ? { items: project(items), total: page.total, limit: page.limit, offset: page.offset }
          : { items: project(items) },
      );
      } finally {
        listReservation?.release();
      }
    },
  );

  app.get<{ Params: ContentParams; Querystring: { dataset?: string } }>(
    '/projects/:projectId/content/:kind/:entityId',
    { config: rlAgent(120) },
    async (req, reply) => {
      const { ctx, project: proj } = await resolveProject(req, 'content:read');
      const kind = parseGenericKind(req.params.kind);
      // An `entry` is keyed within its DATASET (its id is only unique per-dataset) — the owning dataset
      // arrives as `?dataset=`; it is required so the right dataset's entry is returned unambiguously.
      const scope = entryScope(kind, req.query.dataset, reply);
      if (scope === undefined) return reply; // 400 already sent
      const item = await contentRepo.get(ctx, kind, req.params.entityId, scope);
      // A page comes back with the signed DRAFT-preview URL that renders it — the reliable way to SEE a
      // page, and for a project with no deploy target the only one. Same base as the list route.
      if (kind === 'page' && item && typeof item === 'object') {
        const base = draftPreviewBase(proj.id);
        if (base) {
          // A CHILD page's route needs its ancestors, so read the page list only in that case — the common
          // top-level page resolves from a one-entry map with no extra query.
          const page = item as Page;
          const byId = page.parent
            ? pagesById((await contentRepo.list(ctx, 'page')) as Page[])
            : pagesById([page]);
          const previewUrl = pagePreviewUrl(base, page, byId);
          // null for a `kind:"link"` nav placeholder — omit the field rather than advertise the site root.
          if (previewUrl) return reply.send({ item, previewUrl });
        }
      }
      return reply.send({ item });
    },
  );

  /**
   * Gives a new ENTRY an `order` so a dataset built by writing rows comes out in the order it was written.
   *
   * ★ WHY (cost a real clone its list order twice over): entries sort by `order ?? +Infinity` with an id
   * tie-break (compareEntryOrder). That is right for the EDITOR, where drag-reorder stamps `order` on every
   * row — but an agent creating rows over the API sets no `order`, so every row ties at +Infinity and the
   * dataset renders ALPHABETICALLY BY ID. Certification badges came out Advisor→Partner→Silver and nine
   * client logos ran a-z; the author only noticed because badges are visually distinctive. A text list would
   * have shipped silently wrong. Documenting the field is not enough — the DEFAULT has to be right.
   *
   * Three cases, cheapest first:
   *  - UPDATE of an existing row → carry its current `order` when the body omits one, so a routine full
   *    replace (the shape put_content encourages) stops silently dropping a hand-dragged position.
   *  - CREATE into a dataset that already uses `order` → append after the highest.
   *  - CREATE into an entirely UNORDERED dataset → freeze the order it renders in TODAY onto the existing
   *    rows, then append. This fires once per legacy dataset; without it the new row would carry an order
   *    while its siblings stayed +Infinity, and a single append would jump to the front of the list.
   */
  async function assignEntryOrder(ctx: ProjectContext, entityId: string, body: unknown): Promise<unknown> {
    if (!body || typeof body !== 'object') return body;
    const incoming = body as { dataset?: unknown; order?: unknown };
    if (typeof incoming.order === 'number') return body; // explicit wins, always
    const dataset = typeof incoming.dataset === 'string' ? incoming.dataset : '';
    if (!dataset) return body; // no dataset → let the schema reject it with its own message
    const siblings = ((await contentRepo.list(ctx, 'entry')) as Entry[]).filter((e) => e.dataset === dataset);
    const existing = siblings.find((e) => e.id === entityId);
    if (existing) return typeof existing.order === 'number' ? { ...body, order: existing.order } : body;
    const ordered = siblings.filter((e) => typeof e.order === 'number');
    if (siblings.length === 0) return { ...body, order: nextOrderAfter([]) };
    if (ordered.length === 0) {
      // The dataset predates ordering entirely: give the existing rows a spaced scale first, so the
      // new entry has somewhere ABOVE them to land (and so the next drag has room between them).
      const sorted = [...siblings].sort(compareEntryOrder);
      const spaced = spacedOrders(sorted.length);
      for (const [i, row] of sorted.entries()) {
        await contentRepo.put(ctx, 'entry', row.id, { ...row, order: spaced[i] });
      }
      return { ...body, order: nextOrderAfter(spaced) };
    }
    // ★ `nextOrderAfter`, never `min(100_000, max + 1)`: `spacedOrders` starts at 65_536, so one
    // re-space puts every sibling past the old ceiling and a clamped append lands the new entry in the
    // MIDDLE of the dataset — silently, because 100_000 is still a valid order.
    return { ...body, order: nextOrderAfter(ordered.map((e) => e.order as number)) };
  }

  // ---- criticalCss PARTIAL write -------------------------------------------------------------
  // `website.criticalCss` is one string, and `?merge=1` deep-merges OBJECTS but replaces strings
  // wholesale — so changing one rule meant re-transmitting the whole stylesheet. Four clone agents
  // independently called this the most tedious mechanic of the job (counted: 6x ~5KB, 6x ~7KB,
  // 6x ~22KB, 11x ~19KB of pure re-send). A NAMED write is an upsert, so repeated edits to the same
  // rule replace in place instead of piling up copies; an unnamed one appends.
  app.post<{ Params: { projectId: string }; Body: { css?: unknown; block?: unknown } }>(
    '/projects/:projectId/critical-css',
    { bodyLimit: CONTENT_BODY_LIMIT, config: rlAgent(60) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:write');
      const css = typeof req.body?.css === 'string' ? req.body.css : null;
      if (css === null) {
        return reply.code(400).send({ error: 'css is required — a string of CSS (send "" with a block to remove that block)' });
      }
      const rawBlock = req.body?.block;
      const block = typeof rawBlock === 'string' && rawBlock !== '' ? rawBlock : undefined;
      if (block !== undefined && !CSS_BLOCK_NAME.test(block)) {
        return reply.code(400).send({
          error: `block "${block}" is not a valid name — letters, digits, "-" and "_", starting with a letter, max 49 chars`,
        });
      }
      const settings = (await contentRepo.get(ctx, 'settings', SETTINGS_ENTITY_ID)) as
        | { website?: { criticalCss?: string } }
        | null;
      if (!settings) return reply.code(404).send({ error: 'no settings to patch — write the full settings object first' });
      const before = settings.website?.criticalCss ?? '';
      const after = applyCriticalCssPatch(before, css, block);
      const next = { ...settings, website: { ...(settings.website ?? {}), criticalCss: after } };
      await contentRepo.put(ctx, 'settings', SETTINGS_ENTITY_ID, next);
      // A receipt, not the sheet: echoing it back is the very cost this route exists to avoid.
      return reply.send({
        block: block ?? null,
        bytes: after.length,
        bytesBefore: before.length,
        blocks: listCriticalCssBlocks(after),
        changed: after !== before,
      });
    },
  );

  app.put<{ Params: ContentParams; Querystring: { merge?: string; receipt?: string } }>(
    '/projects/:projectId/content/:kind/:entityId',
    { bodyLimit: CONTENT_BODY_LIMIT, config: rlAgent(60) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:write');
      const kind = parseGenericKind(req.params.kind);
      // `?receipt=1` returns a SHORT confirmation instead of echoing the stored entity back. A settings
      // write echoed ~9 KB of criticalCss + chrome slots + identity on EVERY call, including a one-field
      // `?merge=1` patch — measured at ~60 k tokens of pure echo across one clone. Opt-IN so the editor
      // (which re-hydrates from the response) is unaffected; the MCP tools opt in, since an agent that
      // wants the entity back can just call get_content.
      const wantReceipt = req.query.receipt === '1' || req.query.receipt === 'true';
      // The stored value BEFORE this write, loaded at most once and only when something needs it.
      let prior: unknown;
      let priorLoaded = false;
      const loadPrior = async (): Promise<unknown> => {
        if (!priorLoaded) {
          priorLoaded = true;
          // An ENTRY is stored under its dataset SLUG, not the project-global '' scope — read it the same
          // way `put` keys it (from the body), or the lookup misses and a receipt would report a CREATE
          // over an existing row. Merge and the swImport carry are settings/page only, so they are always ''.
          const scope = kind === 'entry' ? String((req.body as { dataset?: unknown } | null | undefined)?.dataset ?? '') : '';
          prior = await contentRepo.get(ctx, kind, req.params.entityId, scope).catch((err: unknown) => {
            if (err instanceof NotFoundError) return undefined;
            throw err;
          });
        }
        return prior;
      };
      // `?merge=1` PATCHES the existing entity instead of replacing it: the body is a FRAGMENT that is
      // deep-merged into the current value (siblings the fragment omits are kept). Enabled for the kinds
      // where a full replace from a stale/partial snapshot silently DESTROYS data:
      //   - `settings`, the big singleton (a partial write reverts every slot it omits), and
      //   - `page`, where sending {id, path, title, nav} to relabel a nav entry used to wipe `source`,
      //     `status`, `description`, `order`, `parent` AND `data.swImport` (the marker every fidelity
      //     tool requires) with no warning.
      // Other kinds are id-keyed rows small enough to resend whole, so a partial write there is rejected
      // rather than silently full-replacing. The merged result still goes through the schema in
      // contentRepo.put, so a bad patch fails exactly like a bad full write.
      const wantMerge = req.query.merge === '1' || req.query.merge === 'true';
      let body: unknown = req.body;
      if (wantMerge) {
        if (kind !== 'settings' && kind !== 'page') {
          return reply.code(400).send({ error: `merge (?merge=1) is only supported for the "settings" and "page" kinds, not "${kind}"` });
        }
        const current = (await loadPrior()) ?? null;
        // Merge needs a base. Settings are seeded on project create and can't be deleted, so that case is a
        // defensive guard; a page merge legitimately misses when the id is wrong or the page is new. Either
        // way return an ACTIONABLE 404 rather than letting a fragment fall through to a full write and fail
        // Zod with a bare "identity: Required" / "path: Required" the agent can't interpret.
        if (!current) {
          return reply.code(404).send({
            error:
              kind === 'settings'
                ? 'no settings to merge into — write the full settings object first (a plain PUT, without ?merge)'
                : `no page "${req.params.entityId}" to merge into — create it with a full write first (without ?merge)`,
          });
        }
        body = deepMerge(current, req.body);
      }
      validateSourceOnSave(req.params.kind, body); // fail fast on unsafe Handlebars source (in the MERGED body)
      // A full page REPLACE must not silently drop `data.swImport`. It is importer-owned PROVENANCE the
      // agent never authors, and every fidelity tool (visual_audit / clone_audit / compare_regions /
      // compare_to_source / fidelity_check) refuses to run without it — so one routine metadata write used
      // to make a cloned page permanently un-auditable with no warning. Carried over only when the incoming
      // body OMITS the key entirely; an explicit `data.swImport: null` still clears it (a page that is no
      // longer import-derived can say so).
      if (kind === 'page' && !wantMerge) {
        body = carryImportMarker((await loadPrior()) ?? null, body); // undefined → creating; nothing to carry
      }
      // A full (non-merge) write must carry `id`, and the path already says what it is. Requiring it in
      // the BODY as well is pure friction, and the failure was a bare `{"fieldErrors":{"id":["Required"]}}`
      // that names neither the id nor where it belongs — a caller converting a batch of pages read them,
      // edited them, wrote them back without the (path-implied) id, and got that on every one. Default it
      // from the path. An id that is PRESENT and wrong still conflicts in `entityKey`, so the mismatch
      // guard is untouched; the two path-keyed singletons have no `id` field at all and are skipped.
      if (!wantMerge && kind !== 'settings' && kind !== 'project_smtp' && kind !== 'project_captcha') {
        const b = body as Record<string, unknown> | null;
        if (b && typeof b === 'object' && !Array.isArray(b) && b.id === undefined) {
          body = { ...b, id: req.params.entityId };
        }
      }
      // Entries: fold FLAT field values into `values` before anything else looks at the body. Sending
      // them flat is the most common mistake against this API and it fails silently — unknown keys are
      // stripped, the row saves as values:{}, the write reports success, and the loop renders nothing.
      // Then give it a default `order` so write order == render order (see assignEntryOrder).
      if (kind === 'entry') body = normalizeEntryValues(body);
      if (kind === 'entry') body = await assignEntryOrder(ctx, req.params.entityId, body);
      // A receipt reports what actually CHANGED, so the prior value must be read before the write.
      if (wantReceipt) await loadPrior();
      const item = await contentRepo.put(ctx, kind, req.params.entityId, body);
      // Saving a page provisions any Widget it composes ({{> name}} → its declared datasets).
      if (kind === 'page') await ensureWidgetDatasets(contentRepo, ctx, (body as { source?: unknown }).source, app.log);
      if (wantReceipt) return reply.send(writeReceipt(kind, req.params.entityId, prior, item));
      return reply.send({ item });
    },
  );

  app.delete<{ Params: ContentParams; Querystring: { dataset?: string } }>(
    '/projects/:projectId/content/:kind/:entityId',
    { config: rlAgent(60) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:delete');
      const kind = parseGenericKind(req.params.kind);
      const scope = entryScope(kind, req.query.dataset, reply);
      if (scope === undefined) return reply; // 400 already sent (entry requires ?dataset=)
      await contentRepo.remove(ctx, kind, req.params.entityId, scope);
      return reply.code(204).send();
    },
  );

  // BULK delete — one call removes up to BULK_DELETE_MAX entities of one kind. Cleaning up after a
  // mechanical import (dozens of junk datasets/entries, a batch of scaffolded pages) meant one DELETE
  // per id: slow interactively, and for an agent a rate-limit wall that made "undo this import" cost
  // more turns than the import itself. POST (not DELETE-with-a-body) because a body on DELETE is
  // under-specified and our own client trips Fastify's empty-body check on it.
  //
  // PARTIAL SUCCESS is the contract: each id is attempted independently and the response reports both
  // lists, so one bad id (already gone, wrong dataset) can't abort the other 99. Deletes run
  // SEQUENTIALLY — `remove` writes a restore tombstone per entity, and serialising keeps that history
  // write ordered and the per-request DB work bounded.
  const BULK_DELETE_MAX = 200;
  /** Kinds that carry a sibling `order`. Nothing else has a position to change. */
  const REORDERABLE_KINDS: ReadonlySet<string> = new Set(['page', 'entry']);
  /** Upper bound on one reorder batch — a whole re-spaced group, not a bulk-edit channel. */
  const REORDER_MAX = 5000;
  const ReorderBody = z.object({
    items: z
      .array(z.object({ id: z.string().min(1).max(200), order: OrderSchema }))
      .min(1)
      .max(REORDER_MAX),
    /** Required when kind is `entry` — entry ids are unique only within their dataset. */
    dataset: z.string().optional(),
  });
  /**
   * Rewrite the sibling order of many entities at once.
   *
   * ★ Reordering was one PUT per moved sibling, and a dense 0..n reindex rewrites everything after the
   * moved item — ~700 PUTs for one drag in an 831-page group, against this route family's own 60/min
   * limit. It 429s partway and leaves the group in an order nobody chose. With midpoint insertion the
   * ordinary move is a single PUT and never comes here; this endpoint serves the two cases that really
   * do touch many rows: re-spacing a group whose gap ran out, and applying an explicit order.
   */
  app.post<{ Params: Pick<ContentParams, 'projectId' | 'kind'> }>(
    '/projects/:projectId/content/:kind/reorder',
    // ★ `rl(20)`, NOT `rlAgent(…)`. rlAgent LIFTS the ceiling to 600/min for an API key, and this is a
    // batch write on the ONE shared SQLite writer — the same reasoning that puts the bundle import and
    // the locale fan-out on the flat limit. A tight agent loop of full-group re-spaces would stall
    // writes for every other tenant on the instance.
    { config: rl(20) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:write');
      const kind = parseGenericKind(req.params.kind);
      if (!REORDERABLE_KINDS.has(kind)) {
        return reply.code(400).send({ error: `${kind} has no sibling order` });
      }
      const parsed = ReorderBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid request', details: parsed.error.flatten() });
      const scope = entryScope(kind, parsed.data.dataset, reply);
      if (scope === undefined) return reply; // 400 already sent (entry requires a dataset)
      const updated = await contentRepo.reorder(ctx, kind, scope, parsed.data.items);
      return reply.send({ updated });
    },
  );

  const BulkDeleteBody = z.object({
    ids: z.array(z.string().min(1).max(200)).min(1).max(BULK_DELETE_MAX),
    /** Required when kind is `entry` — entry ids are unique only within their dataset. */
    dataset: z.string().optional(),
  });
  app.post<{ Params: Pick<ContentParams, 'projectId' | 'kind'> }>(
    '/projects/:projectId/content/:kind/bulk-delete',
    { config: rlAgent(30) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:delete');
      const kind = parseGenericKind(req.params.kind);
      const body = BulkDeleteBody.parse(req.body);
      const scope = entryScope(kind, body.dataset, reply);
      if (scope === undefined) return reply; // 400 already sent (entry requires a dataset)
      // Duplicates would double-count `deleted` and report a phantom not-found on the second pass.
      const ids = [...new Set(body.ids)];
      const deleted: string[] = [];
      const failed: Array<{ id: string; error: string }> = [];
      for (const id of ids) {
        try {
          await contentRepo.remove(ctx, kind, id, scope);
          deleted.push(id);
        } catch (err) {
          // Only DOMAIN errors carry a message meant for a caller ("page not found", "the settings
          // singleton cannot be deleted") — the same allowlist the global error handler applies. An
          // unexpected failure is LOGGED and reported generically, so a DB/driver message (table and
          // column names, constraint text) can't ride out through a per-id report.
          const domain = err instanceof NotFoundError || err instanceof ForbiddenError || err instanceof ConflictError;
          if (!domain) req.log.error({ err, kind, entityId: id }, 'bulk delete failed');
          failed.push({ id, error: domain ? (err as Error).message : 'delete failed' });
        }
      }
      return reply.send({ deleted, failed, requested: ids.length });
    },
  );

  // Rename a dataset's SLUG. Its ENTRIES always move with it (they are owned, not referencing — an entry
  // left on the old slug is unreachable, not "dangling"). `cascade` (default ON) additionally rewrites
  // EXTERNAL refs: page/template `dataset.<slug>` sources + other datasets' reference targets, so loops
  // don't break. `cascade:false` is the editor's "leave page/template references" escape hatch, for an
  // author who wants to fix their own markup — it can no longer strand entries. content:write (edits pages).
  const RenameDatasetBody = z.object({ slug: DatasetSlugSchema, name: z.string().min(1).max(200).optional(), cascade: z.boolean().default(true) });
  app.post<{ Params: { projectId: string; id: string } }>(
    '/projects/:projectId/datasets/:id/rename',
    { config: rl(20) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:write');
      const body = RenameDatasetBody.parse(req.body);
      return reply.send(await contentRepo.renameDataset(ctx, req.params.id, body.slug, { cascade: body.cascade, name: body.name }));
    },
  );

  // ---- Global snippet/template library (instance-wide; admin-managed, readable by everyone) ----
  // Stored as content under the reserved GLOBAL_SCOPE_ID and merged BELOW each project's own
  // snippets/templates at render. READS are open to any authenticated session (the editor lists +
  // uses them); WRITES/DELETES require an instance admin. Project users manage only their OWN
  // snippets/templates via the per-project content routes above.
  app.get<{ Params: { kind: string } }>('/global/:kind', { config: rl(120) }, async (req, reply) => {
    await requireUserId(req);
    return reply.send({ items: await contentRepo.list(globalCtx(), parseLibraryKind(req.params.kind)) });
  });

  app.put<{ Params: { kind: string; entityId: string } }>(
    '/admin/global/:kind/:entityId',
    { bodyLimit: CONTENT_BODY_LIMIT, config: rl(60) },
    async (req, reply) => {
      const userId = await requireInstanceAdmin(req);
      validateSourceOnSave(req.params.kind, req.body); // global snippets/templates: same save-time gate
      const item = await contentRepo.put(globalCtx(userId), parseLibraryKind(req.params.kind), req.params.entityId, req.body);
      return reply.send({ item });
    },
  );

  app.delete<{ Params: { kind: string; entityId: string } }>(
    '/admin/global/:kind/:entityId',
    { config: rl(60) },
    async (req, reply) => {
      const userId = await requireInstanceAdmin(req);
      await contentRepo.remove(globalCtx(userId), parseLibraryKind(req.params.kind), req.params.entityId);
      return reply.code(204).send();
    },
  );

  // ---- Project API keys (bearer tokens for the CLI / MCP bridge) ----
  // Management is `session-only`: a token can never mint, list, or revoke tokens
  // (no self-escalation / persistence). Owner/admin only (enforced by the repo).
  app.post<{ Params: { projectId: string } }>(
    '/projects/:projectId/api-keys',
    { config: rl(20) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'session-only');
      const body = CreateApiKeyBody.parse(req.body);
      const expiresAt = new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000);
      const { token, key } = await apiKeysRepo.create(ctx, {
        name: body.name,
        role: body.role,
        capabilities: body.capabilities,
        expiresAt,
      });
      // `token` is the ONLY time the raw secret is returned — clients store it now.
      return reply.code(201).send({ token, key });
    },
  );

  // Referential-integrity report for the project's content — rows that exist but cannot be reached
  // (orphaned entries, scope/dataset disagreement, stranded entry history). READ-ONLY: it never
  // repairs anything, because "unreachable" is not always "unwanted" and the operator should decide.
  // The write paths that could orphan a row are closed and guarded in code; this catches drift those
  // guards cannot see — a hand-edited database, a restored backup, a future migration.
  app.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/integrity',
    { config: rl(30) },
    async (req, reply) => {
      const { project } = await resolveProject(req, 'content:read');
      return reply.send(await checkProjectIntegrity(db, project.id));
    },
  );

  app.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/api-keys',
    { config: rl(30) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'session-only');
      // `apiKeysRepo.list` is itself writer-gated; this is the fast-fail path.
      return reply.send({ items: await apiKeysRepo.list(ctx) });
    },
  );

  app.delete<{ Params: { projectId: string; id: string } }>(
    '/projects/:projectId/api-keys/:id',
    { config: rl(20) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'session-only');
      const { source, createdBy } = await apiKeysRepo.revoke(ctx, req.params.id);
      // Disconnecting an OAuth/MCP agent: revoking the access token alone leaves its refresh token
      // able to mint a new one — also sever the whole refresh chain for that user+project.
      if (source === 'oauth') await oauthRepo.revokeAllForUserProject(createdBy, ctx.projectId);
      return reply.code(204).send();
    },
  );

  // Active agent connections for the editor's "AI agent details" modal + header indicator: active
  // PATs PLUS live OAuth/MCP sessions (one row per connected user, shown for the whole session
  // window — not just while a 1h access token is valid). The OAuth connection id is the opaque
  // `oauth:<userId>` handle used by the disconnect route below.
  app.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/agent-connections',
    { config: rl(60) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'session-only');
      // Owner-only — gate at the route so it doesn't rely on listAgentConnections throwing first.
      if (ctx.role !== 'owner') throw new ForbiddenError('only the project owner can view agent connections');
      const [pats, sessions] = await Promise.all([
        apiKeysRepo.listAgentConnections(ctx),
        oauthRepo.listActiveSessions(ctx.projectId),
      ]);
      const items = [
        ...sessions.map((s) => ({
          id: `oauth:${s.userId}`,
          kind: 'oauth' as const,
          name: s.clientId,
          role: s.role,
          capabilities: s.capabilities,
          connectedAt: s.connectedAt,
          expiresAt: s.expiresAt,
          lastUsedAt: s.lastUsedAt,
        })),
        ...pats.map((k) => ({
          id: k.id,
          kind: 'pat' as const,
          name: k.name,
          role: k.role,
          capabilities: k.capabilities,
          connectedAt: k.createdAt,
          expiresAt: k.expiresAt,
          lastUsedAt: k.lastUsedAt,
        })),
      ].sort(
        (a, b) =>
          (b.lastUsedAt?.getTime() ?? 0) - (a.lastUsedAt?.getTime() ?? 0) ||
          b.connectedAt.getTime() - a.connectedAt.getTime(),
      );
      return reply.send({ items });
    },
  );

  // Disconnect one agent connection. An `oauth:<userId>` id fully severs that user's OAuth sessions
  // for THIS project (refresh chain + in-flight access tokens); any other id is a PAT key revoke
  // (still severs the chain if it happens to be an OAuth access key). Project-scoped + owner-gated
  // via resolveProject: the userId is confined to ctx.projectId, so it can't reach another project.
  app.delete<{ Params: { projectId: string; id: string } }>(
    '/projects/:projectId/agent-connections/:id',
    { config: rl(20) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'session-only');
      // Owner-only. The PAT path enforces this inside apiKeysRepo.revoke, but the oauth: path calls
      // revokeAllForUserProject directly (no role guard), so gate both here.
      if (ctx.role !== 'owner') throw new ForbiddenError('only the project owner can disconnect agents');
      const id = req.params.id;
      if (id.startsWith('oauth:')) {
        // An OAuth/MCP session: sever the whole chain + in-flight access tokens for that user+project.
        await oauthRepo.revokeAllForUserProject(id.slice('oauth:'.length), ctx.projectId);
      } else {
        // Otherwise a personal token (the only other connection kind this list emits).
        await apiKeysRepo.revoke(ctx, id);
      }
      return reply.code(204).send();
    },
  );

  // ---- OAuth 2.1 (issues the same scoped tokens; for the CLI / hosted MCP clients) ----
  registerOAuthRoutes(app, { db, oauth: oauthRepo, clients: oauthClients, projects, currentUserId, instanceSettings: instanceSettingsRepo, publicUrl: opts.publicUrl, rl });
  // Remote MCP transport (Streamable HTTP) for hosted clients (ChatGPT/claude.ai), authenticated by
  // the same OAuth bearer tokens; reuses the REST routes in-process. See mcp-routes.ts.
  registerMcpRoutes(app, { rl, rlAgent, publicUrl: opts.publicUrl });

  app.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/export',
    async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:read');
      return reply.send(await contentRepo.exportBundle(ctx, project));
    },
  );

  // Whole-project export as a self-contained zip: manifest.json + the complete
  // bundle.json + every media binary under media/<assetId>/…. The archive is
  // STREAMED to a temp file (never buffered whole — see build-zip.ts) then streamed
  // to the client, so memory stays flat regardless of project/media size. Any
  // project member (content:read) may export; secrets are never included.
  app.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/export.zip',
    { config: rl(5) },
    async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:read');
      if (activeExports >= MAX_CONCURRENT_EXPORTS) {
        return reply.code(429).send({ error: 'too many project exports in progress; retry shortly' });
      }
      const bundle = await contentRepo.assembleExportBundle(ctx, project);
      // Fail loudly if any section is past its (import-side) cap — better than shipping a backup
      // that can't be re-imported.
      const over = exportBundleOverCap(bundle);
      if (over) {
        return reply.code(413).send({ error: `project is too large to export: ${over}` });
      }
      const maxBytes = opts.exportMaxBytes ?? PROJECT_EXPORT_MAX_BYTES;

      activeExports += 1;
      let zip: Awaited<ReturnType<typeof buildProjectExportZip>>;
      try {
        // Ship each image asset's retained ORIGINAL only — its on-demand thumbnail cache (written
        // into the same asset dir by the media serve route) is regenerable, so skipping it keeps the
        // archive minimal + deterministic (independent of how often the site has been previewed).
        const thumbSkip = buildThumbSkipMap(bundle.media);
        const media = mediaStorage
          ? await collectExportMedia(
              (assetId) => mediaStorage.assetFilePaths(project.slug, assetId, thumbSkip.get(assetId)),
              bundle.media.map((asset) => asset.id),
            )
          : [];
        const manifest = buildExportManifest(project, bundle, opts.version);
        zip = await buildProjectExportZip({ manifest, bundle, media, maxBytes });
      } catch (err) {
        if (err instanceof ExportSizeLimitError) {
          return reply.code(413).send({ error: 'project export exceeds the archive size limit' });
        }
        throw err;
      } finally {
        activeExports -= 1; // the disk/CPU-heavy build is done; streaming holds no slot
      }

      // If the client already vanished during the build, drop the temp dir now (the 'close'
      // listener would otherwise never fire). Otherwise clean up when the socket closes.
      if (reply.raw.destroyed) {
        await zip.cleanup();
        return reply;
      }
      reply.raw.on('close', () => {
        void zip.cleanup();
      });
      return reply
        .header('content-disposition', `attachment; filename="${project.slug}-export.zip"`)
        .header('content-length', String(zip.bytes))
        .type('application/zip')
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- private mkdtemp archive path
        .send(createReadStream(zip.path));
    },
  );

  // Import a project export zip as a BRAND-NEW project (staff-only, same gate as creating one).
  // Non-destructive: never touches an existing project. Entity ids are preserved inside the fresh
  // project; only the slug is deduped and media URLs rewritten to match. SSE-streamed progress.
  app.post('/projects/import/zip', { config: rl(10) }, async (req, reply) => {
    const userId = await requirePlatformStaff(req); // 403 unless admin/developer; rejects bearer tokens
    if (!mediaStorage) {
      return reply.code(400).send({ error: 'media storage is not configured on this instance' });
    }
    if (activeProjectImports >= MAX_CONCURRENT_PROJECT_IMPORTS) {
      return reply.code(429).send({ error: 'too many imports in progress; retry shortly' });
    }
    // Claim the slot SYNCHRONOUSLY (atomic with the check above — no await intervenes), so two
    // uploads racing through the multi-second file read can't both slip past a stale count. The
    // single outer finally releases it on every path (early 4xx or the SSE stream).
    activeProjectImports += 1;
    const storage = mediaStorage;
    try {
      let buffer: Buffer;
      try {
        const file = await req.file({ limits: { fileSize: PROJECT_IMPORT_UPLOAD_MAX_BYTES, files: 1 } });
        if (!file) return reply.code(400).send({ error: 'no file uploaded' });
        buffer = await file.toBuffer();
        if (file.file.truncated) return reply.code(413).send({ error: 'file exceeds the upload size limit' });
      } catch (err) {
        if (err instanceof Error && /file too large|maxFileSize|request file too large/i.test(err.message)) {
          return reply.code(413).send({ error: 'file exceeds the upload size limit' });
        }
        return reply.code(400).send({ error: 'expected a multipart file upload' });
      }

      // Validate the archive BEFORE hijacking the reply for SSE, so a bad zip is a clean 400.
      let parsed: Awaited<ReturnType<typeof readProjectZip>>;
      try {
        parsed = await readProjectZip(buffer, DEFAULT_PROJECT_ZIP_LIMITS);
      } catch (err) {
        if (err instanceof UploadError) return reply.code(400).send({ error: err.message });
        throw err;
      }

      // The import runs to completion server-side even if the client disconnects mid-stream (a
      // partial project is worse than a finished one) — unlike the abortable website-import crawl.
      await streamImport(
        reply,
        async (onProgress) => {
          const { manifest, bundle } = parsed;
          onProgress({ phase: 'validate', detail: 'project bundle validated' });
          const newSlug = await projects.availableSlug(bundle.project.slug);
          const rewritten = rewriteMediaSlug(bundle, manifest.mediaSlug, newSlug);
          // Every media reference must now be THIS project's — reject a crafted bundle that points
          // at another tenant's `/media/<otherSlug>/…` (the rewrite only touches the manifest slug).
          for (const asset of rewritten.media) {
            if (!asset.url.startsWith(`/media/${newSlug}/`)) {
              throw new ConflictError('bundle references media outside this project');
            }
          }
          const newName = (bundle.project.name || manifest.source.name || newSlug).slice(0, 200);
          onProgress({ phase: 'allocate', detail: `creating project “${newName}”` });
          const project = await projects.create({ name: newName, slug: newSlug }, userId);
          try {
            const ownerCtx = { userId, projectId: project.id, role: 'owner' as const, actor: 'user' as const };
            onProgress({ phase: 'content', detail: 'importing content' });
            const { imported } = await contentRepo.importBundle(ownerCtx, project, rewritten);
            onProgress({ phase: 'media', detail: 'restoring media' });
            const media = await extractProjectMedia(
              parsed.zip,
              storage,
              newSlug,
              DEFAULT_PROJECT_ZIP_LIMITS,
              (done, total) => onProgress({ phase: 'media', detail: `media ${done}/${total}` }),
            );
            return { projectId: project.id, slug: newSlug, name: newName, imported, media };
          } catch (err) {
            // Roll back the half-built project so a failed import leaves nothing behind.
            await projects.remove(project.id).catch((e) => req.log.warn({ err: e }, 'import rollback failed'));
            await storage.removeProject(newSlug).catch((e) => req.log.warn({ err: e }, 'import media rollback failed'));
            throw err;
          }
        },
        { op: 'project-import' },
        req.log,
        'import failed: could not restore the project',
      );
    } finally {
      activeProjectImports -= 1;
    }
  });

  // Duplicate a project in-instance (staff-only): assemble the source's export bundle, mint a new
  // project, import the bundle, and copy the media tree. Reuses the export/import core end to end.
  app.post<{ Params: { projectId: string } }>(
    '/projects/:projectId/duplicate',
    { config: rl(10) },
    async (req, reply) => {
      const userId = await requirePlatformStaff(req);
      const role = await resolveProjectRole(db, userId, req.params.projectId);
      if (!role) throw new ForbiddenError('you do not have access to this project');
      if (activeProjectImports >= MAX_CONCURRENT_PROJECT_IMPORTS) {
        return reply.code(429).send({ error: 'too many operations in progress; retry shortly' });
      }
      activeProjectImports += 1; // claim the slot synchronously (atomic with the check above)
      try {
        const source = await projects.get(req.params.projectId);
        if (source.deletedAt) throw new NotFoundError('project not found');
        const srcCtx = { userId, projectId: source.id, role, actor: 'user' as const };
        const bundle = await contentRepo.assembleExportBundle(srcCtx, source);
        const newSlug = await projects.availableSlug(source.slug);
        const newName = `${source.name} (copy)`.slice(0, 200);
        const project = await projects.create({ name: newName, slug: newSlug }, userId);
        try {
          const ownerCtx = { userId, projectId: project.id, role: 'owner' as const, actor: 'user' as const };
          await contentRepo.importBundle(ownerCtx, project, rewriteMediaSlug(bundle, source.slug, newSlug));
          if (mediaStorage) await mediaStorage.copyProjectMedia(source.slug, newSlug);
          return reply.code(201).send({ project: { ...project, role: 'owner' as const } });
        } catch (err) {
          await projects.remove(project.id).catch((e) => req.log.warn({ err: e }, 'duplicate rollback failed'));
          if (mediaStorage) {
            await mediaStorage.removeProject(newSlug).catch((e) => req.log.warn({ err: e }, 'duplicate media rollback failed'));
          }
          throw err;
        }
      } finally {
        activeProjectImports -= 1;
      }
    },
  );

  app.post<{ Params: { projectId: string } }>(
    '/projects/:projectId/import',
    { bodyLimit: IMPORT_BODY_LIMIT, config: rl(20) },
    async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:write');
      return reply.send(await contentRepo.importBundle(ctx, project, req.body));
    },
  );

  // Live SSR preview of a draft page. Renders an in-flight (possibly unsaved)
  // page tree to a full, brand-themed, self-contained HTML document using the
  // shared pure renderer. Tenant-scoped; any project member may preview.
  app.post<{ Params: { projectId: string } }>(
    '/projects/:projectId/preview',
    { bodyLimit: PREVIEW_BODY_LIMIT, config: rlAgent(120) },
    async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:read');
      // RENDER THE STORED PAGE when the caller sends only an id. The route used to render exactly the
      // object it was handed, so `{ id, path, title }` produced an EMPTY page — an agent asking "show me
      // this page" got a screenshot of just the header and footer and had to fall back to the far heavier
      // visual_audit. The tool description already implied a fallback ("possibly unsaved"); now there is
      // one. A body carrying `source` still renders verbatim, so previewing an UNSAVED draft is unchanged.
      const rawBody = (req.body ?? {}) as Record<string, unknown>;
      const bodyIsStub =
        typeof rawBody.id === 'string' && rawBody.source === undefined && rawBody.root === undefined;
      // The lookup is a FALLBACK, not a precondition: a stub naming a page that doesn't exist must still
      // fail validation as a malformed page (400), not escape as a 404 from the repo. Only a stub that
      // resolves to a real stored page gets merged.
      let stored: object | null = null;
      if (bodyIsStub) {
        stored = ((await contentRepo.get(ctx, 'page', rawBody.id as string).catch(() => null)) as object) ?? null;
      }
      const page = PageSchema.parse(stored ? { ...stored, ...rawBody } : req.body);

      // UNSAVED CHROME SLOTS (the skeleton-slot editor). Slots otherwise come from the SAVED settings,
      // so a slot editor could only ever preview what was last written — typing would show nothing. The
      // override rides ALONGSIDE the page (PageSchema.parse drops unknown keys, so every existing caller
      // is unaffected) and goes through the SAME gate a settings save runs, so a preview can never render
      // chrome the save itself would reject.
      const rawSlots = rawBody.slots;
      let slotOverrides: Record<string, string> | undefined;
      if (rawSlots && typeof rawSlots === 'object') {
        const picked: Record<string, string> = {};
        for (const [slot] of CHROME_HTML_SLOTS) {
          const v = (rawSlots as Record<string, unknown>)[slot];
          // Only the KNOWN slot names, only strings — never a passthrough of arbitrary website settings.
          if (typeof v === 'string' && v.length <= SLOT_MAX) picked[slot] = v;
        }
        if (Object.keys(picked).length > 0) {
          validateSourceOnSave('settings', { website: picked }); // TemplateError → 400, same as saving
          slotOverrides = picked;
        }
      }

      // Brand tokens come from the saved Corporate Identity singleton; fall back to
      // the project name with default tokens when settings aren't configured yet.
      let brand: CorporateIdentity = { name: project.name, colors: {} };
      let website: Settings['website'];
      // Drives per-locale nav + dataset resolution in the preview (WYSIWYG parity
      // with publish): a previewed page's nav lists only its own language's pages.
      let defaultLocale = 'en';
      try {
        const settings = (await contentRepo.get(ctx, 'settings', SETTINGS_ENTITY_ID)) as Settings;
        brand = settings.identity;
        website = settings.website;
        defaultLocale = settings.settings?.defaultLocale ?? 'en';
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err;
      }
      // The draft slot wins over the saved one — and applies even with no settings entity yet, so a
      // brand-new project can still preview the chrome it is being given.
      if (slotOverrides) website = { ...(website ?? {}), ...slotOverrides } as Settings['website'];

      // Group saved entries by dataset for binding resolution. Drafts are shown
      // in the preview (unlike a published build) so authors see work-in-progress.
      const entries = (await contentRepo.list(ctx, 'entry')) as Entry[];
      const byDataset = new Map<string, Entry[]>();
      for (const entry of entries) {
        byDataset.set(entry.dataset, [...(byDataset.get(entry.dataset) ?? []), entry]);
      }
      // Honor the drag-reorder `order` so the preview's {{#each}} + bindings match the editor + publish.
      for (const list of byDataset.values()) list.sort(compareEntryOrder);

      // A code-first (`source` or template-referencing) page previews through the isolated
      // worker — with the page's client-edited region content — then through the shared
      // styled-document shell. This is the member-accessible preview the client content
      // editor uses (render-template is owner-only), so the same token/sandbox flow as
      // block pages applies below.
      // Saved pages (incl. drafts) — used both to resolve INHERITED code (a locale variant
      // with no own source/template follows its translation-group owner's) and, below, for
      // the per-locale nav / translations / parent views.
      const allSavedPages = (await contentRepo.list(ctx, 'page')) as Page[];
      // Project media, listed once per preview: the FULL list powers optimized <picture> below; the
      // SLIM projection (renderMedia) feeds {{#sw-folder}} galleries in the page render + the slots.
      const media = mediaStorage ? ((await contentRepo.list(ctx, 'media')) as MediaAsset[]) : [];
      const renderMedia = mediaForRender(media);
      // Bound the slim media against the same IPC ceiling as data/children/parent (it rides the same
      // worker payload). Slim entries are tiny, so only a pathological asset count would trip this.
      if (JSON.stringify(renderMedia).length > 4 * 1024 * 1024) {
        return reply.code(413).send({ error: 'project media is too large to render' });
      }
      // Every page previews through the worker from its Handlebars `source` (or its referenced
      // template's). An inherit-mode locale variant resolves its translation-group owner's code and
      // supplies only its own page.data (the main language's layout, its translated content); a
      // source-less page renders an empty body in the same shell.
      const codeRef = resolveCodeRef(page, allSavedPages, defaultLocale);
      // A template reference resolves to the TEMPLATE's source (built-in global or
      // project entity); the page contributes only its page.data content. Resolved
      // BEFORE the pool guard — an unknown reference is a client error (400)
      // regardless of whether rendering infrastructure is up.
      let pageSource = codeRef.source ?? '';
      if (codeRef.template) {
        const projectTemplates = isGlobalTemplate(codeRef.template)
          ? []
          : ((await contentRepo.list(ctx, 'template')) as Template[]);
        const globals = isGlobalTemplate(codeRef.template) ? globalTemplateMap(await listGlobalTemplates(contentRepo)) : undefined;
        try {
          pageSource = resolveTemplateSource(codeRef.template, new Map(projectTemplates.map((t) => [t.id, t])), globals);
        } catch {
          return reply.code(400).send({ error: `unknown template "${codeRef.template}"` });
        }
      }
      if (!renderPool) return reply.code(503).send({ error: 'rendering is not available' });
      // Built-in global snippets + the project's own (project wins on a name collision), then the
      // MANAGED Widget bodies LAST so a widget name is effectively reserved — no project/global
      // snippet can shadow the system widget. The preview's CSS is extracted from the RENDERED
      // output, so unused globals/widgets add no weight here.
      const partials = {
        ...(await globalSnippetPartials(contentRepo)),
        ...Object.fromEntries(((await contentRepo.list(ctx, 'snippet')) as Snippet[]).map((s) => [s.name, s.source])),
        ...WIDGET_PARTIALS,
      };
      const sourceData = Object.fromEntries(byDataset);
      // A `page` field stores an id; a template needs the page's attributes ({{link.path}} /
      // {{link.title}}). Resolved HERE and in the publish build — both surfaces, one resolver, or the
      // loop renders correctly in the editor and blank on the published site.
      const localeData = resolveDatasetPageRefs(
        resolveLocaleDatasets(sourceData, page.locale),
        (await contentRepo.list(ctx, 'dataset')) as Dataset[],
        allSavedPages,
        defaultLocale,
      );
      // Keyed entry access ({{item.<dataset>.<id>.<field>}}) — built only for datasets this source
      // addresses by key, so a looping-only page pays nothing.
      const item = keyedDatasets(pageSource, localeData);
      // Public form definitions + same-origin `/f/<projectId>/<formId>` endpoints for the form
      // embed ({{sw-form}} / data-sw-form) — parity with publish, which precomputes
      // publicBaseUrl-absolute endpoints. The hCaptcha sitekey upgrades opted-in forms' widgets.
      const previewForms = resolveFormEndpoints(
        Object.fromEntries(((await contentRepo.list(ctx, 'form')) as Form[]).map((f) => [f.id, toPublicForm(f)])),
        // …pointed at the DRY RUN: a preview validates like the real endpoint and then stores/sends
        // nothing, so testing a form never mails the merchant a lead that does not exist.
        (fid) => `/f/${project.id}/${fid}/preview`,
      );
      // The captcha config only matters for a captcha-flagged form — skip the extra read (this is a
      // per-preview hot path) for the overwhelmingly common case of none.
      const previewCaptcha = Object.values(previewForms).some((f) => f.captcha)
        ? captchaRenderConfig(await loadProjectCaptchaById(db, project.id))
        : undefined;
      // Stored image maps for {{sw-imagemap}} / data-sw-imagemap — the same shape the publish path
      // builds in build.ts. WITHOUT this key the helper renders '' (its "this surface has no image
      // maps" contract), so an authored map came out as NOTHING in the preview with no error at all.
      //
      // Gated on the source mentioning image maps, because a materialised template config runs to
      // hundreds of KB and this is the per-keystroke preview path — a page that embeds none must not
      // pay for the read. Once one IS mentioned, ALL of the project's maps load: the id can come from
      // a variable, so the set of referenced ids is not statically knowable.
      const mapScan = [pageSource, ...Object.values(partials), website?.mainNav, website?.sidebarLeft, website?.sidebarRight, website?.footer, website?.bottom]
        .filter((s): s is string => typeof s === 'string')
        .join('\n');
      const previewImageMaps = mapScan.includes('sw-imagemap')
        ? Object.fromEntries(
            ((await contentRepo.list(ctx, 'imagemap')) as ImageMap[]).map((m) => [
              m.id,
              { id: m.id, config: m as unknown as Record<string, unknown> },
            ]),
          )
        : undefined;
      // Bound the IPC payload serialized in THIS (parent) process — a large dataset/partial/form
      // set (incl. the keyed `item` map) must not spike the API's heap (only the worker carries a
      // memory ceiling). Mirrors the owner render-template guard.
      if (
        JSON.stringify(localeData).length +
          JSON.stringify(item).length +
          JSON.stringify(partials).length +
          JSON.stringify(previewForms).length +
          // Image maps count too: a template-derived config is hundreds of KB, and several of them
          // would spike this process's heap on the way into the worker.
          (previewImageMaps ? JSON.stringify(previewImageMaps).length : 0) >
        4 * 1024 * 1024
      ) {
        return reply.code(413).send({ error: 'project data is too large to render' });
      }
      try {
        // WYSIWYG parity with publish (drafts excluded, like publish): the previewed
        // page's auto-nav lists ONLY its own language's pages, its bindings resolve to
        // the locale dataset variant (`<name>-<locale>`), and `page.locale` /
        // `page.translations` power a language switcher. `json_data` is NOT fetched in
        // preview (no network per keystroke) — `{{ website.json_data }}` renders empty
        // until publish.
        const savedPages = publishedPages(allSavedPages);
        const previewLocale = localeOf(page, defaultLocale);
        const navPages = pagesInLocale(savedPages, previewLocale, defaultLocale);
        const slotNav = decorateNav({
          header: buildNav(navPages, 'header'),
          footer: buildNav(navPages, 'footer'),
          mobile: buildNav(navPages, 'mobile'),
          // Author-only slot the default chrome never reads — exposed for {{#each nav.custom}}.
          custom: buildNav(navPages, 'custom'),
        });
        // The page's FULL route is computed from the parent chain; include the (possibly
        // unsaved/edited) previewed page in the index so its own slug/parent apply.
        const previewById = pagesById(savedPages);
        previewById.set(page.id, page);
        // This page's child pages, flattened — built only when the source loops them. From
        // `savedPages` (already published-only → drafts excluded, mirroring publish/nav for WYSIWYG
        // parity); childrenOf filters parent + locale and caps the count. Each child carries its own
        // `data`, so bound the serialized array against the same IPC ceiling as the data above.
        const previewChildListing = referencesChildren(pageSource)
          ? childrenView(savedPages, page, defaultLocale)
          : { children: [], total: 0, truncated: false };
        const previewChildren = previewChildListing.children;
        if (JSON.stringify(previewChildren).length > 4 * 1024 * 1024) {
          return reply.code(413).send({ error: 'project data is too large to render' });
        }
        const previewPage = {
          title: page.title,
          // Flattened SEO/meta fields ({{page.description}} / {{page.image}}) + the {{sw-control}} current value.
          description: page.description,
          image: page.image,
          canonical: page.canonical,
          noindex: page.noindex,
          // `page.slug` is the page's OWN segment — the Page record's `path` field (e.g. "services");
          // the binding's `page.path` below is the FULL computed route. (Mirrors page.children[*].slug.)
          slug: page.path,
          path: pagePath(page, previewById),
          locale: previewLocale,
          // The project default alongside the RESOLVED locale — publish parity; lets locale-aware
          // helpers ({{sw-active}}'s locale-home rule) tell a translated page from a default-locale one.
          defaultLocale,
          translations: translationsOf(savedPages, page, defaultLocale),
          data: page.data,
          children: previewChildren,
          // Publish parity: the parent's REAL child count, so a capped listing reads the same in the
          // editor as on the live site (a binding wired into only one renderer is the divergence class
          // this codebase treats as a defect).
          childrenTotal: previewChildListing.total,
          // `page.template` — the template ref id ('' = own code); `page.code` — the EFFECTIVE source
          // rendering this page (template-resolved). Source is gated to {{page.code}} uses (it's large).
          template: page.template ?? '',
          code: pageSource && /\bpage\.code\b/.test(pageSource) ? pageSource : '',
        };
        // `page.code` duplicates the (already body-limited) source into the IPC payload — bound it against
        // the same 4 MiB ceiling as the other heavy preview fields, for a consistent defensive guard.
        if (typeof previewPage.code === 'string' && previewPage.code.length > 4 * 1024 * 1024) {
          return reply.code(413).send({ error: 'project data is too large to render' });
        }
        // The page's PARENT as a lean view (`{{page.parent.path}}`, `{{page.parent.data.x}}`) — absent
        // at the tree root. Built only when the source references it (the parent carries its own
        // `data`, so the gate keeps it off the IPC otherwise) and from the SAVED pages for the
        // parent (not the unsaved preview overlay).
        const previewParent = referencesParentPage(pageSource)
          ? (parentPageView(savedPages, page, defaultLocale) as unknown as Record<string, unknown> | undefined)
          : undefined;
        // Bound the parent view against the same IPC ceiling as the data/children above — its `data`
        // is a different page's object, not covered by the dataset guard.
        if (previewParent && JSON.stringify(previewParent).length > 4 * 1024 * 1024) {
          return reply.code(413).send({ error: 'project data is too large to render' });
        }
        // Cross-page slug-path access (`{{pages.services.seo._attributes.data.x}}`) — referenced-only +
        // same-locale, shared by the page render AND the slots (a footer/nav may reference another page too).
        const previewPages = pagesContext(
          savedPages,
          page,
          defaultLocale,
          [pageSource, website?.mainNav, website?.sidebarLeft, website?.sidebarRight, website?.footer, website?.bottom]
            .filter(Boolean)
            .join('\n'),
        );
        // Bound the cross-page tree against the same IPC ceiling — it carries other pages' `data`
        // (referenced-only + node-capped, but a source naming many data-heavy pages could still be large).
        if (previewPages && JSON.stringify(previewPages).length > 4 * 1024 * 1024) {
          return reply.code(413).send({ error: 'project data is too large to render' });
        }
        const rendered = await renderPool.render(pageSource, {
          company: brand as unknown as Record<string, unknown>,
          website: { siteUrl: website?.siteUrl, data: website?.data, shop: resolveShopChannels(website?.shop, (fid) => `/f/${project.id}/${fid}`), consent: website?.consent, t: resolveTranslations(website?.translations, previewLocale, defaultLocale), enableThemes: website?.enableThemes },
          page: previewPage,
          parentPage: previewParent,
          pages: previewPages,
          dataset: localeData,
          item,
          partials,
          // PREVIEW-only: keep the data-sw-* leaf-directive markers so the editor bridge can make
          // them click-to-edit. The publish path strips them in resolveDirectives.
          preview: true,
          // PREVIEW-only: the dataset-aware {{#each}} wraps each entry row in a data-sw-entry marker
          // so a click opens that entry's editor. Always body-safe (wraps the loop body) → no gate needed.
          markEntries: true,
          media: renderMedia,
          forms: previewForms,
          // Omitted entirely (not `{}`) when the page embeds none: the helper distinguishes "this
          // surface has no image maps" from "that id is unknown", and only the latter should throw.
          ...(previewImageMaps ? { imageMaps: previewImageMaps } : {}),
          ...(previewCaptcha ? { captcha: previewCaptcha } : {}),
        });
        // Slots render through the SAME isolated worker; a broken slot is skipped here
        // (publish still hard-validates it) so it can never break the page preview. No
        // `partials`/`content`: slots are project-wide (not client-edited), and — matching
        // the publish slot context in build.ts — they don't compose snippets, so
        // `{{> snippet}}` is intentionally unavailable in a slot (no WYSIWYG drift).
        const slotCtx = {
          company: brand as unknown as Record<string, unknown>,
          website: { siteUrl: website?.siteUrl, data: website?.data, shop: resolveShopChannels(website?.shop, (fid) => `/f/${project.id}/${fid}`), consent: website?.consent, t: resolveTranslations(website?.translations, previewLocale, defaultLocale), enableThemes: website?.enableThemes },
          page: previewPage,
          parentPage: previewParent,
          pages: previewPages,
          dataset: localeData,
          nav: slotNav as unknown as Record<string, unknown>,
          // PREVIEW-only: keep ALL data-sw-* markers so the bridge can make a slot's directives
          // click-to-edit. The platform does NOT restrict which directives a slot may use — that's the
          // operator's call. Two valid semantics: `data-sw-translate` writes the GLOBAL catalog (uniform
          // chrome across every page + locale — what the seed chrome uses), while the page.data
          // directives (text/html/src/bg/href) write the CURRENT page's page.data, giving deliberate
          // PER-PAGE slot content. Publish renders slots WITHOUT this flag (build.ts), so every marker is
          // stripped from the artifact.
          preview: true,
          // ★ AND the dataset-row markers, exactly as the page body above gets them. Chrome is where
          // site-wide lists actually live — a footer's client logos, "why us" slides, capability bars —
          // and without this they rendered with no `data-sw-entry` at all: not clickable, and absent from
          // the Regions panel, so a footer built entirely out of datasets read as "the lists were never
          // converted" when in fact the datasets and their rows were all there. A slot is the ONE place
          // the marker is most needed, because a slot has no page.data, so its repeated content has
          // nowhere to live EXCEPT a dataset. Body-safe (it stamps the loop body's own roots, never an
          // injected wrapper) and preview-only, same as on the page.
          markEntries: true,
          media: renderMedia,
          forms: previewForms,
          // A slot (footer, sidebar, global modal) may embed a map too — same parity as forms.
          ...(previewImageMaps ? { imageMaps: previewImageMaps } : {}),
          ...(previewCaptcha ? { captcha: previewCaptcha } : {}),
        };
        // Each slot reuses slotCtx (which carries `sourceData`) over IPC; that payload is already
        // bounded by the page-render size guard above, and the pool (capped workers + queue depth)
        // serializes the renders, so the six calls can't amplify into a parallel memory spike.
        const slotErrors: string[] = [];
        const renderSlot = async (name: string, src: string | undefined): Promise<string | undefined> => {
          if (!src) return undefined;
          try {
            return await renderPool.render(src, slotCtx);
          } catch (err) {
            // Still best-effort — a broken slot is omitted so it can never break the page preview —
            // but no longer INVISIBLE. ★ A slot is site-wide chrome: when it fails, the header or
            // footer disappears from every page at once, and a debug-level log is not something an
            // author (or an agent) will ever see. It is reported with the render now, and at warn.
            const message = err instanceof Error ? err.message : String(err);
            slotErrors.push(`${name}: ${slotHint(message)}`);
            req.log?.warn({ slot: name, errMsg: message }, 'preview slot failed to render — chrome omitted');
            return undefined;
          }
        };
        const [mainNav, sidebarLeft, sidebarRight, footer, bottom] = await Promise.all([
          renderSlot('mainNav', website?.mainNav),
          renderSlot('sidebarLeft', website?.sidebarLeft),
          renderSlot('sidebarRight', website?.sidebarRight),
          renderSlot('footer', website?.footer),
          renderSlot('bottom', website?.bottom),
        ]);
        // Wrap + inline Tailwind INSIDE the try so a compile failure returns the error
        // envelope (not a raw 500), consistent with the rest of this handler.
        // Custom effect code (the "None / Custom Code" slots): nav/button code injects at body-end
        // after the tenant's own scripts; a custom preloader becomes the first-body-child overlay.
        const fxCode = websiteEffectsCustomCode(website?.effects);
        const sourceHtml = await styledSourceDocument(page, brand, rendered, {
          // Self-hosted @font-face so the editor canvas doesn't fall back to system fonts.
          ...fontMediaShell((await contentRepo.list(ctx, 'media')) as MediaAsset[], project.slug),
          formApi: { base: '', project: project.id, preview: true },
          mainNav,
          sidebarLeft,
          sidebarRight,
          footer,
          bottom,
          head: website?.head,
          criticalCss: website?.criticalCss,
          containerWidth: website?.containerWidth,
          customScripts: [website?.scripts, fxCode.bodyEnd].filter(Boolean).join('\n') || undefined,
          // NO preloader in the single-page canvas — for CUSTOM code either, now. A preloader is
          // whole-site chrome: the built-in effects have never rendered here (their CSS and the
          // runtime that clears them ship only in the full build), so emitting custom code here put an
          // author's fixed overlay on the canvas with nothing to remove it. Both kinds are previewed
          // in the whole-site draft preview, which is where a loading state means anything.
          preloader: undefined,
          emitBrandContentTokens: !!(fxCode.bodyEnd || fxCode.preloader),
          bodyClass: websiteEffectsClasses(website?.effects),
          stickyHeader: website?.effects?.stickyHeader,
          theme: { enabled: !!website?.enableThemes, default: website?.defaultTheme },
          lang: previewLocale, // `<html lang>` follows the previewed page's locale (publish parity)
          systemT: resolveTranslations(website?.translations, previewLocale, defaultLocale),
        });
        const sourceToken = previewStore.put(sourceHtml, { projectId: project.id, userId: ctx.userId });
        const shotResult = await previewScreenshots(req, sourceHtml);
        const screenshots = shotResult?.shots;
        // `slug` so the editor builds the `/preview/<slug>/<token>` doc URL (same as the block branch below).
        return reply.send({
          html: sourceHtml,
          token: sourceToken,
          slug: project.slug,
          // Site-wide chrome that failed to render, so the caller can say WHY the header/footer is
          // missing instead of showing a page that is quietly wrong everywhere.
          ...(slotErrors.length ? { slotErrors } : {}),
          ...(screenshots ? { screenshots } : {}),
          // Why the picture is missing, so the caller can say so rather than show a wordless gap.
          ...(shotResult?.unavailable ? { screenshotsUnavailable: shotResult.unavailable } : {}),
        });
      } catch (err) {
        if (err instanceof RenderUnavailableError) return reply.code(503).send({ error: err.message });
        return reply.code(400).send({ error: err instanceof Error ? err.message : 'render failed' });
      }
    },
  );

  // Serves a previously-rendered preview document for an opaque token, addressed by the project's
  // (public, immutable) SLUG — `/preview/<slug>/<token>` — to match the media + published-site URL
  // scheme. Returned as `text/html` under `Content-Security-Policy: sandbox allow-scripts`, which
  // forces an OPAQUE, isolated origin even on direct navigation, so its scripts (the inlined
  // component behavior) run but cannot read the editor's cookies/session or make credentialed API
  // calls. The editor loads this via the iframe `src` (NOT `srcDoc`), so the document uses THIS CSP
  // rather than inheriting the editor page's stricter one. The token is unguessable, short-lived,
  // and bound to (project, user) — so only the member who GENERATED it can fetch it, and the route
  // is session-authenticated (the editor iframe carries the cookie; previews are not API-key fetched).
  app.get<{ Params: { slug: string; token: string } }>(
    '/preview/:slug/:token',
    { config: rl(120) },
    async (req, reply) => {
      // Every miss (unknown slug, no session, no membership, bad/expired token) returns the SAME
      // opaque 404 — it never leaks whether a given project or preview exists.
      const expired = () =>
        reply.code(404).type('text/html').send('<!doctype html><title>Preview expired</title>');
      // Bound both params before any DB work (defense-in-depth): tokens are randomUUID (36 chars)
      // and a slug is ≤64 chars, so anything longer is a guaranteed miss.
      if (req.params.token.length > 64 || req.params.slug.length > 64) return expired();
      let project: Awaited<ReturnType<ProjectRepository['getBySlug']>>;
      try {
        project = await projects.getBySlug(req.params.slug);
      } catch {
        return expired();
      }
      if (project.deletedAt) return expired(); // soft-deleted → preview unreachable
      // Session-only auth, mirroring resolveProject's session branch: a platform admin resolves to
      // owner, everyone else needs a membership on THIS project. requireUserId throws without a
      // session → treated as a miss.
      let userId: string;
      try {
        userId = await requireUserId(req);
      } catch {
        return expired();
      }
      const role = await resolveProjectRole(db, userId, project.id);
      if (!role) return expired();
      const html = previewStore.get(req.params.token, { projectId: project.id, userId });
      if (html === null) return expired();
      // `sandbox allow-scripts` (no `allow-same-origin`) → opaque origin: scripts run, isolated.
      // SAMEORIGIN framing lets the editor embed it; no third party. `allow-forms` lets a form's
      // submit event fire — this surface's forms post to the DRY RUN, so nothing is stored or mailed.
      reply.header('content-security-policy', PREVIEW_SANDBOX_CSP);
      reply.header('x-frame-options', 'SAMEORIGIN');
      return reply.type('text/html').send(html);
    },
  );

  // Live content-change stream (Server-Sent Events). The editor's live-preview
  // surface subscribes here and re-renders when ANY channel (editor/CLI/MCP)
  // writes to the project — so an agent's edits show up in an open preview. The
  // parent (same-origin, authenticated) page holds this connection and swaps the
  // sandboxed iframe; the events carry ids only (never content), so nothing leaks.
  app.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/events',
    { config: rl(30) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:read');
      // Bound concurrent streams per project so a client can't open unbounded
      // long-lived connections (each holds a socket + a bus listener).
      if (events.subscriberCount(ctx.projectId) >= MAX_EVENT_SUBSCRIBERS_PER_PROJECT) {
        return reply.code(429).send({ error: 'too many live-preview connections for this project' });
      }
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        // Defeat proxy buffering so events arrive promptly.
        'x-accel-buffering': 'no',
        // hijack() bypasses the onSend security-headers hook — replicate the baseline.
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'same-origin',
        'x-frame-options': 'DENY',
      });
      raw.write(': connected\n\n');
      const unsubscribe = events.subscribe(ctx.projectId, (change) => {
        // Guard against a write racing socket teardown (EPIPE/ERR_STREAM_DESTROYED).
        if (raw.writable) raw.write(`event: content\ndata: ${JSON.stringify(change)}\n\n`);
      });
      // Heartbeat keeps intermediaries from idling the connection out.
      const heartbeat = setInterval(() => {
        if (!raw.writable) {
          clearInterval(heartbeat);
          return;
        }
        raw.write(': ping\n\n');
      }, 25_000);
      heartbeat.unref();
      req.raw.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    },
  );

  // ---- Media (upload / list / delete + public serving) ----
  if (mediaStorage) {
    const storage = mediaStorage;

    // Mint a fresh SHORT (flat-layout) media asset id, unique within the project (see mint-id.ts).
    const mintAssetId = (ctx: ProjectContext): Promise<string> => mintUniqueAssetId(contentRepo, ctx);

    // Strip the on-disk `<id>-` prefix off a stored name back to its LOGICAL form (what the DB
    // `original`/`storedName` records; the serve route re-adds the prefix for the flat layout).
    const logicalStoredName = (storedName: string, assetId: string): string =>
      storedName.startsWith(`${assetId}-`) ? storedName.slice(assetId.length + 1) : storedName;

    // Public media-record resolver for the FLAT delivery route (`/media/<slug>/<id>-<name>`): maps
    // (slug, short id) → the asset record so the route dispatches on its AUTHORITATIVE `kind` — an
    // imported `kind:'script'` .js serves inline, but a raw-uploaded (`kind:'file'`) .js of the same
    // extension serves download-only. A bounded, short-TTL cache keeps the public serve path off a DB
    // round trip per request; a stale entry after a delete degrades to a 404 (the file is gone too),
    // and an SVG overwrite keeps the same kind/name so the cached record stays valid.
    const MEDIA_RECORD_TTL_MS = 60_000;
    const MEDIA_RECORD_CACHE_MAX = 4000;
    const MEDIA_SERVE_USER = '__media_serve__';
    const mediaRecordCache = new Map<string, { at: number; asset: MediaAsset | null }>();
    const resolvePublicMediaAsset = async (projectSlug: string, assetId: string): Promise<MediaAsset | null> => {
      const key = `${projectSlug}/${assetId}`;
      const hit = mediaRecordCache.get(key);
      if (hit && Date.now() - hit.at < MEDIA_RECORD_TTL_MS) return hit.asset;
      let asset: MediaAsset | null = null;
      try {
        const project = await projects.getBySlug(projectSlug);
        const ctx = { userId: MEDIA_SERVE_USER, projectId: project.id, role: 'owner' as const };
        asset = (await contentRepo.get(ctx, 'media', assetId)) as MediaAsset;
      } catch {
        asset = null;
      }
      if (mediaRecordCache.size >= MEDIA_RECORD_CACHE_MAX) mediaRecordCache.clear();
      mediaRecordCache.set(key, { at: Date.now(), asset });
      return asset;
    };

    /**
     * Slug → project id for the PUBLIC media routes; null when no such project exists.
     *
     * The on-demand thumbnail path gates encodes per tenant, and a gate is only as trustworthy as the
     * identity it counts. That identity arrives as a URL segment on an unauthenticated route, so it
     * has to be resolved to something real before it is allowed to mean anything. Shares the record
     * cache's TTL and bound, and — like it — caches the NEGATIVE answer too, so a flood of unknown
     * slugs cannot turn into a flood of lookups.
     */
    const projectIdCache = new Map<string, { at: number; id: string | null }>();
    const resolvePublicProjectId = async (projectSlug: string): Promise<string | null> => {
      const hit = projectIdCache.get(projectSlug);
      if (hit && Date.now() - hit.at < MEDIA_RECORD_TTL_MS) return hit.id;
      let id: string | null = null;
      try {
        id = (await projects.getBySlug(projectSlug)).id;
      } catch {
        id = null;
      }
      if (projectIdCache.size >= MEDIA_RECORD_CACHE_MAX) projectIdCache.clear();
      projectIdCache.set(projectSlug, { at: Date.now(), id });
      return id;
    };

    // Optimize a raw image buffer (AVIF/WebP/LQIP), store the binaries, and record
    // the tenant-scoped metadata. Shared by the upload route AND the stock import.
    async function createMediaAsset(
      ctx: ProjectContext,
      projectSlug: string,
      buffer: Buffer,
      meta: { filename: string; mimetype: string; folder?: string; alt?: string; attribution?: MediaAsset['attribution'] },
      storeOpts?: { cap?: number },
    ): Promise<ImageAsset> {
      const assetId = await mintAssetId(ctx);
      const { assetDir, inputPath } = await storage.stageUpload(projectSlug, assetId, buffer);
      try {
        // Store the retained ORIGINAL. Both caps BOUND the stored width and the SMALLER wins: an
        // explicit caller cap (the site importer's 2400, the stock import's STOCK_IMPORT_CAP) and
        // the project's own `website.imageUploadCap`. Either alone applies; neither → uncapped. A
        // project that deliberately caps at 1600 must not be overridden to 2400 by an import path.
        // When a cap bites, storeOriginal downscales + re-encodes to WebP. Responsive thumbnails are
        // generated on demand from this original — no eager variant fan-out.
        const settings = (await contentRepo.get(ctx, 'settings', SETTINGS_ENTITY_ID).catch(() => undefined)) as
          | Settings
          | undefined;
        const projectCap = settings?.website?.imageUploadCap;
        const cap =
          storeOpts?.cap === undefined
            ? projectCap
            : projectCap === undefined
              ? storeOpts.cap
              : Math.min(storeOpts.cap, projectCap);
        // Prefix the stored file with `<id>-` so the optimized original lands FLAT as
        // `<slug>/<id>-<name>` in the shared project dir; `logicalStoredName` strips it back for the DB.
        const storedName = `${assetId}-${MediaStorage.safeStoredName(meta.filename || 'image')}`;
        // Key on the project ID, exactly as the thumbnail path does — the same project must be ONE
        // tenant to the gate whether it is uploading or serving, or it quietly gets two shares.
        const stored = await withOptimizeSlot(ctx.projectId, () =>
          storeOriginal(inputPath, assetDir, { storedName, ...(cap ? { cap } : {}) }),
        );
        await storage.clearUpload(inputPath);
        const asset = ImageAssetSchema.parse({
          kind: 'image',
          id: assetId,
          filename: meta.filename,
          folder: meta.folder ?? '',
          format: stored.format,
          bytes: buffer.length,
          width: stored.width,
          height: stored.height,
          placeholder: stored.placeholder,
          hasAlpha: stored.hasAlpha,
          animated: stored.animated,
          original: logicalStoredName(stored.storedName, assetId),
          url: `/media/${projectSlug}/${stored.storedName}`,
          ...(meta.alt ? { alt: meta.alt } : {}),
          ...(meta.attribution ? { attribution: meta.attribution } : {}),
        });
        return (await contentRepo.put(ctx, 'media', assetId, asset)) as ImageAsset;
      } catch (err) {
        // Any failure (bad image, validation, DB) → remove the whole asset dir.
        await storage.remove(projectSlug, assetId);
        if (err instanceof Error && /format|pixel|dimension|size limit/i.test(err.message)) {
          throw new MediaValidationError('unsupported or invalid image');
        }
        throw err;
      }
    }

    // Store an SVG as a first-class VECTOR IMAGE (kind:'image', format:'svg'): sanitized (scripts /
    // handlers / remote refs stripped — see sanitizeSvg) then kept VERBATIM (no sharp, no rasterize),
    // so it stays animated + infinitely scalable. It is served inline under a locked-down CSP; combined
    // with `<img>` secure-static rendering, that makes an inline foreign SVG safe. Returns null if the
    // bytes aren't a usable SVG. The importer + the upload route both funnel SVG through here.
    async function createSvgAsset(
      ctx: ProjectContext,
      projectSlug: string,
      svgText: string,
      meta: { filename: string; folder?: string; alt?: string; attribution?: MediaAsset['attribution'] },
    ): Promise<ImageAsset | null> {
      const clean = sanitizeSvg(svgText);
      if (!clean) return null;
      const buffer = Buffer.from(clean, 'utf8');
      const assetId = await mintAssetId(ctx);
      // Force a `.svg` stored name regardless of the source filename's extension.
      const base = MediaStorage.safeStoredName(meta.filename || 'image').replace(/\.[^.]+$/, '');
      const storedName = `${base}.svg`;
      const dims = svgIntrinsicSize(clean) ?? { width: 300, height: 150 };
      try {
        await storage.storeFile(projectSlug, assetId, storedName, buffer);
        const asset = ImageAssetSchema.parse({
          kind: 'image',
          id: assetId,
          filename: meta.filename || storedName,
          folder: meta.folder ?? '',
          format: 'svg',
          bytes: buffer.length,
          width: Math.max(1, dims.width),
          height: Math.max(1, dims.height),
          hasAlpha: true,
          // SVG animation (SMIL / @keyframes) is preserved IN the file; this flag tracks the GIF/WebP
          // frame-loop semantics (which drive animated-thumbnail generation), and SVG has none.
          animated: false,
          original: storedName,
          url: `/media/${projectSlug}/${assetId}-${storedName}`,
          ...(meta.alt ? { alt: meta.alt } : {}),
          ...(meta.attribution ? { attribution: meta.attribution } : {}),
        });
        return (await contentRepo.put(ctx, 'media', assetId, asset)) as ImageAsset;
      } catch (err) {
        await storage.remove(projectSlug, assetId);
        throw err;
      }
    }

    // Store a NON-image upload as-is (any file type). Served download-only (attachment + nosniff),
    // so an uploaded HTML/SVG can never execute on the API/site origin.
    async function createFileAsset(
      ctx: ProjectContext,
      projectSlug: string,
      buffer: Buffer,
      meta: { filename: string; mimetype: string; folder?: string },
    ): Promise<FileAsset> {
      const assetId = await mintAssetId(ctx);
      const storedName = MediaStorage.safeStoredName(meta.filename || 'file');
      try {
        await storage.storeFile(projectSlug, assetId, storedName, buffer);
        const asset = FileAssetSchema.parse({
          kind: 'file',
          id: assetId,
          filename: meta.filename || storedName,
          folder: meta.folder ?? '',
          bytes: buffer.length,
          contentType: meta.mimetype || 'application/octet-stream',
          storedName,
          // Flat URL — the serve route serves this download-only by looking up kind:'file'.
          url: `/media/${projectSlug}/${assetId}-${storedName}`,
        });
        return (await contentRepo.put(ctx, 'media', assetId, asset)) as FileAsset;
      } catch (err) {
        await storage.remove(projectSlug, assetId);
        throw err;
      }
    }

    // Store a VIDEO/AUDIO upload. Served INLINE with its real content type (and range requests), because
    // a <video> must be playable — the download-only `file` kind cannot back a background video.
    async function createVideoAsset(
      ctx: ProjectContext,
      projectSlug: string,
      buffer: Buffer,
      meta: { filename: string; mimetype: string; folder?: string },
    ): Promise<VideoAsset> {
      const assetId = await mintAssetId(ctx);
      const storedName = MediaStorage.safeStoredName(meta.filename || 'video');
      const ext = storedName.split('.').pop()?.toLowerCase() ?? '';
      try {
        await storage.storeFile(projectSlug, assetId, storedName, buffer);
        const asset = VideoAssetSchema.parse({
          kind: 'video',
          id: assetId,
          filename: meta.filename || storedName,
          folder: meta.folder ?? '',
          bytes: buffer.length,
          contentType: VIDEO_CONTENT_TYPES.get(ext) ?? (meta.mimetype || 'video/mp4'),
          storedName,
          url: `/media/${projectSlug}/${assetId}-${storedName}`,
        });
        return (await contentRepo.put(ctx, 'media', assetId, asset)) as VideoAsset;
      } catch (err) {
        await storage.remove(projectSlug, assetId);
        throw err;
      }
    }

    /**
     * Store a LARGE upload straight from a staged temp file — video/audio, or any download-only file.
     *
     * Mirrors createVideoAsset/createFileAsset exactly, except the bytes never enter the heap. These
     * are the only two kinds without a small cap (images 15MB, SVG 4MB, fonts 5MB), so they are the
     * only ones where buffering actually costs anything: measured +107MB resident for a 120MB upload.
     */
    async function createLargeAssetFromPath(
      ctx: ProjectContext,
      projectSlug: string,
      srcPath: string,
      meta: { filename: string; mimetype: string; folder?: string },
      kind: 'video' | 'file',
    ): Promise<VideoAsset | FileAsset> {
      const assetId = await mintAssetId(ctx);
      const storedName = MediaStorage.safeStoredName(meta.filename || (kind === 'video' ? 'video' : 'file'));
      const ext = storedName.split('.').pop()?.toLowerCase() ?? '';
      try {
        const bytes = await storage.storeFileFromPath(projectSlug, assetId, storedName, srcPath);
        const common = {
          id: assetId,
          filename: meta.filename || storedName,
          folder: meta.folder ?? '',
          bytes,
          storedName,
          url: `/media/${projectSlug}/${assetId}-${storedName}`,
        };
        const asset =
          kind === 'video'
            ? VideoAssetSchema.parse({
                ...common,
                kind: 'video',
                contentType: VIDEO_CONTENT_TYPES.get(ext) ?? (meta.mimetype || 'video/mp4'),
              })
            : FileAssetSchema.parse({
                ...common,
                kind: 'file',
                contentType: meta.mimetype || 'application/octet-stream',
              });
        return (await contentRepo.put(ctx, 'media', assetId, asset)) as VideoAsset | FileAsset;
      } catch (err) {
        await storage.remove(projectSlug, assetId);
        throw err;
      }
    }

    // Store an imported site's CSS as one inline-served `.css` file (kind 'stylesheet') so the importer
    // can `<link>` it instead of inlining the bulk CSS into each page's editable source.
    async function createStylesheetAsset(ctx: ProjectContext, projectSlug: string, css: string): Promise<StylesheetAsset> {
      const assetId = await mintAssetId(ctx);
      const storedName = 'styles.css';
      const buffer = Buffer.from(css, 'utf8');
      try {
        await storage.storeFile(projectSlug, assetId, storedName, buffer);
        const asset = StylesheetAssetSchema.parse({
          kind: 'stylesheet',
          id: assetId,
          filename: storedName,
          folder: '',
          bytes: buffer.length,
          storedName,
          url: `/media/${projectSlug}/${assetId}-${storedName}`,
        });
        return (await contentRepo.put(ctx, 'media', assetId, asset)) as StylesheetAsset;
      } catch (err) {
        await storage.remove(projectSlug, assetId);
        throw err;
      }
    }

    // Store an imported site's JS as one inline-served `.js` file (kind 'script') so the importer can
    // `<script src>`-link it. @security Owner-only import; the cornerstone no-foreign-scripts rule is
    // relaxed ONLY for these self-hosted refs (see ScriptAssetSchema); preview is sandboxed.
    async function createScriptAsset(ctx: ProjectContext, projectSlug: string, js: string): Promise<ScriptAsset> {
      const assetId = await mintAssetId(ctx);
      const storedName = 'script.js';
      const buffer = Buffer.from(js, 'utf8');
      try {
        await storage.storeFile(projectSlug, assetId, storedName, buffer);
        const asset = ScriptAssetSchema.parse({
          kind: 'script',
          id: assetId,
          filename: storedName,
          folder: '',
          bytes: buffer.length,
          storedName,
          url: `/media/${projectSlug}/${assetId}-${storedName}`,
        });
        return (await contentRepo.put(ctx, 'media', assetId, asset)) as ScriptAsset;
      } catch (err) {
        await storage.remove(projectSlug, assetId);
        throw err;
      }
    }

    // Store a self-hosted FONT family (kind 'font') — used by the local upload + Google select routes.
    const createFontAsset = (ctx: ProjectContext, projectSlug: string, input: Parameters<typeof storeFontAsset>[4]) =>
      storeFontAsset(contentRepo, storage, ctx, projectSlug, input);

    // Upload ANY file: images are optimized (AVIF/WebP/LQIP); everything else is stored as-is
    // (download-only). The optional `?folder=` query files the asset under a virtual folder.
    /**
     * Store one uploaded FILE, whatever brought the bytes in.
     *
     * Extracted so the multipart route and the agent UPLOAD-TICKET route dispatch identically. The
     * per-kind rules here (SVG sanitized + kept verbatim, raster optimized, fonts detected by magic
     * bytes, video inline, everything else download-only) are the actual media contract; two copies
     * would drift the moment a kind is added to one caller and not the other.
     *
     * Returns a discriminated result rather than writing a reply, so each caller keeps its own status
     * conventions.
     */
    type StoredUpload = { ok: true; item: unknown } | { ok: false; status: number; error: string };
    /**
     * Write an incoming upload straight to a temp file next to the media root.
     *
     * `file.toBuffer()` held the whole upload in the heap — 120MB in, 107MB resident, measured. The
     * temp file lives UNDER the media root on purpose: `storeFileFromPath` then renames it into the
     * asset dir, which is atomic and free on the same filesystem.
     *
     * Named for the TEMP FILE deliberately — `MediaStorage.stageUpload` already means something else
     * (it stages a BUFFER for the sharp pipeline), and two different "stage upload"s in one file
     * would be a trap.
     */
    const stageUploadToTempFile = async (stream: NodeJS.ReadableStream): Promise<string> => {
      const dir = join(opts.mediaRoot ?? '', '.uploads-tmp');
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- derived from configured mediaRoot
      await mkdir(dir, { recursive: true, mode: 0o750 });
      const path = join(dir, `up-${randomUUID()}`);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- generated name in our own dir
      await pipeline(stream, createWriteStream(path));
      return path;
    };

    /**
     * Store an upload that has already been STREAMED to a temp file.
     *
     * Only two upload kinds have no small cap — video/audio and download-only files — and they are
     * the only ones where holding the bytes costs anything (measured: +107MB resident for a 120MB
     * upload). Those go straight from the temp file into the asset dir and never enter the heap.
     * Everything else (SVG 4MB, image 15MB, font 5MB) is read in and handed to the existing
     * buffer dispatcher, because sharp, the SVG sanitizer and the font detector all need bytes.
     *
     * The temp file is always cleaned up, including on every failure path.
     */
    const storeUploadFromPath = async (
      ctx: ProjectContext,
      projectSlug: string,
      tmpPath: string,
      meta: { filename: string; mimetype: string; folder: string },
      font?: { family?: string; weight?: string; style?: string; fallback?: string },
    ): Promise<StoredUpload> => {
      try {
        const isSvg = meta.mimetype === 'image/svg+xml' || meta.mimetype === 'image/svg';
        const looksLikeImage = isSvg || meta.mimetype.startsWith('image/');
        // A font is identified by MAGIC BYTES, not its mimetype, so peek the head rather than
        // reading a possibly-huge file just to find out it is not a font.
        let looksLikeFont = false;
        if (!looksLikeImage) {
          const fh = await open(tmpPath, 'r');
          try {
            const head = Buffer.alloc(8);
            await fh.read(head, 0, 8, 0);
            looksLikeFont = detectFontFormat(head) !== undefined;
          } finally {
            await fh.close();
          }
        }
        if (looksLikeImage || looksLikeFont) {
          // Bounded by their own caps, so reading these in is cheap and keeps ONE dispatcher.
          const buffer = await readFile(tmpPath);
          return await storeUploadBuffer(ctx, projectSlug, buffer, meta, font);
        }
        const isVideo = isVideoExt(meta.filename) || meta.mimetype.startsWith('video/') || meta.mimetype.startsWith('audio/');
        const saved = await createLargeAssetFromPath(ctx, projectSlug, tmpPath, meta, isVideo ? 'video' : 'file');
        return { ok: true, item: saved };
      } finally {
        // storeFileFromPath renames the temp file away on the large path, so this is a no-op there.
        await rm(tmpPath, { force: true }).catch(() => {});
      }
    };

    const storeUploadBuffer = async (
      ctx: ProjectContext,
      projectSlug: string,
      buffer: Buffer,
      meta: { filename: string; mimetype: string; folder: string },
      font?: { family?: string; weight?: string; style?: string; fallback?: string },
    ): Promise<StoredUpload> => {
      // An SVG upload is SANITIZED (scripts/handlers/remote refs stripped) and kept VERBATIM as a
      // vector image (never routed through sharp) — served inline under a locked-down CSP. Malformed
      // SVG (nothing usable after sanitization) → 400.
      const isSvg = meta.mimetype === 'image/svg+xml' || meta.mimetype === 'image/svg';
      if (isSvg) {
        if (buffer.length > MAX_SVG_BYTES) return { ok: false, status: 413, error: 'SVG exceeds the 4MB limit' };
        const saved = await createSvgAsset(ctx, projectSlug, buffer.toString('utf8'), { filename: meta.filename, folder: meta.folder });
        if (!saved) return { ok: false, status: 400, error: 'invalid or unsafe SVG' };
        return { ok: true, item: saved };
      }
      // An optimizable raster `image/*` upload is optimized (corrupt/oversized images 400). Any other
      // type is stored as-is (download-only).
      if (meta.mimetype.startsWith('image/')) {
        try {
          return { ok: true, item: await createMediaAsset(ctx, projectSlug, buffer, meta) };
        } catch (err) {
          if (err instanceof MediaValidationError) return { ok: false, status: 400, error: err.message };
          throw err;
        }
      }
      // A real font (by magic bytes) → a `kind:'font'` asset. The font picker sends family/weight/
      // style/fallback; a generic drop falls back to sensible, editable defaults.
      const format = detectFontFormat(buffer);
      if (format) {
        if (buffer.length > MAX_FONT_BYTES) return { ok: false, status: 413, error: 'file exceeds size limit' };
        const fontMeta = FontUploadMeta.safeParse({
          family: font?.family ?? meta.filename.replace(/\.[^.]+$/, ''),
          weight: font?.weight,
          style: font?.style,
          fallback: font?.fallback,
        });
        if (!fontMeta.success) return { ok: false, status: 400, error: 'invalid font metadata' };
        try {
          const saved = await createFontAsset(ctx, projectSlug, {
            family: fontMeta.data.family,
            fallback: fontMeta.data.fallback,
            source: 'local',
            folder: meta.folder,
            faces: [{ weight: fontMeta.data.weight, style: fontMeta.data.style, format, bytes: buffer }],
          });
          return { ok: true, item: saved };
        } catch (err) {
          if (err instanceof z.ZodError) return { ok: false, status: 400, error: 'invalid font' };
          throw err;
        }
      }
      try {
        // A playable video/audio goes to the INLINE video kind; everything else stays download-only.
        const saved = isVideoExt(meta.filename)
          ? await createVideoAsset(ctx, projectSlug, buffer, meta)
          : await createFileAsset(ctx, projectSlug, buffer, meta);
        return { ok: true, item: saved };
      } catch (err) {
        // A bad client-supplied contentType (the only externally-shaped field) → clean 400, never the
        // global handler's field-name-leaking ZodError envelope.
        if (err instanceof z.ZodError) return { ok: false, status: 400, error: 'invalid upload' };
        throw err;
      }
    };

    app.post<{ Params: { projectId: string }; Querystring: { folder?: string; family?: string; weight?: string; style?: string; fallback?: string } }>(
      '/projects/:projectId/media',
      { config: rl(30) },
      async (req, reply) => {
        const { ctx, project } = await resolveProject(req, 'content:write');
        // Reject before reading the (potentially large) upload for non-writers.
        if (!WRITE_ROLES.has(ctx.role)) {
          return reply.code(403).send({ error: 'insufficient role for this operation' });
        }
        // Validate the virtual folder up front (purely a metadata label; storage stays flat).
        const folderParsed = MediaFolderSchema.safeParse(req.query.folder ?? '');
        if (!folderParsed.success) return reply.code(400).send({ error: 'invalid folder' });
        const folder = folderParsed.data;

        const file = await req.file();
        if (!file) return reply.code(400).send({ error: 'no file uploaded' });

        // STREAMED to disk, not buffered: a large upload never needs to be in the heap.
        let tmpPath: string;
        try {
          tmpPath = await stageUploadToTempFile(file.file);
        } catch {
          // @fastify/multipart aborts the stream when the per-file size limit is exceeded.
          return reply.code(413).send({ error: 'file exceeds size limit' });
        }
        if (file.file.truncated) {
          await rm(tmpPath, { force: true }).catch(() => {});
          return reply.code(413).send({ error: 'file exceeds size limit' });
        }

        const meta = { filename: file.filename || 'upload', mimetype: file.mimetype || 'application/octet-stream', folder };
        const stored = await storeUploadFromPath(ctx, project.slug, tmpPath, meta, {
          family: req.query.family,
          weight: req.query.weight,
          style: req.query.style,
          fallback: req.query.fallback,
        });
        if (!stored.ok) return reply.code(stored.status).send({ error: stored.error });
        return reply.code(201).send({ item: stored.item });
      },
    );

    /**
     * Mint an UPLOAD TICKET so an agent can put a LOCAL file into the media library.
     *
     * An MCP agent has files on its own disk and, until this, no way to hand one over: `import_image`
     * takes a PUBLIC url the SERVER fetches, and the multipart route above needs the bearer token —
     * which the MCP client holds and the model never sees. Base64 in a tool argument is the obvious
     * alternative and it fails on arithmetic: the MODEL would have to emit the bytes, and a 1MB image
     * is ~370k tokens.
     *
     * So the agent asks HERE (authenticated, `content:write`-gated, exactly like any other write) and
     * gets back a one-shot URL it can curl. The bytes then travel over a channel the model is not part
     * of, and file size stops being a context problem. Every dimension except the bytes is pinned now,
     * at a point where the caller is known — see UploadTicketStore.
     */
    app.post<{ Params: { projectId: string }; Body: unknown }>(
      '/projects/:projectId/media/upload-ticket',
      { config: rl(30) },
      async (req, reply) => {
        const { ctx, project } = await resolveProject(req, 'content:write');
        if (!WRITE_ROLES.has(ctx.role)) {
          return reply.code(403).send({ error: 'insufficient role for this operation' });
        }
        const parsed = z.object({ folder: MediaFolderSchema.optional() }).safeParse(req.body ?? {});
        if (!parsed.success) return reply.code(400).send({ error: 'invalid folder' });
        const token = uploadTickets.put({
          projectId: project.id,
          projectSlug: project.slug,
          userId: ctx.userId,
          folder: parsed.data.folder ?? '',
        });
        return reply.code(201).send({
          uploadPath: `/media-upload/${token}`,
          expiresInSeconds: uploadTickets.ttlSeconds,
          maxBytes: MAX_UPLOAD_BYTES,
        });
      },
    );

    /**
     * REDEEM an upload ticket: the raw request body becomes a media asset.
     *
     * ★ NO SESSION, deliberately — the ticket IS the credential, and the agent curling this has no
     * cookie and no bearer. That is safe only because the ticket was minted by an authenticated,
     * `content:write`-gated caller and pins the project, the user and the folder; the holder chooses the
     * BYTES and nothing else. `take()` consumes it, so a replay is indistinguishable from an unknown
     * token — both 404, which is also why the failure says nothing about whether the token ever existed.
     *
     * Raw body, not multipart: an agent uploads with `curl -T FILE URL`, which is the shortest correct
     * thing to ask of it (`--data-binary` mangles nothing either, but -T needs no flags to avoid). The
     * filename rides in `?filename=`, because a raw PUT carries none and the stored asset is named from
     * it. Content type is derived from that name rather than trusted from the header — the header is
     * attacker-chosen here in a way it is not on the session-authenticated route.
     */
    // ENCAPSULATED so the wildcard body parser below applies to THIS ROUTE ONLY. Fastify scopes
    // content-type parsers to the plugin that registers them; adding `'*'` at app level would make
    // every other route silently accept a body of any declared type instead of answering 415.
    await app.register(async (uploadScope) => {
      // A raw PUT arrives as octet-stream (or whatever curl guessed), and none of it is JSON — take the
      // bytes verbatim. The type claimed here is NOT trusted: the stored asset's type comes from the
      // filename, because on this route the header is chosen by whoever holds the ticket.
      // STREAMS the body to a temp file instead of buffering it. `parseAs: 'buffer'` meant a 200MB
      // ticket upload was 200MB of heap before the handler even ran — measured at +107MB for a 120MB
      // file. Encapsulated to this scope, so no other route's parsing changes.
      uploadScope.addContentTypeParser('*', (_req, payload, done) => {
        stageUploadToTempFile(payload)
          .then((tmpPath) => done(null, { tmpPath }))
          .catch((err: Error) => done(err));
      });
      uploadScope.put<{ Params: { token: string }; Querystring: { filename?: string } }>(
      '/media-upload/:token',
      {
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
        // The ticket caps what may be spent on an unauthenticated request; the same ceiling the
        // multipart route uses, enforced before the body is buffered.
        bodyLimit: MAX_UPLOAD_BYTES,
      },
      async (req, reply) => {
        // The body is already on disk by the time this runs (see the parser above), so EVERY exit
        // from here has to clean it up or a rejected ticket leaks a temp file per attempt.
        const tmpPath = (req.body as { tmpPath?: string } | undefined)?.tmpPath;
        const discard = async (): Promise<void> => {
          if (tmpPath) await rm(tmpPath, { force: true }).catch(() => {});
        };

        const scope = uploadTickets.take(req.params.token);
        // One message for unknown / expired / already-redeemed. Distinguishing them would tell a holder
        // which tokens ever existed.
        if (!scope) {
          await discard();
          return reply.code(404).send({ error: 'upload ticket is unknown, expired or already used' });
        }

        if (!tmpPath || (await stat(tmpPath)).size === 0) {
          await discard();
          return reply.code(400).send({ error: 'empty upload' });
        }

        const rawName = typeof req.query.filename === 'string' ? req.query.filename : '';
        // Basename only: a ticket must not be able to write outside the media library by naming a path.
        const filename = rawName.replace(/\\/g, '/').split('/').pop()?.slice(0, 200).trim() || 'upload';

        // ★ Membership is RE-CHECKED here, not pinned into the ticket. Authorization should be current:
        // a member removed from the project during the ticket's window must not still be able to write
        // to it, and pinning the role would have bought exactly that hole for the sake of one query.
        const role = await resolveProjectRole(db, scope.userId, scope.projectId);
        if (!role || !WRITE_ROLES.has(role)) {
          await discard();
          return reply.code(404).send({ error: 'upload ticket is unknown, expired or already used' });
        }
        const ctx: ProjectContext = { userId: scope.userId, projectId: scope.projectId, role, actor: 'agent' };

        const stored = await storeUploadFromPath(ctx, scope.projectSlug, tmpPath, {
          filename,
          mimetype: mimeTypeForFilename(filename),
          folder: scope.folder,
        });
        if (!stored.ok) return reply.code(stored.status).send({ error: stored.error });
        return reply.code(201).send({ item: stored.item });
      },
      );
    });

    // Import a remote URL INTO the library (download + self-host), so a field that pasted a URL can
    // keep the published export self-contained. Raster images are optimized (createMediaAsset); SVG is
    // sanitized + stored as a vector image (createSvgAsset); anything else is stored as-is.
    //
    // SSRF: the binding guard is `pinnedFetchDetailed` — resolve ONCE, reject if any resolved address is
    // private, then connect to the PINNED IP, re-guarding every redirect hop. The cheap `targetsPrivateHost`
    // string check below stays as a fast pre-filter (it answers the obvious literal/`localhost` cases with a
    // precise message, without a DNS round-trip) but it is NOT the boundary: it cannot see where a hostname
    // actually resolves, so on its own it let any name with a private A record through. That mattered here
    // more than on a blind fetch — this route STORES the response as a retrievable media asset, and it is
    // reachable by the `import_image` MCP tool, i.e. by an agent loop reading untrusted third-party content.
    const ImportUrlBody = z.object({ url: z.string().url().max(2048), folder: MediaFolderSchema.optional() });
    // Where a materialised template's images land, so they are easy to find (and to delete with the
    // map). Organisational only — a media URL carries no folder segment.
    const TEMPLATE_MEDIA_FOLDER = 'image-maps';
    const FromTemplateBody = z.object({
      template: z.string().min(1).max(100),
      /** Entity id for the new map; generated from the template id when omitted. */
      id: z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/).optional(),
      /** Display name; the template's own name when omitted. */
      name: z.string().min(1).max(200).optional(),
    });
    app.post<{ Params: { projectId: string } }>('/projects/:projectId/media/import-url', { config: rl(20) }, async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:write');
      if (!WRITE_ROLES.has(ctx.role)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const parsed = ImportUrlBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid request' });
      const { url } = parsed.data;
      const folder = parsed.data.folder ?? '';
      if (!/^https:\/\//i.test(url) || targetsPrivateHost(url)) {
        return reply.code(400).send({ error: 'only public https URLs can be imported' });
      }
      // The cap has to be chosen BEFORE the fetch (the pinned fetcher enforces it with a
      // content-length pre-check AND a streaming backstop), so it keys off the URL's extension —
      // the content type is not known until the bytes arrive.
      //
      // Playable media gets the same ceiling the LOCAL upload paths already allow. The store, the
      // `video` media kind and the createVideoAsset branch below all accept it at that size; only
      // this route's image-sized cap said otherwise, which made a site's video unreachable by URL
      // while the identical file uploaded from disk was fine. Measured: an 83 MB source video
      // 413'd here and imported cleanly through the upload ticket.
      let importPath = '';
      try {
        importPath = new URL(url).pathname;
      } catch {
        /* a malformed URL falls through to the image cap and fails in the fetcher */
      }
      const maxImportBytes = isVideoExt(importPath) ? MAX_UPLOAD_BYTES : MAX_IMAGE_UPLOAD_BYTES;

      // The slot must span the BUFFER'S WHOLE LIFETIME — fetch AND store — because the payload
      // stays resident until the asset is written; gating only the fetch would leave the peak
      // unchanged. Image-sized imports run UNGATED: they were never the amplification risk and
      // must not pay new latency for one.
      const runImport = async (allowedBytes: number): Promise<typeof reply> => {
        // Redirects and the size cap (content-length pre-check AND a streaming backstop) live inside the
        // pinned fetcher, so there is no path around the guard. `timeoutMs` there is a per-socket INACTIVITY
        // timeout, so it alone would let a server trickle bytes and hold a worker open indefinitely — the
        // AbortController adds the hard whole-operation deadline (spanning redirects + the body read) that
        // this route had before. clearTimeout is in the finally so the timer never outlives the request.
        // The pinned fetcher resolves rather than rejects on every failure it knows about; the catch is a
        // backstop so an unexpected throw still answers 400 (never a 500 leaking a stack to the caller).
        let fetched: PinnedResult;
        const controller = new AbortController();
        // Same size class that picked the byte cap picks the deadline — a 200MB allowance behind a
        // 10s deadline is unreachable. The INACTIVITY timeout below stays at 10s either way.
        const deadlineMs = maxImportBytes > MAX_IMAGE_UPLOAD_BYTES ? LARGE_IMPORT_DEADLINE_MS : IMPORT_TIMEOUT_MS;
        const timer = setTimeout(() => controller.abort(), deadlineMs);
        try {
          fetched = await importUrlFetch(url, {
            timeoutMs: IMPORT_TIMEOUT_MS,
            maxBytes: allowedBytes,
            maxRedirects: MAX_IMPORT_REDIRECTS,
            signal: controller.signal,
          });
        } catch {
          return reply.code(400).send({ error: 'could not fetch the URL' });
        } finally {
          clearTimeout(timer);
        }
        if (!fetched.ok) {
          switch (fetched.reason) {
            case 'blocked':
              // The host, or a redirect target, is not a public https address. Deliberately does NOT say
              // which hop or what it resolved to — that would be an internal-DNS oracle.
              return reply.code(400).send({ error: 'a non-public URL was blocked (host or redirect target)' });
            case 'redirects':
              return reply.code(400).send({ error: 'too many redirects' });
            case 'oversize':
              // Name the ceiling that applied AND the way through it. The bare "file exceeds size
              // limit" told an agent nothing, so it hotlinked the asset instead of uploading it —
              // even though it had already downloaded the file and the upload ticket would have
              // taken it.
              return reply.code(413).send({
                error:
                  `file exceeds the ${Math.round(allowedBytes / (1024 * 1024))}MB limit for URL import` +
                  ` — download it and use a one-shot upload ticket (POST /projects/:id/media/upload-ticket,` +
                  ` MCP create_media_upload), which accepts up to ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB`,
              });
            case 'status':
              return reply.code(400).send({ error: `download failed (${fetched.status})` });
            default:
              return reply.code(400).send({ error: 'could not fetch the URL' });
          }
        }
        const contentType = fetched.contentType;
        const buffer = Buffer.from(fetched.bytes);

        // The pre-fetch cap was a GUESS from the URL's extension — the only signal available before
        // any bytes arrive. Now that the real Content-Type is known, re-hold the payload to the
        // ceiling that actually matches it, because the two signals can disagree and nothing else
        // reconciles them: `photo.mp4` answered as `image/png` would otherwise keep the 200MB
        // playable cap and then go through the full raster decode at 13x the image limit (sharp's
        // 50MP guard does not bound BYTES). The same in reverse — arbitrary bytes behind a video-like
        // extension must not be stored and served as `video/*` at 200MB.
        const isPlayablePayload =
          contentType.startsWith('video/') ||
          contentType.startsWith('audio/') ||
          // A real .mp4 is sometimes served as generic binary; the storage dispatch below already
          // treats that as video, so allow the large ceiling — but only when the extension agrees.
          (isVideoExt(importPath) && (contentType === 'application/octet-stream' || contentType === ''));
        const settledCap = isPlayablePayload ? MAX_UPLOAD_BYTES : MAX_IMAGE_UPLOAD_BYTES;
        if (buffer.length > settledCap) {
          return reply.code(413).send({
            error:
              `file exceeds the ${Math.round(settledCap / (1024 * 1024))}MB limit for a ${contentType || 'unknown'} URL import` +
              ` — download it and use a one-shot upload ticket (POST /projects/:id/media/upload-ticket,` +
              ` MCP create_media_upload), which accepts up to ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB`,
          });
        }

        const isSvg = contentType === 'image/svg+xml' || contentType === 'image/svg';
        if (isSvg && buffer.length > MAX_SVG_BYTES) return reply.code(413).send({ error: 'SVG exceeds the 4MB limit' });
        // A malformed %-sequence the URL parser accepts but decodeURIComponent rejects → a safe default.
        let filename: string;
        try {
          filename = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'download') || 'download';
        } catch {
          filename = 'download';
        }
        try {
          // SVG → sanitized vector image (null if unusable). Other images → optimized raster. Else file.
          const saved = isSvg
            ? await createSvgAsset(ctx, project.slug, buffer.toString('utf8'), { filename, folder })
            : contentType.startsWith('image/')
              ? await createMediaAsset(ctx, project.slug, buffer, { filename, mimetype: contentType, folder })
              : isVideoExt(filename) || contentType.startsWith('video/') || contentType.startsWith('audio/')
                ? await createVideoAsset(ctx, project.slug, buffer, { filename, mimetype: contentType, folder })
                : await createFileAsset(ctx, project.slug, buffer, { filename, mimetype: contentType, folder });
          if (!saved) return reply.code(400).send({ error: 'invalid or unsafe SVG' });
          return reply.code(201).send({ item: saved });
        } catch (err) {
          if (err instanceof MediaValidationError) return reply.code(400).send({ error: err.message });
          if (err instanceof z.ZodError) return reply.code(400).send({ error: 'invalid import' });
          throw err;
        }
      };
      if (maxImportBytes <= MAX_IMAGE_UPLOAD_BYTES) return runImport(maxImportBytes);
      try {
        return await largeImportGate.run(project.id, async () => {
          // Reserve what this instance can AFFORD, not the 200MB ceiling.
          //
          // The pinned fetcher buffers the whole body, so the reservation has to cover the payload —
          // but reserving the CAP made large import impossible on a small instance. Measured on a
          // 512MB container: ~180MB is spendable, a 200MB reservation never fits, and so EVERY video
          // URL was refused — a 2MB one included — with a 503 promising that a retry would help.
          //
          // Grant the smaller of the cap and the real headroom, then hand that same number to the
          // fetcher as its byte cap. A file too big for the instance is then refused as OVERSIZE,
          // which is true and tells the caller what to do (use an upload ticket), instead of being
          // reported as contention that does not exist.
          //
          // Only when the ledger actually KNOWS the limit. Before `initMemoryBudget` (and in unit
          // tests) a snapshot reports zero headroom, which would silently shrink every import to the
          // floor — the existing cap test caught exactly that. An uninitialised budget means "no
          // information", not "no memory", so the cap stands, matching what `admitMemory` does.
          let allowedBytes = maxImportBytes;
          if (memoryBudgetReady) {
            const snap = await memoryBudget.snapshot();
            allowedBytes = Math.min(
              maxImportBytes,
              Math.max(MIN_LARGE_IMPORT_BYTES, Math.floor(snap.availableBytes * LARGE_IMPORT_HEADROOM)),
            );
          }
          // Held for the fetch AND the store: the buffer stays resident until the asset lands.
          const held = await admitMemory(allowedBytes, 'large media import');
          try {
            return await runImport(allowedBytes);
          } finally {
            held.release();
          }
        });
      } catch (err) {
        // Answer the shed HERE rather than throwing it at the global error handler: that handler
        // passes through only 4xx statuses (`status >= 400 && status < 500`) plus an allowlisted
        // 429/413, so a thrown 503 falls into the opaque 500 branch. Measured: the shed caller got
        // a 500, which reads as "the server is broken" instead of "come back in a moment".
        if (err instanceof TenantShareError) {
          // Not "the server is full" — THIS project is at its own share. Saying which is the
          // difference between a caller backing off usefully and a caller blaming the instance.
          return reply.code(503).send({ error: err.message });
        }
        if (err instanceof GateFullError) {
          return reply.code(503).send({ error: 'too many large imports in progress; retry shortly' });
        }
        // The memory ledger's own shed. It used to be reported as "too many large imports in
        // progress" — which was false whenever nothing else was running, and sent the caller off to
        // wait for contention that would never clear. Its own message names the real cause.
        if ((err as { statusCode?: number }).statusCode === 503) {
          return reply.code(503).send({ error: (err as Error).message });
        }
        throw err;
      }
    });

    // Render ONE image map to a self-contained document — JUST the map, no site chrome.
    //
    // The Studio's Preview used to render a whole PROJECT PAGE that embedded the map, so the author
    // got a header, a footer and the site's typography wrapped around the thing they were editing.
    // This is the map alone, on a neutral surface, filling the frame.
    //
    // Serves either a STORED map (`?map=<id>`) or a bundled DEMO (`?template=<id>`) — a demo renders
    // straight from the bundled config and writes NOTHING into the project, which is the whole point
    // of a demo: look at it without it becoming yours.
    //
    // Served directly as `text/html` under `sandbox allow-scripts`, like the snippet preview: an
    // OPAQUE origin, so the inlined runtime executes (a map is nothing without it) while the
    // document can neither reach the editor that framed it nor read anything same-origin.
    app.get<{ Params: { projectId: string }; Querystring: { map?: string; template?: string } }>(
      '/projects/:projectId/imagemaps/preview',
      { config: rl(60) },
      async (req, reply) => {
        const { ctx } = await resolveProject(req, 'content:read');
        const html = (body: string, code = 200) =>
          reply
            .code(code)
            .header('content-security-policy', "sandbox allow-scripts; default-src 'none'; img-src * data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'")
            .header('x-frame-options', 'SAMEORIGIN')
            .type('text/html')
            .send(body);
        const notice = (msg: 'This map no longer exists.' | 'That demo does not exist.', code = 404) =>
          html(
            `<!doctype html><meta charset="utf-8"><body style="margin:0;font:13px/1.5 system-ui,sans-serif;color:#64748b;display:grid;place-items:center;height:100vh;padding:1rem;text-align:center">${msg}</body>`,
            code,
          );

        let config: unknown = null;
        const templateId = typeof req.query.template === 'string' ? req.query.template : '';
        if (templateId) {
          if (!isImageMapTemplateId(templateId)) return notice('That demo does not exist.');
          config = await readTemplateConfig(templateId);
          if (!config) return notice('That demo does not exist.');
        } else {
          const id = typeof req.query.map === 'string' ? req.query.map : '';
          const stored = id ? await contentRepo.get(ctx, 'imagemap', id).catch(() => null) : null;
          if (!stored) return notice('This map no longer exists.');
          config = stored;
        }

        const assets = componentAssets(['ImageMap']);
        const markup = renderImageMapMarkup({ id: 'preview', config: config as Record<string, unknown> });
        return html(
          '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
            `<style>html,body{margin:0;height:100%}body{display:grid;place-items:center;padding:16px;box-sizing:border-box;` +
            `background:#f8fafc;font-family:ui-sans-serif,system-ui,sans-serif}.sw-imap-stage{width:100%;max-width:1200px}` +
            `@media (prefers-color-scheme:dark){body{background:#0f172a}}</style>` +
            `<style>${assets.css}</style>` +
            `<div class="sw-imap-stage">${markup}</div>` +
            `<script>${assets.js}</script>`,
        );
      },
    );

    // Materialise a bundled IMAGE MAP TEMPLATE into this project.
    //
    // The template's images are copied into the project's OWN media library and the config is
    // rewritten to point at them, so the resulting map is self-contained: nothing it references
    // lives on the platform, and a publish/export carries it like any other project image. This is
    // the only supported way to use a template — the /authoring/imagemaps/* URLs are a source, not
    // a destination.
    app.post<{ Params: { projectId: string } }>('/projects/:projectId/imagemaps/from-template', { config: rl(20) }, async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:write');
      if (!WRITE_ROLES.has(ctx.role)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const parsed = FromTemplateBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid request' });

      const template = IMAGE_MAP_TEMPLATES.find((t) => t.id === parsed.data.template);
      const config = template ? await readTemplateConfig(template.id) : null;
      if (!template || !config) return reply.code(404).send({ error: 'unknown image map template' });

      // Copy each referenced image into the media library, collecting the URL rewrites.
      const rewrites = new Map<string, string>();
      for (const authoringUrl of template.images) {
        const filename = authoringUrl.split('/').pop() as string;
        const bytes = await readTemplateImage(filename);
        if (!bytes) return reply.code(500).send({ error: 'template image is missing' });
        const saved = await createMediaAsset(ctx, project.slug, bytes, {
          filename,
          mimetype: 'image/jpeg',
          folder: TEMPLATE_MEDIA_FOLDER,
        });
        rewrites.set(authoringUrl, saved.url);
      }

      // Rewrite over the SERIALISED config: an image URL can appear on an artboard background, a
      // hotspot's background image or inside tooltip content, and a whole-string replace reaches
      // every one of them without a path list that can miss a nesting level.
      let json = JSON.stringify(config);
      for (const [from, to] of rewrites) json = json.split(from).join(to);
      const rewritten = JSON.parse(json) as Record<string, unknown>;

      // Give every artboard an id. Vendor exports omit it on the first artboard, and the runtime
      // assigns none — so without this every artboard shares artboardDefaults' `default-id` and the
      // floor switcher does nothing. Existing ids are kept, because the hotspots' change-artboard
      // actions already point at them.
      const artboards = Array.isArray(rewritten.artboards) ? (rewritten.artboards as Array<Record<string, unknown>>) : [];
      const usedArtboardIds = new Set(artboards.map((a) => a.id).filter((v): v is string => typeof v === 'string' && v !== ''));
      rewritten.artboards = artboards.map((artboard) => {
        if (typeof artboard.id === 'string' && artboard.id !== '') return artboard;
        let fresh = `artboard-${randomUUID().slice(0, 8)}`;
        while (usedArtboardIds.has(fresh)) fresh = `artboard-${randomUUID().slice(0, 8)}`;
        usedArtboardIds.add(fresh);
        return { ...artboard, id: fresh };
      });

      const id = parsed.data.id ?? `${template.id}-${randomUUID().slice(0, 8)}`;
      const name = parsed.data.name ?? template.name;
      const data = { ...rewritten, id, general: { ...(rewritten.general as object), name } };

      // put() validates against ImageMapSchema and records a revision like any other content write.
      const stored = await contentRepo.put(ctx, 'imagemap', id, data);
      return reply.code(201).send({ item: stored, importedImages: rewrites.size });
    });

    // Clear this project's DERIVED thumbnail cache: removes every on-demand-generated sm/md/lg/xl
    // WebP/AVIF file, keeping every retained ORIGINAL. Thumbnails regenerate on the next request, so
    // this is a safe, idempotent way to reclaim disk (e.g. after bulk deletes or a format change).
    app.post<{ Params: { projectId: string } }>('/projects/:projectId/media/prune-thumbnails', async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:write');
      if (!WRITE_ROLES.has(ctx.role)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const media = (await contentRepo.list(ctx, 'media')) as MediaAsset[];
      let removed = 0;
      for (const a of media) {
        // Require a known original before pruning — never run the "delete everything except keepOriginal"
        // sweep with an undefined keep (which would delete the original too).
        if (a.kind === 'image' && a.original) removed += await storage.pruneAssetThumbnails(project.slug, a.id, a.original);
      }
      return reply.send({ removed });
    });

    // Stock-image search + import (Openverse/Unsplash/Pexels). Imports land as normal
    // media assets (downloaded + optimized + self-hosted) so the export stays portable.
    registerStockRoutes(app, {
      resolveProject,
      isWriter: (ctx) => WRITE_ROLES.has(ctx.role),
      stockService,
      createMediaAsset,
      rl,
    });

    // Import an external website (crawl a live URL) → a faithful, self-contained Sitewright scaffold,
    // streamed over SSE. Owner-only + SSRF-guarded; the AI rewrite stage turns the scaffold into native
    // idioms afterwards. Lives in the media block since it self-hosts the source site's images.
    registerImportRoutes(app, {
      resolveProject,
      contentRepo,
      createMediaAsset,
      // Self-host an imported SVG as a sanitized, verbatim VECTOR image (kept animated + scalable).
      createSvgAsset: async (ctx, slug, svgText, meta) => {
        try {
          const saved = await createSvgAsset(ctx, slug, svgText, meta);
          return saved ? { url: saved.url } : null;
        } catch {
          return null; // unparseable / storage error → drop (the <img> falls back to the source ref)
        }
      },
      // Self-host an imported @font-face web font through the existing font pipeline (magic-byte
      // validated + served inline). Invalid/oversize bytes → null (the importer keeps the url() as-is).
      hostFontAsset: async (ctx, slug, buffer, font) => {
        const format = detectFontFormat(buffer);
        if (!format || buffer.length > MAX_FONT_BYTES) return null;
        try {
          const saved = await createFontAsset(ctx, slug, {
            family: font.family,
            fallback: 'sans-serif',
            source: 'local',
            faces: [{ weight: font.weight, ...(font.weightRange ? { weightRange: font.weightRange } : {}), style: font.style, format, bytes: buffer }],
          });
          return { url: saved.url };
        } catch {
          return null; // invalid family/metadata → leave the original url()
        }
      },
      // Self-host a linked document (PDF/doc/…) as-is via the file-asset path (download-only, no sharp).
      hostFileAsset: async (ctx, slug, buffer, meta) => {
        try {
          // The importer routes video/audio here too — self-host it as the INLINE video kind so a
          // cloned background video actually plays instead of downloading (or vanishing).
          const saved = isVideoExt(meta.filename)
            ? await createVideoAsset(ctx, slug, buffer, meta)
            : await createFileAsset(ctx, slug, buffer, meta);
          return { url: saved.url };
        } catch {
          return null; // oversize / storage error → leave the original href
        }
      },
      // Self-host the imported site's CSS as one inline-served stylesheet, returning its /media URL so
      // the importer can <link> it (keeping the bulk CSS out of the page source).
      hostStylesheet: async (ctx, slug, css) => {
        try {
          const saved = await createStylesheetAsset(ctx, slug, css);
          return saved.url;
        } catch {
          return null;
        }
      },
      // Self-host an imported script (inline body OR fetched external) as one inline-served `.js` file,
      // returning its /media URL so the importer can `<script src>`-link it. Owner-only; relaxes the
      // no-foreign-scripts rule for self-hosted refs only (the import was an explicit owner choice).
      hostScript: async (ctx, slug, js) => {
        try {
          const saved = await createScriptAsset(ctx, slug, js);
          return saved.url;
        } catch {
          return null;
        }
      },
      rl,
      log: app.log,
      // FOUNDATION imports only: cache each imported page's live-source screenshot so compare_to_source
      // has a stable reference from import time (skipped when source-ref caching is disabled).
      ...(sourceRefStore
        ? {
            cacheSourceRefs: (slug: string, pages: ReferencePage[], onProgress: (e: unknown) => void, signal: AbortSignal) =>
              captureSourceRefs(sourceRefStore, slug, pages, { onProgress, signal }),
          }
        : {}),
    });

    app.get<{ Params: { projectId: string }; Querystring: { kind?: string; placeholders?: string } }>(
      '/projects/:projectId/media',
      async (req, reply) => {
        const { ctx } = await resolveProject(req, 'content:read');
        const items = (await contentRepo.list(ctx, 'media')) as MediaAsset[];
        // Optional `?kind=image|file|font|video` filter (e.g. the font picker only needs fonts).
        const kind = req.query.kind;
        const filtered = kind ? items.filter((a) => a.kind === kind) : items;
        // DROP the inline LQIP data URIs by default. They are only useful to a UI that paints a blur-up
        // thumbnail; to any other caller they are pure noise, and they are not small — measured on a
        // real project, 28,176 of a 76,287-char response (36%) was base64 placeholder. `?placeholders=1`
        // brings them back for the editor's media picker.
        const wantPlaceholders = req.query.placeholders === '1' || req.query.placeholders === 'true';
        const out = wantPlaceholders
          ? filtered
          : filtered.map((a) => (a.kind === 'image' && a.placeholder ? { ...a, placeholder: undefined } : a));
        return reply.send({ items: out });
      },
    );

    app.delete<{ Params: { projectId: string; id: string } }>(
      '/projects/:projectId/media/:id',
      async (req, reply) => {
        const { ctx } = await resolveProject(req, 'content:delete');
        // SOFT-delete → the Recycle Bin: the row + binary are RETAINED so it can be restored; a 90-day
        // reaper purges older entries. This is what makes an autonomous agent media delete recoverable.
        await contentRepo.softDeleteMedia(ctx, req.params.id);
        mediaRecordCache.clear(); // drop any cached serve record for this project's media
        return reply.code(204).send();
      },
    );

    // --- Recycle Bin: list soft-deleted media, restore one, or purge it permanently -----------
    /**
     * Which of this project's media nothing refers to.
     *
     * Returns the assets themselves (so the caller can show name, size and thumbnail) plus WHAT WAS
     * SEARCHED — an author about to delete 40 files deserves to see the scan's reach rather than be
     * asked to trust it. Assets referenced only by version history come back flagged, not hidden:
     * deleting one breaks a restore rather than a page, which is a different decision.
     */
    /**
     * What this project occupies on disk, per store. Reporting only — nothing enforces a quota.
     *
     * Nothing bounds a SINGLE project: the reapers cap how long derived output survives, not how
     * large any one site gets, so one large import can add hundreds of megabytes and no policy
     * notices. A number an author can see is the cheapest thing that makes that visible.
     */
    app.get<{ Params: { projectId: string } }>('/projects/:projectId/storage', { config: rl(20) }, async (req, reply) => {
      const { project } = await resolveProject(req, 'content:read');
      const [media, build, preview, sourceRefs] = await Promise.all([
        projectStorage(opts.mediaRoot, project.slug),
        projectStorage(opts.publishRoot, project.slug),
        projectStorage(opts.previewRoot, project.slug),
        projectStorage(opts.sourceRefRoot, project.slug),
      ]);
      return reply.send({
        media,
        build,
        preview,
        sourceRefs,
        total: media + build + preview + sourceRefs,
        // Which of these the sweeps can reclaim without anyone republishing or re-importing.
        derived: build + preview + sourceRefs,
      });
    });

    app.get<{ Params: { projectId: string } }>('/projects/:projectId/media/unused', { config: rl(10) }, async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:read');
      const scan = await findUnusedMedia(db, ctx.projectId);
      const byId = new Map(scan.unused.map((u) => [u.id, u]));
      const all = (await contentRepo.list(ctx, 'media')) as Array<{ id: string }>;
      const items = all
        .filter((m) => byId.has(m.id))
        .map((m) => ({ ...m, onlyInHistory: byId.get(m.id)?.onlyInHistory ?? false }));
      return reply.send({ items, scanned: scan.scanned });
    });

    app.get<{ Params: { projectId: string } }>('/projects/:projectId/media/deleted', { config: rl(60) }, async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:read');
      return reply.send({ items: await contentRepo.listDeletedMedia(ctx) });
    });

    app.post<{ Params: { projectId: string; id: string } }>('/projects/:projectId/media/:id/restore', { config: rl(30) }, async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:write');
      await contentRepo.restoreMedia(ctx, req.params.id);
      mediaRecordCache.clear();
      return reply.code(204).send();
    });

    app.delete<{ Params: { projectId: string; id: string } }>('/projects/:projectId/media/:id/purge', { config: rl(30) }, async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:delete');
      // PERMANENT (Recycle Bin only): drop the DB row + the binary. `purgeMedia` guards on
      // `deletedAt IS NOT NULL`, so a LIVE asset can't be hard-deleted here — the bin + 90-day
      // recovery window can never be skipped. A leaked binary (if fs removal fails) is harmless +
      // GC-able; a leaked row would block re-creating the same asset id.
      await contentRepo.purgeMedia(ctx, req.params.id);
      mediaRecordCache.clear(); // the id is now free to be re-minted — never serve its stale record/kind
      try {
        await storage.remove(project.slug, req.params.id);
      } catch (err) {
        app.log.error({ err }, 'media binary removal failed after purge');
      }
      return reply.code(204).send();
    });

    // Empty the whole Recycle Bin: purge EVERY soft-deleted asset (DB rows + binaries) at once. Same
    // `content:delete` gate + bin-only guard as the single purge; a leaked binary (fs removal failure)
    // is harmless + GC-able. Lower rate limit — it's a heavy, deliberate action.
    app.delete<{ Params: { projectId: string } }>('/projects/:projectId/media/deleted', { config: rl(10) }, async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:delete');
      const ids = await contentRepo.purgeAllDeletedMedia(ctx);
      mediaRecordCache.clear();
      for (const id of ids) {
        try {
          await storage.remove(project.slug, id);
        } catch (err) {
          app.log.error({ err, id }, 'media binary removal failed after emptying the Recycle Bin');
        }
      }
      return reply.send({ purged: ids.length });
    });

    // --- folder + asset OPERATIONS (rename/move/copy/delete) ---------------------
    // Folders are persisted as `mediafolder` records so an EMPTY folder survives a reload;
    // non-root operations cascade to both the folder records and the assets filed under them.

    /** Persists `path` and every missing ancestor as a folder record (idempotent, deduped by path). */
    const ensureFolderRecords = async (ctx: ProjectContext, path: string): Promise<void> => {
      const existing = new Set(((await contentRepo.list(ctx, 'mediafolder')) as MediaFolderRecord[]).map((f) => f.path));
      for (const p of [...ancestorPaths(path), path]) {
        if (!existing.has(p)) {
          const id = newId();
          await contentRepo.put(ctx, 'mediafolder', id, { id, path: p });
          existing.add(p);
        }
      }
    };

    /** Duplicates an asset (new id + copied binaries + rewritten url), optionally into another folder. */
    const duplicateAsset = async (
      ctx: ProjectContext,
      projectSlug: string,
      asset: MediaAsset,
      folder: string,
    ): Promise<MediaAsset> => {
      // A fresh short (flat) id, unique within the project. copyAsset writes the source's binaries
      // under the new `<id>-<file>` names; the url is the flat delivery shape.
      const dupId = await mintAssetId(ctx);
      await storage.copyAsset(projectSlug, asset.id, dupId);
      const logical =
        asset.kind === 'image' ? asset.original : asset.kind === 'font' ? asset.files[0]!.file : asset.storedName;
      const url = `/media/${projectSlug}/${dupId}-${logical}`;
      const copy = { ...asset, id: dupId, folder, url } as MediaAsset;
      return (await contentRepo.put(ctx, 'media', dupId, copy)) as MediaAsset;
    };

    const FolderPathBody = z.object({ path: MediaFolderSchema.refine((v) => v !== '', 'path is required') });
    const FolderMoveBody = z.object({
      from: MediaFolderSchema,
      to: MediaFolderSchema,
    });

    // List the persisted folder records (the editor unions these with asset-derived folders).
    app.get<{ Params: { projectId: string } }>('/projects/:projectId/media/folders', async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:read');
      // A folder RECORD exists only for a folder someone explicitly CREATED. Assets filed straight into
      // a path (every importer-created folder, for one) have no record, so this returned almost nothing
      // while the library was fully organised — measured on a real project: 1 record against 10 folders
      // actually in use. That makes "look at the folders before you organise", which this endpoint's own
      // description tells you to do, return a misleading answer. Union the records with the paths that
      // are genuinely in use, plus their ancestors, so the answer is the real folder tree.
      const [records, media] = await Promise.all([
        contentRepo.list(ctx, 'mediafolder') as Promise<MediaFolderRecord[]>,
        contentRepo.list(ctx, 'media') as Promise<MediaAsset[]>,
      ]);
      const paths = new Map<string, MediaFolderRecord>();
      for (const r of records) paths.set(r.path, r);
      for (const asset of media) {
        const folder = String((asset as { folder?: string }).folder ?? '').replace(/^\/+|\/+$/g, '');
        if (!folder) continue;
        // "a/b/c" implies "a" and "a/b" exist too — a picker needs the ancestors to render the tree.
        const segs = folder.split('/');
        for (let i = 1; i <= segs.length; i++) {
          const p = segs.slice(0, i).join('/');
          if (!paths.has(p)) paths.set(p, { id: `used:${p}`, path: p });
        }
      }
      const items = [...paths.values()].sort((a, b) => a.path.localeCompare(b.path));
      return reply.send({ items });
    });

    // Create an (empty) folder + any missing ancestors.
    app.post<{ Params: { projectId: string } }>('/projects/:projectId/media/folders', { config: rl(60) }, async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:write');
      if (!WRITE_ROLES.has(ctx.role)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const body = FolderPathBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid folder path' });
      await ensureFolderRecords(ctx, body.data.path);
      return reply.code(201).send({ ok: true });
    });

    // Rename OR move a folder: re-root the folder subtree AND every asset filed under it.
    app.post<{ Params: { projectId: string } }>('/projects/:projectId/media/folders/rename', { config: rl(60) }, async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:write');
      if (!WRITE_ROLES.has(ctx.role)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const body = FolderMoveBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid folder path' });
      const { from, to } = body.data;
      const err = validateFolderMove(from, to);
      if (err) return reply.code(400).send({ error: err });
      const folders = (await contentRepo.list(ctx, 'mediafolder')) as MediaFolderRecord[];
      // Refuse to merge into an existing folder — it would create a duplicate `to` record
      // (the `from` record reparents to `to`, joining the one already there).
      if (folders.some((f) => f.path === to)) {
        return reply.code(409).send({ error: 'a folder with that name already exists' });
      }
      // Ensure the new parent chain exists (NOT `to` itself — the `from` record becomes it,
      // so pre-creating `to` would leave a duplicate).
      for (const ancestor of ancestorPaths(to)) await ensureFolderRecords(ctx, ancestor);
      // Re-root the matching folder records (path + descendants).
      for (const f of folders) {
        if (isUnderFolder(f.path, from)) {
          await contentRepo.put(ctx, 'mediafolder', f.id, { id: f.id, path: reparentPath(f.path, from, to) });
        }
      }
      // Re-file every asset under `from`.
      const assets = (await contentRepo.list(ctx, 'media')) as MediaAsset[];
      for (const a of assets) {
        if (isUnderFolder(a.folder, from)) {
          await contentRepo.put(ctx, 'media', a.id, { ...a, folder: reparentPath(a.folder, from, to) });
        }
      }
      return reply.send({ ok: true });
    });

    // Copy a folder subtree (records + duplicated assets) to a new path.
    app.post<{ Params: { projectId: string } }>('/projects/:projectId/media/folders/copy', { config: rl(30) }, async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:write');
      if (!WRITE_ROLES.has(ctx.role)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const body = FolderMoveBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid folder path' });
      const { from, to } = body.data;
      const err = validateFolderMove(from, to);
      if (err) return reply.code(400).send({ error: err });
      const folders = (await contentRepo.list(ctx, 'mediafolder')) as MediaFolderRecord[];
      await ensureFolderRecords(ctx, to);
      for (const f of folders) {
        if (isUnderFolder(f.path, from)) await ensureFolderRecords(ctx, reparentPath(f.path, from, to));
      }
      const assets = (await contentRepo.list(ctx, 'media')) as MediaAsset[];
      for (const a of assets) {
        if (isUnderFolder(a.folder, from)) await duplicateAsset(ctx, project.slug, a, reparentPath(a.folder, from, to));
      }
      return reply.send({ ok: true });
    });

    // Delete a folder RECURSIVELY. Its assets are SOFT-deleted (→ Recycle Bin, recoverable for 90
    // days) — consistent with single-file delete; nothing is destroyed here. The folder RECORDS are
    // removed (structural shells with no binary), so the folder disappears from the tree; a restored
    // asset re-materializes its folder from its retained `folder` path (FileBrowser derives folders
    // from asset paths too), so restore stays coherent even though the record is gone.
    // Deleting a folder BINS EVERYTHING UNDER IT — the assets are soft-deleted to the Recycle Bin, not
    // just unfiled. That is the right behaviour and it used to be invisible: the call answered a bare 204
    // whether it removed an empty folder or 500 photographs, so neither a caller nor a person could tell
    // which had just happened, and there was no way to ASK first. It now reports the count, and
    // `?dryRun=1` answers the same shape while touching nothing.
    app.delete<{ Params: { projectId: string }; Querystring: { dryRun?: string } }>('/projects/:projectId/media/folders', { config: rl(60) }, async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:delete');
      if (!WRITE_ROLES.has(ctx.role)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const body = FolderPathBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid folder path' });
      const folder = body.data.path;
      const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
      const assets = (await contentRepo.list(ctx, 'media')) as MediaAsset[];
      const doomed = assets.filter((a) => isUnderFolder(a.folder, folder));
      const folders = (await contentRepo.list(ctx, 'mediafolder')) as MediaFolderRecord[];
      const doomedFolders = folders.filter((f) => isUnderFolder(f.path, folder));
      // Count the folders a PERSON sees disappear, not the folder RECORDS. A folder only gets a record
      // when someone creates or renames one — the tree also shows every path an asset lives in, so a
      // library that was only ever uploaded into has records for none of it and would report "0
      // subfolders" while removing eleven.
      const doomedPaths = new Set<string>([
        ...doomedFolders.map((f) => f.path),
        ...doomed.map((a) => a.folder).filter((f) => f && isUnderFolder(f, folder)),
      ]);
      // A sample so a confirmation prompt can name what is at stake rather than only counting it.
      const report = {
        folder,
        assets: doomed.length,
        folders: doomedPaths.size,
        sample: doomed.slice(0, 5).map((a) => a.filename),
      };
      if (dryRun) return reply.send({ ...report, dryRun: true });
      for (const a of doomed) await contentRepo.softDeleteMedia(ctx, a.id);
      if (doomed.length > 0) mediaRecordCache.clear();
      for (const f of doomedFolders) await contentRepo.remove(ctx, 'mediafolder', f.id);
      // 200 with the report, not 204: what a destructive call actually did is worth saying out loud.
      // Restorable from the Recycle Bin for 90 days, which is the other half of why the count matters.
      return reply.send({ ...report, binned: doomed.length });
    });

    // Move and/or rename a single asset: `folder` re-files it, `filename` changes its display name.
    const PatchAssetBody = z.object({
      folder: MediaFolderSchema.optional(),
      filename: z.string().min(1).max(255).optional(),
    });
    // BULK re-file. The single-asset PATCH below is one round-trip per asset, so reorganising an
    // imported library meant 96 calls for one site — and it hit a 429 partway through, leaving the
    // library half-filed. Partial success is normal and reported per id, like delete_content_bulk.
    const BulkMoveBody = z.object({
      ids: z.array(z.string().min(1)).min(1).max(200),
      folder: MediaFolderSchema.optional(),
      // A rename is inherently per-asset, so bulk only moves. Renaming stays on the single PATCH.
    });
    app.post<{ Params: { projectId: string } }>('/projects/:projectId/media/bulk-move', { config: rlAgent(30) }, async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:write');
      if (!WRITE_ROLES.has(ctx.role)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const body = BulkMoveBody.safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'invalid request — ids (1-200) and a folder are required', details: body.error.flatten() });
      }
      if (body.data.folder === undefined) return reply.code(400).send({ error: 'folder is required' });
      const folder = body.data.folder;
      const ids = [...new Set(body.data.ids)];
      const moved: string[] = [];
      const failed: Array<{ id: string; error: string }> = [];
      for (const id of ids) {
        try {
          const asset = await contentRepo.getLiveMedia(ctx, id);
          await contentRepo.put(ctx, 'media', asset.id, { ...asset, folder });
          moved.push(id);
        } catch (err) {
          // One bad id must not abandon the rest half-filed — that is the failure mode this replaces.
          failed.push({ id, error: err instanceof Error ? err.message : 'move failed' });
        }
      }
      return reply.send({ moved, failed, requested: ids.length, folder });
    });

    app.patch<{ Params: { projectId: string; id: string } }>('/projects/:projectId/media/:id', { config: rl(60) }, async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:write');
      if (!WRITE_ROLES.has(ctx.role)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const body = PatchAssetBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid update' });
      // `getLiveMedia` rejects a soft-deleted (binned) asset — you restore it, you don't rename it in place.
      const asset = await contentRepo.getLiveMedia(ctx, req.params.id);
      const next = {
        ...asset,
        ...(body.data.folder !== undefined ? { folder: body.data.folder } : {}),
        ...(body.data.filename !== undefined ? { filename: body.data.filename } : {}),
      };
      return reply.send({ item: await contentRepo.put(ctx, 'media', asset.id, next) });
    });

    // Overwrite an existing SVG asset's CONTENT in place (the Studio's "save to the same file"). Re-sanitizes
    // like the upload path and keeps the asset id + stored filename, so every existing reference (<img src>,
    // {{sw-image}}, inline embeds) stays valid.
    // Cap matches sanitizeSvg's MAX_SVG_BYTES (4 MiB) so an over-limit body is rejected before buffering.
    const OverwriteSvgBody = z.object({ svg: z.string().min(1).max(4 * 1024 * 1024) });
    app.put<{ Params: { projectId: string; id: string } }>('/projects/:projectId/media/:id/svg', { config: rl(30) }, async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:write');
      if (!WRITE_ROLES.has(ctx.role)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const body = OverwriteSvgBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid svg' });
      const asset = await contentRepo.getLiveMedia(ctx, req.params.id);
      if (asset.kind !== 'image' || (asset as ImageAsset).format !== 'svg') return reply.code(400).send({ error: 'not an SVG asset' });
      const clean = sanitizeSvg(body.data.svg);
      if (!clean) return reply.code(400).send({ error: 'svg failed sanitization' });
      const buffer = Buffer.from(clean, 'utf8');
      const img = asset as ImageAsset;
      const storedName = img.original || `${MediaStorage.safeStoredName(img.filename).replace(/\.[^.]+$/, '')}.svg`;
      await storage.storeFile(project.slug, asset.id, storedName, buffer);
      const dims = svgIntrinsicSize(clean) ?? { width: img.width, height: img.height };
      const next = { ...img, bytes: buffer.length, width: Math.max(1, dims.width), height: Math.max(1, dims.height) };
      return reply.send({ item: await contentRepo.put(ctx, 'media', asset.id, next) });
    });

    // Duplicate a single asset (optionally into another folder).
    const CopyAssetBody = z.object({ folder: MediaFolderSchema.optional() });
    app.post<{ Params: { projectId: string; id: string } }>('/projects/:projectId/media/:id/copy', { config: rl(30) }, async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:write');
      if (!WRITE_ROLES.has(ctx.role)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const body = CopyAssetBody.safeParse(req.body ?? {});
      if (!body.success) return reply.code(400).send({ error: 'invalid folder' });
      // `getLiveMedia` rejects a soft-deleted (binned) asset — copying one would resurrect it outside restore.
      const asset = await contentRepo.getLiveMedia(ctx, req.params.id);
      const copy = await duplicateAsset(ctx, project.slug, asset, body.data.folder ?? asset.folder);
      return reply.code(201).send({ item: copy });
    });

    // On-demand thumbnail cache: the FIRST request for a named-size variant generates a WebP/AVIF from
    // the retained original, persists it in the asset dir, and serves it; later requests hit the cached
    // file. Concurrent misses for the same variant are COALESCED so a burst encodes exactly once. The
    // bounded named-size set (sm/md/lg/xl) is the anti-abuse boundary for this generate-on-request path;
    // thumbnails are immutable (a new upload = a new asset id).
    const inflightThumbs = new Map<string, Promise<Buffer>>();
    const ensureThumb = async (
      slug: string,
      id: string,
      originalName: string,
      size: SizeToken,
      format: ThumbFormat,
    ): Promise<Buffer> => {
      const thumbName = thumbFileName(originalName, size, format);
      try {
        return await storage.readStored(slug, id, thumbName); // cache hit
      } catch {
        /* miss → generate (coalesced) below */
      }
      // ★ Resolve the slug to a REAL project BEFORE the gate, and key the gate on its id.
      //
      // `slug` is a raw path parameter on a public, unauthenticated route, and the storage layer only
      // validates its CHARSET — never that it names anything. Keying a per-tenant gate on it would let
      // a caller invent a tenant per request (a fresh identity is scheduled FIRST, since it has been
      // served least) or, worse, spend another project's share: a slug is not a secret, it is in every
      // `<img src>` on that project's own public site. Both are fixed by refusing to let an unknown
      // slug reach the gate at all. `getBySlug` is cached, so this costs no round trip per request.
      const projectId = await resolvePublicProjectId(slug);
      if (!projectId) throw new NotFoundError('media');
      const key = `${slug}/${id}/${thumbName}`;
      let pending = inflightThumbs.get(key);
      if (!pending) {
        pending = (async () => {
          // Allocate the (up to 50 MB) original buffer ONLY once an optimize slot is granted — reading
          // it while WAITING would let a request backlog pin unbounded memory. readStored validates
          // `originalName`; a missing/invalid original throws → the route 404s.
          const buffer = await withOptimizeSlot(projectId, async () => {
            // Hand sharp the PATH, not the bytes: `readStored` is `readFile(resolveStoredPath(…))`,
            // so resolving instead keeps the identical validation and confinement while leaving the
            // original (up to 50MB) out of the heap entirely. Only the ENCODED output is resident.
            const originalPath = storage.resolveStoredPath(slug, id, originalName);
            return (await generateThumbnail(originalPath, { width: THUMB_SIZES[size], format })).buffer;
          });
          await storage.storeFile(slug, id, thumbName, buffer);
          return buffer;
        })().finally(() => inflightThumbs.delete(key));
        inflightThumbs.set(key, pending);
      }
      return pending;
    };

    // Public serving of IMAGE assets (published sites are public). The storage layer validates every
    // segment and confines the path to the asset dir, so traversal is impossible. `?size` (default xl)
    // selects an on-demand responsive thumbnail; `?size=original` serves the raw original inline;
    // `?format=avif` opts into AVIF. `nosniff` keeps the browser from re-interpreting the bytes.
    app.get<{
      Params: { projectSlug: string; assetId: string; file: string };
      Querystring: { size?: string; format?: string };
    }>(
      '/media/:projectSlug/:assetId/:file',
      { config: rl(MEDIA_ASSET_RL_MAX) },
      async (req, reply) => {
        const { projectSlug, assetId, file } = req.params;
        // A SHORT id is a FLAT asset — it must be served by the kind-dispatching flat route above, never
        // by this extension-dispatching legacy route (which would serve a raw upload inline by extension).
        if (isShortAssetId(assetId)) return reply.code(404).send({ error: 'not found' });
        const ext = (file.split('.').pop() ?? '').toLowerCase();
        // A `kind:'font'` face is served INLINE (font/* + nosniff + CORS) so a sandboxed (opaque-
        // origin) preview iframe can load it via `@font-face`; fonts are public, immutable binaries.
        if (FONT_FACE_FILE.test(file)) {
          let bytes: Buffer;
          try {
            bytes = await storage.readStored(projectSlug, assetId, file);
          } catch {
            return reply.code(404).send({ error: 'not found' });
          }
          return reply
            .header('cache-control', 'public, max-age=31536000, immutable')
            .header('x-content-type-options', 'nosniff')
            .header('access-control-allow-origin', '*')
            .header('cross-origin-resource-policy', 'cross-origin')
            .type(FONT_CONTENT_TYPES.get(ext) ?? 'font/woff2')
            .send(bytes);
        }
        // A `kind:'stylesheet'` (imported site CSS) is served INLINE as text/css (+ nosniff + CORS) so
        // a page can `<link>` it — incl. from the sandboxed, opaque-origin preview iframe. CSS is inert
        // (no script execution); it's stored via storeFile alongside fonts.
        if (/^[A-Za-z0-9_-]+\.css$/.test(file)) {
          let bytes: Buffer;
          try {
            bytes = await storage.readStored(projectSlug, assetId, file);
          } catch {
            return reply.code(404).send({ error: 'not found' });
          }
          return reply
            .header('cache-control', 'public, max-age=31536000, immutable')
            .header('x-content-type-options', 'nosniff')
            .header('access-control-allow-origin', '*')
            .header('cross-origin-resource-policy', 'cross-origin')
            .type('text/css; charset=utf-8')
            .send(bytes);
        }
        // A `kind:'script'` (imported site JS) served INLINE as text/javascript (+ nosniff + CORS) so a
        // page can `<script src>`-link it. @security Owner-only import choice; the published site is the
        // owner's own origin and the preview iframe is sandboxed. Stored via storeFile alongside CSS/fonts.
        if (/^[A-Za-z0-9_-]+\.js$/.test(file)) {
          let bytes: Buffer;
          try {
            bytes = await storage.readStored(projectSlug, assetId, file);
          } catch {
            return reply.code(404).send({ error: 'not found' });
          }
          return reply
            .header('cache-control', 'public, max-age=31536000, immutable')
            .header('x-content-type-options', 'nosniff')
            .header('access-control-allow-origin', '*')
            .header('cross-origin-resource-policy', 'cross-origin')
            .type('text/javascript; charset=utf-8')
            .send(bytes);
        }
        // An SVG (kind:'image', format:'svg') is served INLINE as image/svg+xml so a cloned <img src>
        // renders — but under a LOCKED-DOWN CSP (no scripts, no external fetches) that neutralizes any
        // residual direct-navigation vector (the bytes were already sanitized on store; `<img>` rendering
        // is secure-static anyway). `?size`/`?format` are ignored — a vector scales natively. + nosniff +
        // CORS so the sandboxed (opaque-origin) preview iframe can load it too.
        //
        // CACHE: SVG is the ONE media kind that can be OVERWRITTEN in place (the Studio's "save to the same
        // file" → PUT …/svg keeps the asset id + URL), so its URL is MUTABLE. Serving it `immutable` froze
        // the pre-edit bytes in the browser for a year → an overwrite never reached an open editor (re-import
        // showed the un-animated original) or a live `<img>`. Serve it revalidating (`no-cache`) with a
        // content ETag so a re-fetch is a cheap conditional request: 304 while unchanged, fresh 200 after a save.
        if (isSvgFile(file)) {
          let bytes: Buffer;
          try {
            bytes = await storage.readStored(projectSlug, assetId, file);
          } catch {
            return reply.code(404).send({ error: 'not found' });
          }
          const etag = `"${createHash('sha256').update(bytes).digest('base64url').slice(0, 27)}"`;
          // The strict SVG headers are repeated on BOTH branches: a 304 that omitted the CSP would let the
          // global onSend hook stamp the weaker default policy, which the browser then merges into its cached
          // 200 — silently downgrading the sandboxed `default-src 'none'` policy. If-None-Match may carry a
          // comma list (RFC 9110 §13.1.2), so match against any listed validator.
          const svgHeaders = (r: typeof reply) =>
            r
              .header('etag', etag)
              .header('cache-control', 'no-cache')
              .header('x-content-type-options', 'nosniff')
              .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox")
              .header('access-control-allow-origin', '*')
              .header('cross-origin-resource-policy', 'cross-origin');
          const inmRaw = req.headers['if-none-match'];
          const inm = Array.isArray(inmRaw) ? inmRaw.join(',') : inmRaw;
          if (typeof inm === 'string' && inm.split(',').some((v) => v.trim() === etag)) {
            return svgHeaders(reply).code(304).send();
          }
          return svgHeaders(reply).type('image/svg+xml; charset=utf-8').send(bytes);
        }
        // IMAGE delivery. `file` is the stored ORIGINAL name (any raster ext). `?size` (default xl)
        // selects a responsive thumbnail generated on demand + cached; `?size=original` serves the raw
        // original inline; `?format=avif` opts into AVIF (WebP is the default).
        if (isThumbnailable(file)) {
          const q = req.query;
          if (q.size === 'original') {
            let original: Buffer;
            try {
              original = await storage.readStored(projectSlug, assetId, file);
            } catch {
              return reply.code(404).send({ error: 'not found' });
            }
            return reply
              .header('cache-control', 'public, max-age=31536000, immutable')
              .header('x-content-type-options', 'nosniff')
              .type(MEDIA_CONTENT_TYPES.get(ext) ?? 'application/octet-stream')
              .send(original);
          }
          const size: SizeToken = q.size && isSizeToken(q.size) ? q.size : DEFAULT_SIZE;
          const format: ThumbFormat = q.format && isThumbFormat(q.format) ? q.format : 'webp';
          let bytes: Buffer;
          try {
            bytes = await ensureThumb(projectSlug, assetId, file, size, format);
          } catch (err) {
            // A full optimize queue is a transient overload → retryable 503 (Retry-After); anything else
            // (missing/invalid original) is a genuine 404.
            if ((err as { statusCode?: number }).statusCode === 503) {
              return reply.code(503).header('retry-after', '2').send({ error: 'server busy' });
            }
            return reply.code(404).send({ error: 'not found' });
          }
          return reply
            .header('cache-control', 'public, max-age=31536000, immutable')
            .header('x-content-type-options', 'nosniff')
            .type(format === 'avif' ? 'image/avif' : 'image/webp')
            .send(bytes);
        }
        return reply.code(404).send({ error: 'not found' });
      },
    );

    // Public serving of RAW (non-image) file assets. ALWAYS download-only: octet-stream +
    // `Content-Disposition: attachment` + `nosniff`, so an uploaded HTML/SVG/script can never
    // render or execute on this (cookie-bearing) origin. Distinct `/file/` path segment.
    app.get<{ Params: { projectSlug: string; assetId: string; file: string } }>(
      '/media/:projectSlug/:assetId/file/:file',
      { config: rl(MEDIA_ASSET_RL_MAX) },
      async (req, reply) => {
        const { projectSlug, assetId, file } = req.params;
        // A SHORT id is a FLAT asset served by the flat route (kind-dispatched), never this legacy path.
        if (isShortAssetId(assetId)) return reply.code(404).send({ error: 'not found' });
        let bytes: Buffer;
        try {
          bytes = await storage.readStored(projectSlug, assetId, file);
        } catch {
          return reply.code(404).send({ error: 'not found' });
        }
        // `file` is the STORED_FILE-validated stored name (no quotes/CRLF/Unicode) — safe in the
        // header. Do NOT swap in the asset's original `filename`, which is unsanitized (255 chars,
        // arbitrary Unicode/quotes) and would enable header injection.
        //
        // PDF is served INLINE + same-origin-frameable (application/pdf + nosniff + PDF_MEDIA_CSP): a
        // browser renders it in its own sandboxed viewer (no DOM/cookie/origin access), and nosniff +
        // the explicit type stop any HTML-reinterpretation. This lets a cloned "company profile" modal
        // <iframe> show the doc instead of forcing a download. Everything else stays download-only
        // (octet-stream + attachment) so an uploaded HTML/SVG/script can never render on this origin.
        if (file.toLowerCase().endsWith('.pdf')) {
          return reply
            .header('cache-control', 'public, max-age=31536000, immutable')
            .header('x-content-type-options', 'nosniff')
            .header('content-security-policy', PDF_MEDIA_CSP)
            // frame-ancestors 'self' is the real guard; SAMEORIGIN mirrors it for legacy browsers that
            // don't implement frame-ancestors (defence-in-depth parity with the HTML page path).
            .header('x-frame-options', 'SAMEORIGIN')
            .type('application/pdf')
            .send(bytes);
        }
        return reply
          .header('cache-control', 'public, max-age=31536000, immutable')
          .header('x-content-type-options', 'nosniff')
          .header('content-disposition', `attachment; filename="${file}"`)
          .type('application/octet-stream')
          .send(bytes);
      },
    );

    // FLAT public serving: `/media/<slug>/<id>-<name>` (the new short-id, single-folder scheme). The
    // legacy `/media/<slug>/<id>/…` routes above still serve un-migrated (uuid) assets. This route
    // dispatches on the asset's AUTHORITATIVE `kind` (looked up + cached), NOT the file extension — so a
    // raw-uploaded `.js`/`.svg`/`.html` (kind:'file') can never be served inline/executable; only a
    // genuine imported `kind:'script'`/`'stylesheet'` or svg `kind:'image'` is. (Serving mirrors the
    // legacy routes; it is intentionally self-contained and is removed with them in the migration PR.)
    app.get<{
      Params: { projectSlug: string; file: string };
      Querystring: { size?: string; format?: string };
    }>('/media/:projectSlug/:file', { config: rl(MEDIA_ASSET_RL_MAX) }, async (req, reply) => {
      const { projectSlug, file } = req.params;
      // `<id>-<name>`: the id is a fixed short base62 token (no hyphen), so the FIRST hyphen splits it.
      const dash = file.indexOf('-');
      if (dash <= 0) return reply.code(404).send({ error: 'not found' });
      const assetId = file.slice(0, dash);
      const name = file.slice(dash + 1);
      if (!isShortAssetId(assetId) || !name || name.includes('/')) return reply.code(404).send({ error: 'not found' });
      const asset = await resolvePublicMediaAsset(projectSlug, assetId);
      if (!asset) return reply.code(404).send({ error: 'not found' });
      const ext = (name.split('.').pop() ?? '').toLowerCase();
      const read = (): Promise<Buffer | null> => storage.readStored(projectSlug, assetId, name).catch(() => null);
      const CORS = (r: typeof reply): typeof reply =>
        r
          .header('cache-control', 'public, max-age=31536000, immutable')
          .header('x-content-type-options', 'nosniff')
          .header('access-control-allow-origin', '*')
          .header('cross-origin-resource-policy', 'cross-origin');

      // A FONT FACE, by kind OR by being one. The kind alone is not enough: the site importer stores a
      // scraped webfont as `kind:'file'` with a `font/*` contentType, and the legacy nested route used to
      // serve those correctly because it dispatched on the EXTENSION. Under the flat scheme they fell
      // through to the download branch — `application/octet-stream`, `content-disposition: attachment`,
      // no CORS — so every `@font-face` pointing at `/media/…` failed in the SANDBOXED page-editor
      // preview (opaque origin ⇒ the fetch is cross-origin ⇒ no ACAO, no font) and the text silently
      // rendered in the fallback family. The published site and the whole-site preview were unaffected,
      // because the build copies the bytes into `_assets/` and serves them by extension — which is
      // exactly the "different fonts in the page preview" report.
      //
      // @security This is not the extension-dispatch the flat route rejects. That rule exists to stop a
      // raw `.js`/`.svg`/`.html` upload being served executable/renderable on this origin. A font is an
      // inert binary: it cannot execute, it is still `nosniff`, and the browser simply fails to parse
      // anything that is not really a font.
      // `name.toLowerCase()`: the extension table is already lowercased, and an imported `Font.WOFF2`
      // is still a font — matching case-sensitively would drop it into the download branch, which is
      // the very failure this whole branch exists to fix.
      if (asset.kind === 'font' || (asset.kind === 'file' && FONT_FACE_FILE.test(name.toLowerCase()))) {
        const bytes = await read();
        if (!bytes) return reply.code(404).send({ error: 'not found' });
        // ★ The EXTENSION only nominates a candidate; the BYTES decide. Serving on the filename alone
        // would let anyone with upload permission park arbitrary content at a public, CORS-open,
        // inline-served URL on the platform's own origin just by naming it `.woff2` — the upload path
        // already refuses to call such a file a font (`detectFontFormat` is a magic-byte check), and
        // the serve path has no business being more credulous than the store path. A genuine imported
        // webfont passes; anything else falls through to the download-only branch below.
        if (asset.kind === 'font' || detectFontFormat(bytes)) {
          return CORS(reply).type(FONT_CONTENT_TYPES.get(ext) ?? 'font/woff2').send(bytes);
        }
      }
      if (asset.kind === 'stylesheet') {
        const bytes = await read();
        if (!bytes) return reply.code(404).send({ error: 'not found' });
        return CORS(reply).type('text/css; charset=utf-8').send(bytes);
      }
      if (asset.kind === 'script') {
        // @security Inline foreign JS is served ONLY for a genuine imported `kind:'script'` (owner-only
        // import; the published site is the owner's own origin; preview is sandboxed). A raw `.js` upload
        // is `kind:'file'` and falls through to download-only below.
        const bytes = await read();
        if (!bytes) return reply.code(404).send({ error: 'not found' });
        return CORS(reply).type('text/javascript; charset=utf-8').send(bytes);
      }
      if (asset.kind === 'video') {
        // INLINE with its real type — a background video has to play, not download. nosniff still
        // applies, and the type comes from our own extension table rather than the upload's claim.
        const bytes = await read();
        if (!bytes) return reply.code(404).send({ error: 'not found' });
        const type = VIDEO_CONTENT_TYPES.get(ext) ?? asset.contentType;
        // RANGE REQUESTS, for real. Advertising `accept-ranges` while ignoring `Range:` is the exact
        // kind of untrue signal this codebase keeps getting bitten by: the browser believes it can
        // seek, asks for a byte window, gets the whole file with a 200, and SNAPS BACK TO 0. Measured
        // on the first cut of this route — `video.currentTime = 6` landed at 0. It also means a 16 MB
        // background video downloads in full before it can start.
        const ranged = partialContent(bytes, req.headers.range);
        if (ranged === 'unsatisfiable') {
          return CORS(reply).code(416).header('content-range', `bytes */${bytes.length}`).send();
        }
        if (ranged) {
          return CORS(reply)
            .code(206)
            .header('accept-ranges', 'bytes')
            .header('content-range', ranged.contentRange)
            .header('content-length', String(ranged.body.length))
            .type(type)
            .send(ranged.body);
        }
        return CORS(reply).header('accept-ranges', 'bytes').type(type).send(bytes);
      }
      if (asset.kind === 'file') {
        // ALWAYS download-only (octet-stream + attachment + nosniff) so an uploaded HTML/SVG/script can
        // never render/execute on this origin — EXCEPT a PDF, served inline + same-origin-frameable so a
        // cloned modal <iframe> can show it (browser's sandboxed viewer; nosniff + explicit type).
        const bytes = await read();
        if (!bytes) return reply.code(404).send({ error: 'not found' });
        if (ext === 'pdf') {
          return reply
            .header('cache-control', 'public, max-age=31536000, immutable')
            .header('x-content-type-options', 'nosniff')
            .header('content-security-policy', PDF_MEDIA_CSP)
            .header('x-frame-options', 'SAMEORIGIN')
            .type('application/pdf')
            .send(bytes);
        }
        return reply
          .header('cache-control', 'public, max-age=31536000, immutable')
          .header('x-content-type-options', 'nosniff')
          // `name` is STORED_FILE-validated (no quotes/CRLF/Unicode) — safe in the header.
          .header('content-disposition', `attachment; filename="${name}"`)
          .type('application/octet-stream')
          .send(bytes);
      }
      // kind:'image'. An SVG (format:'svg') is served inline under a locked-down CSP + a revalidating
      // ETag (it can be overwritten in place via the Studio, so its URL is mutable — never `immutable`).
      if (asset.format === 'svg' || isSvgFile(name)) {
        const bytes = await read();
        if (!bytes) return reply.code(404).send({ error: 'not found' });
        const etag = `"${createHash('sha256').update(bytes).digest('base64url').slice(0, 27)}"`;
        const svgHeaders = (r: typeof reply): typeof reply =>
          r
            .header('etag', etag)
            .header('cache-control', 'no-cache')
            .header('x-content-type-options', 'nosniff')
            .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox")
            .header('access-control-allow-origin', '*')
            .header('cross-origin-resource-policy', 'cross-origin');
        const inmRaw = req.headers['if-none-match'];
        const inm = Array.isArray(inmRaw) ? inmRaw.join(',') : inmRaw;
        if (typeof inm === 'string' && inm.split(',').some((v) => v.trim() === etag)) {
          return svgHeaders(reply).code(304).send();
        }
        return svgHeaders(reply).type('image/svg+xml; charset=utf-8').send(bytes);
      }
      // Raster image: `?size` (default xl) picks an on-demand thumbnail; `?size=original` serves the raw
      // original inline; `?format=avif` opts into AVIF.
      if (isThumbnailable(name)) {
        const q = req.query;
        if (q.size === 'original') {
          const original = await read();
          if (!original) return reply.code(404).send({ error: 'not found' });
          return reply
            .header('cache-control', 'public, max-age=31536000, immutable')
            .header('x-content-type-options', 'nosniff')
            .type(MEDIA_CONTENT_TYPES.get(ext) ?? 'application/octet-stream')
            .send(original);
        }
        const size: SizeToken = q.size && isSizeToken(q.size) ? q.size : DEFAULT_SIZE;
        const format: ThumbFormat = q.format && isThumbFormat(q.format) ? q.format : 'webp';
        let bytes: Buffer;
        try {
          bytes = await ensureThumb(projectSlug, assetId, name, size, format);
        } catch (err) {
          if ((err as { statusCode?: number }).statusCode === 503) {
            return reply.code(503).header('retry-after', '2').send({ error: 'server busy' });
          }
          return reply.code(404).send({ error: 'not found' });
        }
        return reply
          .header('cache-control', 'public, max-age=31536000, immutable')
          .header('x-content-type-options', 'nosniff')
          .type(format === 'avif' ? 'image/avif' : 'image/webp')
          .send(bytes);
      }
      return reply.code(404).send({ error: 'not found' });
    });
  }

  // Assembles the inputs a static build needs from the project's current DB content — shared by
  // the published build (`POST /publish`) and the live-preview DRAFT build, so the two always
  // render from an identical bundle (no drift). The publish-time JSON snapshot is fetched by each
  // caller (different error policy: publish 409s on a bad URL; preview skips best-effort).
  async function assembleBuildInputs(
    ctx: ProjectContext,
    project: Awaited<ReturnType<ProjectRepository['get']>>,
  ): Promise<{
    bundle: ProjectBundle;
    media: MediaAsset[];
    captcha: CaptchaRenderConfig | undefined;
    snippets: Record<string, string>;
    globalTemplates: Template[];
  }> {
    const exp = await contentRepo.exportBundle(ctx, project);
    // Per-locale page overrides + form definitions are publish INPUTS (like media), not portable
    // project artifacts — loaded here rather than in the export bundle.
    const translations = (await contentRepo.list(ctx, 'translation')) as PageTranslation[];
    const forms = (await contentRepo.list(ctx, 'form')) as Form[];
    const imageMaps = (await contentRepo.list(ctx, 'imagemap')) as ImageMap[];
    const bundle: ProjectBundle = {
      // ExportBundle.project omits formatVersion (a format concern, not a DB field); re-add it.
      project: { formatVersion: exp.formatVersion, ...exp.project },
      pages: exp.pages,
      templates: exp.templates,
      datasets: exp.datasets,
      entries: exp.entries,
      translations,
      forms,
      imageMaps,
    };
    // `media` includes `kind:'font'` assets — copyMedia bundles their faces (zero font-CDN refs).
    const media = mediaStorage ? ((await contentRepo.list(ctx, 'media')) as MediaAsset[]) : [];
    const instance = await instanceSettingsRepo.getStored();
    const captcha = captchaRenderConfig(await loadProjectCaptchaById(db, project.id));
    // Inherit the instance-wide default image delivery format when this project hasn't chosen one, so the
    // admin's `defaultImageFormat` actually governs {{sw-image}} (build.ts reads website.imageDelivery).
    // Covers BOTH publish and the live-preview build (they share this assembly) and the isolated worker
    // (the resolved value rides on the bundle).
    if (instance.defaultImageFormat && !bundle.project.website?.imageDelivery) {
      bundle.project.website = { ...(bundle.project.website ?? {}), imageDelivery: instance.defaultImageFormat };
    }
    // Reusable `{{> compose}}` partials: built-in globals + the project's own (project wins).
    const snippets = {
      ...(await globalSnippetPartials(contentRepo)),
      ...Object.fromEntries(((await contentRepo.list(ctx, 'snippet')) as Snippet[]).map((s) => [s.name, s.source])),
    };
    // The runtime GLOBAL template library so a `global:<id>` ref resolves to the admin-edited source.
    const globalTemplates = await listGlobalTemplates(contentRepo);
    return { bundle, media, captcha, snippets, globalTemplates };
  }

  // Renders the project's full static site to `outDir` — the shared build for BOTH local publish and
  // (now) deploy, so a deploy always ships the latest content (build-at-deploy-time). Throws
  // PublishError (bad route graph) or JsonDataError (bad json_data URL) — both author-correctable (409).
  async function buildToDir(
    ctx: ProjectContext,
    project: Awaited<ReturnType<ProjectRepository['get']>>,
    outDir: string,
    buildOpts: { minify?: boolean } = {},
  ): Promise<ReleaseManifest> {
    const { bundle, media, captcha, snippets, globalTemplates } = await assembleBuildInputs(ctx, project);
    // Publish-time JSON snapshot: fetch + parse `website.jsonDataUrl` in THIS (networked) process —
    // SSRF-guarded — then pass the parsed value into the build. A bad URL throws JsonDataError (→ 409).
    let jsonData: unknown;
    const jsonDataUrl = bundle.project.website?.jsonDataUrl;
    if (jsonDataUrl) jsonData = await fetchJsonData(jsonDataUrl);
    return buildRunner.run({
      outDir,
      bundle,
      publishedAt: new Date().toISOString(),
      media,
      ...(opts.publicUrl ? { publicBaseUrl: opts.publicUrl } : {}),
      ...(captcha ? { captcha } : {}),
      ...(jsonData !== undefined ? { jsonData } : {}),
      ...(Object.keys(snippets).length ? { snippets } : {}),
      globalTemplates,
      // Minify is now a `local` deploy-target serve option (the caller passes it) — no longer a website field.
      ...(buildOpts.minify ? { minifyHtml: true } : {}),
      // readStored accepts image variant / raw file / font face names (superset) — all copied in.
      readMedia: mediaStorage ? (assetId, file) => mediaStorage.readStored(project.slug, assetId, file) : undefined,
      // Generated thumbnails go back into the asset dir — the same cache `ensureThumb` fills — so a
      // rebuild copies them instead of re-encoding every referenced image from its original.
      storeMedia: mediaStorage
        ? (assetId, file, data) => mediaStorage.storeFile(project.slug, assetId, file, data)
        : undefined,
    });
  }

  // The project's `local` deploy target (Local Hosting), or undefined when none is configured. Local
  // hosting is opt-in: a project is built + served at `/sites/<slug>/` only when this target exists.
  async function findLocalTarget(ctx: ProjectContext): Promise<DeployTarget | undefined> {
    const targets = (await contentRepo.list(ctx, 'deploy_target')) as DeployTarget[];
    return targets.find((t) => t.protocol === 'local');
  }

  /**
   * Where a built site can actually be REACHED — the shared answer behind both publish responses.
   *
   * ★ "A release exists" and "the site is live somewhere we can name" are DIFFERENT facts, and conflating
   * them cost a real false completion: `url` used to be returned UNCONDITIONALLY, so a freshly cloned
   * project with no deploy target reported `{ url: "https://<slug>.<sitesDomain>/", localHosting: false }`
   * — a URL that 404s, sitting right next to the field saying why. The editor was fine (it gates its "View"
   * button on `localHosting`), but MCP hands the object to an agent verbatim, and an agent reasonably reads
   * `url` as "where this is". One reported a clone as published at an address that had never served.
   * So: no deploy target at all → the project is UNPUBLISHED, whatever build artifacts exist on disk; and
   * `url` is non-null ONLY for local hosting, the one case where this app is the thing doing the serving
   * (a remote FTP/SFTP/Git target uploads to an origin we cannot know). `previewUrl` is always available
   * and is the honest answer to "let me see it" — signed, no login needed, and it serves the DRAFT.
   */
  async function hostingState(
    ctx: ProjectContext,
    project: { id: string; slug: string },
  ): Promise<{ local?: DeployTarget; deployTargets: number; url: string | null; previewUrl: string | null }> {
    const targets = (await contentRepo.list(ctx, 'deploy_target')) as DeployTarget[];
    const local = targets.find((t) => t.protocol === 'local');
    return {
      local,
      deployTargets: targets.length,
      url: local ? servedSiteUrl(project.slug) : null,
      previewUrl: draftPreviewBase(project.id),
    };
  }

  // Builds the site fresh into a throwaway temp directory and returns its path — used by deploy so the
  // upload ships the CURRENT content without first running (or disturbing) the local-publish artifact.
  // Takes the project ID (re-fetched here) so the deploy-target module needn't carry the project type.
  // The caller MUST remove the directory when done. Propagates PublishError/JsonDataError for a 409.
  async function buildForDeploy(
    ctx: ProjectContext,
    projectId: string,
    deployOpts: { minify?: boolean; protocol?: string } = {},
  ): Promise<string> {
    const project = await projects.get(projectId);
    const dir = await mkdtemp(join(tmpdir(), 'sw-deploy-'));
    try {
      // `minify` mirrors the saved target's `minifyHtml` serve option — available for ALL deploy
      // targets (the caller passes it). The legacy ad-hoc `/publish/deploy` route has no saved target,
      // so it omits this and builds unminified by design.
      await buildToDir(ctx, project, dir, { minify: !!deployOpts.minify });
      // A remote deploy ships this build to the OWNER's host. Without a configured public URL, a
      // platform-routed (Email/SMTP) form's endpoint is baked root-relative (`/f/…`) and would resolve
      // to the deployed host (no such route → 404). Refuse rather than ship a form that silently fails
      // to submit. Local hosting builds via buildToDir directly (not this path), so relative endpoints
      // there — which DO work on the platform origin / via the subdomain carve-out — are unaffected.
      // Gated on `!opts.publicUrl`: when it IS set, buildToDir bakes ABSOLUTE endpoints, so the guard
      // would never match — skipping it is both correct and a small win, not a behavioural exception.
      if (!opts.publicUrl) await assertRemoteFormEndpointsReachable(dir);
      // `contact.php (SMTP)` forms need their credentials alongside the handler. This runs HERE —
      // main process, after the build, into the throwaway deploy dir — and never in the build
      // worker (no secrets by design) or the persisted publish store (the member-readable archive
      // zip would expose it). Refuses a git target outright. See writePhpSmtpConfig.
      await writePhpSmtpConfig({
        dir,
        forms: (await contentRepo.list(ctx, 'form')) as Form[],
        protocol: deployOpts.protocol ?? '',
        formModes: await instanceSettingsRepo.getFormModes(),
        smtp: await loadProjectSmtp(db, projectId),
        ...(opts.encryptionKey ? { encryptionKey: opts.encryptionKey } : {}),
      });
      return dir;
    } catch (err) {
      await rm(dir, { recursive: true, force: true });
      throw err;
    }
  }

  // ---- Publishing (build a static site + serve it) ----
  if (publishStore) {
    const store = publishStore;
    // Build/rebuild the project's static site from the current DB content.
    app.post<{ Params: { projectId: string } }>(
      '/projects/:projectId/publish',
      { config: rl(20) },
      async (req, reply) => {
        const { ctx, project } = await resolveProject(req, 'publish');
        if (!WRITE_ROLES.has(ctx.role)) {
          return reply.code(403).send({ error: 'insufficient role for this operation' });
        }
        if (activePublishes.has(project.id)) {
          return reply.code(409).send({ error: 'a build is already in progress for this project' });
        }
        activePublishes.add(project.id);
        try {
          // Build the local artifact. Minify follows the `local` deploy target's serve option (if one is
          // configured); the site is only SERVED at /sites/<slug>/ when a local target exists (the gate
          // there enforces it) — so building without one just produces a downloadable/servable-later build.
          const hosting = await hostingState(ctx, project);
          const release = await buildToDir(ctx, project, store.dirFor(project.slug), {
            minify: !!hosting.local?.minifyHtml,
          });
          // The DURABLE record of this publish. Kept in the database rather than read back out of the
          // build, so reaping the build (see the retention rule below) cannot destroy the answer to
          // "is the published site out of date?".
          await releasesRepo.record(project.id, release);

          // ★ RETENTION IS THE SWEEP'S JOB, NOT THIS ROUTE'S. A build for a project with no Local
          // Hosting target serves nothing, but deleting it HERE would punish the ordinary sequence
          // "publish, then turn on hosting": the bytes would be gone seconds before they were wanted,
          // and the author would have to publish twice for no reason they could see. The hourly sweep
          // removes it instead, which bounds the disk just as well and leaves that window open.
          // Just published → nothing newer than this release, so the site is not dirty.
          return reply.send({
            status: hosting.deployTargets === 0 ? 'unpublished' : 'published',
            release,
            url: hosting.url,
            previewUrl: hosting.previewUrl,
            dirty: false,
            localHosting: !!hosting.local,
            deployTargets: hosting.deployTargets,
            ...(hosting.deployTargets === 0
              ? { reason: 'built, but this project has no deploy target — nothing serves it yet. Add one (Local Hosting, FTP/SFTP or Git) to put it online; until then use previewUrl to view it.' }
              : {}),
          });
        } catch (err) {
          // Author-correctable: a bad route graph (PublishError) or a bad json_data URL (JsonDataError).
          if (err instanceof PublishError || err instanceof JsonDataError) {
            return reply.code(409).send({ error: err.message });
          }
          throw err;
        } finally {
          activePublishes.delete(project.id);
        }
      },
    );

    app.get<{ Params: { projectId: string } }>(
      '/projects/:projectId/publish',
      async (req, reply) => {
        const { ctx, project } = await resolveProject(req, 'content:read');
        const release = await releasesRepo.get(project.id, () => store.readRelease(project.slug));
        // Dirty = there is publishable content AND it changed since the last release (or there is
        // no release yet). Drives the editor's "changes to deploy" hint.
        const latest = await contentRepo.latestContentUpdate(ctx);
        const dirty =
          latest !== null && (release === null || latest.getTime() > Date.parse(release.publishedAt));
        // `localHosting` = a `local` deploy target exists, so the site is (or can be) served at /sites/.
        // `status` is the headline an agent should act on: with NO deploy target the project is UNPUBLISHED
        // no matter how many releases were built, because nothing serves them. See hostingState().
        const hosting = await hostingState(ctx, project);
        return reply.send({
          status: hosting.deployTargets === 0 || !release ? 'unpublished' : 'published',
          release,
          url: hosting.url,
          previewUrl: hosting.previewUrl,
          dirty,
          localHosting: !!hosting.local,
          deployTargets: hosting.deployTargets,
          ...(hosting.deployTargets === 0
            ? { reason: 'this project has no deploy target, so nothing serves it — there is no live URL. Add one (Local Hosting, FTP/SFTP or Git) to put it online; until then use previewUrl to view it.' }
            : {}),
          ...(hosting.local?.previewToken ? { previewToken: hosting.local.previewToken } : {}),
        });
      },
    );

    // Download the published site as a zip artifact (deploy it anywhere at a root).
    // Member-readable: the archive is the already-public published output (also
    // served unauthenticated at /sites/<id>/), so it needs no extra role gate.
    app.get<{ Params: { projectId: string } }>(
      '/projects/:projectId/publish/archive',
      async (req, reply) => {
        const { ctx, project } = await resolveProject(req, 'content:read');
        // ★ THE ARCHIVE IS THE SECOND READER OF THE BUILD DIRECTORY, and the reason it cannot simply
        // be gated on one existing. Downloading a zip is most useful precisely when a project has NO
        // deploy target — that IS the manual deployment path — so the retention rule (keep a build
        // only while Local Hosting is on) must not take the feature away.
        //
        // So: use the retained build when there is one, and otherwise build fresh into a temp dir and
        // throw it away, exactly as a remote deploy does. A publish is still required first, because
        // "export" means "the site as published", not "whatever the draft happens to be".
        const everPublished = await releasesRepo.get(project.id, () => store.readRelease(project.slug));
        if (everPublished === null) {
          return reply.code(409).send({ error: 'publish the site before exporting' });
        }
        const retained = (await store.readRelease(project.slug)) !== null;
        const dir = retained ? store.dirFor(project.slug) : await buildForDeploy(ctx, project.id);
        try {
          const zip = await archiveSite(dir);
          return reply
            .header('content-disposition', `attachment; filename="${project.slug}-site.zip"`)
            .header('content-type', 'application/zip')
            .send(zip);
        } finally {
          if (!retained) await rm(dir, { recursive: true, force: true }).catch(() => {});
        }
      },
    );

    // Deploy the published site to an external target (FTP / FTPS / SFTP). The
    // credentials in the body are used transiently and never persisted or logged.
    app.post<{ Params: { projectId: string } }>(
      '/projects/:projectId/publish/deploy',
      { config: rl(20) },
      async (req, reply) => {
        const { ctx, project } = await resolveProject(req, 'deploy');
        if (!WRITE_ROLES.has(ctx.role)) {
          return reply.code(403).send({ error: 'insufficient role for this operation' });
        }
        const config = DeployConfigSchema.parse(req.body);
        assertDeployHostAllowed(config.host);
        if (activeDeploys.has(project.id)) {
          return reply.code(409).send({ error: 'a deploy is already in progress for this project' });
        }
        activeDeploys.add(project.id);
        // Build the site FRESH, then upload it (build-at-deploy-time — no prior publish needed). A
        // build failure (bad route graph / json_data URL) is author-correctable → 409.
        let dir: string;
        try {
          dir = await buildForDeploy(ctx, project.id, { protocol: config.protocol });
        } catch (err) {
          activeDeploys.delete(project.id);
          if (err instanceof PublishError || err instanceof JsonDataError) {
            return reply.code(409).send({ error: err.message });
          }
          throw err;
        }
        try {
          const result = config.useRsync ? await deployRsync(dir, config) : await deploySite(dir, config);
          return reply.send({ deployed: result });
        } catch (err) {
          // Connection/auth/transfer failure against the operator's target server.
          // Log the detail server-side; return a generic message so the response
          // does not leak the target's banner/timing (SSRF oracle reduction).
          app.log.error(
            { host: config.host, protocol: config.protocol, errMsg: err instanceof Error ? err.message : String(err) },
            'deploy failed',
          );
          return reply.code(502).send({ error: 'deploy failed: could not connect or transfer to the target' });
        } finally {
          await rm(dir, { recursive: true, force: true });
          activeDeploys.delete(project.id);
        }
      },
    );

    // Public serving of the published static site (path-safe). HTML pages plus
    // the allowlisted text assets emitted by the builder (the compiled utility
    // sheet); binaries are served via /media.
    app.get<{ Params: { slug: string; '*': string } }>(
      '/sites/:slug/*',
      async (req, reply) => {
        const { slug } = req.params;
        const path = req.params['*'] ?? '';
        // Reached via `<slug>.<sitesDomain>` (rewritten into this route)? Then this host serves the
        // site at its ROOT, so redirects + the token cookie must be root-relative, not `/sites/<slug>/`.
        // That subdomain is also a SEPARATE origin from the editor/API — the host-only session cookie
        // is never sent to it — so it's safe to RUN the imported site's own JS there. The `/sites/<slug>/`
        // PATH form shares the cookie-bearing app origin, so it stays script-inert (download-only).
        const viaSubdomain = siteSubdomainSlug(req.headers.host) === slug;
        // RETIRE the app-origin `/sites/<slug>/` PATH form. A published page now carries the OWNER's
        // authored inline JS (permissive published CSP), which must run ONLY on the ISOLATED
        // `<slug>.<sitesDomain>` subdomain (the host-only session cookie is never sent there) — never on
        // the cookie-bearing app origin. When a sites domain is configured, 301 the whole path-form
        // request to the subdomain. Without one, the path form still serves (edge case: self-host with no
        // wildcard DNS) but SCRIPT-INERT — the CSP below strips `'unsafe-inline'` so author JS can't run
        // on the app origin. The subdomain rewrite lands here as `viaSubdomain` → no redirect (no loop).
        // The redirect embeds `slug` in the target's AUTHORITY, and find-my-way percent-DECODES the path
        // param AFTER matching — so `/sites/evil.com%2Fx/…` would arrive as slug `evil.com/x` and the `/`
        // would terminate the authority → an OPEN REDIRECT off the trusted app origin. Only ever redirect a
        // slug shaped like a real project slug; anything else falls through to the normal 404 project lookup.
        if (!viaSubdomain && sitesDomain && /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
          const fwdProto = firstForwardedValue(req.headers['x-forwarded-proto']);
          const proto = fwdProto === 'http' || fwdProto === 'https' ? fwdProto : req.protocol;
          const q = req.url.indexOf('?');
          const query = q === -1 ? '' : req.url.slice(q);
          const safePath = path.replace(/[\r\n\0]/g, '');
          // Preserve a non-standard port from the current host (`dind.local:2003` → `:2003`); sitesDomain
          // itself carries no port. Standard-port prod hosts (sitewright.buchweitz.house) have none.
          const fwdHost = firstForwardedValue(req.headers['x-forwarded-host']) ?? req.headers.host ?? '';
          const port = /:(\d+)$/.exec(fwdHost)?.[0] ?? '';
          return reply.redirect(`${proto}://${slug}.${sitesDomain}${port}/${safePath}${query}`, 301);
        }
        const siteBase = viaSubdomain ? '/' : `/sites/${slug}/`;
        // Bundled binary assets under `_assets/` (images inline; a foreign `.js` runs ONLY on the
        // isolated subdomain origin — never on the app origin; everything else download-only).
        let binary = null;
        try {
          binary = await store.readBinary(slug, path, { executableScripts: viaSubdomain });
        } catch {
          /* invalid slug → fall through to 404 below */
        }
        if (binary !== null) {
          reply
            .header('cache-control', 'public, max-age=31536000, immutable')
            // A `.js` asset's content-type depends on the Host (executable via the subdomain origin,
            // download-only via the path form), and the response is `immutable`-cached — so vary on Host
            // to stop a non-host-keyed shared cache serving the subdomain's executable copy to an
            // app-origin path-form request (defense-in-depth; compliant caches key on host already).
            .header('vary', 'Host')
            .header('x-content-type-options', 'nosniff');
          if (binary.attachment) reply.header('content-disposition', 'attachment');
          if (binary.csp) reply.header('content-security-policy', binary.csp);
          // A frameable inline PDF (its own CSP frame-ancestors 'self') mirrors that with SAMEORIGIN for
          // legacy browsers lacking frame-ancestors (parity with the HTML page path's DENY defence-in-depth).
          if (binary.contentType === 'application/pdf') reply.header('x-frame-options', 'SAMEORIGIN');
          return reply.type(binary.contentType).send(binary.body);
        }
        // Mirror the `readBinary` call above: a malformed slug makes `dirFor` throw — swallow it and fall
        // through to the 404 below (a rejected-slug asset path returns 404, not an opaque 500).
        let asset = null;
        try {
          asset = await store.readAsset(slug, path);
        } catch {
          /* invalid slug → fall through to 404 */
        }
        if (asset !== null) {
          // Cache hard ONLY when the URL carries the per-publish `?v=` token (styles.css / consent.js / …,
          // referenced that way from the page) — a republish then changes the URL. Unversioned root files
          // (site.webmanifest / robots.txt / sitemap.xml / favicons, and bare direct hits) MUST revalidate
          // so a republish is reflected — they share a fixed URL with changing content.
          const versioned = Boolean((req.query as { v?: string } | undefined)?.v);
          return reply
            .header('cache-control', versioned ? 'public, max-age=31536000, immutable' : 'no-cache')
            .type(asset.contentType)
            .send(asset.body);
        }
        const html = await store.readHtml(slug, path);
        // Unknown / unpublished path → a bare HTTP 404 (empty body), not a styled error page.
        if (html === null) return reply.code(404).send();
        // Publish-option gates apply to PAGE (HTML) responses only — the static assets above and the
        // 404 above are ungated, so the per-request settings read happens ONLY for a real page (never
        // for assets or unknown paths). The protected resource is the page; a sub-resource URL is
        // useless without it.
        // Local hosting is served ONLY when the project has a `local` deploy target (it carries the
        // serve options). No project / no local target → behave as if nothing is published here (404).
        const gateProject = await projects.getBySlug(slug).catch(() => null);
        // No project, or a SOFT-DELETED one → behave as if nothing is published (the page goes offline
        // the moment the project is deleted; its retained assets are inert without the page).
        if (!gateProject || gateProject.deletedAt) return reply.code(404).send();
        const local = await findLocalTarget({ userId: 'system', projectId: gateProject.id, role: 'owner' as const });
        if (!local) return reply.code(404).send();
        // The target's preview-token gate (a soft "unlisted preview" control). Keep clean path URLs
        // for in-site NAVIGATION: a first visit with a valid `?token=` stashes the token in a
        // path-scoped, SameSite=Lax cookie and redirects to the token-free URL; every later page (a
        // same-site top-level navigation) carries the cookie. A bare `?token=` query would be DROPPED
        // by the page's relative links, so nav would break — hence the cookie. (Constant-time compare;
        // lengths are equal-or-reject so timingSafeEqual never throws.)
        if (local.previewToken) {
          // SOFT access only — NOT a security boundary. The gate is the SECRET token (constant-time
          // compared below), not the cookie's integrity: a sibling subdomain that runs imported JS (now
          // possible per this change) could toss a `Domain=<sitesDomain>` `sw_site_<slug>` cookie, but a
          // wrong value just 403s and a right value means the attacker already holds the token — so the
          // cookie is host-only and left unprefixed. The platform SESSION cookie (the real credential)
          // is `__Host-`-hardened against exactly this tossing; see `sessionCookie`.
          const SITE_COOKIE = `sw_site_${slug}`;
          const matches = (v: string | undefined): boolean => {
            if (!v) return false;
            const a = Buffer.from(v);
            const b = Buffer.from(local.previewToken!);
            return a.length === b.length && timingSafeEqual(a, b);
          };
          // eslint-disable-next-line security/detect-object-injection -- key is `sw_site_<validated-slug>`
          const cookieTok = (req.cookies as Record<string, string | undefined> | undefined)?.[SITE_COOKIE];
          if (!matches(cookieTok)) {
            const raw = (req.query as { token?: string | string[] } | undefined)?.token;
            const queryTok = typeof raw === 'string' ? raw : '';
            if (matches(queryTok)) {
              // Valid token in the URL → remember it in a cookie + redirect to the clean (token-free) URL.
              reply.setCookie(SITE_COOKIE, local.previewToken, {
                path: siteBase,
                httpOnly: true,
                sameSite: 'lax', // sent on same-site top-level navigations (in-site link clicks)
                secure: opts.secureCookies ?? false,
                maxAge: 60 * 60 * 24 * 30, // 30 days
              });
              const safePath = path.replace(/[\r\n\0]/g, '');
              return reply.redirect(`${siteBase}${safePath}`, 302);
            }
            // charset=utf-8 so the message renders correctly; kept informative — a bare 403 would leave
            // a visitor with no idea a preview token is needed.
            return reply
              .code(403)
              .type('text/html; charset=utf-8')
              .send('<h1>403 - a preview token is required to view this site</h1>');
          }
        }
        // Redirect an EXTENSIONLESS page request that lacks its trailing slash to the canonical
        // directory URL, so the page's RELATIVE asset/link paths (`../styles.css`, `_assets/…`)
        // resolve against the right base instead of one level too high. Explicit file URLs
        // (`…/index.html`) are served as-is.
        const lastSegment = path.slice(path.lastIndexOf('/') + 1);
        if (path !== '' && !path.endsWith('/') && !lastSegment.includes('.')) {
          const q = req.url.indexOf('?');
          const query = q === -1 ? '' : req.url.slice(q);
          // Defence-in-depth: strip CR/LF/NUL before they reach the Location header. The
          // wildcard param is percent-DECODED by the router, so `%0d%0a` arrives as raw CRLF;
          // it's already unreachable here (a CRLF path maps to no published file → 404 above,
          // never this branch), but the redirect target must never carry header-breaking bytes.
          const safePath = path.replace(/[\r\n\0]/g, '');
          return reply.redirect(`${siteBase}${safePath}/${query}`, 301);
        }
        // Per-site CSP (PAGE responses only). The CSP is enforced HERE, as a response header, and ONLY on
        // platform-hosted origins — this is where the platform has something to protect (many tenants on one
        // parent domain, adjacent to the editor origin). The build ships the policy in the document as an
        // INERT `<meta name="sw-csp">`, which browsers ignore, so an EXPORTED site and the sandboxed draft
        // preview carry no enforcement at all; this promotes it to the real header for hosted traffic.
        // Reading it from the served HTML costs only a string scan — no settings read, no extra disk read —
        // and is guaranteed consistent with the page actually being served. It RELAXES the strict
        // `default-src 'self'` floor to EXACTLY the site's registered origins for both the subdomain and the
        // path form (they share this handler); route-scoped, so the editor/app origin CSP is untouched.
        const metaCsp = siteCspHeaderFromHtml(html);
        if (viaSubdomain) {
          // Isolated subdomain origin: the OWNER's authored inline JS RUNS. An embed page carries the
          // permissive CSP in its meta; a plain page has none → apply the base permissive published CSP.
          reply
            .header(
              'content-security-policy',
              metaCsp ??
                "default-src 'self'; script-src 'self' 'unsafe-inline'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
            )
            .header('x-frame-options', 'DENY');
        } else if (metaCsp) {
          // Path-form fallback on the cookie-bearing app origin (only reached when no sites domain is
          // configured — else we 301'd to the subdomain above). The policy derives ONLY from the PLATFORM's
          // own `name="sw-csp"` meta (siteCspHeaderFromHtml ignores an author `<meta>` injected via
          // website.head, which lands after <title>), so we can safely KEEP the consented origins while
          // STRIPPING script `'unsafe-inline'` — author inline JS can never run on the app origin. The
          // platform meta's script-src is always the literal `script-src 'self' 'unsafe-inline'[ <origins>]`.
          reply
            .header('content-security-policy', metaCsp.replace("script-src 'self' 'unsafe-inline'", "script-src 'self'"))
            .header('x-frame-options', 'DENY');
        } else {
          // A plain page (no platform meta). A FIXED, server-controlled strict CSP: as a RESPONSE HEADER it
          // is the enforced FLOOR (browsers apply header ∩ meta), so an author-injected `<meta>` in the body
          // can never relax it — inline JS stays blocked and the page isn't framable.
          reply
            .header(
              'content-security-policy',
              "default-src 'self'; script-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
            )
            .header('x-frame-options', 'DENY'); // DENY: the onSend default is skipped once we set our own CSP
        }
        // The PAGE always revalidates (it references the `?v=`-versioned assets above + changes per
        // republish), so a redeploy/republish is picked up immediately while its assets stay hard-cached.
        return reply.header('cache-control', 'no-cache').type('text/html').send(html);
      },
    );
  }

  // ---- Live PREVIEW: the always-on, whole-site DRAFT browse surface ----
  // A members-only render of the project's CURRENT saved content (drafts included), browsable like
  // a real site (working navigation) with NO publish required. The editor's same-origin SitePreview
  // shell embeds these pages in a sandboxed iframe and reloads/navigates on the SSE change stream, so
  // an author or agent sees edits land live. The build is ephemeral + lazy: rebuilt on the first
  // request after content changes (keyed by the latest-update stamp), then served from disk via the
  // same path-safe logic as a published site (a distinct root, never served publicly).
  if (previewSiteStore) {
    const preview = previewSiteStore;
    // Secret backing the preview SIGNATURE (a path segment that gates the draft so the sandboxed,
    // cookieless preview can navigate). Read the LIVE `currentCookieSecret` at sign/verify time (below),
    // so a security-motivated rotation invalidates outstanding preview share-links too — not just sessions.
    // After a failed build, skip rebuilding the SAME version for this long, so a project stuck in a
    // broken state (e.g. a bad Handlebars source) can't trigger a fresh build on every request.
    const PREVIEW_BUILD_COOLDOWN_MS = 3_000;

    async function buildPreviewSite(
      ctx: ProjectContext,
      project: Awaited<ReturnType<ProjectRepository['get']>>,
      version: string,
    ): Promise<void> {
      const inputs = await assembleBuildInputs(ctx, project);
      // Preview is best-effort about the publish-time JSON snapshot: a bad/unreachable source must
      // never break the live preview (publish, by contrast, 409s so the author fixes it before shipping).
      let jsonData: unknown;
      const jsonDataUrl = inputs.bundle.project.website?.jsonDataUrl;
      if (jsonDataUrl) {
        try {
          jsonData = await fetchJsonData(jsonDataUrl);
        } catch {
          /* preview tolerates a missing JSON source */
        }
      }
      const manifest = await buildRunner.run({
        outDir: preview.dirFor(project.slug),
        bundle: inputs.bundle,
        publishedAt: new Date().toISOString(),
        media: inputs.media,
        // The two preview-only switches: show work-in-progress drafts, and inject the parent-bridge
        // runtime so the editor shell can track + auto-navigate the iframe. (No minify — stays readable.)
        includeDrafts: true,
        previewRuntime: PREVIEW_SITE_RUNTIME_JS,
        // Somebody is watching a spinner for this one. (Dropped by the isolated worker runner, which
        // serializes its job — that path simply reports the generic "building" state below.)
        onProgress: (p) => void previewProgress.set(project.id, p),
        ...(opts.publicUrl ? { publicBaseUrl: opts.publicUrl } : {}),
        ...(inputs.captcha ? { captcha: inputs.captcha } : {}),
        ...(jsonData !== undefined ? { jsonData } : {}),
        ...(Object.keys(inputs.snippets).length ? { snippets: inputs.snippets } : {}),
        globalTemplates: inputs.globalTemplates,
        readMedia: mediaStorage
          ? (assetId, file) => mediaStorage.readStored(project.slug, assetId, file)
          : undefined,
        storeMedia: mediaStorage
          ? (assetId, file, data) => mediaStorage.storeFile(project.slug, assetId, file, data)
          : undefined,
      });
      previewBuiltVersion.set(project.id, version);
      // A draft build no longer aborts on a page it cannot render — it serves an error document at
      // that page's own route and carries on. Remember which pages those were, so the failure is
      // reportable from anywhere in the editor and not only by browsing onto the broken page.
      const failures = manifest.pageFailures ?? [];
      if (failures.length > 0) {
        previewPageFailures.set(project.id, failures);
        app.log.warn(
          { projectId: project.id, pages: failures.map((f) => f.page), errMsg: failures[0]?.message },
          'preview build: pages served an error document',
        );
      } else {
        previewPageFailures.delete(project.id);
      }
    }

    // Bring the on-disk draft build up to date before serving a page. A burst of edits during a
    // build advances the version, so re-check a bounded number of times — eventually consistent
    // without an unbounded spin under constant editing (the client reloads on the next change anyway).
    // A build FAILURE stops the loop (and arms the cooldown above) so one bad save can't fan a single
    // page request into four failed builds; the stale prior build is served until content changes.
    async function ensurePreviewBuild(
      ctx: ProjectContext,
      project: Awaited<ReturnType<ProjectRepository['get']>>,
    ): Promise<void> {
      for (let i = 0; i < 4; i++) {
        // Timestamp AND row count: a DELETE removes a row outright, so a newest-updated_at alone
        // never moves and the deleted page keeps serving out of the last build (verified live).
        const version = await contentRepo.previewContentVersion(ctx);
        if (previewBuiltVersion.get(project.id) === version) return;
        const failed = previewBuildFail.get(project.id);
        if (failed && failed.version === version && Date.now() - failed.at < PREVIEW_BUILD_COOLDOWN_MS) return;
        let inflight = previewBuilds.get(project.id);
        if (!inflight) {
          inflight = buildPreviewSite(ctx, project, version)
            .then(() => void previewBuildFail.delete(project.id))
            .catch((err: unknown) => {
              previewBuildFail.set(project.id, { version, at: Date.now() });
              app.log.warn(
                { projectId: project.id, errMsg: err instanceof Error ? err.message : String(err) },
                'preview build failed',
              );
              throw err;
            })
            .finally(() => {
              previewBuilds.delete(project.id);
              // No entry ⇒ nothing is building. That absence is the signal the shell polls for, so it
              // has to be cleared on failure too, not just on success.
              previewProgress.delete(project.id);
            });
          previewBuilds.set(project.id, inflight);
        }
        try {
          await inflight;
        } catch {
          // Logged + cooldown armed above; stop retrying this request (serve the prior build / 404).
          return;
        }
      }
    }

    // Resolve a changed content entity (a page id off the SSE stream) to its preview ROUTE, so the
    // shell can auto-navigate the iframe to the page an agent just created/edited. Non-page entities
    // (settings, entries, translations) and routeless pages (link placeholders, collection parents)
    // → `null`, and the shell simply reloads the current page instead.
    app.get<{ Params: { projectId: string }; Querystring: { entity?: string } }>(
      '/projects/:projectId/preview-locate',
      { config: rl(120) }, // a page-list read per call; the client debounces, so this is generous
      async (req, reply) => {
        const { ctx } = await resolveProject(req, 'content:read');
        const entity = req.query.entity;
        if (!entity) return reply.send({ path: null });
        const pages = (await contentRepo.list(ctx, 'page')) as Page[];
        const byId = pagesById(pages);
        const page = byId.get(entity);
        if (!page || isLinkPage(page) || page.collection) return reply.send({ path: null });
        return reply.send({ path: pathToSlug(pagePath(page, byId)) ?? '' });
      },
    );

    // What the draft build is doing RIGHT NOW. The preview shell polls this while its iframe has not
    // painted yet: `GET /preview-url` blocks for the whole build, so without a second, non-blocking
    // endpoint there is nothing the shell could say beyond "loading". `building:false` means no build
    // is in flight — either it finished (the blocked call is about to return) or none was needed.
    // Read-only, derived from an in-memory map, so its budget can be generous enough to poll.
    app.get<{ Params: { projectId: string } }>(
      '/projects/:projectId/preview-progress',
      { config: rl(600) },
      async (req, reply) => {
        const { project } = await resolveProject(req, 'content:read');
        // `building` comes from the in-flight map, NOT from the presence of a phase: the isolated
        // worker runner cannot report phases at all, and deriving one from the other would tell the
        // shell "nothing is happening" through the entire wait it exists to explain.
        const building = previewBuilds.has(project.id);
        const p = previewProgress.get(project.id);
        return reply.send({ building, ...(building && p ? p : {}) });
      },
    );

    // A members-only presence COUNT for the preview surface's agent pill (no connection details —
    // the owner-only /agent-connections endpoint carries those). Counts live OAuth/MCP sessions +
    // active PATs; the transient "working" state is derived client-side from the SSE actor tag.
    app.get<{ Params: { projectId: string } }>(
      '/projects/:projectId/agent-presence',
      { config: rl(60) },
      async (req, reply) => {
        const { ctx, project } = await resolveProject(req, 'content:read');
        const sessions = await oauthRepo.listActiveSessions(project.id);
        const pats = await apiKeysRepo.listAgentConnections(ctx);
        return reply.send({ connected: sessions.length + pats.length });
      },
    );

    // The member-only endpoint that hands the editor (and a "copy link" affordance) the SIGNED,
    // share-able preview base — `/preview/<projectId>/<sig>/`. Resolving it requires content:read, so
    // only a member can MINT the link; the link itself then works without a login (the sig is the auth).
    app.get<{ Params: { projectId: string } }>(
      '/projects/:projectId/preview-url',
      async (req, reply) => {
        const { ctx, project } = await resolveProject(req, 'content:read');
        // Bring the draft up to date before answering, so `pageFailures` describes the CURRENT
        // content rather than whichever build happened to run last. The shell asks for this on every
        // reload, which is exactly when an author wants to know a page stopped rendering.
        await ensurePreviewBuild(ctx, project).catch(() => {}); // a build failure is reported below / logged
        return reply.send({
          base: `/preview-site/${project.id}/${signPreview(project.id, currentCookieSecret)}/`,
          // Pages that could not be rendered. Each still SERVES — an error document naming the
          // problem — so the preview as a whole is never stale; this is how the rest of the editor
          // gets to say so too.
          pageFailures: previewPageFailures.get(project.id) ?? [],
        });
      },
    );

    // ── Revocable SHARE links for the DRAFT preview ──────────────────────────────────────────────────
    // The DEFAULT preview URL (above) is member-minted + time-bucketed → it EXPIRES, so the default
    // preview is effectively logged-in-only. To hand a live draft to an UNAUTHENTICATED client, an
    // owner/member creates a STABLE share link here; DELETING it REVOKES the link. The token is
    // HMAC-derived (preview-token.ts) so nothing sensitive is stored — the row is just the revocation
    // handle + label. Share links are per-project and never expose any other project. The returned `url`
    // is app-origin-relative; the editor makes it absolute (the preview is served from the app origin,
    // sandboxed to an opaque origin, so a shared link can never touch the cookie-bearing session).
    app.get<{ Params: { projectId: string } }>('/projects/:projectId/preview-shares', { config: rl(120) }, async (req) => {
      const { ctx, project } = await resolveProject(req, 'content:read');
      // An unexpected store error propagates to the app's global handler (clean 500), rather than being
      // swallowed here into a misleading "no share links" — the same reason the count read below isn't
      // swallowed (that would fail the max-25 limit OPEN).
      const rows = (await contentRepo.list(ctx, 'preview_share')) as Array<{ id: string; label: string; createdAt: number }>;
      return {
        items: rows
          .slice()
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((r) => ({ id: r.id, label: r.label, createdAt: r.createdAt, url: `/preview-site/${project.id}/${signShare(project.id, r.id, currentCookieSecret)}/` })),
      };
    });
    app.post<{ Params: { projectId: string }; Body: { label?: string } }>('/projects/:projectId/preview-shares', { config: rl(30) }, async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:write');
      const existing = await contentRepo.list(ctx, 'preview_share');
      if (existing.length >= 25) return reply.code(400).send({ error: 'too many share links (max 25) — revoke some first' });
      const id = newId();
      const row = { id, label: String(req.body?.label ?? '').slice(0, 120), createdAt: Date.now(), createdBy: ctx.userId };
      await contentRepo.put(ctx, 'preview_share', id, row);
      return reply.send({ id, label: row.label, createdAt: row.createdAt, url: `/preview-site/${project.id}/${signShare(project.id, id, currentCookieSecret)}/` });
    });
    app.delete<{ Params: { projectId: string; shareId: string } }>('/projects/:projectId/preview-shares/:shareId', { config: rl(30) }, async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:write');
      await contentRepo.remove(ctx, 'preview_share', req.params.shareId).catch(() => {});
      return reply.send({ ok: true });
    });

    // compare-to-source: screenshot the page's BUILD (its loopback preview) AND its imported SOURCE at the
    // same viewports, so an agent gets both side-by-side and self-corrects against the real site. The SOURCE
    // prefers the reference cached at IMPORT time (stable snapshot, fast); on a miss it renders the live
    // original via the SSRF-pinned browser and backfills the cache. `?refresh=1` forces a fresh snapshot.
    // Owner/member (content:read); the page must carry an import source (`data.swImport.sourceUrl`).
    app.get<{ Params: { projectId: string; pageId: string } }>(
      '/projects/:projectId/compare/:pageId',
      { config: rl(10) },
      async (req, reply) => {
        const { ctx, project } = await resolveProject(req, 'content:read');
        // One list serves both needs: the target page AND the full page map to walk its parent chain.
        // The build URL needs the page's FULL nested route (`services/building-engineering`), not its own
        // leaf `path` segment — otherwise a child page's preview URL 404s and compare returns a blank BUILD.
        const allPages = (await contentRepo.list(ctx, 'page').catch(() => [])) as Page[];
        const byId = pagesById(allPages);
        const targetPage = byId.get(req.params.pageId) ?? null;
        const page = targetPage as ComparePageInput | null;
        // `pathToSlug('/')` → undefined for the HOME page (it has no slug) — that IS the correct signal:
        // compareTargets falls back to '' → the root preview URL. undefined here means home, not an error.
        const fullRoute = targetPage ? pathToSlug(pagePath(targetPage, byId)) : undefined;
        const port = req.socket.localPort ?? (Number(process.env.PORT) || 80);
        const target = compareTargets({
          page,
          route: fullRoute,
          projectId: project.id,
          sig: signPreview(project.id, currentCookieSecret),
          originHostPort: `127.0.0.1:${port}`,
          viewports: (req.query as { viewports?: string } | undefined)?.viewports,
        });
        if ('error' in target) {
          if (target.error === 'not-found') throw new NotFoundError('page not found');
          return reply.code(400).send({ error: 'this page has no imported source URL to compare against' });
        }
        const refreshQ = ((req.query as { refresh?: string } | undefined)?.refresh ?? '').toLowerCase();
        const wantRefresh = refreshQ === '1' || refreshQ === 'true';
        const wantNames = (target.viewports ?? DEFAULT_SCREENSHOT_VIEWPORTS) as ViewportName[];
        const abort = new AbortController();
        req.raw.on('close', () => abort.abort());

        // The BUILD always renders live (it's the agent's current work). Kick it off concurrently.
        const buildP = captureUrlShots(target.buildUrl, { mode: 'loopback', viewports: target.viewports, signal: abort.signal }).catch(() => ({}) as Partial<Record<ViewportName, Shot>>);

        // The SOURCE prefers the reference cached at import time (stable + fast); falls back to a live
        // render. A live render that (re)builds the canonical reference captures the DEFAULT viewport set
        // and stores it — so the cache is never clobbered with a partial set.
        let source: Partial<Record<ViewportName, Shot>> = {};
        let sourceFrom: 'cache' | 'live' = 'cache';
        let capturedAt: number | undefined;
        const cached = wantRefresh ? null : await (sourceRefStore?.get(project.slug, req.params.pageId) ?? Promise.resolve(null));
        if (cached && wantNames.every((n) => cached.shots[n])) {
          source = Object.fromEntries(wantNames.map((n) => [n, cached.shots[n]!]));
          capturedAt = cached.capturedAt;
        } else {
          sourceFrom = 'live';
          capturedAt = Date.now();
          if (sourceRefStore && (wantRefresh || !cached)) {
            const full = await captureUrlShots(target.sourceUrl, { mode: 'pinned', viewports: [...DEFAULT_SCREENSHOT_VIEWPORTS], signal: abort.signal }).catch(() => ({}) as Partial<Record<ViewportName, Shot>>);
            if (Object.keys(full).length > 0) await sourceRefStore.put(project.slug, req.params.pageId, { sourceUrl: target.sourceUrl, capturedAt, shots: full }).catch(() => {});
            source = Object.fromEntries(wantNames.filter((n) => full[n]).map((n) => [n, full[n]!]));
          } else {
            // No store, or a partial miss against an existing cache — render the requested set, don't cache.
            source = await captureUrlShots(target.sourceUrl, { mode: 'pinned', viewports: target.viewports, signal: abort.signal }).catch(() => ({}));
          }
        }
        const build = await buildP;
        return reply.send({ sourceUrl: target.sourceUrl, route: target.route, sourceFrom, capturedAt, build, source });
      },
    );

    // fidelity_check: the OBJECTIVE clone-fidelity gate. Render the page's BUILD (loopback) and its imported
    // SOURCE (SSRF-pinned) at Full HD, extract computed styles per element + whole-bar chrome facts, and diff
    // them — returning measured PASS/FAIL numbers (body font/gradient/coverage; chrome pos/size/style/meta:
    // skew, weight, letter-spacing, radius, shadow, fixed-position, ripple, modals) instead of only images.
    // This is what lets ANY agent terminate the nativize loop on a number, not an eyeballed screenshot.
    // Owner/member (content:read); the page must carry an import source. Source is always rendered LIVE here
    // (element extraction needs a real render, unlike the screenshot cache).
    app.get<{ Params: { projectId: string; pageId: string } }>(
      '/projects/:projectId/fidelity/:pageId',
      { config: rl(6) },
      async (req, reply) => {
        const { ctx, project } = await resolveProject(req, 'content:read');
        const allPages = (await contentRepo.list(ctx, 'page').catch(() => [])) as Page[];
        const byId = pagesById(allPages);
        const targetPage = byId.get(req.params.pageId) ?? null;
        const fullRoute = targetPage ? pathToSlug(pagePath(targetPage, byId)) : undefined;
        const port = req.socket.localPort ?? (Number(process.env.PORT) || 80);
        const target = compareTargets({
          page: targetPage as ComparePageInput | null,
          route: fullRoute,
          projectId: project.id,
          sig: signPreview(project.id, currentCookieSecret),
          originHostPort: `127.0.0.1:${port}`,
        });
        if ('error' in target) {
          if (target.error === 'not-found') throw new NotFoundError('page not found');
          return reply.code(400).send({ error: 'this page has no imported source URL to compare against' });
        }
        const abort = new AbortController();
        req.raw.on('close', () => abort.abort());
        // Render both sides concurrently (build = the agent's current work, source = the real site) and diff.
        const [build, source] = await Promise.all([
          captureUrlElements(target.buildUrl, { mode: 'loopback', signal: abort.signal }),
          captureUrlElements(target.sourceUrl, { mode: 'pinned', signal: abort.signal }),
        ]);
        // Say WHICH side could not be looked at, rather than presenting a failed capture as a 0% score —
        // an agent cannot act on "coverage: 0" when the truth is "the render did not come back".
        const capture = { build: captureIssue(build), source: captureIssue(source) };
        const captured = capture.build || capture.source ? { capture } : {};
        return reply.send({ sourceUrl: target.sourceUrl, route: target.route, ...captured, ...scoreFidelity(source, build) });
      },
    );

    // clone_audit: the COMPREHENSIVE acceptance gate — fidelity_check measures computed styles, but a clone can
    // pass that while its datasets are duplicated, its modals dropped, its slider dead, its fonts not actually
    // loaded, or its mobile menu missing. This runs all three legs — STRUCTURE (repo: datasets/folders/editable),
    // BEHAVIOUR (a live build render: sliders enhance / modals present / fonts load / mobile menu reachable), and
    // VISUAL (fidelity_check folded in) — and returns one PASS/FAIL the clone loop terminates on. content:read.
    app.get<{ Params: { projectId: string; pageId: string } }>(
      '/projects/:projectId/clone-audit/:pageId',
      { config: rl(3) },
      async (req, reply) => {
        const { ctx, project } = await resolveProject(req, 'content:read');
        // A failed list should 500, not silently pass the STRUCTURE checks against empty data (fail loud).
        const allPages = (await contentRepo.list(ctx, 'page')) as Page[];
        const byId = pagesById(allPages);
        const targetPage = byId.get(req.params.pageId) ?? null;
        if (!targetPage) throw new NotFoundError('page not found');
        const fullRoute = pathToSlug(pagePath(targetPage, byId));
        const port = req.socket.localPort ?? (Number(process.env.PORT) || 80);
        const target = compareTargets({
          page: targetPage as ComparePageInput,
          route: fullRoute,
          projectId: project.id,
          sig: signPreview(project.id, currentCookieSecret),
          originHostPort: `127.0.0.1:${port}`,
        });
        if ('error' in target) {
          // targetPage is non-null (thrown above), so the only reachable error is a missing import source.
          return reply.code(400).send({ error: 'this page has no imported source URL to compare against' });
        }
        const abort = new AbortController();
        req.raw.on('close', () => abort.abort());
        // VISUAL leg first: render BUILD + SOURCE and diff (also tells us whether the ORIGINAL has modals).
        const [build, source] = await Promise.all([
          captureUrlElements(target.buildUrl, { mode: 'loopback', signal: abort.signal }),
          captureUrlElements(target.sourceUrl, { mode: 'pinned', signal: abort.signal }),
        ]);
        const fidelity = scoreFidelity(source, build);
        // BEHAVIOUR leg: probe the live BUILD (desktop + phone). Require modals only if the ORIGINAL has triggers.
        // Count DISTINCT header paths (nav membership is locale-independent) so a multilingual project doesn't
        // inflate navExpected past what a single-locale render can show.
        const navExpected = new Set(allPages.filter((p) => (p.nav?.slots ?? []).includes('header') && (p.path ?? '') !== '').map((p) => p.path)).size;
        const behaviour = await captureBehaviour(target.buildUrl, {
          mode: 'loopback',
          signal: abort.signal,
          navExpected,
          hasModalTrigger: (source.meta.modalTriggers ?? 0) > 0,
          // Probe the ORIGINAL for clipping too, so the clip check reports only what the SOURCE does not
          // already do. Without this the check cannot tell a broken layout from a deliberate bleed, which
          // is why it had to be demoted to advisory; with it, it gates again.
          sourceUrl: target.sourceUrl,
        });
        // STRUCTURE leg: pure over repo data.
        const [datasets, media] = await Promise.all([contentRepo.list(ctx, 'dataset'), contentRepo.list(ctx, 'media')]);
        // The editability check must see the page's EFFECTIVE source, not its raw stored one: a
        // template-driven page has an empty `source` and a snippet-composing page keeps its directives in
        // the partial, so counting `targetPage.source` failed every structure the import guide mandates.
        // Resolve the template ref the same way preview/publish do, and hand over the snippet bodies so
        // `{{> partial}}` directives are counted too.
        let auditDefaultLocale = 'en';
        let auditCriticalCss: string | null = null;
        try {
          const auditSettings = (await contentRepo.get(ctx, 'settings', SETTINGS_ENTITY_ID)) as Settings;
          auditDefaultLocale = auditSettings.settings?.defaultLocale ?? 'en';
          auditCriticalCss = auditSettings.website?.criticalCss ?? null;
        } catch (err) {
          if (!(err instanceof NotFoundError)) throw err;
        }
        const auditCodeRef = resolveCodeRef(targetPage, allPages, auditDefaultLocale);
        let effectiveSource = auditCodeRef.source ?? '';
        if (auditCodeRef.template) {
          const projectTemplates = isGlobalTemplate(auditCodeRef.template) ? [] : ((await contentRepo.list(ctx, 'template')) as Template[]);
          const globals = isGlobalTemplate(auditCodeRef.template) ? globalTemplateMap(await listGlobalTemplates(contentRepo)) : undefined;
          // An unknown template ref is the page author's problem, not the audit's — fall back to the raw
          // source so the audit still reports the other legs instead of 500ing.
          try {
            effectiveSource = resolveTemplateSource(auditCodeRef.template, new Map(projectTemplates.map((t) => [t.id, t])), globals);
          } catch {
            effectiveSource = targetPage.source ?? '';
          }
        }
        const auditSnippets = {
          ...(await globalSnippetPartials(contentRepo)),
          ...Object.fromEntries(((await contentRepo.list(ctx, 'snippet')) as Snippet[]).map((s) => [s.name, s.source])),
          ...WIDGET_PARTIALS,
        };
        const audit = assembleAudit([
          structuralChecks({ datasets: datasets as Array<{ id?: string; name?: string; slug?: string }>, media: media as Array<{ folder?: string; url?: string }>, pageSource: effectiveSource || null, snippets: auditSnippets, criticalCss: auditCriticalCss }),
          behaviouralChecks(behaviour),
          visualChecks(fidelity),
        ]);
        return reply.send({ sourceUrl: target.sourceUrl, route: target.route, ...audit, fidelity });
      },
    );

    // visual_audit: the VISION acceptance gate — DETERMINISTIC. Renders the CLONE (loopback build) + the
    // LIVE original (SSRF-pinned, fresh — not the degraded import cache) full-page at desktop + mobile and
    // returns the side-by-sides + a structured defect RUBRIC. The DRIVING agent (a CLI/MCP model with its
    // own vision) judges the pixels — the platform does NOT call an AI here, so a cheap-token CLI clone never
    // triggers a second, platform-billed vision call (the CLI and on-platform lanes stay separate). It still
    // beats the computed-style scorers: real side-by-side vs the LIVE original, full-page (not clipped), real
    // rendered fonts/images (getComputedStyle lies). content:read.
    app.get<{ Params: { projectId: string; pageId: string } }>(
      '/projects/:projectId/visual-audit/:pageId',
      { config: rl(3) },
      async (req, reply) => {
        const { ctx, project } = await resolveProject(req, 'content:read');
        const allPages = (await contentRepo.list(ctx, 'page')) as Page[];
        const byId = pagesById(allPages);
        const targetPage = byId.get(req.params.pageId) ?? null;
        if (!targetPage) throw new NotFoundError('page not found');
        const fullRoute = pathToSlug(pagePath(targetPage, byId));
        const port = req.socket.localPort ?? (Number(process.env.PORT) || 80);
        const target = compareTargets({
          page: targetPage as ComparePageInput,
          route: fullRoute,
          projectId: project.id,
          sig: signPreview(project.id, currentCookieSecret),
          originHostPort: `127.0.0.1:${port}`,
        });
        if ('error' in target) return reply.code(400).send({ error: 'this page has no imported source URL to compare against' });
        const abort = new AbortController();
        req.raw.on('close', () => abort.abort());
        const vps = [...DEFAULT_SCREENSHOT_VIEWPORTS] as ViewportName[];
        // CLONE via the loopback build, ORIGINAL fresh via the SSRF-pinned path — full-page, desktop + mobile.
        const [build, liveSource] = await Promise.all([
          captureUrlShots(target.buildUrl, { mode: 'loopback', viewports: vps, signal: abort.signal }).catch(() => ({}) as Partial<Record<ViewportName, Shot>>),
          captureUrlShots(target.sourceUrl, { mode: 'pinned', viewports: vps, signal: abort.signal }).catch(() => ({}) as Partial<Record<ViewportName, Shot>>),
        ]);
        // A live re-fetch of the original can come back BLOCKED (empty) or BLANK — an embed-guarded/expired
        // source, or a near-uniform white capture. In that case fall back to the ground-truth screenshots
        // cached at import time so the agent still has a real original to judge against (goal: an offline
        // visual gate). A GOOD live capture refreshes that cache. A blank JPEG compresses tiny regardless of
        // page height, so a small byte size is a reliable near-uniform signal.
        let source = liveSource;
        let sourceFrom: 'live' | 'cache' = 'live';
        /* v8 ignore start */ // browser-capture cache fallback — exercised by the deploy-time e2e check.
        const isBlankShot = (s: Shot | undefined): boolean => !s || Buffer.from(s.base64, 'base64').length < 8000;
        if (sourceRefStore) {
          const liveOk = vps.some((n) => !isBlankShot(liveSource[n]));
          if (liveOk) {
            await sourceRefStore.put(project.slug, req.params.pageId, { sourceUrl: target.sourceUrl, capturedAt: Date.now(), shots: liveSource }).catch(() => {});
          } else {
            const cached = await sourceRefStore.get(project.slug, req.params.pageId).catch(() => null);
            if (cached && vps.some((n) => cached.shots[n])) {
              source = Object.fromEntries(vps.filter((n) => cached.shots[n]).map((n) => [n, cached.shots[n]!]));
              sourceFrom = 'cache';
            }
          }
        }
        /* v8 ignore stop */
        return reply.send({
          sourceUrl: target.sourceUrl,
          route: target.route,
          rubric: VISUAL_AUDIT_RUBRIC,
          categories: VISUAL_DEFECT_CATEGORIES,
          severities: VISUAL_DEFECT_SEVERITIES,
          sourceFrom,
          build,
          source,
        });
      },
    );

    // PAGE-SPEED + SEO audit (Lighthouse). Builds a DEPLOY-EQUIVALENT static output (minified exactly like
    // the project's real publish) into a temp dir and serves it on an ephemeral loopback origin with
    // deploy-equivalent cache headers, then runs Lighthouse against the target page. We deliberately do NOT
    // audit the always-on draft build (`/preview-site/…`): that serves `cache-control: no-store`, a `sandbox`
    // CSP, and injects the preview-runtime bridge JS — all of which would make the performance number
    // non-representative of what a visitor actually gets. Returns category scores (performance / accessibility
    // / best-practices / seo), core lab metrics, and a ranked list of actionable findings. Lab-only (no CrUX
    // field data): perf is directional; SEO / a11y / best-practices are deterministic. `?formFactor=` picks
    // the emulated device (default mobile). content:read.
    app.get<{ Params: { projectId: string; pageId: string }; Querystring: { formFactor?: string } }>(
      '/projects/:projectId/pagespeed-audit/:pageId',
      { config: rl(3) },
      async (req, reply) => {
        const { ctx, project } = await resolveProject(req, 'content:read');
        const allPages = (await contentRepo.list(ctx, 'page')) as Page[];
        const byId = pagesById(allPages);
        const targetPage = byId.get(req.params.pageId) ?? null;
        if (!targetPage) throw new NotFoundError('page not found');
        if (isLinkPage(targetPage) || targetPage.collection) {
          return reply.code(400).send({ error: 'this page has no rendered route to audit' });
        }
        const formFactor: FormFactor = req.query.formFactor === 'desktop' ? 'desktop' : 'mobile';
        const route = pathToSlug(pagePath(targetPage, byId)) ?? '';
        const publicPath = route ? `/${route}/` : '/';

        // Build the deploy-equivalent output once, serve it, audit the page, then tear both down. Minify
        // follows the project's local deploy target so the audited bytes match what Publish produces.
        const local = await findLocalTarget(ctx);
        const dir = await mkdtemp(join(tmpdir(), 'sw-pagespeed-'));
        let served: Awaited<ReturnType<typeof serveBuiltSite>> | undefined;
        // Note when the client goes away (panel closed / navigated) so we don't reply to a dead socket.
        const abort = new AbortController();
        req.raw.on('close', () => abort.abort());
        try {
          // Bound the ENTIRE cost (build + ephemeral server + Lighthouse) on the shared render semaphore so
          // concurrent audits can't exhaust CPU/disk/ports — not just the Chrome portion.
          const result = await withRenderSlot(async () => {
            await buildToDir(ctx, project, dir, { minify: !!local?.minifyHtml });
            served = await serveBuiltSite(dir);
            const pageUrl = `${served.url}${route ? `${route}/` : ''}`;
            const audit = await runPagespeedAudit(pageUrl, { formFactor });
            // Report the LOGICAL page path, never the internal ephemeral loopback URL/port — and the same
            // for any Lighthouse run-warning (e.g. a redirect warning interpolates the navigated URL) or
            // per-resource finding URL, so scrub the loopback origin out of every one before it leaves the server.
            const origin = new URL(served.url).origin;
            const runWarnings = redactOrigin(audit.runWarnings, origin);
            const findings = rebaseFindingUrls(audit.findings, origin);
            // Heading-structure outline (SEO): best-effort — parse the served static HTML. A fetch failure
            // (e.g. client disconnect) just omits the outline rather than failing the whole audit.
            let outline: HeadingOutline | undefined;
            try {
              const res = await fetch(pageUrl, { signal: abort.signal });
              if (res.ok) outline = analyzeHeadingOutline(extractHeadings(await res.text()));
            } catch {
              /* best-effort — outline stays undefined */
            }
            return {
              ...audit,
              url: publicPath,
              findings,
              ...(runWarnings ? { runWarnings } : {}),
              ...(outline ? { outline } : {}),
            };
          });
          if (abort.signal.aborted) return reply; // client disconnected mid-run — the response is moot
          return reply.send(result);
        } catch (err) {
          // Author-correctable build failures (bad route graph / bad json_data URL) surface as 409, like publish.
          if (err instanceof PublishError || err instanceof JsonDataError) {
            return reply.code(409).send({ error: err.message });
          }
          // No launchable headless browser (e.g. a browserless environment) → 503, not an opaque 500. Log the
          // underlying detail server-side but don't leak internal paths in the client-facing message.
          if (err instanceof PagespeedUnavailableError) {
            req.log.warn({ err }, 'pagespeed audit: no headless browser available');
            return reply.code(503).send({ error: 'page-speed audit is unavailable: no headless browser could be launched' });
          }
          throw err;
        } finally {
          await served?.close();
          await rm(dir, { recursive: true, force: true });
        }
      },
    );

    // compare_regions: HIGH-RESOLUTION region crops (default header + footer) of the BUILD (loopback) and the
    // imported SOURCE (SSRF-pinned), at 2× device scale as LOSSLESS WebP — so an agent can SEE fine chrome
    // detail (gradient stops, skew edges, thin shadows) that the 1× JPEG full-page compare_to_source smears.
    // Optional `?regions=header,footer` limits which default regions to capture. Owner/member (content:read).
    app.get<{ Params: { projectId: string; pageId: string }; Querystring: { regions?: string } }>(
      '/projects/:projectId/compare-regions/:pageId',
      { config: rl(6) },
      async (req, reply) => {
        const { ctx, project } = await resolveProject(req, 'content:read');
        const allPages = (await contentRepo.list(ctx, 'page').catch(() => [])) as Page[];
        const byId = pagesById(allPages);
        const targetPage = byId.get(req.params.pageId) ?? null;
        const fullRoute = targetPage ? pathToSlug(pagePath(targetPage, byId)) : undefined;
        const port = req.socket.localPort ?? (Number(process.env.PORT) || 80);
        const target = compareTargets({
          page: targetPage as ComparePageInput | null,
          route: fullRoute,
          projectId: project.id,
          sig: signPreview(project.id, currentCookieSecret),
          originHostPort: `127.0.0.1:${port}`,
        });
        if ('error' in target) {
          if (target.error === 'not-found') throw new NotFoundError('page not found');
          return reply.code(400).send({ error: 'this page has no imported source URL to compare against' });
        }
        // Which default regions to capture (unknown names dropped; empty/absent → all defaults).
        const wanted = (req.query.regions ?? '').split(',').map((s) => s.trim()).filter((s) => Object.hasOwn(DEFAULT_COMPARE_REGIONS, s));
        const regions = wanted.length ? Object.fromEntries(wanted.map((n) => [n, DEFAULT_COMPARE_REGIONS[n]!])) : DEFAULT_COMPARE_REGIONS;
        const abort = new AbortController();
        req.raw.on('close', () => abort.abort());
        const [build, source] = await Promise.all([
          captureUrlRegions(target.buildUrl, { mode: 'loopback', regions, signal: abort.signal }),
          captureUrlRegions(target.sourceUrl, { mode: 'pinned', regions, signal: abort.signal }),
        ]);
        // Shape as { region: { build, source } } so the tool can lay each region out build-then-source.
        const out: Record<string, { build?: RegionShot; source?: RegionShot }> = {};
        for (const name of Object.keys(regions)) out[name] = { build: build[name], source: source[name] };
        return reply.send({ sourceUrl: target.sourceUrl, route: target.route, regions: out });
      },
    );

    // inspect_source: MEASURE a rendered page — settled markup + real computed styles + real rects for the
    // selectors asked about. The read-only counterpart to the image/score tools above: those all return a
    // picture or a number ABOUT A COMPARISON and each needs a built clone, so none of them can answer "what
    // IS the original's nav-link padding" — which the import guide keeps telling the agent to go and measure.
    // Also the only view of chrome a site builds in JAVASCRIPT: the importer stores the pre-JS body, so such
    // a site's stored source contains no header/footer markup at all. Owner/member (content:read).
    app.post<{
      Params: { projectId: string; pageId: string };
      Body: { selectors?: unknown; styles?: unknown; html?: unknown; viewport?: unknown; side?: unknown };
    }>(
      '/projects/:projectId/inspect-source/:pageId',
      { config: rl(10) },
      async (req, reply) => {
        const { ctx, project } = await resolveProject(req, 'content:read');
        const asStrings = (v: unknown): string[] =>
          Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim() !== '').map((s) => s.trim()) : [];
        const selectors = asStrings(req.body?.selectors).slice(0, INSPECT_LIMITS.maxSelectors);
        if (selectors.length === 0) {
          return reply.code(400).send({ error: 'selectors is required — a non-empty array of CSS selectors to measure' });
        }
        const side = req.body?.side === 'build' ? 'build' : 'source';
        const vpRaw = req.body?.viewport;
        // Either one of the five names, or an exact pixel width. The names leave a gap between 768 and
        // 1440 — where responsive frameworks actually switch — so a width is the only way to measure
        // "what applies at 992?" rather than infer it from the stylesheet text.
        const viewport =
          typeof vpRaw === 'string' && isScreenshotViewportName(vpRaw)
            ? vpRaw
            : typeof vpRaw === 'number' && Number.isFinite(vpRaw) && vpRaw > 0
              ? vpRaw
              : undefined;
        // A failed list must 500, not silently measure against an empty page set (same rule as clone_audit).
        const allPages = (await contentRepo.list(ctx, 'page')) as Page[];
        const byId = pagesById(allPages);
        const targetPage = byId.get(req.params.pageId) ?? null;
        const fullRoute = targetPage ? pathToSlug(pagePath(targetPage, byId)) : undefined;
        const port = req.socket.localPort ?? (Number(process.env.PORT) || 80);
        const target = compareTargets({
          page: targetPage as ComparePageInput | null,
          route: fullRoute,
          projectId: project.id,
          sig: signPreview(project.id, currentCookieSecret),
          originHostPort: `127.0.0.1:${port}`,
        });
        if ('error' in target) {
          if (target.error === 'not-found') throw new NotFoundError('page not found');
          return reply.code(400).send({ error: 'this page has no imported source URL to inspect' });
        }
        const abort = abortOnClose(req);
        // Unlike the capture tools this does NOT swallow render failures: an empty result would read as
        // "the original has no such element", which is precisely the wrong thing to tell a measuring agent.
        const measured = await captureUrlInspect(side === 'build' ? target.buildUrl : target.sourceUrl, {
          mode: side === 'build' ? 'loopback' : 'pinned',
          selectors,
          // Capped server-side too, not just in the MCP tool schema — this route is reachable directly.
          styles: asStrings(req.body?.styles).slice(0, INSPECT_LIMITS.maxStyles),
          html: req.body?.html === true,
          ...(viewport ? { viewport } : {}),
          signal: abort.signal,
        });
        // `data-sw-*` markers are STRIPPED at publish (see resolveDirectives in build.ts), so selecting
        // on them against the BUILD matches nothing — and a bare `count: 0` reads as "my content is
        // missing". One agent logged a MAJOR defect and rewrote correct markup because of exactly this.
        // Say what actually happened instead of letting a false negative stand.
        const strippedSelectors = selectors.filter((s) => /\[\s*data-sw-/.test(s));
        const zeroMatch = new Set(
          ((measured as { results?: Array<{ selector: string; count: number }> }).results ?? [])
            .filter((r) => r.count === 0)
            .map((r) => r.selector),
        );
        const misleading = strippedSelectors.filter((s) => zeroMatch.has(s));
        const notes =
          misleading.length && side === 'build'
            ? [
                `${misleading.length} selector(s) matched nothing because data-sw-* attributes are REMOVED ` +
                  `from published output — they exist only in the authored source. This is not a missing ` +
                  `element: select it structurally instead (e.g. by tag/class/id). Affected: ${misleading.join(', ')}`,
              ]
            : undefined;
        return reply.send({
          side,
          url: side === 'build' ? target.buildUrl : target.sourceUrl,
          sourceUrl: target.sourceUrl,
          route: target.route,
          ...measured,
          ...(notes ? { notes } : {}),
        });
      },
    );

    // Serve the draft build at a SIGNED path. The `<sig>` segment IS the auth (verified here), so NO
    // membership/cookie is required — which is exactly what lets the sandboxed, opaque-origin preview
    // NAVIGATE: a SameSite=Strict cookie is dropped on in-frame navigation, but the signature lives in
    // the path and every relative link carries it. HTML pages are sandboxed (author JS can't reach the
    // editor session); assets get cross-origin headers (the opaque-origin frame fetches them with no
    // credentials) — both kinds sit behind the same signature.
    //
    // Own ISOLATED, generous per-client rate-limit bucket (not the shared global cap): a page view fans out
    // into many asset sub-requests, and on the shared bucket that fan-out exhausts it and 429s the HTML
    // document itself (a blank preview until reload). The only expensive work (a rebuild) stays bounded
    // independently by the version cache + coalescing + failure cooldown.
    app.get<{ Params: { projectId: string; sig: string; '*': string } }>(
      '/preview-site/:projectId/:sig/*',
      { config: rl(PREVIEW_SITE_RL_MAX) },
      async (req, reply) => {
        const { projectId, sig } = req.params;
        // Access: a valid (unexpired) DEFAULT signature — member-minted + time-bucketed, so the default
        // preview is effectively logged-in-only (a random visitor can't mint one and a leaked URL expires)
        // — OR a valid, NON-revoked SHARE token the owner created to hand the draft to an UNAUTHENTICATED
        // client. Check the cheap default sig first (no DB read); only load the share handles when it fails.
        if (!verifyPreview(projectId, sig, currentCookieSecret)) {
          const shareRows = await contentRepo.list(
            { userId: 'system', projectId, role: 'owner' as const },
            'preview_share',
          );
          const shareIds = new Set(shareRows.map((s) => (s as { id: string }).id));
          if (!verifyShare(projectId, sig, currentCookieSecret, shareIds)) return reply.code(404).send();
        }
        const project = await projects.get(projectId).catch(() => null);
        // A soft-deleted project's draft preview goes offline too, even for a previously-minted signed
        // URL — otherwise a held link would keep serving the (now-deleted) draft site.
        if (!project || project.deletedAt) return reply.code(404).send();
        const path = req.params['*'] ?? '';
        const base = `/preview-site/${projectId}/${sig}/`;

        // ── Static asset: cross-origin headers so the opaque-origin frame can load it (still signed) ──
        if (isPreviewAssetPath(path)) {
          const crossOrigin = () =>
            reply
              .header('cache-control', 'no-store')
              .header('x-content-type-options', 'nosniff')
              .header('access-control-allow-origin', '*')
              .header('cross-origin-resource-policy', 'cross-origin');
          // Run a bundled (imported) `.js` ONLY for a genuinely isolated script load — a subresource
          // fetched BY the opaque-origin sandboxed preview frame, which reports `Sec-Fetch-Site:
          // cross-site` (an opaque origin is cross-site to everything) + `Sec-Fetch-Dest: script`.
          // A same-origin loader — e.g. a `/sites/<slug>/` page on THIS host embedding this signed
          // URL via its raw `website.scripts` slot (CSP there allows `script-src 'self'`) — reports
          // `same-origin`/`same-site`, so it falls through to download-only and foreign JS can never
          // execute on the cookie-bearing app origin. Absent headers (old/non-browser client) stay
          // download-only too. `Sec-Fetch-*` are browser-set forbidden headers, so a page can't forge
          // them; a non-browser client that could has no victim session to abuse.
          const fetchSite = String(req.headers['sec-fetch-site'] ?? '');
          const fetchDest = String(req.headers['sec-fetch-dest'] ?? '');
          const executableScripts = fetchDest === 'script' && fetchSite === 'cross-site';
          let binary = null;
          try {
            binary = await preview.readBinary(project.slug, path, { executableScripts });
          } catch {
            /* invalid slug → fall through to the 404 below */
          }
          if (binary !== null) {
            crossOrigin();
            if (binary.attachment) reply.header('content-disposition', 'attachment');
            if (binary.csp) reply.header('content-security-policy', binary.csp);
            if (binary.contentType === 'application/pdf') reply.header('x-frame-options', 'SAMEORIGIN');
            // Seekable media answers `Range:` with a 206. Without it a <video> cannot seek (measured:
            // `currentTime = 6` snapped back to 0) and must transfer the whole file before it starts.
            if (binary.ranged) {
              reply.header('accept-ranges', 'bytes');
              const ranged = partialContent(binary.body, req.headers.range);
              if (ranged === 'unsatisfiable') {
                return reply.code(416).header('content-range', `bytes */${binary.body.length}`).send();
              }
              if (ranged) {
                return reply
                  .code(206)
                  .header('content-range', ranged.contentRange)
                  .header('content-length', String(ranged.body.length))
                  .type(binary.contentType)
                  .send(ranged.body);
              }
            }
            return reply.type(binary.contentType).send(binary.body);
          }
          const asset = await preview.readAsset(project.slug, path);
          if (asset !== null) return crossOrigin().type(asset.contentType).send(asset.body);
          return reply.code(404).send();
        }

        // ── HTML page: rebuilt on demand (system ctx — the sig already authorized this), sandboxed ──
        const systemCtx = { userId: 'system', projectId: project.id, role: 'owner' as const };
        await ensurePreviewBuild(systemCtx, project);
        const html = await preview.readHtml(project.slug, path);
        if (html === null) return reply.code(404).send();
        // Canonicalize an extensionless, slash-less page URL so its page-relative asset/link paths
        // resolve against the right base (mirrors the /sites redirect).
        const lastSegment = path.slice(path.lastIndexOf('/') + 1);
        if (path !== '' && !path.endsWith('/') && !lastSegment.includes('.')) {
          const q = req.url.indexOf('?');
          const query = q === -1 ? '' : req.url.slice(q);
          const safePath = path.replace(/[\r\n\0]/g, '');
          return reply.redirect(`${base}${safePath}/${query}`, 301);
        }
        return reply
          .header('cache-control', 'no-store')
          // Don't leak the signed (bearer) URL to third parties via the Referer header on outbound links.
          .header('referrer-policy', 'no-referrer')
          // Sandbox the author content (opaque origin) — scripts run for true WYSIWYG, but can't reach
          // the editor's same-origin session. `allow-forms` lets the submit EVENT fire; the leads it
          // would fire are handled by pointing preview forms at the dry-run endpoint (build.ts), not by
          // breaking the button. Without it the browser refuses the submit outright, so the one thing
          // the review workflow could never exercise on the surface it runs on was a form.
          // `allow-popups allow-popups-to-escape-sandbox` so an outbound `target="_blank"` link actually
          // opens. Without them the browser silently drops the navigation — every external link on every
          // previewed site reads as DEAD (a clone review chased 31 IMDb links that were authored
          // correctly and simply could not fire). The escape token matters as much as the popup one: a
          // popup that inherits this sandbox lands on the target site at an OPAQUE origin and breaks
          // there instead. Neither token grants the framed document same-origin access to the editor.
          .header('content-security-policy', PREVIEW_SANDBOX_CSP)
          .header('x-frame-options', 'SAMEORIGIN')
          .type('text/html')
          .send(html);
      },
    );
  }

  // Multilingual locale management (add/remove a translation target, propagate a page,
  // cascade-delete across languages) — pure content ops, so registered unconditionally
  // (no encryption key needed). See docs/i18n-content-model.md.
  registerLocaleRoutes(app, { resolveProject, contentRepo, rl });
  registerWebsiteDataRoutes(app, { resolveProject, contentRepo, rl });
  registerRevisionRoutes(app, {
    resolveProject,
    contentRepo,
    revisionsRepo,
    isWriter: (ctx) => WRITE_ROLES.has(ctx.role),
    db,
    rl,
  });

  // Saved deploy targets (encrypted credentials) — independent of publish serving.
  if (opts.encryptionKey) {
    registerDeployTargetRoutes(app, {
      resolveProject,
      contentRepo,
      encryptionKey: opts.encryptionKey,
      activeDeploys,
      assertDeployHostAllowed,
      isWriter: (ctx) => WRITE_ROLES.has(ctx.role),
      // Build the site fresh into a temp dir at deploy time; the route uploads it then removes it.
      buildForDeploy,
      // Drop the locally-served build when its Local Hosting target is deleted (see that route).
      // No publish root configured → nothing was ever served locally, so there is nothing to remove.
      removeLocalSite: async (slug) => {
        await publishStore?.removeProject(slug);
      },
      // Build into the locally-served directory when Local Hosting is switched ON. The build is kept
      // only while such a target exists, so without this the site would 404 until the next publish.
      ensureLocalSite: async (ctx, project) => {
        if (!publishStore) return;
        // ★ ONLY when a release exists and its bytes do NOT. A project that has never been published
        // has nothing to reproduce, so building here would turn "add Local Hosting" into a publish
        // the author did not ask for — and on a freshly created project there is not even content to
        // build. This runs for exactly one case: the sweep reclaimed the build, and hosting is being
        // switched back on, where a 404 would otherwise be the only feedback.
        if ((await publishStore.readRelease(project.slug)) !== null) return;
        if ((await releasesRepo.get(project.id)) === null) return;
        const release = await buildToDir(ctx, project as never, publishStore.dirFor(project.slug), { minify: false });
        await releasesRepo.record(project.id, release);
      },
      // Shares the publish route's in-flight set so a delete can't `rm -rf` a directory mid-build.
      isPublishing: (projectId) => activePublishes.has(projectId),
      rl,
    });
    // Per-project SMTP config (for the userSmtp form mode) — encrypted, like deploy targets.
    registerProjectSmtpRoutes(app, {
      resolveProject,
      contentRepo,
      encryptionKey: opts.encryptionKey,
      isWriter: (ctx) => WRITE_ROLES.has(ctx.role),
      assertHostAllowed: assertSmtpHostAllowed,
      resolveSmtpTestRecipient,
      rl,
    });
    // Per-project captcha provider + credentials — encrypted secret, like SMTP and deploy targets.
    registerProjectCaptchaRoutes(app, {
      resolveProject,
      contentRepo,
      encryptionKey: opts.encryptionKey,
      isWriter: (ctx) => WRITE_ROLES.has(ctx.role),
      captcha: captchaVerifier,
      rl,
    });
    // Per-project "bring your own agent" AI config — encrypted key, like deploy targets.
    registerAiConfigRoutes(app, {
      resolveProject,
      contentRepo,
      encryptionKey: opts.encryptionKey,
      isWriter: (ctx) => WRITE_ROLES.has(ctx.role),
      rl,
    });
  }

  // Google Fonts: download a family's weights server-side (the only Google contact) and self-host
  // them as a `kind:'font'` library asset; the editor adds a slot referencing it. The published
  // site then bundles the font like any media, so neither preview nor a published page loads Google.
  if (mediaStorage) {
    const SelectFontBody = z.object({
      family: FontFamilyNameSchema,
      weights: z.array(FontWeightSchema).min(1).max(FONT_WEIGHTS.length),
      folder: MediaFolderSchema.optional(),
    });
    app.post<{ Params: { projectId: string } }>('/projects/:projectId/fonts/select', { config: rl(20) }, async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:write');
      if (!WRITE_ROLES.has(ctx.role)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const parsed = SelectFontBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid request' });
      try {
        // Re-selecting a family already in the library merges the new weights into that asset (one
        // library entry per family) rather than creating a duplicate. Only the MISSING weights are
        // downloaded; if every requested weight is already self-hosted, Google is never contacted.
        const fonts = ((await contentRepo.list(ctx, 'media')) as MediaAsset[]).filter(
          (m): m is Extract<MediaAsset, { kind: 'font' }> => m.kind === 'font',
        );
        const family = parsed.data.family;
        const existing = fonts.find((f) => f.source === 'google' && f.family.toLowerCase() === family.toLowerCase());
        // A Google select only ever yields NORMAL-style faces (DownloadedFont), so a google-source
        // asset holds only normal faces and a missing weight is identified by weight alone — filter to
        // normal faces explicitly to stay aligned with mergeFontFaces' weight×style dedup.
        const have = new Set(existing?.files.filter((f) => f.style === 'normal').map((f) => f.weight) ?? []);
        const need = parsed.data.weights.filter((w) => !have.has(w));
        if (existing && need.length === 0) return reply.send({ item: existing });

        const dl = await downloadGoogleFont(family, need);
        const faces = dl.faces.map((f) => ({ weight: f.weight, style: f.style, format: f.format, bytes: f.bytes }));
        const item = existing
          ? // Merge into the existing family asset, keeping its stored family/fallback (identical to the
            // freshly-downloaded dl.* for the same catalog family, so there's nothing to clobber).
            await mergeFontFaces(contentRepo, mediaStorage, ctx, project.slug, existing, faces)
          : await storeFontAsset(contentRepo, mediaStorage, ctx, project.slug, {
              family: dl.family,
              fallback: dl.fallback,
              source: 'google',
              folder: parsed.data.folder ?? '',
              faces,
            });
        return reply.send({ item });
      } catch (err) {
        if (err instanceof FontFetchError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    });
  }

  // Web forms: the public submission endpoint (/f/:projectId/:formId) + the
  // authenticated submissions inbox. Always registered (no secret/key dependency).
  /**
   * One retry pass over form notifications that have not gone out yet.
   *
   * Exposed on the app rather than scheduled here: the INTERVAL belongs to `server.ts`, because
   * `createApp` is constructed by roughly two hundred test files and a background timer in each of
   * them is a flakiness generator. A test that wants to exercise retries calls this directly.
   */
  const resolveMail = makeDeliveryResolver({ db, mailer, projectMailer });
  app.decorate('runDueFormDeliveries', async (opts: { now?: () => number; limit?: number } = {}) =>
    runDueDeliveries({
      submissions: submissionsRepo,
      resolveMail,
      ...opts,
      log: (message, detail) => app.log.info(detail, message),
    }),
  );

  registerFormRoutes(app, {
    db,
    submissions: submissionsRepo,
    mailer,
    projectMailer,
    captcha: captchaVerifier,
    // Per PROJECT, decrypted here so the route never touches the encryption key. A config whose
    // secret will not decrypt THROWS, and the caller fails closed — the same posture the instance
    // secret had, kept deliberately: an unverifiable captcha must never wave a submission through.
    getProjectCaptcha: async (projectId: string) => {
      const stored = await loadProjectCaptchaById(db, projectId);
      if (!stored) return null;
      const secret = stored.secret && opts.encryptionKey ? decryptSecret(stored.secret, opts.encryptionKey) : null;
      return { provider: stored.provider, secret, ...(stored.minScore !== undefined ? { minScore: stored.minScore } : {}) };
    },
    // Same key the preview signatures use — one instance secret, not a second thing to configure.
    getPowSecret: () => currentCookieSecret,
    getFormModes: () => instanceSettingsRepo.getFormModes(),
    resolveProject,
    isWriter: (ctx) => WRITE_ROLES.has(ctx.role),
    rl,
  });

  // ---- AI (online generation — agency-funded, metered, quota-gated) ----
  // Resolves the org+user's month-to-date token usage against the configured caps.
  async function aiQuotaStatus(ctx: ProjectContext): Promise<{
    orgUsed: number;
    userUsed: number;
    orgOver: boolean;
    userOver: boolean;
  }> {
    const since = startOfMonthUTC(new Date());
    // `orgMonthlyTokens` is now the PLATFORM-wide cap (global usage); `userMonthlyTokens` the
    // per-user cap. The org dimension is gone — there is one platform budget.
    const orgUsed = aiQuota.orgMonthlyTokens ? await aiUsageRepo.tokensSince(since) : 0;
    const userUsed = aiQuota.userMonthlyTokens
      ? await aiUsageRepo.tokensSince(since, ctx.userId)
      : 0;
    return {
      orgUsed,
      userUsed,
      orgOver: Boolean(aiQuota.orgMonthlyTokens) && orgUsed >= (aiQuota.orgMonthlyTokens ?? 0),
      userOver: Boolean(aiQuota.userMonthlyTokens) && userUsed >= (aiQuota.userMonthlyTokens ?? 0),
    };
  }

  app.post<{ Params: { projectId: string } }>(
    '/projects/:projectId/ai/generate',
    { config: rl(30) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'session-only');
      if (!WRITE_ROLES.has(ctx.role)) {
        return reply.code(403).send({ error: 'insufficient role for this operation' });
      }
      if (!aiProvider) return reply.code(501).send({ error: 'AI is not configured' });
      const body = AiGenerateBody.parse(req.body);

      // Enforce monthly token caps BEFORE spending (agency-funded budget). This
      // is check-then-spend, not atomic: concurrent calls that both pass the
      // check can overshoot the cap by ~one completion each. Bounded by rl(30)
      // and a single self-hosted budget owner, so the worst case is a few cents
      // of overshoot per minute — acceptable here. Tighten with a serialized
      // per-org write if ever deployed under external per-tenant billing.
      const quota = await aiQuotaStatus(ctx);
      if (quota.orgOver) {
        return reply.code(429).send({ error: 'organization AI quota exhausted for this month' });
      }
      if (quota.userOver) {
        return reply.code(429).send({ error: 'your AI quota is exhausted for this month' });
      }

      // Copy generation: the agent writes plain-text content for a code-first page's editable
      // regions / page.data. (The legacy block-tree JSON target was retired with the block editor.)
      const system = 'You are a concise corporate-website copywriter. Output plain text only — no markdown.';
      const completion = await aiProvider.complete({ system, prompt: body.instruction });
      await aiUsageRepo.record(ctx.userId, ctx.projectId, completion.model, completion.usage);
      return reply.send({ result: { text: completion.text }, usage: completion.usage, model: completion.model });
    },
  );

  // Month-to-date AI usage + limits (for a usage dashboard). Any signed-in user may read their own
  // usage + the platform total.
  app.get('/ai/usage', { config: rl(30) }, async (req, reply) => {
    const userId = await requireUserId(req);
    const since = startOfMonthUTC(new Date());
    // Both queries always run (unlike the generate path, which short-circuits
    // when no cap is set): the dashboard reports actual usage even with no cap.
    const orgUsed = await aiUsageRepo.tokensSince(since);
    const userUsed = await aiUsageRepo.tokensSince(since, userId);
    return reply.send({
      enabled: Boolean(aiProvider),
      period: 'month',
      org: { used: orgUsed, limit: aiQuota.orgMonthlyTokens ?? null },
      user: { used: userUsed, limit: aiQuota.userMonthlyTokens ?? null },
    });
  });

  // The on-page AI assistant: a streaming, tool-using agent that edits the project's DRAFT
  // content by driving the same MCP tools an external client would, scoped to capabilities
  // the user grants. Session-only (the browser never holds a token); metered like /ai/generate.
  // Resolve the EFFECTIVE on-page assistant for a project, per request: a project's own BYO key first
  // (dedicated ai_config kind), then the platform-wide instance config (admin-set), then the
  // env-configured fallback. Returns null when the assistant is not configured anywhere.
  async function resolveAiProvider(ctx: ProjectContext): Promise<ResolvedAgent | null> {
    if (opts.encryptionKey) {
      const [row] = await contentRepo.list(ctx, 'ai_config');
      const parsed = row ? AiConfigSchema.safeParse(row) : null;
      if (parsed?.success && parsed.data.enabled && parsed.data.secret) {
        const apiKey = decryptSecret(parsed.data.secret, opts.encryptionKey);
        return {
          provider: buildAgentProvider({ provider: parsed.data.provider, apiKey, model: parsed.data.model, baseUrl: parsed.data.baseUrl }),
          projectMonthlyTokens: parsed.data.monthlyTokenLimit || undefined,
          maxOutputTokens: parsed.data.maxOutputTokens || undefined,
          adminsUnlimited: false, // a project's own budget applies to everyone on it
          platformFunded: false,
        };
      }
    }
    const inst = await instanceSettingsRepo.getAiConfig();
    if (inst?.enabled && inst.apiKey) {
      return {
        provider: buildAgentProvider({ provider: inst.provider, apiKey: inst.apiKey, model: inst.model, baseUrl: inst.baseUrl }),
        projectMonthlyTokens: inst.defaultProjectMonthlyTokens || undefined,
        maxOutputTokens: inst.maxOutputTokens || undefined,
        adminsUnlimited: inst.adminsUnlimited,
        platformFunded: true,
      };
    }
    if (agentProvider) {
      return { provider: agentProvider, projectMonthlyTokens: aiQuota.projectMonthlyTokens || undefined, adminsUnlimited: true, platformFunded: true };
    }
    return null;
  }

  registerAiAgentRoutes(app, {
    db,
    resolveAgent: resolveAiProvider,
    agentGrants: agentGrantsRepo,
    aiUsageRepo,
    aiQuota,
    resolveProject,
    isWriter: (ctx) => WRITE_ROLES.has(ctx.role),
    isAdmin: isInstanceAdmin,
    getAgentInstructions: () => instanceSettingsRepo.getEffectiveAgentInstructions(),
    rl,
    cloneOrchestration: {
      // Imported pages that still need authoring (have an import source), home first, skipping link
      // placeholders + collection parents. The gate — not this list — decides whether each is actually done.
      listPages: async (ctx) => {
        const allPages = (await contentRepo.list(ctx, 'page')) as Page[];
        const byId = pagesById(allPages);
        return allPages
          .filter((p) => Boolean((p.data as { swImport?: { sourceUrl?: string } } | undefined)?.swImport?.sourceUrl))
          .filter((p) => !isLinkPage(p) && !p.collection)
          .sort((a, b) => (((a.path ?? '') === '' ? 0 : 1) - ((b.path ?? '') === '' ? 0 : 1)))
          .map((p) => ({ pageId: p.id, slug: pathToSlug(pagePath(p, byId)) ?? '', title: p.title }));
      },
      // AUTHORITATIVE gate — DETERMINISTIC, no server-side AI (so it never mixes a second, platform-billed
      // AI call into a cheap-token CLI clone). Re-runs the (already-tested) clone-audit route with the
      // agent's own scoped token — its non-advisory STRUCTURE / BEHAVIOUR checks only (the computed-style
      // visual legs are ADVISORY: coverage is blind to casing/dividers/icon-style/section-height, so it can't
      // terminate the loop) — and re-reads the STORED source for the anti-lie marker check. The agent's own
      // claim is ignored. The VISUAL fidelity (layout/images/sections vs the live original) is the agent's job:
      // it self-judges the deterministic visual_audit side-by-sides region-by-region while authoring.
      runGate: async (token, ctx, pageId) => {
        const inject = async (path: string): Promise<Record<string, unknown>> => {
          const res = await app.inject({ method: 'GET', url: path, headers: { authorization: `Bearer ${token}` } });
          if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`${path} → ${res.statusCode}`);
          return JSON.parse(res.payload) as Record<string, unknown>;
        };
        const pid = ctx.projectId;
        const ca = await inject(`/projects/${pid}/clone-audit/${encodeURIComponent(pageId)}`).catch((e: unknown) => ({ error: String(e) }));
        const source = ((await contentRepo.get(ctx, 'page', pageId).catch(() => null)) as Page | null)?.source ?? null;
        const markers = checkNativeMarkers(source);
        const checks = Array.isArray((ca as { checks?: AuditCheck[] }).checks) ? (ca as { checks: AuditCheck[] }).checks : null;
        const structuralFails = checks
          ? checks.filter((c) => !c.advisory && !c.pass).map((c) => `${c.label} — ${c.detail}`)
          : ['clone_audit could not run (fix the page so it renders)'];
        return { pass: structuralFails.length === 0 && markers.ok, structuralFails, markers };
      },
    },
  });

  // Liveness: the process is up and serving. A pure ping — no DB, no dependencies — so an orchestrator
  // never restarts a healthy pod just because the DB is briefly busy. FULLY rate-limit-exempt: it's a
  // zero-cost literal, and probes from the LB/orchestrator (often a shared source IP) must never be
  // throttled into a false "down".
  app.get('/health', { config: { rateLimit: false } }, async () => ({ ok: true }));

  // Readiness: the instance can actually serve requests — the DB is reachable + migrated. A load balancer
  // / orchestrator holds traffic until this returns 200; a briefly-unreachable DB yields 503 (drain, not
  // restart). Unlike /health it does real per-request DB I/O, so it gets its OWN generous bucket (60/min —
  // far above any probe cadence) rather than full exemption, so it can't be an unauthenticated DB amplifier.
  app.get('/ready', { config: rl(60) }, async (req, reply) => {
    try {
      await db.run(sql`select 1`);
      return { ok: true };
    } catch (err) {
      req.log.error({ err }, 'readiness check failed: database unreachable');
      return reply.code(503).send({ ok: false });
    }
  });

  // The machine-readable authoring contracts of the first-party interactive components
  // (data-sw-component): markers, part roles, config attributes, and markup skeletons.
  // STATIC platform metadata (the same constant the renderer registry is pinned to — no
  // tenant data, no instance config), served so agents and tooling can discover the
  // component vocabulary structurally instead of relying on prose docs. Public like
  // /health + /version, but rate-limited since the payload is non-trivial.
  app.get('/authoring/components', { config: rl(60) }, async () => ({ components: COMPONENT_CATALOG }));

  // Icon search for {{sw-icon "name"}} (Phosphor). STATIC platform data. `q` accepts MULTIPLE terms,
  // comma- or whitespace-separated → one match group per term. Powers the editor icon library + the MCP
  // search_icons tool. `limit` caps each group (1–48, default 24).
  app.get('/authoring/icons/search', { config: rl(60) }, async (req) => {
    const q = req.query as { q?: unknown; limit?: unknown };
    // Cap the query length (the search is synchronous + per-term-linear; iconSearchTerms also caps the
    // term COUNT). Matches the MCP tool's 200-char bound — together these keep this PUBLIC route bounded.
    const query = (typeof q.q === 'string' ? q.q : '').slice(0, 200);
    const limit = Math.min(48, Math.max(1, Number.parseInt(typeof q.limit === 'string' ? q.limit : '', 10) || 24));
    return { query, results: searchIcons(query, limit) };
  });

  // The Phosphor name + weight lists — the editor icon library fetches these so it can search/paginate
  // client-side WITHOUT bundling the (multi-MB) icon-body data into the editor. STATIC platform data.
  app.get('/authoring/icons/names', { config: rl(60) }, async () => ({ names: PHOSPHOR_NAMES, weights: PHOSPHOR_WEIGHTS }));

  // Render a BATCH of icons to inline <svg> (the editor library previews a page at a time, per weight).
  // `names` is comma-separated, capped; `weight` is one of PHOSPHOR_WEIGHTS (default fill). Bodies come
  // only from the trusted maps; renderIconSvg attribute-escapes. STATIC; bounded (≤120 names/call).
  app.get('/authoring/icons/render', { config: rl(120) }, async (req) => {
    const q = req.query as { names?: unknown; weight?: unknown };
    const weight = typeof q.weight === 'string' && (PHOSPHOR_WEIGHTS as readonly string[]).includes(q.weight) ? q.weight : 'fill';
    const names = (typeof q.names === 'string' ? q.names : '')
      .slice(0, 3000) // cap the raw string too (defense-in-depth, mirrors the search route), then the count
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
      .slice(0, 120);
    const svgs: Record<string, string> = {};
    for (const name of names) {
      const svg = name.startsWith('brand:') ? renderIconSvg(name, 'h-6 w-6') : renderIconSvg(`${name}:${weight}`, 'h-6 w-6');
      if (svg) svgs[name] = svg;
    }
    return { weight, svgs };
  });

  // Texture library — transparent, tileable PNG overlays (from transparenttextures.com). The colour
  // comes from the element's `background-color` (a CI token), so one asset works over any brand colour.
  // With `?q=` → per-term search groups (powers the MCP search_textures tool); without → the full name
  // list (the editor texture library fetches this once, then lazy-loads thumbnails). STATIC platform data.
  app.get('/authoring/textures', { config: rl(60) }, async (req) => {
    const q = req.query as { q?: unknown; limit?: unknown };
    const query = (typeof q.q === 'string' ? q.q : '').slice(0, 200);
    if (query.trim()) {
      const limit = Math.min(48, Math.max(1, Number.parseInt(typeof q.limit === 'string' ? q.limit : '', 10) || 24));
      return { query, results: searchTextures(query, limit) };
    }
    return { names: TEXTURE_NAMES };
  });

  // Serve one texture PNG. `:file` is `<name>.png`; the base name is ALLOWLIST-validated against the
  // catalog inside `readTexture` (no path traversal). Immutable + CORS so preview + exported sites on
  // any origin load it. (The published site itself uses the rewritten relative `_assets/` copy.)
  app.get<{ Params: { file: string } }>('/authoring/textures/:file', { config: rl(MEDIA_ASSET_RL_MAX) }, async (req, reply) => {
    const { file } = req.params;
    if (!file.endsWith('.png')) return reply.code(404).send({ error: 'not found' });
    const bytes = await readTexture(file.slice(0, -4));
    if (!bytes) return reply.code(404).send({ error: 'not found' });
    return reply
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .header('access-control-allow-origin', '*')
      .header('cross-origin-resource-policy', 'cross-origin')
      .type('image/png')
      .send(bytes);
  });

  // The bundled IMAGE MAP starter templates: metadata for the picker (STATIC platform data — the
  // ~940 KB of config stays on disk, see imagemap-assets.ts).
  app.get('/authoring/imagemaps', { config: rl(60) }, async () => ({ templates: IMAGE_MAP_TEMPLATES }));

  // One template's CONFIG, for previewing it before it is materialised into a project. `:id` is
  // ALLOWLIST-validated against the catalog inside readTemplateConfig (no path traversal).
  app.get<{ Params: { id: string } }>('/authoring/imagemaps/templates/:id', { config: rl(60) }, async (req, reply) => {
    const config = await readTemplateConfig(req.params.id);
    if (!config) return reply.code(404).send({ error: 'not found' });
    return reply.header('cache-control', 'public, max-age=3600').send({ config });
  });

  // Serve one template image. ALLOWLIST-validated in readTemplateImage. Immutable + CORS so the
  // editor preview loads it from any origin — a PROJECT's copy is imported into its media library,
  // so nothing published ever points here.
  app.get<{ Params: { file: string } }>('/authoring/imagemaps/:file', { config: rl(MEDIA_ASSET_RL_MAX) }, async (req, reply) => {
    const { file } = req.params;
    const bytes = await readTemplateImage(file);
    if (!bytes) return reply.code(404).send({ error: 'not found' });
    // Type from the extension rather than a hardcoded image/jpeg — today every template image is a
    // JPEG, but `nosniff` means a wrong type would simply fail to render rather than fall back.
    const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
    const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg';
    return reply
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .header('access-control-allow-origin', '*')
      .header('cross-origin-resource-policy', 'cross-origin')
      .type(type)
      .send(bytes);
  });

  // "Fork existing effect" snippets for the Website-settings custom-code editors — each built-in
  // nav/button/preloader effect as a self-contained, ready-to-run HTML snippet (derived from the same
  // source as the built-ins, so it can't drift). STATIC platform data; computed once + cached.
  app.get('/authoring/effect-forks', { config: rl(60) }, async () => buildEffectForks());

  // The compiled button-preview stylesheet for the Website-settings "Button effects" modal — the .btn
  // baseline + every effect/shape/accent utility. STATIC platform CSS (brand-agnostic; the editor
  // injects the project's --sw-color-* into the preview iframe); computed once + cached.
  app.get('/authoring/button-preview-css', { config: rl(60) }, async () => ({ css: await buttonPreviewCss() }));

  // The Tailwind CSS reference for the Library's "TailwindCSS Reference" modal: every utility class
  // the bundled Tailwind can generate, the CSS each produces, and the authored per-topic prose.
  // STATIC platform data (no tenant input), serialized + hashed once — see tailwind-reference.ts.
  // Served revalidating with a content ETag: the payload is ~1.8 MB but only changes when Tailwind is
  // upgraded or the prose is edited, so a returning editor gets a 304 with no body.
  app.get('/authoring/tailwind/reference', { config: rl(60) }, async (req, reply) => {
    const { body, etag } = tailwindReferencePayload();
    // If-None-Match may carry a comma list (RFC 9110 §13.1.2) — match against any listed validator.
    const inmRaw = req.headers['if-none-match'];
    const inm = Array.isArray(inmRaw) ? inmRaw.join(',') : inmRaw;
    if (typeof inm === 'string' && inm.split(',').some((v) => v.trim() === etag)) {
      return reply.header('etag', etag).header('cache-control', 'no-cache').code(304).send();
    }
    return reply
      .header('etag', etag)
      .header('cache-control', 'no-cache')
      .header('x-content-type-options', 'nosniff')
      .type('application/json; charset=utf-8')
      .send(body);
  });
  // The Library "Parallax" builder's live preview DOCUMENT (the chosen element beside a static twin,
  // driven by the REAL runtime). Served as text/html under `Content-Security-Policy: sandbox
  // allow-scripts` so the inline runtime RUNS in an opaque, isolated origin — the editor's own CSP
  // (`script-src 'self'`) would block an inline script in a `srcdoc` iframe, so the editor points the
  // iframe `src` HERE instead. Only clamped numeric/enum channel params reach the markup (no tenant
  // strings, no brand vars) → no injection surface. STATIC apart from the query knobs; rate-limited.
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/authoring/parallax-preview',
    { config: rl(60) },
    async (req, reply) => {
      const q = req.query;
      const numPair = (v: string | undefined): [number, number] | null => {
        if (typeof v !== 'string') return null;
        const parts = v.split(',').map(Number);
        return parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) ? [parts[0]!, parts[1]!] : null;
      };
      // Each channel: its from,to plus an optional per-channel window + OUT phase (query keys mirror the
      // data attributes minus the prefix, e.g. `opacity`, `opacity-range`, `opacity-out`, `opacity-out-range`).
      const chan = (name: string) => {
        const main = numPair(q[name]);
        return main
          ? { from: main[0], to: main[1], range: numPair(q[`${name}-range`]), out: numPair(q[`${name}-out`]), outRange: numPair(q[`${name}-out-range`]) }
          : null;
      };
      const html = parallaxPreviewDoc({
        axis: q.axis === 'x' ? 'x' : 'y',
        range: numPair(q.range),
        translate: chan('translate'),
        opacity: chan('opacity'),
        scale: chan('scale'),
        blur: chan('blur'),
      });
      return reply
        .header('content-security-policy', 'sandbox allow-scripts')
        .header('x-frame-options', 'SAMEORIGIN')
        .type('text/html')
        .send(html);
    },
  );

  // The Library "SVG animation" builder's live preview DOCUMENT (the chosen effect + timing looping on a
  // sample line-art SVG, driven by the REAL runtime). Served under `Content-Security-Policy: sandbox
  // allow-scripts` like the parallax preview above, for the same reason. Only the allowlisted effect
  // keyword + clamped numeric timing reach the markup (svgAnimAttrs validates) → no injection surface.
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/authoring/svg-preview',
    { config: rl(60) },
    async (req, reply) => {
      const q = req.query;
      const int = (v: string | undefined): number | undefined => {
        const n = Number.parseInt(v ?? '', 10);
        return Number.isFinite(n) ? n : undefined;
      };
      const html = svgAnimPreviewDoc({
        effect: q.effect,
        duration: int(q.duration),
        delay: int(q.delay),
        easing: q.easing,
        drawDir: q['draw-dir'] === 'reverse' ? 'reverse' : undefined,
        fill: q.fill === 'true',
        origin: q.origin,
      });
      return reply
        .header('content-security-policy', 'sandbox allow-scripts')
        .header('x-frame-options', 'SAMEORIGIN')
        .type('text/html')
        .send(html);
    },
  );

  // The SVG Animation Studio's live CANVAS document (renders the user's SVG + plays the real runtimes +
  // reports clicks/highlights). STATIC — all content arrives via postMessage from the editor; served
  // under the same sandbox CSP as the previews above (opaque origin, no session).
  app.get('/authoring/svg-studio-preview', { config: rl(60) }, async (_req, reply) =>
    reply
      .header('content-security-policy', 'sandbox allow-scripts')
      .header('x-frame-options', 'SAMEORIGIN')
      .type('text/html')
      .send(svgStudioPreviewDoc()),
  );

  // The system WIDGET catalog — managed, data-backed drop-ins (hero-slider, …) the editor's Widgets
  // rail browses and inserts as {{> name}}. STATIC platform metadata (no tenant data): name/label/
  // description, the component it's built on, and the config dataset(s) it provisions on save. The
  // body + manifest stay server-side; the editor only needs this slim descriptor.
  app.get('/authoring/widgets', { config: rl(60) }, async () => ({
    widgets: GLOBAL_WIDGETS.map((w) => ({
      name: w.name,
      label: w.label,
      description: w.description,
      component: w.component,
      datasets: w.provides.datasets.map((d) => ({ slug: d.slug, name: d.name })),
    })),
  }));

  // The DEPLOYED editor SPA's build id — the content hash of its main bundle, read ONCE from the served
  // index.html (it only changes on a redeploy = a new container). The editor compares this to its own
  // running bundle hash to detect "a newer version is deployed; reload your stale tab". Cached after first read.
  let editorBuildId: string | null | undefined;
  const getEditorBuildId = async (): Promise<string | null> => {
    if (editorBuildId !== undefined) return editorBuildId;
    editorBuildId = null;
    if (opts.editorDist) {
      try {
        const indexHtml = await readFile(join(opts.editorDist, 'index.html'), 'utf8');
        const m = indexHtml.match(/assets\/index-([A-Za-z0-9_-]+)\.js/);
        if (m) editorBuildId = m[1]!;
      } catch {
        /* editorDist missing / unreadable → leave null (no stale-tab check) */
      }
    }
    return editorBuildId;
  };

  // Pull-based update check for the in-app banner. Public + informational. `build` = the running editor
  // SPA's content hash (for stale-tab reload); `current`/`latest` = the self-hosted release-upgrade check.
  // This INSTANCE's RFC 9116 security.txt (not the per-project one the publisher emits into a client
  // site). Generated per request so `Expires` is always ~90 days out and can never go stale; served
  // as text/plain per RFC 9116 §3, and `no-cache` so a changed SW_SECURITY_CONTACT takes effect at
  // once. Registered as an explicit route because the SPA fallback would otherwise answer this path
  // with index.html — a 200 and a page of HTML where a scanner expects the file.
  app.get('/.well-known/security.txt', async (_req, reply) => {
    return reply
      .type('text/plain; charset=utf-8')
      .header('cache-control', 'no-cache')
      .send(
        renderPlatformSecurityTxt({
          now: new Date(),
          contacts: opts.securityContacts,
          // Canonical ONLY from the configured public URL — never derived from the request Host,
          // which is caller-supplied and would reflect an arbitrary origin into a published file.
          publicUrl: opts.publicUrl,
        }),
      );
  });

  app.get('/version', async () => {
    const current = opts.version ?? '0.0.0';
    const latest = opts.latestVersion ? await opts.latestVersion() : null;
    return {
      current,
      latest,
      updateAvailable: latest ? isNewer(latest, current) : false,
      releaseUrl: opts.releaseUrl ?? null,
      build: await getEditorBuildId(),
    };
  });

  // Single-container mode: serve the editor SPA at `/`, with a fallback to
  // index.html for non-API GET routes (client-side navigation / refresh).
  if (opts.editorDist) {
    // CSP for the editor SPA document ONLY (not published /sites pages, which keep the strict
    // default + never reference Google): the Google-Fonts picker BROWSES by loading webfonts from
    // Google in the admin's browser (selected fonts are then self-hosted), so allow the Google
    // style + font hosts here. `setHeaders` overriding the response CSP makes the onSend default-
    // CSP hook skip it (it only sets the default when no CSP is present).
    // The `sha256-…` allows the single inline FOUC script in editor/index.html (applies the persisted
    // color theme before first paint, so dark-mode users see no light flash). It is the ONLY inline
    // script permitted (no `unsafe-inline`); its hash covers the script's exact bytes — if that script
    // in apps/editor/index.html ever changes, recompute this hash (sha256, base64, of the script body).
    // If the hash ever mismatches, the script is simply blocked and main.tsx applies the theme instead
    // (a brief flash, never broken).
    // Computed PER RESPONSE, not once at registration: `frameAncestors` is live-updated when an admin
    // saves the embedding setting, and this is the document an embedder actually frames — baking the
    // policy in at boot would mean the setting only took effect after a restart.
    const editorCsp = (): string =>
      "default-src 'self'; script-src 'self' 'sha256-tlhaSBLKS1jokEVelo26MbNXtbB3d+qnWj1D95nCkH4='; img-src 'self' data: https:; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; " +
      `object-src 'none'; base-uri 'self'; frame-ancestors ${frameAncestors ?? "'none'"}`;
    /** Stamps the SPA shell's framing headers: XFO is omitted once an allowlist is active (it cannot
     *  express one), leaving `frame-ancestors` as the guard. */
    const applyShellFraming = (reply: { header(k: string, v: string): unknown }): void => {
      reply.header('content-security-policy', editorCsp());
      if (frameAncestors === null) reply.header('x-frame-options', 'DENY');
    };
    // `dotfiles: 'deny'` makes the posture explicit (don't rely on @fastify/send's 'ignore'
    // default): a dotfile under editorDist (e.g. a stray .env) is never served.
    await app.register(fastifyStatic, {
      root: opts.editorDist,
      prefix: '/',
      wildcard: false,
      dotfiles: 'deny',
      // @fastify/static v10 passes a FastifyReply here (v9 passed the raw ServerResponse), so use
      // reply.header(...) rather than res.setHeader(...).
      setHeaders: (reply, path) => {
        if (path.endsWith('index.html')) {
          applyShellFraming(reply);
          // The SPA entry must always revalidate so a new deploy's content-hashed asset URLs are picked up.
          reply.header('cache-control', 'no-cache');
        } else if (/[/\\]assets[/\\]/.test(path)) {
          // Vite content-hashes asset filenames (the build's `?v`), so cache them forever.
          reply.header('cache-control', 'public, max-age=31536000, immutable');
        }
      },
    });
    // Rate-limit the catch-all so unknown-path probing/enumeration is throttled too.
    app.setNotFoundHandler({ preHandler: app.rateLimit() }, (req, reply) => {
      if (req.method === 'GET' && !isApiPath(req.url)) {
        applyShellFraming(reply);
        return reply
          .header('cache-control', 'no-cache') // SPA shell: revalidate so a new deploy is picked up on refresh
          .sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not found' });
    });
  }

  // ---- Isolated template render (Handlebars in a child-process worker pool) ----
  // The live-preview backend for the code-first template editor: renders a supplied
  // template against the project's Corporate Identity + datasets, inside a memory-capped
  // worker. Owner/admin only — template authoring is a developer action.
  const RenderTemplateBody = z
    .object({
      // Ad-hoc source (the live editing loop) OR a stored source-page by id.
      template: z.string().max(256 * 1024).optional(),
      pageId: z.string().max(200).optional(),
      page: z.object({ title: z.string().max(300), path: z.string().max(2048) }).partial().optional(),
      // When true, wrap the rendered body in a full styled <!doctype> document (the doc
      // shell + the source's compiled Tailwind utilities inlined) so the editor preview is
      // STYLED. Default false → the bare rendered body (used by API consumers/tests).
      document: z.boolean().optional(),
    })
    .refine(
      (b) => (b.template !== undefined) !== (b.pageId !== undefined),
      'provide exactly one of template or pageId',
    );
  app.post<{ Params: { projectId: string } }>(
    '/projects/:projectId/render-template',
    // 30/min — aligned with the small worker pool's throughput (avoids a deep parent queue).
    { bodyLimit: 512 * 1024, config: rl(30) },
    async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:read');
      if (!WRITE_ROLES.has(ctx.role)) {
        throw new ForbiddenError('template authoring requires an owner/admin role');
      }
      if (!renderPool) return reply.code(503).send({ error: 'rendering is not available' });
      const body = RenderTemplateBody.parse(req.body);

      // Resolve the template source + page context: a stored source-page (by id) or ad-hoc.
      let templateSource: string;
      let pageCtx: Record<string, unknown> = body.page ?? { title: project.name, path: '/' };
      let storedPage: Page | undefined;
      if (body.pageId !== undefined) {
        // Re-parse the stored page (not a bare cast) so a dirty/legacy DB row can't reach
        // the render path unvalidated; NotFound → 404.
        const page = PageSchema.parse(await contentRepo.get(ctx, 'page', body.pageId));
        if (!page.source) return reply.code(400).send({ error: 'this page has no template source' });
        templateSource = page.source;
        storedPage = page;
        // `{{ page.path }}` is the full route computed from the parent chain; `page.slug` is the
        // page's OWN segment (its `path` field) — mirrors the member-preview/publish page context.
        const allForPath = pagesById((await contentRepo.list(ctx, 'page')) as Page[]);
        // page.data carries the page's editable text/url overrides (the data-sw-* directives).
        pageCtx = { title: page.title, slug: page.path, path: pagePath(page, allForPath), data: page.data };
      } else {
        templateSource = body.template as string; // refine guarantees one of template/pageId
      }

      // Binding context: company (identity), website (public fields only), page, datasets→dataset.
      let company: Record<string, unknown> = { name: project.name };
      let website: Record<string, unknown> | undefined;
      let themeBodyClass = '';
      let themeStickyHeader: StickyHeaderSetting | undefined;
      let themeCustomScripts: string | undefined;
      let themePreloader: string | undefined;
      let themeEmitContentTokens = false;
      let themeCriticalCss: string | undefined;
      let brand: CorporateIdentity = { name: project.name, colors: {} };
      let projectDefaultLocale = 'en';
      try {
        const settings = (await contentRepo.get(ctx, 'settings', SETTINGS_ENTITY_ID)) as Settings;
        company = settings.identity as unknown as Record<string, unknown>;
        brand = settings.identity;
        projectDefaultLocale = settings.settings?.defaultLocale ?? 'en';
        // This authoring render-template tool feeds `data` un-locale-resolved (see the note below); to
        // match, `{{sw-translate}}` here serves the DEFAULT-locale strings regardless of a stored page's
        // own locale. Locale-accurate translation preview is the /preview path (uses previewLocale).
        website = settings.website
          ? { siteUrl: settings.website.siteUrl, data: settings.website.data, consent: settings.website.consent, t: resolveTranslations(settings.website.translations, projectDefaultLocale, projectDefaultLocale), enableThemes: settings.website.enableThemes }
          : undefined;
        themeBodyClass = websiteEffectsClasses(settings.website?.effects);
        themeStickyHeader = settings.website?.effects?.stickyHeader;
        themeCriticalCss = settings.website?.criticalCss;
        const fx = websiteEffectsCustomCode(settings.website?.effects);
        themeCustomScripts = fx.bodyEnd || undefined;
        // NO preloader on this canvas either — same reasoning as the page-preview route above, which
        // this one had been left out of step with. It passed the author's custom code RAW (not even
        // inside the platform wrapper), and no preloader runtime ships in this shell, so a custom
        // overlay rendered here had nothing to clear it and simply covered the canvas. A preloader is
        // whole-site chrome; the whole-site draft preview is where it means anything.
        themePreloader = undefined;
        themeEmitContentTokens = !!(fx.bodyEnd || fx.preloader);
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err;
      }
      if (storedPage) {
        // Locale context (resolved + default) for a stored page — member-preview/publish parity, so
        // locale-aware helpers ({{sw-active}}'s locale-home rule) behave the same in this authoring
        // render. Ad-hoc bodies stay locale-less (the helper then falls back to the "/"-only rule).
        pageCtx = { ...pageCtx, locale: localeOf(storedPage, projectDefaultLocale), defaultLocale: projectDefaultLocale };
      }
      const byDataset = new Map<string, Entry[]>();
      for (const entry of (await contentRepo.list(ctx, 'entry')) as Entry[]) {
        byDataset.set(entry.dataset, [...(byDataset.get(entry.dataset) ?? []), entry]);
      }
      for (const list of byDataset.values()) list.sort(compareEntryOrder);
      const data = Object.fromEntries(byDataset);
      // Reusable Handlebars partials the template can {{> name}} (validated at render): built-in
      // globals + the project's own (project wins on a name collision), then the MANAGED Widget
      // bodies LAST so a widget name can't be shadowed.
      const partials = {
        ...(await globalSnippetPartials(contentRepo)),
        ...Object.fromEntries(((await contentRepo.list(ctx, 'snippet')) as Snippet[]).map((s) => [s.name, s.source])),
        ...WIDGET_PARTIALS,
      };
      // Keyed entry access for this template (only the datasets it addresses by key). NOTE: this
      // owner render-template tool feeds `data` un-locale-resolved (pre-existing), so `item` here
      // keys the DEFAULT-locale entries — the member /preview + publish paths locale-resolve both.
      const item = keyedDatasets(templateSource, data as Record<string, readonly Entry[]>);
      // Public form definitions + same-origin endpoints so the code editor's live render shows
      // {{sw-form}} / data-sw-form embeds (parity with the member /preview path).
      const renderForms = resolveFormEndpoints(
        Object.fromEntries(((await contentRepo.list(ctx, 'form')) as Form[]).map((f) => [f.id, toPublicForm(f)])),
        (fid) => `/f/${project.id}/${fid}/preview`, // dry run — a render preview never mails a lead
      );
      // Read only when a captcha-flagged form exists (mirrors the /preview gate).
      const renderCaptcha = Object.values(renderForms).some((f) => f.captcha)
        ? captchaRenderConfig(await loadProjectCaptchaById(db, project.id))
        : undefined;
      // Bound the IPC payload serialized in THIS (parent) process — a large dataset must
      // not spike the API's heap (only the worker carries a --max-old-space ceiling).
      if (JSON.stringify(data).length + JSON.stringify(item).length + JSON.stringify(partials).length + JSON.stringify(renderForms).length > 4 * 1024 * 1024) {
        return reply.code(413).send({ error: 'project data is too large to render' });
      }

      try {
        const rendered = await renderPool.render(templateSource, {
          company,
          website,
          page: pageCtx,
          dataset: data,
          item,
          partials,
          forms: renderForms,
          ...(renderCaptcha ? { captcha: renderCaptcha } : {}),
        });
        if (!body.document) return reply.send({ html: rendered });
        // Styled-document preview: wrap the rendered body in the publish doc shell + inline
        // the source's own Tailwind utilities (shared with the member `/preview` path).
        const previewPage: Page = {
          id: 'preview',
          path: String(pageCtx.path ?? '/'),
          title: String(pageCtx.title ?? project.name),
        };
        const html = await styledSourceDocument(previewPage, brand, rendered, {
          // Self-hosted @font-face so the code-editor preview doesn't fall back to system fonts.
          ...fontMediaShell((await contentRepo.list(ctx, 'media')) as MediaAsset[], project.slug),
          formApi: { base: '', project: project.id, preview: true },
          criticalCss: themeCriticalCss, // site-wide critical CSS (gradient/chrome classes)
          bodyClass: themeBodyClass,
          stickyHeader: themeStickyHeader,
          customScripts: themeCustomScripts,
          preloader: themePreloader,
          emitBrandContentTokens: themeEmitContentTokens,
        });
        // Mint a previewStore token so the editor loads the doc via an iframe `src` (served under an
        // opaque-origin `sandbox` CSP) instead of `srcDoc` (which inherits the editor's own CSP).
        // `html` is still returned for API consumers/tests.
        const token = previewStore.put(html, { projectId: project.id, userId: ctx.userId });
        return reply.send({ html, token });
      } catch (err) {
        // Infra (worker/timeout) → 503; a template validation/compile/render error → 400.
        if (err instanceof RenderUnavailableError) return reply.code(503).send({ error: err.message });
        return reply.code(400).send({ error: err instanceof Error ? err.message : 'render failed' });
      }
    },
  );

  // Renders ONE stored snippet (project or `?scope=global`) to a styled, self-contained HTML
  // document for the editor's hover preview. Unlike render-template (owner-only, ad-hoc source),
  // this renders a STORED snippet BY ID, so it's safe at `content:read` — the same gate as the
  // member `/preview`. Served DIRECTLY (no token) as `text/html` under the opaque `sandbox
  // allow-scripts` CSP, loaded via an iframe `src`; errors render as a small HTML notice so the
  // iframe never shows a raw JSON error.
  app.get<{ Params: { projectId: string; id: string }; Querystring: { scope?: string } }>(
    '/projects/:projectId/snippets/:id/preview',
    // 30/min — this hits the SAME small render-worker pool as render-template, so it shares that
    // route's throughput-aligned cap (the client's hover debounce keeps real usage well under it).
    { config: rl(30) },
    async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:read');
      // `msg` is a fixed set of static in-code strings (never user input) — typed as a union so a
      // future caller can't interpolate dynamic content into the served (sandboxed) document.
      const notice = (
        msg:
          | 'Preview is unavailable.'
          | 'This snippet no longer exists.'
          | 'The snippet library is too large to preview.'
          | 'This snippet has an error and can’t be previewed.',
        code = 200,
      ) =>
        reply
          .code(code)
          .header('content-security-policy', 'sandbox')
          .header('x-frame-options', 'SAMEORIGIN')
          .type('text/html')
          .send(
            `<!doctype html><meta charset="utf-8"><body style="margin:0;font:13px/1.5 system-ui,sans-serif;color:#64748b;display:grid;place-items:center;height:100vh;padding:1rem;text-align:center">${msg}</body>`,
          );
      if (!renderPool) return notice('Preview is unavailable.', 503);

      // Built-in + admin globals and the project's own snippets — both the resolvable partial set a
      // snippet may `{{> include}}` AND the source to preview. A Map keyed by own entries makes the
      // by-id lookup prototype-safe (snippet names can't be `__proto__` — SnippetSchema requires a
      // leading letter — but a Map is robust regardless).
      const globalPartials = await globalSnippetPartials(contentRepo);
      const projectMap = Object.fromEntries(((await contentRepo.list(ctx, 'snippet')) as Snippet[]).map((s) => [s.name, s.source]));
      // Widget bodies are resolvable as `{{> include}}` targets but are NOT a previewable scope —
      // they stay out of globalPartials/projectMap (the source-to-preview lookup below) and are
      // spread LAST so a managed widget name can't be shadowed by a snippet of the same name.
      const partials = { ...globalPartials, ...projectMap, ...WIDGET_PARTIALS };
      const scope = req.query.scope === 'global' ? 'global' : 'project';
      const source = new Map(Object.entries(scope === 'global' ? globalPartials : projectMap)).get(req.params.id);
      if (typeof source !== 'string') return notice('This snippet no longer exists.', 404);
      // Bound the IPC payload to the worker (source + the partial set; data/item are empty here).
      if (source.length + JSON.stringify(partials).length > 4 * 1024 * 1024) return notice('The snippet library is too large to preview.', 413);

      let brand: CorporateIdentity = { name: project.name, colors: {} };
      let website: Record<string, unknown> | undefined;
      let themeBodyClass = '';
      let themeStickyHeader: StickyHeaderSetting | undefined;
      let themeFxBodyEnd: string | undefined;
      let containerWidth: string | undefined;
      let themeCriticalCss: string | undefined;
      try {
        const settings = (await contentRepo.get(ctx, 'settings', SETTINGS_ENTITY_ID)) as Settings;
        brand = settings.identity;
        // Snippet HOVER preview is intentionally lean (empty data/item); `website.t` is omitted too, so
        // {{sw-translate}} in a hovered snippet renders its `default=`/'' fallback (no locale context here).
        website = settings.website ? { siteUrl: settings.website.siteUrl, data: settings.website.data, consent: settings.website.consent } : undefined;
        containerWidth = settings.website?.containerWidth;
        themeCriticalCss = settings.website?.criticalCss;
        themeBodyClass = websiteEffectsClasses(settings.website?.effects);
        themeStickyHeader = settings.website?.effects?.stickyHeader;
        // Custom nav/button effect code applies here too (a hovered nav snippet should show it); a
        // custom PRELOADER is deliberately omitted — a snippet hover doesn't want a loading overlay.
        themeFxBodyEnd = websiteEffectsCustomCode(settings.website?.effects).bodyEnd || undefined;
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err;
      }

      try {
        // No datasets/entries: a hover preview shows the snippet's STRUCTURE with brand styling +
        // resolved {{> partials}}; dataset loops / page.data bindings render empty (kept lean — no
        // per-hover entry load). Partials let a snippet that composes others preview correctly.
        const rendered = await renderPool.render(source, {
          company: brand as unknown as Record<string, unknown>,
          website,
          page: { title: project.name, path: '/' },
          dataset: {},
          item: {},
          partials,
        });
        const previewPage: Page = { id: 'snippet-preview', path: '/', title: project.name };
        const html = await styledSourceDocument(previewPage, brand, rendered, {
          // Self-hosted @font-face so this preview doesn't fall back to system fonts.
          ...fontMediaShell((await contentRepo.list(ctx, 'media')) as MediaAsset[], project.slug),
          formApi: { base: '', project: project.id, preview: true },
          criticalCss: themeCriticalCss, // site-wide critical CSS (gradient/chrome classes)
          bodyClass: themeBodyClass,
          stickyHeader: themeStickyHeader,
          customScripts: themeFxBodyEnd,
          emitBrandContentTokens: !!themeFxBodyEnd,
          containerWidth,
        });
        // `allow-forms` so an embedded form's submit fires here too; this render's forms point at the
        // dry-run endpoint (renderForms above), so a live render never mails anyone.
        reply.header('content-security-policy', PREVIEW_SANDBOX_CSP);
        reply.header('x-frame-options', 'SAMEORIGIN');
        return reply.type('text/html').send(html);
      } catch (err) {
        if (err instanceof RenderUnavailableError) return notice('Preview is unavailable.', 503);
        return notice('This snippet has an error and can’t be previewed.', 200);
      }
    },
  );

  // Graceful shutdown for k8s: drain + terminate render workers when Fastify closes.
  if (renderPool) {
    app.addHook('onClose', async () => {
      await renderPool.shutdown();
    });
  }
  // Close the shared screenshot browser too (no-op if it was never launched).
  app.addHook('onClose', async () => closeScreenshotBrowser());

  // Periodic housekeeping: prune expired sessions / MFA tickets / WebAuthn challenges so abandoned
  // flows don't accumulate. The timer is unref'd (never holds the process open) and cleared on close
  // (so tests don't leak timers); the interval is long enough not to fire inside a test run.
  /**
   * How long a derived artefact survives without being touched. Preview builds and source references
   * only; a build with no Local Hosting target is removed regardless of age, because age is not what
   * makes it useless.
   */
  const derivedRetentionMs = opts.derivedRetentionMs ?? 30 * 24 * 60 * 60 * 1000;

  /**
   * Sweep the three derived stores. The rules live in `storage-reaper.ts`; what matters HERE is the
   * `onPreviewReaped` wiring — `previewBuiltVersion` is an in-memory map whose check returns early
   * without testing that the directory still exists, so a build reaped behind this process's back
   * would serve 404s. Dropping the marker is what makes the next request rebuild instead, and it is
   * why this sweep cannot be a cron job.
   */
  async function reapDerivedStorage(): Promise<void> {
    const report = await sweepDerivedStorage(db, {
      ...(opts.publishRoot ? { publishRoot: opts.publishRoot } : {}),
      ...(opts.previewRoot ? { previewRoot: opts.previewRoot } : {}),
      ...(opts.sourceRefRoot ? { sourceRefRoot: opts.sourceRefRoot } : {}),
      retentionMs: derivedRetentionMs,
      busyProjectIds: activePublishes,
      onPreviewReaped: (projectId) => {
        previewBuiltVersion.delete(projectId);
        previewBuilds.delete(projectId);
      },
    });
    for (const [what, r] of [['unserved site builds', report.builds], ['stale preview builds', report.previews], ['stale source references', report.sourceRefs]] as const) {
      if (r.removed.length) app.log.info({ removed: r.removed.length, bytes: r.bytesFreed }, `reaped ${what}`);
    }
  }

  const sweepMs = opts.maintenanceSweepMs ?? 60 * 60 * 1000;
  /**
   * ★ Runs ONCE SHORTLY AFTER BOOT as well as on the interval, and that is not a nicety.
   *
   * With `setInterval` alone, an instance restarted more often than the interval NEVER sweeps — the
   * timer is always cancelled before it fires. That is not a hypothetical: a development instance,
   * anything redeployed a few times a day, and every container that crash-loops all fall into it, and
   * the symptom is silence rather than an error. Housekeeping that only runs on quiet machines is
   * housekeeping that does not run on the machines with the most to clean.
   *
   * The delay keeps it off the boot path, so a restart is not slowed by a filesystem walk and a
   * health check never waits behind one.
   */
  const runMaintenanceSweeps = (): void => {
    // Chained, not concurrent: the client reap only drops registrations nothing points at, so it has
    // to see the token sweep's deletions or a dead client survives on the strength of expired rows.
    void sweepExpiredAuthRows(db)
      .then(() => reapUnusedOAuthClients(db))
      .then(() => reapDeadPats(db))
      .catch((err) => app.log.warn(err, 'auth-row maintenance sweep failed'));
    void revisionsRepo.sweepOld().catch((err) => app.log.warn(err, 'revision retention sweep failed'));
    // Spent proof-of-work challenges past their signed TTL. Dropping them cannot reopen a replay:
    // an expired challenge fails verification before the spent-check is ever consulted.
    void submissionsRepo.sweepSpentPow().catch((err) => app.log.warn(err, 'proof-of-work sweep failed'));
    if (mediaStorage) void reapDeletedMedia(db, mediaStorage).catch((err) => app.log.warn(err, 'media recycle-bin reap failed'));
    // ★ THE DERIVED-STORE REAPERS. `sites`, `preview` and `source-refs` had ONE removal path
    // between them (permanent project deletion), so anything ever published, previewed or imported
    // grew forever — 1.35 GB on a real instance, almost none of it reachable.
    void reapDerivedStorage().catch((err) => app.log.warn(err, 'derived-storage reap failed'));
  };

  if (sweepMs > 0) {
    // Well inside the shortest interval any caller sets, so the two never overlap on the first pass.
    const firstRun = setTimeout(runMaintenanceSweeps, Math.min(30_000, Math.floor(sweepMs / 2)));
    const sweepTimer = setInterval(runMaintenanceSweeps, sweepMs);
    firstRun.unref();
    sweepTimer.unref();
    app.addHook('onClose', async () => {
      clearTimeout(firstRun);
      clearInterval(sweepTimer);
    });
  }

  return app;
}
