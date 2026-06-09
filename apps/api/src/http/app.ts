import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import {
  MediaFolderSchema,
  targetsPrivateHost,
  ImageAssetSchema,
  FileAssetSchema,
  FontWeightSchema,
  FontFamilyNameSchema,
  FONT_WEIGHTS,
  PageSchema,
  migrateContentIntoData,
  PageNodeSchema,
  InstanceSettingsInputSchema,
  assertWithinTreeDepth,
  toPublicForm,
  type CorporateIdentity,
  type Entry,
  type FileAsset,
  type MediaFolderRecord,
  type Form,
  type FormPublic,
  type ImageAsset,
  type MediaAsset,
  type Snippet,
  type Page,
  type PageTranslation,
  type Template,
} from '@sitewright/schema';
import { downloadGoogleFont, FontFetchError } from '../fonts/service.js';
import { detectFontFormat, MAX_FONT_BYTES } from '../fonts/upload.js';
import { createFontAsset as storeFontAsset, mergeFontFaces } from '../fonts/asset.js';
import {
  renderDocument,
  usedComponentTypes,
  componentAssets,
  usesAnimations,
  treeUsesAnimations,
  ANIMATION_CSS,
  ANIMATION_JS,
  usesLazyload,
  treeUsesLazyload,
  LAZYLOAD_CSS,
  LAZYLOAD_JS,
  usesRipple,
  treeUsesRipple,
  RIPPLE_CSS,
  RIPPLE_JS,
} from '@sitewright/blocks';
import { compileUtilityCss, brandToTailwindTheme } from '@sitewright/tailwind';
import { optimizeImage } from '@sitewright/image-pipeline';
import {
  buildNav,
  collectClassNames,
  extractClassNames,
  GLOBAL_SNIPPET_PARTIALS,
  isGlobalTemplate,
  publishedPages,
  resolveTemplateSource,
  resolveLocaleDatasets,
  compareEntryOrder,
  keyedDatasets,
  translationsOf,
  localeOf,
  pagesInLocale,
  pagePath,
  pagesById,
  childrenOf,
  parentPageView,
  referencesChildren,
  referencesParentPage,
  type ProjectBundle,
} from '@sitewright/core';
import type { Database } from '../db/client.js';
import { MediaStorage } from '../media/storage.js';
import { MediaValidationError } from '../media/errors.js';
import { ancestorPaths, isUnderFolder, reparentPath, validateFolderMove } from '../media/folders.js';
import { PublishError } from '../publish/build.js';
import { fetchJsonData, JsonDataError } from '../publish/json-data.js';
import { InProcessBuildRunner, type BuildRunner } from '../publish/runner.js';
import { AiProviderError, type AiProvider } from '../ai/provider.js';
import { PublishStore } from '../publish/store.js';
import { PreviewStore } from './preview-store.js';
import { PREVIEW_BRIDGE_JS } from './preview-bridge.js';
import { archiveSite, deploySite, DeployConfigSchema } from '../publish/adapters.js';
import { isNewer } from '../version/checker.js';
import { registerDeployTargetRoutes } from './deploy-targets.js';
import { registerFormRoutes } from './form-routes.js';
import { registerProjectSmtpRoutes } from './project-smtp-routes.js';
import { registerStockRoutes, type StockServiceLike } from './stock-routes.js';
import { StockService } from '../stock/service.js';
import { defaultStockProviders } from '../stock/providers.js';
import { SubmissionRepository } from '../repo/submissions.js';
import { GlobalSmtpMailer, ProjectSmtpMailer, type SubmissionMailer, type ProjectMailer } from '../mail/mailer.js';
import { HttpHcaptchaVerifier, type HcaptchaVerifier } from '../mail/hcaptcha.js';
import { createSession, revokeSession, validateSession } from '../auth/sessions.js';
import {
  getPlatformRole,
  getUserEmail,
  listPlatformUsers,
  listProjectAccessForUser,
  listProjectMembers,
  login,
  registerAccount,
  removeProjectMember,
  resolveProjectRole,
  setPlatformRole,
} from '../repo/accounts.js';
import {
  acceptInvite,
  createInvite,
  getInvite,
  hasPendingInvite,
  listInvites,
  peekInvite,
  revokeInvite,
} from '../repo/invites.js';
import { InstanceSettingsRepository, EncryptionUnavailableError } from '../repo/instance-settings.js';
import { ProjectRepository } from '../repo/projects.js';
import { AiUsageRepository } from '../repo/ai-usage.js';
import { ApiKeyRepository, type ResolvedApiKey } from '../repo/api-keys.js';
import { OAuthRepository } from '../repo/oauth.js';
import { OAuthClientRepository } from '../repo/oauth-clients.js';
import { registerOAuthRoutes } from './oauth-routes.js';
import { ProjectEventBus } from '../events/bus.js';
import {
  ContentRepository,
  CONTENT_KINDS,
  SETTINGS_ENTITY_ID,
  type Settings,
} from '../repo/content.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  type ProjectContext,
} from '../repo/context.js';
import { RenderPool, RenderUnavailableError } from '../render/render-pool.js';
import { API_KEY_CAPABILITIES, type ApiKeyCapability, type ContentKind } from '../db/schema.js';

const SESSION_COOKIE = 'sw_session';
const RL_WINDOW = '1 minute';
/** Cap concurrent live-preview (SSE) connections per project (bounds sockets + listeners). */
const MAX_EVENT_SUBSCRIBERS_PER_PROJECT = 20;
/** Per-route rate-limit config for an expensive/sensitive endpoint. */
const rl = (max: number) => ({ rateLimit: { max, timeWindow: RL_WINDOW } });
const IMPORT_BODY_LIMIT = 4 * 1024 * 1024; // 4 MiB for a full project import
const PREVIEW_BODY_LIMIT = 2 * 1024 * 1024; // 2 MiB for a single draft page
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MiB per uploaded image
const IMPORT_TIMEOUT_MS = 10_000; // import-url: cap the whole download (headers + body)

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
const API_PREFIXES = ['/auth', '/projects', '/me', '/health', '/admin', '/f', '/invites', '/ai', '/api-key'];

const MEDIA_CONTENT_TYPES = new Map<string, string>([
  ['avif', 'image/avif'],
  ['webp', 'image/webp'],
  ['jpg', 'image/jpeg'],
]);

/** A `kind:'font'` asset's stored face file (`<weight>[-italic].<ext>`) — served INLINE as font/*. */
const FONT_FACE_FILE = /^[1-9]00(-italic)?\.(woff2|woff|ttf|otf)$/;
const FONT_CONTENT_TYPES = new Map<string, string>([
  ['woff2', 'font/woff2'],
  ['woff', 'font/woff'],
  ['ttf', 'font/ttf'],
  ['otf', 'font/otf'],
]);

// Bound concurrent image optimization — each run spawns several sharp encoders,
// so unbounded parallel uploads could saturate CPU/memory on the single
// container. A slot is handed directly to the next waiter on release (never
// over-admitting beyond MAX_CONCURRENT_OPTIMIZE).
const MAX_CONCURRENT_OPTIMIZE = 3;
let activeOptimizations = 0;
const optimizeWaiters: Array<() => void> = [];
async function withOptimizeSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeOptimizations < MAX_CONCURRENT_OPTIMIZE) {
    activeOptimizations += 1;
  } else {
    await new Promise<void>((resolve) => optimizeWaiters.push(resolve));
  }
  try {
    return await fn();
  } finally {
    const next = optimizeWaiters.shift();
    if (next) next();
    else activeOptimizations -= 1;
  }
}

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
const DEDICATED_KINDS: ReadonlySet<ContentKind> = new Set(['media', 'mediafolder', 'deploy_target', 'project_smtp']);
function parseGenericKind(kind: string): ContentKind {
  const parsed = parseKind(kind);
  if (DEDICATED_KINDS.has(parsed)) {
    throw new ForbiddenError(`${parsed} must be accessed via its dedicated endpoints`);
  }
  return parsed;
}

const RegisterBody = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  // Accepted for backward compatibility with older clients but ignored — there is no org to name.
  orgName: z.string().min(1).max(120).optional(),
});
const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});
const AiGenerateBody = z.object({
  instruction: z.string().min(1).max(4000),
  target: z.enum(['blocks', 'copy']).default('copy'),
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
  topNav?: string;
  mobileNav?: string;
  sidebarLeft?: string;
  sidebarRight?: string;
  footer?: string;
  bottom?: string;
  head?: string;
  criticalCss?: string;
  customScripts?: string;
  /** `<html lang>` for the preview — the previewed page's locale (publish parity). */
  lang?: string;
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
  body: string,
  shell: PreviewShell = {},
): Promise<string> {
  // The slots' Tailwind/DaisyUI classes must be in the inlined preview sheet too, else the shared
  // header/footer renders unstyled in the editor.
  const slotHtml = [shell.topNav, shell.mobileNav, shell.sidebarLeft, shell.sidebarRight, shell.footer, shell.bottom]
    .filter(Boolean)
    .join(' ');
  const scanHtml = `${body} ${slotHtml}`;
  const classNames = extractClassNames(scanHtml);
  // Platform-runtime markers in the rendered body/slots → inline the first-party
  // runtime(s) so they work live in the sandboxed preview (its CSP allows scripts).
  // The runtime CSS goes BEFORE the utility sheet, so Tailwind wins at equal specificity.
  const animated = usesAnimations(scanHtml);
  const lazy = usesLazyload(scanHtml);
  const waves = usesRipple(scanHtml);
  const inlineStyles = [
    ...(animated ? [ANIMATION_CSS] : []),
    ...(lazy ? [LAZYLOAD_CSS] : []),
    ...(waves ? [RIPPLE_CSS] : []),
    ...(classNames.length > 0
      ? [await compileUtilityCss([classNames.join(' ')], brandToTailwindTheme(brand))]
      : []),
  ];
  const inlineScripts = [
    ...(animated ? [ANIMATION_JS] : []),
    ...(lazy ? [LAZYLOAD_JS] : []),
    ...(waves ? [RIPPLE_JS] : []),
    // The editor↔preview bridge (scroll preserve/restore + inline-edit). Preview-only — this shell
    // is never the publish path (build.ts calls renderDocument directly), so it can't leak.
    PREVIEW_BRIDGE_JS,
  ];
  return renderDocument(page, {
    brand,
    bodyHtml: body,
    inlineStyles: inlineStyles.length > 0 ? inlineStyles : undefined,
    inlineScripts: inlineScripts.length > 0 ? inlineScripts : undefined,
    ...shell,
  });
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

const CreateProjectBody = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .max(64)
    // eslint-disable-next-line security/detect-unsafe-regex -- linear (hyphen separator), length-capped by .max()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase alphanumeric with hyphens'),
});

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

export interface AppOptions {
  db: Database;
  cookieSecret?: string;
  secureCookies?: boolean;
  logger?: boolean;
  /** Isolated template render pool (child-process workers). Absent → /render-template 503s. */
  renderPool?: RenderPool;
  /** Absolute path to the built editor SPA to serve at `/` (single-container mode). */
  editorDist?: string;
  /** Absolute path to the media storage root; enables media upload/serve (incl. fonts) when set. */
  mediaRoot?: string;
  /** Absolute path to the published-sites root; enables publish/serve when set. */
  publishRoot?: string;
  /**
   * Trust `X-Forwarded-For` so `req.ip` is the real client IP behind a reverse
   * proxy (required for correct per-IP rate limiting). `true`, or a CIDR/list of
   * trusted proxy addresses. Leave unset for direct connections.
   */
  trustProxy?: boolean | string | string[];
  /** 32-byte key for encrypting stored secrets (saved deploy-target passwords). */
  encryptionKey?: Buffer;
  /** When set, deploy targets are restricted to these exact hostnames (SaaS SSRF guard). */
  deployAllowedHosts?: string[];
  /** When set, per-project SMTP hosts are restricted to these exact hostnames (SaaS SSRF guard). */
  smtpAllowedHosts?: string[];
  /**
   * Normalized (lowercased) email allowlist designating instance admins — the
   * users who may read/write instance settings. Empty/unset = no instance admins.
   */
  adminEmails?: string[];
  /**
   * Per-IP request cap (per minute) for the auth routes (`/auth/register`, `/auth/login`). Defaults
   * to 10 — the safe production value. Raise it ONLY for the integration/E2E harness, which drives
   * many registrations from a single IP and would otherwise exhaust the shared bucket.
   */
  authRateMax?: number;
  /**
   * Whether public `POST /auth/register` is open. Default `true` (the embeddable factory + the
   * test suite). The production entry point (`server.ts`) sets this from `SW_OPEN_REGISTRATION`
   * and defaults it CLOSED — a closed instance is invitation-only (an email must hold a pending
   * invite), with the first admin seeded out-of-band (see seed.ts).
   */
  openRegistration?: boolean;
  /** Current running version (for the pull-based update check). */
  version?: string;
  /** Provider of the latest released version tag (cached; null when unavailable). */
  latestVersion?: () => Promise<string | null>;
  /** URL shown in the update banner linking to the latest release. */
  releaseUrl?: string;
  /** Build executor (default: in-process). Swap for an isolated worker in SaaS. */
  buildRunner?: BuildRunner;
  /** Online AI completion provider (agency-funded). Omit to disable the AI endpoints. */
  aiProvider?: AiProvider;
  /** Form-submission mailer (Mode A). Defaults to the global-SMTP mailer; tests inject a fake. */
  mailer?: SubmissionMailer;
  /** Per-project SMTP mailer (Mode B / userSmtp). Defaults to ProjectSmtpMailer; tests inject a fake. */
  projectMailer?: ProjectMailer;
  /** hCaptcha verifier for form submissions. Defaults to the live siteverify client; tests inject a fake. */
  hcaptcha?: HcaptchaVerifier;
  /** Stock-image search/import service. Defaults to the live providers; tests inject a fake. */
  stockService?: StockServiceLike;
  /**
   * The platform's public base URL (e.g. `https://cms.agency.com`). Baked into
   * exported `Form` blocks so the static site posts submissions back here. Unset
   * → same-origin `/f/…` (works only when the platform serves the export).
   */
  publicUrl?: string;
  /** Monthly token quotas for agency-funded metering. Unset/0 = unlimited. */
  aiQuota?: { orgMonthlyTokens?: number; userMonthlyTokens?: number };
}

export async function createApp(opts: AppOptions): Promise<FastifyInstance> {
  const { db } = opts;
  const signed = Boolean(opts.cookieSecret);
  const projects = new ProjectRepository(db);
  // In-process change bus: content writes (from any channel) publish here; the
  // SSE endpoint below relays them to live-preview clients.
  const events = new ProjectEventBus();
  const contentRepo = new ContentRepository(db, events);
  const mediaStorage = opts.mediaRoot ? new MediaStorage(opts.mediaRoot) : undefined;
  const publishStore = opts.publishRoot ? new PublishStore(opts.publishRoot) : undefined;
  // Short-lived store of rendered preview docs, so they can be served (via a token
  // URL) under a `Content-Security-Policy: sandbox` for true WYSIWYG interactivity.
  const previewStore = new PreviewStore();
  const buildRunner = opts.buildRunner ?? new InProcessBuildRunner();
  const aiProvider = opts.aiProvider;
  const aiUsageRepo = new AiUsageRepository(db);
  const apiKeysRepo = new ApiKeyRepository(db);
  const oauthRepo = new OAuthRepository(db);
  const oauthClients = new OAuthClientRepository(db);
  const instanceSettingsRepo = new InstanceSettingsRepository(db, opts.encryptionKey);
  const submissionsRepo = new SubmissionRepository(db);
  const mailer = opts.mailer ?? new GlobalSmtpMailer(instanceSettingsRepo);
  const projectMailer = opts.projectMailer ?? new ProjectSmtpMailer(db, instanceSettingsRepo, opts.encryptionKey);
  const hcaptchaVerifier = opts.hcaptcha ?? new HttpHcaptchaVerifier();
  const stockService = opts.stockService ?? new StockService(defaultStockProviders(), instanceSettingsRepo);
  // Normalized once at startup; membership is a constant-time-ish Set lookup per request.
  const adminEmails: ReadonlySet<string> = new Set(
    (opts.adminEmails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean),
  );
  const aiQuota = opts.aiQuota ?? {};
  // Isolated template renderer (child-process worker pool). Injected in tests; in
  // production server.ts constructs one. Absent → the render route returns 503.
  const renderPool = opts.renderPool;
  const app = Fastify({
    // Redact deploy credentials defensively (Fastify omits bodies by default, but
    // guard against any future body logging).
    logger: opts.logger
      ? {
          redact: [
            // Covers the auth login/register password AND the project-SMTP PUT
            // (SmtpInput.password is top-level) AND deploy-target create.
            'req.body.password',
            'req.body.hostFingerprint',
            // Instance-settings PUT carries plaintext secrets in nested fields.
            'req.body.smtp.password',
            'req.body.hcaptcha.secret',
            'req.body.stock.unsplash',
            'req.body.stock.pexels',
          ],
        }
      : false,
    // Behind a reverse proxy, trust X-Forwarded-For so req.ip (the rate-limit key)
    // is the real client IP instead of the proxy's (which would collapse all
    // clients to one bucket).
    trustProxy: opts.trustProxy ?? false,
  });

  // Public registration is open unless the embedder closes it. Leaving the default open is
  // safe for the test harness but a footgun for a direct `createApp` consumer who forgot to
  // set it, so surface it loudly (the production entry point always passes an explicit value,
  // so this never fires there).
  if (opts.openRegistration === undefined) {
    app.log.warn(
      '[sitewright/api] openRegistration left at its default (OPEN); anyone may self-register. ' +
        'Pass openRegistration:false (set SW_OPEN_REGISTRATION to opt in) for an invite-only instance.',
    );
  }

  // Plugins that integrate per-route (rate-limit hooks `onRoute`) must finish
  // loading BEFORE routes are registered, so these are awaited up front.
  await app.register(cookie, opts.cookieSecret ? { secret: opts.cookieSecret } : {});
  if (mediaStorage) {
    await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0 } });
  }
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
  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    // A route may set its OWN Content-Security-Policy (the sandboxed preview-doc,
    // which needs `sandbox allow-scripts` + to be framable by the editor). When it
    // does, don't override its CSP — and skip the default DENY framing too, since
    // that route opts into its own framing policy.
    if (!reply.hasHeader('content-security-policy')) {
      reply.header('x-frame-options', 'DENY');
      // `img-src … https:` lets the editor's stock picker preview provider-CDN
      // thumbnails (Unsplash/Pexels/Openverse sources). Their terms require
      // hotlinking previews (no proxy/cache); imported images are still downloaded
      // + self-hosted under 'self'. Published exports reference 'self' images only.
      reply.header(
        'content-security-policy',
        "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      );
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof UnauthorizedError) return reply.code(401).send({ error: err.message });
    if (err instanceof ForbiddenError) return reply.code(403).send({ error: err.message });
    if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
    if (err instanceof ConflictError) return reply.code(409).send({ error: err.message });
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
    if (status === 413) return reply.code(413).send({ error: 'request body too large' });
    app.log.error(err);
    return reply.code(500).send({ error: 'internal error' });
  });

  function sessionToken(req: FastifyRequest): string | undefined {
    // eslint-disable-next-line security/detect-object-injection -- SESSION_COOKIE is a constant cookie name
    const raw = req.cookies[SESSION_COOKIE];
    if (!raw) return undefined;
    if (!signed) return raw;
    // When a secret is configured, only accept correctly-signed cookies.
    const unsigned = req.unsignCookie(raw);
    return unsigned.valid ? (unsigned.value ?? undefined) : undefined;
  }

  /** Extracts a `Authorization: Bearer swk_…` project API token, if present. */
  function bearerToken(req: FastifyRequest): string | undefined {
    const header = req.headers.authorization;
    if (!header) return undefined;
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    return match ? match[1] : undefined;
  }

  // Rate limiting: a generous global cap keyed per-user (session) or per-IP, with
  // stricter caps on expensive/sensitive routes (each route sets its own via config).
  // NOTE: behind a reverse proxy, enable Fastify `trustProxy` so req.ip is the real
  // client IP rather than the proxy's.
  await app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: RL_WINDOW,
    cache: 20_000, // explicit LRU key cap (bounds memory; documents intent)
    keyGenerator: (req) => sessionToken(req) ?? bearerToken(req) ?? req.ip,
  });

  async function requireUserId(req: FastifyRequest): Promise<string> {
    const token = sessionToken(req);
    const userId = token ? await validateSession(db, token) : null;
    if (!userId) throw new UnauthorizedError('authentication required');
    return userId;
  }

  // Soft variant for the OAuth authorize page: resolve the session user, or null
  // (so we can render a sign-in prompt rather than throw a JSON 401).
  async function currentUserId(req: FastifyRequest): Promise<string | null> {
    const token = sessionToken(req);
    return token ? await validateSession(db, token) : null;
  }

  // Instance/platform admin = a user whose DB `platform_role` is `admin` (seeded from
  // SW_ADMIN_EMAIL, granted via a platform invite). The legacy `adminEmails` allowlist is still
  // honored as a fallback so an operator can designate admins by env without a DB role (and so the
  // test harness keeps working). Instance settings are global, decided here — never by a project
  // role. Bearer (API-key) callers are never instance admins — admin config is session-only.
  async function isInstanceAdmin(userId: string): Promise<boolean> {
    if ((await getPlatformRole(db, userId)) === 'admin') return true;
    if (adminEmails.size === 0) return false;
    const email = await getUserEmail(db, userId);
    return email !== null && adminEmails.has(email);
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
      };
      // Re-load the project so a stale key whose project was deleted resolves to a clean 404.
      const project = await projects.get(req.params.projectId);
      return { ctx, project, apiKey: key };
    }

    const userId = await requireUserId(req);
    // A platform admin reaches every project as owner; everyone else reaches only the projects they
    // hold a membership for (a clean 403 otherwise — they cannot probe other projects).
    const role = await resolveProjectRole(db, userId, req.params.projectId);
    if (!role) throw new ForbiddenError('you do not have access to this project');
    const project = await projects.get(req.params.projectId);
    return { ctx: { userId, role, projectId: project.id }, project, apiKey: null };
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

  // Auth routes share a per-IP cap; defaults to 10/min (production), raisable for the E2E harness.
  const authRl = rl(opts.authRateMax ?? 10);

  app.post('/auth/register', { config: authRl }, async (req, reply) => {
    const body = RegisterBody.parse(req.body);
    // When registration is closed, it is invitation-only: only an email holding a pending invite
    // may register (then accept it). The instance admin is seeded out-of-band (seed.ts), never
    // registered, so closing this never locks the operator out.
    if (!(opts.openRegistration ?? true) && !(await hasPendingInvite(db, body.email))) {
      return reply.code(403).send({ error: 'registration is by invitation only' });
    }
    const { userId } = await registerAccount(db, body.email, body.password);
    const { token, expiresAt } = await createSession(db, userId);
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      secure: opts.secureCookies ?? false,
      signed,
      expires: expiresAt,
    });
    return reply.code(201).send({ userId });
  });

  app.post('/auth/login', { config: authRl }, async (req, reply) => {
    const body = LoginBody.parse(req.body);
    const userId = await login(db, body.email, body.password);
    const { token, expiresAt } = await createSession(db, userId);
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      secure: opts.secureCookies ?? false,
      signed,
      expires: expiresAt,
    });
    return reply.send({ userId });
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = sessionToken(req);
    if (token) await revokeSession(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/me', { config: rl(60) }, async (req, reply) => {
    const userId = await requireUserId(req);
    const [platformRole, access, instanceAdmin] = await Promise.all([
      getPlatformRole(db, userId),
      // Projects the caller can reach: a platform admin → all; everyone else → their memberships.
      listProjectAccessForUser(db, userId),
      isInstanceAdmin(userId),
    ]);
    const projects = access.map((a) => ({ id: a.projectId, name: a.projectName, slug: a.projectSlug, role: a.role }));
    return reply.send({ userId, platformRole, isInstanceAdmin: instanceAdmin, projects });
  });

  // ---- Instance admin settings (global mail / hCaptcha / enabled form modes) ----
  // Not org/project-scoped: gated on the instance-admin email allowlist. Secrets
  // are encrypted at rest and never returned (the read view masks them).
  app.get('/admin/settings', { config: rl(30) }, async (req, reply) => {
    await requireInstanceAdmin(req);
    return reply.send({ settings: await instanceSettingsRepo.getPublic() });
  });

  app.put('/admin/settings', { config: rl(30) }, async (req, reply) => {
    const userId = await requireInstanceAdmin(req);
    const input = InstanceSettingsInputSchema.parse(req.body);
    try {
      const settings = await instanceSettingsRepo.put(input);
      // Audit trail for an instance-wide config change (userId only — no PII).
      app.log.info({ userId }, 'instance settings updated');
      return reply.send({ settings });
    } catch (err) {
      if (err instanceof EncryptionUnavailableError) {
        return reply.code(503).send({ error: err.message });
      }
      throw err;
    }
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
    return reply.send({
      projectId: key.projectId,
      role: key.role,
      capabilities: key.capabilities,
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
    return { userId, role, projectId };
  }

  app.get('/projects', { config: rl(60) }, async (req, reply) => {
    const userId = await requireUserId(req);
    const access = await listProjectAccessForUser(db, userId);
    // Map to the project shape the editor expects (id/name/slug) plus the caller's role.
    const list = access.map((a) => ({ id: a.projectId, name: a.projectName, slug: a.projectSlug, role: a.role }));
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
    // Session-only (a non-interactive token must not create projects); check the bearer first for
    // consistency with the other management gates. Any authenticated user may create a project and
    // becomes its owner — restricting creation to platform staff is deferred to a later PR
    // (production registration is invitation-only by default, so this is not openly exploitable).
    if (bearerToken(req) !== undefined) {
      throw new ForbiddenError('this operation requires an interactive session');
    }
    const userId = await requireUserId(req);
    const body = CreateProjectBody.parse(req.body);
    // Atomic: the project + the creator's owner membership are written together (never an
    // ownerless, unreachable project).
    const project = await projects.create(body, userId);
    const ownerCtx = { userId, projectId: project.id, role: 'owner' as const };
    // Seed a Corporate Identity with a sensible DEFAULT BRAND COLOR (blue), so DaisyUI
    // components are themed out of the box and the preview looks intentional immediately.
    await contentRepo.put(ownerCtx, 'settings', 'settings', {
      identity: { name: body.name, colors: { primary: '#2563eb' } },
      settings: { defaultLocale: 'en', locales: ['en'] },
    });
    // Every project starts with a HOME page (the tree root: empty slug → "/", header nav),
    // so the pages list, auto-nav, and the first publish work out of the box. Same scaffold
    // idea as the editor's "Add page" starter: a brand binding + one client-editable region.
    await contentRepo.put(ownerCtx, 'page', 'home', {
      id: 'home',
      path: '',
      title: 'Home',
      root: { id: 'root', type: 'Section', children: [] },
      source:
        '<main class="mx-auto max-w-3xl px-6 py-16">\n' +
        '  <h1 class="text-4xl font-bold tracking-tight">{{ company.name }}</h1>\n' +
        '  <p class="mt-4 text-lg opacity-70" data-sw-text="tagline">Welcome — edit this tagline.</p>\n' +
        '</main>\n',
      nav: { slots: ['header'], order: 0 },
    });
    return reply.code(201).send({ project });
  });

  app.get<{ Params: { id: string } }>(
    '/projects/:id',
    async (req, reply) => {
      const userId = await requireUserId(req);
      const role = await resolveProjectRole(db, userId, req.params.id);
      if (!role) throw new ForbiddenError('you do not have access to this project');
      return reply.send({ project: await projects.get(req.params.id) });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/projects/:id',
    { config: rl(20) },
    async (req, reply) => {
      // A project may be deleted by its owner or a platform admin (both resolve to owner).
      const userId = await requireUserId(req);
      const role = await resolveProjectRole(db, userId, req.params.id);
      if (role !== 'owner') throw new ForbiddenError('insufficient role to delete this project');
      // Capture the slug BEFORE the row is gone — the published site directory is keyed by slug.
      const project = await projects.get(req.params.id);
      await projects.remove(req.params.id);
      // Best-effort on-disk cleanup: the published site + media directories have no
      // DB-level cascade. A failure here must NOT fail the delete (the rows are
      // already gone) — log and continue. Optional chaining no-ops when unconfigured.
      // Log only the error code/message (not the full error, which carries the
      // absolute fs path) to keep internal paths out of the logs.
      const onCleanupError = (what: string) => (err: unknown) =>
        req.log.warn(
          { what, errCode: (err as NodeJS.ErrnoException).code, errMsg: err instanceof Error ? err.message : String(err) },
          'project asset cleanup failed on delete',
        );
      // Published site is keyed by slug; media storage stays keyed by project id.
      await publishStore?.removeProject(project.slug).catch(onCleanupError('publish'));
      await mediaStorage?.removeProject(req.params.id).catch(onCleanupError('media'));
      return reply.code(204).send();
    },
  );

  // ---- Project content (tenant + project scoped) ----
  type ContentParams = { projectId: string; kind: string; entityId: string };

  // The generic content routes are the incremental authoring API (editor saves,
  // MCP edits). Cap them tighter than the global 200/min — reads generously, writes
  // at 60/min (ample for interactive + agent editing; large imports use the dedicated
  // bundle endpoint, not per-entity PUTs). This bounds a compromised token's ability
  // to flood the site-wide settings (criticalCss/head/scripts) write.
  app.get<{ Params: Pick<ContentParams, 'projectId' | 'kind'> }>(
    '/projects/:projectId/content/:kind',
    { config: rl(120) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:read');
      return reply.send({ items: await contentRepo.list(ctx, parseGenericKind(req.params.kind)) });
    },
  );

  app.get<{ Params: ContentParams }>(
    '/projects/:projectId/content/:kind/:entityId',
    { config: rl(120) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:read');
      const item = await contentRepo.get(ctx, parseGenericKind(req.params.kind), req.params.entityId);
      return reply.send({ item });
    },
  );

  app.put<{ Params: ContentParams }>(
    '/projects/:projectId/content/:kind/:entityId',
    { config: rl(60) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:write');
      const item = await contentRepo.put(
        ctx,
        parseGenericKind(req.params.kind),
        req.params.entityId,
        req.body,
      );
      return reply.send({ item });
    },
  );

  app.delete<{ Params: ContentParams }>(
    '/projects/:projectId/content/:kind/:entityId',
    { config: rl(60) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:write');
      await contentRepo.remove(ctx, parseGenericKind(req.params.kind), req.params.entityId);
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
      await apiKeysRepo.revoke(ctx, req.params.id);
      return reply.code(204).send();
    },
  );

  // ---- OAuth 2.1 (issues the same scoped tokens; for the CLI / hosted MCP clients) ----
  registerOAuthRoutes(app, { db, oauth: oauthRepo, clients: oauthClients, projects, currentUserId, rl });

  app.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/export',
    async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:read');
      return reply.send(await contentRepo.exportBundle(ctx, project));
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
    { bodyLimit: PREVIEW_BODY_LIMIT, config: rl(120) },
    async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:read');
      // Guard recursion depth before the recursive Zod parse (untrusted tree).
      assertWithinTreeDepth((req.body as { root?: unknown } | null)?.root);
      const page = PageSchema.parse(req.body);

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
      if (page.source || page.template) {
        // A template reference resolves to the TEMPLATE's source (built-in global or
        // project entity); the page contributes only its {{edit}} content. Resolved
        // BEFORE the pool guard — an unknown reference is a client error (400)
        // regardless of whether rendering infrastructure is up.
        let pageSource = page.source ?? '';
        if (page.template) {
          const projectTemplates = isGlobalTemplate(page.template)
            ? []
            : ((await contentRepo.list(ctx, 'template')) as Template[]);
          try {
            pageSource = resolveTemplateSource(page.template, new Map(projectTemplates.map((t) => [t.id, t])));
          } catch {
            return reply.code(400).send({ error: `unknown template "${page.template}"` });
          }
        }
        if (!renderPool) return reply.code(503).send({ error: 'rendering is not available' });
        // Built-in global snippets + the project's own (project wins on a name collision). The
        // preview's CSS is extracted from the RENDERED output, so unused globals add no weight here.
        const partials = {
          ...GLOBAL_SNIPPET_PARTIALS,
          ...Object.fromEntries(((await contentRepo.list(ctx, 'snippet')) as Snippet[]).map((s) => [s.name, s.source])),
        };
        const sourceData = Object.fromEntries(byDataset);
        const localeData = resolveLocaleDatasets(sourceData, page.locale);
        // Keyed entry access ({{item.<dataset>.<id>.<field>}}) — built only for datasets this source
        // addresses by key, so a looping-only page pays nothing.
        const item = keyedDatasets(pageSource, localeData);
        // Bound the IPC payload serialized in THIS (parent) process — a large dataset/partial set
        // (incl. the keyed `item` map) must not spike the API's heap (only the worker carries a
        // memory ceiling). Mirrors the owner render-template guard.
        if (JSON.stringify(localeData).length + JSON.stringify(item).length + JSON.stringify(partials).length > 4 * 1024 * 1024) {
          return reply.code(413).send({ error: 'project data is too large to render' });
        }
        try {
          // WYSIWYG parity with publish (drafts excluded, like publish): the previewed
          // page's auto-nav lists ONLY its own language's pages, its bindings resolve to
          // the locale dataset variant (`<name>-<locale>`), and `page.locale` /
          // `page.translations` power a language switcher. `json_data` is NOT fetched in
          // preview (no network per keystroke) — `{{ website.json_data }}` renders empty
          // until publish.
          const savedPages = publishedPages((await contentRepo.list(ctx, 'page')).map(migrateContentIntoData) as Page[]);
          const previewLocale = localeOf(page, defaultLocale);
          const navPages = pagesInLocale(savedPages, previewLocale, defaultLocale);
          const slotNav = {
            header: buildNav(navPages, 'header'),
            footer: buildNav(navPages, 'footer'),
            mobile: buildNav(navPages, 'mobile'),
          };
          // The page's FULL route is computed from the parent chain; include the (possibly
          // unsaved/edited) previewed page in the index so its own slug/parent apply.
          const previewById = pagesById(savedPages);
          previewById.set(page.id, page);
          // This page's child pages, flattened — built only when the source loops them. From
          // `savedPages` (already published-only → drafts excluded, mirroring publish/nav for WYSIWYG
          // parity); childrenOf filters parent + locale and caps the count. Each child carries its own
          // `data`, so bound the serialized array against the same IPC ceiling as the data above.
          const previewChildren = referencesChildren(pageSource) ? childrenOf(savedPages, page, defaultLocale) : [];
          if (JSON.stringify(previewChildren).length > 4 * 1024 * 1024) {
            return reply.code(413).send({ error: 'project data is too large to render' });
          }
          const previewPage = {
            title: page.title,
            // `page.slug` is the page's OWN segment — the Page record's `path` field (e.g. "services");
            // the binding's `page.path` below is the FULL computed route. (Mirrors page.children[*].slug.)
            slug: page.path,
            path: pagePath(page, previewById),
            locale: previewLocale,
            translations: translationsOf(savedPages, page, defaultLocale),
            data: page.data,
            children: previewChildren,
          };
          // The page's PARENT as a lean view (`{{parentPage.path}}`, `{{parentPage.data.x}}`) — absent
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
          const rendered = await renderPool.render(pageSource, {
            company: brand as unknown as Record<string, unknown>,
            website: { siteUrl: website?.siteUrl, data: website?.data },
            page: previewPage,
            parentPage: previewParent,
            data: localeData,
            item,
            partials,
            richContent: page.richContent,
            // PREVIEW-only: keep the data-sw-* leaf-directive markers so the editor bridge can make
            // them click-to-edit. The publish path strips them in resolveDirectives.
            preview: true,
            // PREVIEW-only: the dataset-aware {{#each}} wraps each entry row in a data-sw-entry marker
            // so a click opens that entry's editor. Always body-safe (wraps the loop body) → no gate needed.
            markEntries: true,
          });
          // Slots render through the SAME isolated worker; a broken slot is skipped here
          // (publish still hard-validates it) so it can never break the page preview. No
          // `partials`/`content`: slots are project-wide (not client-edited), and — matching
          // the publish slot context in build.ts — they don't compose snippets, so
          // `{{> snippet}}` is intentionally unavailable in a slot (no WYSIWYG drift).
          const slotCtx = {
            company: brand as unknown as Record<string, unknown>,
            website: { siteUrl: website?.siteUrl, data: website?.data },
            page: previewPage,
            parentPage: previewParent,
            data: localeData,
            nav: slotNav as unknown as Record<string, unknown>,
          };
          // Each slot reuses slotCtx (which carries `sourceData`) over IPC; that payload is already
          // bounded by the page-render size guard above, and the pool (capped workers + queue depth)
          // serializes the renders, so the six calls can't amplify into a parallel memory spike.
          const renderSlot = async (name: string, src: string | undefined): Promise<string | undefined> => {
            if (!src) return undefined;
            try {
              return await renderPool.render(src, slotCtx);
            } catch (err) {
              // Best-effort in preview — a broken slot is omitted (publish hard-validates it). Log at
              // debug so it's visible to an operator rather than silently swallowed.
              req.log?.debug({ slot: name, err: err instanceof Error ? err.message : String(err) }, 'preview slot skipped');
              return undefined;
            }
          };
          const [topNav, mobileNav, sidebarLeft, sidebarRight, footer, bottom] = await Promise.all([
            renderSlot('topNav', website?.topNav),
            renderSlot('mobileNav', website?.mobileNav),
            renderSlot('sidebarLeft', website?.sidebarLeft),
            renderSlot('sidebarRight', website?.sidebarRight),
            renderSlot('footer', website?.footer),
            renderSlot('bottom', website?.bottom),
          ]);
          // Wrap + inline Tailwind INSIDE the try so a compile failure returns the error
          // envelope (not a raw 500), consistent with the rest of this handler.
          const sourceHtml = await styledSourceDocument(page, brand, rendered, {
            topNav,
            mobileNav,
            sidebarLeft,
            sidebarRight,
            footer,
            bottom,
            head: website?.head,
            criticalCss: website?.criticalCss,
            customScripts: website?.scripts,
            lang: previewLocale, // `<html lang>` follows the previewed page's locale (publish parity)
          });
          const sourceToken = previewStore.put(sourceHtml, { projectId: project.id, userId: ctx.userId });
          return reply.send({ html: sourceHtml, token: sourceToken });
        } catch (err) {
          if (err instanceof RenderUnavailableError) return reply.code(503).send({ error: err.message });
          return reply.code(400).send({ error: err instanceof Error ? err.message : 'render failed' });
        }
      }

      // Media powers optimized <picture> in the preview too, via the API-served URLs.
      const media = mediaStorage ? ((await contentRepo.list(ctx, 'media')) as MediaAsset[]) : [];
      // Auto-nav from the saved pages so Nav blocks render their menu in preview
      // (WYSIWYG parity with publish; an unsaved new page isn't in its own nav yet).
      // Drafts are excluded from nav here too, matching the published output; the menu
      // lists only the previewed page's own language (per-locale nav, like publish).
      const savedPages = publishedPages((await contentRepo.list(ctx, 'page')).map(migrateContentIntoData) as Page[]);
      const previewLocale = localeOf(page, defaultLocale);
      const navPages = pagesInLocale(savedPages, previewLocale, defaultLocale);
      const nav = {
        header: buildNav(navPages, 'header'),
        footer: buildNav(navPages, 'footer'),
        mobile: buildNav(navPages, 'mobile'),
      };
      // Public form definitions for any Form blocks; the preview posts same-origin.
      const previewForms: Record<string, FormPublic> = Object.fromEntries(
        ((await contentRepo.list(ctx, 'form')) as Form[]).map((f) => [f.id, toPublicForm(f)]),
      );
      const previewHcaptchaSiteKey = (await instanceSettingsRepo.getStored()).hcaptcha?.siteKey;
      // The preview document is served (via a token URL) under `CSP: sandbox
      // allow-scripts` — an opaque, isolated origin — so styles AND the platform
      // component JS are INLINED to make it self-contained + truly interactive
      // (WYSIWYG). Gather component CSS/JS + utility CSS only when used.
      const classNames = collectClassNames(page.root);
      const { css: componentCss, js: componentJs } = componentAssets(usedComponentTypes(page.root));
      // Platform-runtime markers (`data-aos` / `data-bg` / `waves-effect` in a raw Html
      // block) → inline the first-party runtime(s) so they work live in the sandboxed
      // preview, like publish.
      const animated = treeUsesAnimations(page.root);
      const lazy = treeUsesLazyload(page.root);
      const waves = treeUsesRipple(page.root);
      const inlineStyles: string[] = [];
      // Component CSS first (then the runtime CSS), then Tailwind utilities last
      // (so utilities win at equal specificity) — mirrors the publish order
      // (inline component CSS, then the linked utility sheet).
      if (componentCss) inlineStyles.push(componentCss);
      if (animated) inlineStyles.push(ANIMATION_CSS);
      if (lazy) inlineStyles.push(LAZYLOAD_CSS);
      if (waves) inlineStyles.push(RIPPLE_CSS);
      if (classNames.length > 0) {
        inlineStyles.push(await compileUtilityCss([classNames.join(' ')], brandToTailwindTheme(brand)));
      }
      const previewById = pagesById(savedPages);
      previewById.set(page.id, page);
      const html = renderDocument(page, {
        brand,
        lang: previewLocale, // `<html lang>` follows the previewed page's locale (publish parity)
        // {{ company.* }}/{{ website.* }}/{{ page.* }} substitution (WYSIWYG parity with publish).
        // `website` is projected to only its public fields (not the raw head/footer/CSS blobs).
        vars: {
          company: brand,
          website: { siteUrl: website?.siteUrl, data: website?.data },
          page: { title: page.title, path: pagePath(page, previewById), locale: previewLocale, translations: translationsOf(savedPages, page, defaultLocale), data: page.data },
        },
        // Bindings resolve to the page's locale dataset variant (`<name>-<locale>`), like publish.
        datasets: resolveLocaleDatasets(Object.fromEntries(byDataset), page.locale),
        includeDrafts: true,
        markEntries: true, // PREVIEW-only entry markers (block-tree list bindings)
        media,
        nav,
        forms: previewForms,
        formEndpoint: (formId) => `/f/${project.id}/${formId}`,
        ...(previewHcaptchaSiteKey ? { hcaptchaSiteKey: previewHcaptchaSiteKey } : {}),
        // Images AND self-hosted fonts (kind:'font' assets in `media`) resolve through one URL —
        // their `@font-face` loads from the media route (never a font CDN).
        mediaUrl: (asset, file) => `/media/${project.id}/${asset.id}/${file}`,
        inlineStyles: inlineStyles.length > 0 ? inlineStyles : undefined,
        inlineScripts: [
          ...(componentJs ? [componentJs] : []),
          ...(animated ? [ANIMATION_JS] : []),
          ...(lazy ? [LAZYLOAD_JS] : []),
          ...(waves ? [RIPPLE_JS] : []),
          // Editor↔preview bridge (scroll preserve/restore). Preview-only path.
          PREVIEW_BRIDGE_JS,
        ],
      });
      // Store the rendered doc behind an opaque token; the editor loads it via the
      // GET route below (which serves it under a sandbox CSP). `html` is still
      // returned for API consumers/tests that want it directly.
      const token = previewStore.put(html, { projectId: project.id, userId: ctx.userId });
      return reply.send({ html, token });
    },
  );

  // Serves a previously-rendered preview document for an opaque token. Returned as
  // `text/html` under `Content-Security-Policy: sandbox allow-scripts` — which
  // forces an OPAQUE, isolated origin even on direct navigation, so its scripts
  // (the inlined component behavior) run but cannot read the editor's cookies/
  // session or make credentialed API calls. The editor loads this via the iframe
  // `src` (NOT `srcDoc`), so the document uses THIS CSP rather than inheriting the
  // editor page's stricter one. The token is unguessable, short-lived, and bound
  // to (org, project, user) — so only the member who GENERATED it can fetch it.
  app.get<{ Params: { projectId: string; token: string } }>(
    '/projects/:projectId/preview/:token',
    { config: rl(120) },
    async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:read');
      // Tokens are randomUUID (36 chars); bound the param before the store lookup (defense-in-depth,
      // consistent with the other token params). A malformed token just misses → 404 below.
      if (req.params.token.length > 64) {
        return reply.code(404).type('text/html').send('<!doctype html><title>Preview expired</title>');
      }
      const html = previewStore.get(req.params.token, {
        projectId: project.id,
        userId: ctx.userId,
      });
      if (html === null) {
        return reply.code(404).type('text/html').send('<!doctype html><title>Preview expired</title>');
      }
      // `sandbox allow-scripts` (no `allow-same-origin`) → opaque origin: scripts
      // run, isolated. SAMEORIGIN framing lets the editor embed it; no third party.
      reply.header('content-security-policy', 'sandbox allow-scripts');
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

    // Optimize a raw image buffer (AVIF/WebP/LQIP), store the binaries, and record
    // the tenant-scoped metadata. Shared by the upload route AND the stock import.
    async function createMediaAsset(
      ctx: ProjectContext,
      projectId: string,
      buffer: Buffer,
      meta: { filename: string; mimetype: string; folder?: string; alt?: string; attribution?: MediaAsset['attribution'] },
    ): Promise<ImageAsset> {
      const assetId = randomUUID();
      const { assetDir, inputPath } = await storage.stageUpload(projectId, assetId, buffer);
      try {
        const optimized = await withOptimizeSlot(() => optimizeImage(inputPath, assetDir));
        await storage.clearUpload(inputPath);
        const asset = ImageAssetSchema.parse({
          kind: 'image',
          id: assetId,
          filename: meta.filename,
          folder: meta.folder ?? '',
          format: meta.mimetype,
          bytes: buffer.length,
          width: optimized.width,
          height: optimized.height,
          placeholder: optimized.placeholder,
          variants: optimized.variants.map((v) => ({ format: v.format, width: v.width, height: v.height, path: v.path })),
          fallback: optimized.fallback,
          url: `/media/${projectId}/${assetId}/${optimized.fallback}`,
          ...(meta.alt ? { alt: meta.alt } : {}),
          ...(meta.attribution ? { attribution: meta.attribution } : {}),
        });
        return (await contentRepo.put(ctx, 'media', assetId, asset)) as ImageAsset;
      } catch (err) {
        // Any failure (bad image, validation, DB) → remove the whole asset dir.
        await storage.remove(projectId, assetId);
        if (err instanceof Error && /format|pixel|dimension|size limit/i.test(err.message)) {
          throw new MediaValidationError('unsupported or invalid image');
        }
        throw err;
      }
    }

    // Store a NON-image upload as-is (any file type). Served download-only (attachment + nosniff),
    // so an uploaded HTML/SVG can never execute on the API/site origin.
    async function createFileAsset(
      ctx: ProjectContext,
      projectId: string,
      buffer: Buffer,
      meta: { filename: string; mimetype: string; folder?: string },
    ): Promise<FileAsset> {
      const assetId = randomUUID();
      const storedName = MediaStorage.safeStoredName(meta.filename || 'file');
      try {
        await storage.storeFile(projectId, assetId, storedName, buffer);
        const asset = FileAssetSchema.parse({
          kind: 'file',
          id: assetId,
          filename: meta.filename || storedName,
          folder: meta.folder ?? '',
          bytes: buffer.length,
          contentType: meta.mimetype || 'application/octet-stream',
          storedName,
          url: `/media/${projectId}/${assetId}/file/${storedName}`,
        });
        return (await contentRepo.put(ctx, 'media', assetId, asset)) as FileAsset;
      } catch (err) {
        await storage.remove(projectId, assetId);
        throw err;
      }
    }

    // Store a self-hosted FONT family (kind 'font') — used by the local upload + Google select routes.
    const createFontAsset = (ctx: ProjectContext, projectId: string, input: Parameters<typeof storeFontAsset>[4]) =>
      storeFontAsset(contentRepo, storage, ctx, projectId, input);

    // Upload ANY file: images are optimized (AVIF/WebP/LQIP); everything else is stored as-is
    // (download-only). The optional `?folder=` query files the asset under a virtual folder.
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

        let buffer: Buffer;
        try {
          buffer = await file.toBuffer();
        } catch {
          // @fastify/multipart throws when the per-file size limit is exceeded.
          return reply.code(413).send({ error: 'file exceeds size limit' });
        }
        if (file.file.truncated) {
          return reply.code(413).send({ error: 'file exceeds size limit' });
        }

        const meta = { filename: file.filename || 'upload', mimetype: file.mimetype || 'application/octet-stream', folder };
        // An optimizable raster `image/*` upload is optimized (corrupt/oversized images 400). SVG is
        // NEVER optimized — explicitly rejected here, so safety doesn't hinge on the pipeline
        // rejecting it. Any other type is stored as-is (download-only).
        const isSvg = meta.mimetype === 'image/svg+xml' || meta.mimetype === 'image/svg';
        if (isSvg) return reply.code(400).send({ error: 'SVG is not accepted' });
        if (meta.mimetype.startsWith('image/')) {
          try {
            const saved = await createMediaAsset(ctx, project.id, buffer, meta);
            return reply.code(201).send({ item: saved });
          } catch (err) {
            if (err instanceof MediaValidationError) return reply.code(400).send({ error: err.message });
            throw err;
          }
        }
        // A real font (by magic bytes) → a `kind:'font'` asset. The font picker sends family/weight/
        // style/fallback as query params; a generic drop falls back to sensible, editable defaults.
        const format = detectFontFormat(buffer);
        if (format) {
          if (buffer.length > MAX_FONT_BYTES) return reply.code(413).send({ error: 'file exceeds size limit' });
          const fontMeta = FontUploadMeta.safeParse({
            family: req.query.family ?? meta.filename.replace(/\.[^.]+$/, ''),
            weight: req.query.weight,
            style: req.query.style,
            fallback: req.query.fallback,
          });
          if (!fontMeta.success) return reply.code(400).send({ error: 'invalid font metadata' });
          try {
            const saved = await createFontAsset(ctx, project.id, {
              family: fontMeta.data.family,
              fallback: fontMeta.data.fallback,
              source: 'local',
              folder,
              faces: [{ weight: fontMeta.data.weight, style: fontMeta.data.style, format, bytes: buffer }],
            });
            return reply.code(201).send({ item: saved });
          } catch (err) {
            if (err instanceof z.ZodError) return reply.code(400).send({ error: 'invalid font' });
            throw err;
          }
        }
        try {
          const saved = await createFileAsset(ctx, project.id, buffer, meta);
          return reply.code(201).send({ item: saved });
        } catch (err) {
          // A bad client-supplied contentType (the only externally-shaped field) → clean 400,
          // never the global handler's field-name-leaking ZodError envelope.
          if (err instanceof z.ZodError) return reply.code(400).send({ error: 'invalid upload' });
          throw err;
        }
      },
    );

    // Import a remote URL INTO the library (download + self-host), so a field that pasted a URL can
    // keep the published export self-contained. SSRF-guarded like the stock downloader: https-only,
    // private-host rejection, no redirects (a 3xx to a private host can't bypass the check), size cap
    // + timeout. Images are optimized (createMediaAsset); anything else is stored as-is; SVG rejected.
    const ImportUrlBody = z.object({ url: z.string().url().max(2048), folder: MediaFolderSchema.optional() });
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

      // The abort timer stays armed across the BODY read too (a server that trickles the body must not
      // hold a worker open) — clearTimeout is in the OUTER finally, mirroring the stock downloader.
      let buffer: Buffer;
      let contentType: string;
      let oversize = false;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_MS);
      try {
        const res = await fetch(url, { signal: controller.signal, redirect: 'error' });
        if (!res.ok) return reply.code(400).send({ error: `download failed (${res.status})` });
        if (Number(res.headers.get('content-length') ?? '0') > MAX_UPLOAD_BYTES) {
          return reply.code(413).send({ error: 'file exceeds size limit' });
        }
        contentType = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() || 'application/octet-stream';
        buffer = Buffer.from(await res.arrayBuffer());
        oversize = buffer.length > MAX_UPLOAD_BYTES;
      } catch {
        return reply.code(400).send({ error: 'could not fetch the URL' });
      } finally {
        clearTimeout(timer);
      }
      if (oversize) return reply.code(413).send({ error: 'file exceeds size limit' });

      if (contentType === 'image/svg+xml' || contentType === 'image/svg') return reply.code(400).send({ error: 'SVG is not accepted' });
      // A malformed %-sequence the URL parser accepts but decodeURIComponent rejects → a safe default.
      let filename: string;
      try {
        filename = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'download') || 'download';
      } catch {
        filename = 'download';
      }
      try {
        const saved = contentType.startsWith('image/')
          ? await createMediaAsset(ctx, project.id, buffer, { filename, mimetype: contentType, folder })
          : await createFileAsset(ctx, project.id, buffer, { filename, mimetype: contentType, folder });
        return reply.code(201).send({ item: saved });
      } catch (err) {
        if (err instanceof MediaValidationError) return reply.code(400).send({ error: err.message });
        if (err instanceof z.ZodError) return reply.code(400).send({ error: 'invalid import' });
        throw err;
      }
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

    app.get<{ Params: { projectId: string }; Querystring: { kind?: string } }>(
      '/projects/:projectId/media',
      async (req, reply) => {
        const { ctx } = await resolveProject(req, 'content:read');
        const items = (await contentRepo.list(ctx, 'media')) as MediaAsset[];
        // Optional `?kind=image|file|font` filter (e.g. the font picker only needs fonts).
        const kind = req.query.kind;
        return reply.send({ items: kind ? items.filter((a) => a.kind === kind) : items });
      },
    );

    app.delete<{ Params: { projectId: string; id: string } }>(
      '/projects/:projectId/media/:id',
      async (req, reply) => {
        const { ctx, project } = await resolveProject(req, 'content:write');
        // DB first: a leaked binary (if fs removal fails) is harmless and GC-able,
        // whereas a leaked DB row would block re-creating the same asset id.
        await contentRepo.remove(ctx, 'media', req.params.id);
        try {
          await storage.remove(project.id, req.params.id);
        } catch (err) {
          app.log.error({ err }, 'media binary removal failed after DB delete');
        }
        return reply.code(204).send();
      },
    );

    // --- folder + asset OPERATIONS (rename/move/copy/delete) ---------------------
    // Folders are persisted as `mediafolder` records so an EMPTY folder survives a reload;
    // non-root operations cascade to both the folder records and the assets filed under them.

    /** Persists `path` and every missing ancestor as a folder record (idempotent, deduped by path). */
    const ensureFolderRecords = async (ctx: ProjectContext, path: string): Promise<void> => {
      const existing = new Set(((await contentRepo.list(ctx, 'mediafolder')) as MediaFolderRecord[]).map((f) => f.path));
      for (const p of [...ancestorPaths(path), path]) {
        if (!existing.has(p)) {
          const id = randomUUID();
          await contentRepo.put(ctx, 'mediafolder', id, { id, path: p });
          existing.add(p);
        }
      }
    };

    /** Duplicates an asset (new id + copied binaries + rewritten url), optionally into another folder. */
    const duplicateAsset = async (
      ctx: ProjectContext,
      projectId: string,
      asset: MediaAsset,
      folder: string,
    ): Promise<MediaAsset> => {
      const newId = randomUUID();
      await storage.copyAsset(projectId, asset.id, newId);
      const url =
        asset.kind === 'image'
          ? `/media/${projectId}/${newId}/${asset.fallback}`
          : asset.kind === 'font'
            ? `/media/${projectId}/${newId}/${asset.files[0]!.file}`
            : `/media/${projectId}/${newId}/file/${asset.storedName}`;
      const copy = { ...asset, id: newId, folder, url } as MediaAsset;
      return (await contentRepo.put(ctx, 'media', newId, copy)) as MediaAsset;
    };

    const FolderPathBody = z.object({ path: MediaFolderSchema.refine((v) => v !== '', 'path is required') });
    const FolderMoveBody = z.object({
      from: MediaFolderSchema,
      to: MediaFolderSchema,
    });

    // List the persisted folder records (the editor unions these with asset-derived folders).
    app.get<{ Params: { projectId: string } }>('/projects/:projectId/media/folders', async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:read');
      return reply.send({ items: await contentRepo.list(ctx, 'mediafolder') });
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
        if (isUnderFolder(a.folder, from)) await duplicateAsset(ctx, project.id, a, reparentPath(a.folder, from, to));
      }
      return reply.send({ ok: true });
    });

    // Delete a folder RECURSIVELY: every folder record + asset (and its binaries) under it.
    app.delete<{ Params: { projectId: string } }>('/projects/:projectId/media/folders', { config: rl(60) }, async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:write');
      if (!WRITE_ROLES.has(ctx.role)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const body = FolderPathBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid folder path' });
      const folder = body.data.path;
      const assets = (await contentRepo.list(ctx, 'media')) as MediaAsset[];
      for (const a of assets) {
        if (isUnderFolder(a.folder, folder)) {
          await contentRepo.remove(ctx, 'media', a.id);
          try {
            await storage.remove(project.id, a.id);
          } catch (e) {
            app.log.error({ err: e }, 'media binary removal failed during folder delete');
          }
        }
      }
      const folders = (await contentRepo.list(ctx, 'mediafolder')) as MediaFolderRecord[];
      for (const f of folders) {
        if (isUnderFolder(f.path, folder)) await contentRepo.remove(ctx, 'mediafolder', f.id);
      }
      return reply.code(204).send();
    });

    // Move and/or rename a single asset: `folder` re-files it, `filename` changes its display name.
    const PatchAssetBody = z.object({
      folder: MediaFolderSchema.optional(),
      filename: z.string().min(1).max(255).optional(),
    });
    app.patch<{ Params: { projectId: string; id: string } }>('/projects/:projectId/media/:id', { config: rl(60) }, async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:write');
      if (!WRITE_ROLES.has(ctx.role)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const body = PatchAssetBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid update' });
      const asset = (await contentRepo.get(ctx, 'media', req.params.id)) as MediaAsset;
      const next = {
        ...asset,
        ...(body.data.folder !== undefined ? { folder: body.data.folder } : {}),
        ...(body.data.filename !== undefined ? { filename: body.data.filename } : {}),
      };
      return reply.send({ item: await contentRepo.put(ctx, 'media', asset.id, next) });
    });

    // Duplicate a single asset (optionally into another folder).
    const CopyAssetBody = z.object({ folder: MediaFolderSchema.optional() });
    app.post<{ Params: { projectId: string; id: string } }>('/projects/:projectId/media/:id/copy', { config: rl(30) }, async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:write');
      if (!WRITE_ROLES.has(ctx.role)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const body = CopyAssetBody.safeParse(req.body ?? {});
      if (!body.success) return reply.code(400).send({ error: 'invalid folder' });
      const asset = (await contentRepo.get(ctx, 'media', req.params.id)) as MediaAsset;
      const copy = await duplicateAsset(ctx, project.id, asset, body.data.folder ?? asset.folder);
      return reply.code(201).send({ item: copy });
    });

    // Public serving of optimized IMAGE binaries (published sites are public). The storage layer
    // validates every segment and confines the path to the asset directory, so traversal is
    // impossible; `read` only accepts the image-servable charset (avif/webp/jpg). `nosniff` keeps
    // the browser from re-interpreting the bytes as anything other than the declared image type.
    app.get<{ Params: { projectId: string; assetId: string; file: string } }>(
      '/media/:projectId/:assetId/:file',
      async (req, reply) => {
        const { projectId, assetId, file } = req.params;
        const ext = file.split('.').pop() ?? '';
        // A `kind:'font'` face is served INLINE (font/* + nosniff + CORS) so a sandboxed (opaque-
        // origin) preview iframe can load it via `@font-face`; fonts are public, immutable binaries.
        if (FONT_FACE_FILE.test(file)) {
          let bytes: Buffer;
          try {
            bytes = await storage.readStored(projectId, assetId, file);
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
        let bytes: Buffer;
        try {
          bytes = await storage.read(projectId, assetId, file);
        } catch {
          return reply.code(404).send({ error: 'not found' });
        }
        const type = MEDIA_CONTENT_TYPES.get(ext) ?? 'application/octet-stream';
        return reply
          .header('cache-control', 'public, max-age=31536000, immutable')
          .header('x-content-type-options', 'nosniff')
          .type(type)
          .send(bytes);
      },
    );

    // Public serving of RAW (non-image) file assets. ALWAYS download-only: octet-stream +
    // `Content-Disposition: attachment` + `nosniff`, so an uploaded HTML/SVG/script can never
    // render or execute on this (cookie-bearing) origin. Distinct `/file/` path segment.
    app.get<{ Params: { projectId: string; assetId: string; file: string } }>(
      '/media/:projectId/:assetId/file/:file',
      async (req, reply) => {
        const { projectId, assetId, file } = req.params;
        let bytes: Buffer;
        try {
          bytes = await storage.readStored(projectId, assetId, file);
        } catch {
          return reply.code(404).send({ error: 'not found' });
        }
        // `file` is the STORED_FILE-validated stored name (no quotes/CRLF/Unicode) — safe in the
        // header. Do NOT swap in the asset's original `filename`, which is unsanitized (255 chars,
        // arbitrary Unicode/quotes) and would enable header injection.
        return reply
          .header('cache-control', 'public, max-age=31536000, immutable')
          .header('x-content-type-options', 'nosniff')
          .header('content-disposition', `attachment; filename="${file}"`)
          .type('application/octet-stream')
          .send(bytes);
      },
    );
  }

  // ---- Publishing (build a static site + serve it) ----
  if (publishStore) {
    const store = publishStore;
    // Serialize builds/deploys per project: prevents concurrent operations from
    // racing on the same output directory (and bounds load).
    const activePublishes = new Set<string>();

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
          const exp = await contentRepo.exportBundle(ctx, project);
          // Per-locale page overrides (multilingual). Loaded here (not in the
          // export bundle) — like media, a publish input rather than a portable
          // project artifact in v1.
          const translations = (await contentRepo.list(ctx, 'translation')) as PageTranslation[];
          // Form definitions — like translations, a publish input (the renderer emits
          // the public form; the recipient is never written to the exported HTML).
          const forms = (await contentRepo.list(ctx, 'form')) as Form[];
          const bundle: ProjectBundle = {
            // ExportBundle.project omits formatVersion (it's a format concern, not a
            // DB field); re-add it to satisfy the ProjectBundle.project (Project) type.
            project: { formatVersion: exp.formatVersion, ...exp.project },
            pages: exp.pages,
            partials: exp.partials,
            templates: exp.templates,
            datasets: exp.datasets,
            entries: exp.entries,
            translations,
            forms,
          };
          // `media` includes `kind:'font'` assets — copyMedia bundles their faces, so a published
          // page self-hosts its fonts (zero font-CDN references) via the normal media path.
          const media = mediaStorage ? ((await contentRepo.list(ctx, 'media')) as MediaAsset[]) : [];
          // Instance hCaptcha site key (public) — baked into forms that require it.
          const hcaptchaSiteKey = (await instanceSettingsRepo.getStored()).hcaptcha?.siteKey;
          // Publish-time JSON snapshot: fetch + parse `website.jsonDataUrl` in THIS (networked) process
          // — SSRF-guarded — then pass the parsed value into the build job. The `--network none` worker
          // and the exported static site never fetch anything. A bad URL fails the publish (author-fixable).
          let jsonData: unknown;
          const jsonDataUrl = bundle.project.website?.jsonDataUrl;
          if (jsonDataUrl) {
            try {
              jsonData = await fetchJsonData(jsonDataUrl);
            } catch (err) {
              return reply
                .code(409)
                .send({ error: err instanceof JsonDataError ? err.message : 'JSON data fetch failed' });
            }
          }
          // Reusable Handlebars partials a source page can {{> compose}} (same as the editor preview):
          // built-in globals + the project's own (project wins on a name collision).
          const snippets = {
            ...GLOBAL_SNIPPET_PARTIALS,
            ...Object.fromEntries(((await contentRepo.list(ctx, 'snippet')) as Snippet[]).map((s) => [s.name, s.source])),
          };
          const release = await buildRunner.run({
            outDir: store.dirFor(project.slug),
            bundle,
            publishedAt: new Date().toISOString(),
            media,
            // Exported Form blocks post to this absolute platform endpoint.
            ...(opts.publicUrl ? { publicBaseUrl: opts.publicUrl } : {}),
            ...(hcaptchaSiteKey ? { hcaptchaSiteKey } : {}),
            ...(jsonData !== undefined ? { jsonData } : {}),
            ...(Object.keys(snippets).length ? { snippets } : {}),
            // readStored accepts image variant names, raw file names, AND font face names (superset),
            // so image/file/font assets are all copied into the published artifact.
            readMedia: mediaStorage
              ? (assetId, file) => mediaStorage.readStored(project.id, assetId, file)
              : undefined,
          });
          // Just published → nothing newer than this release, so the site is not dirty.
          return reply.send({ release, url: `/sites/${project.slug}/`, dirty: false });
        } catch (err) {
          // A bad route graph (duplicate slugs, unsafe segment) is author-correctable.
          if (err instanceof PublishError) {
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
        const release = await store.readRelease(project.slug);
        // Dirty = there is publishable content AND it changed since the last release (or there is
        // no release yet). Drives the editor's green "unpublished changes" publish button.
        const latest = await contentRepo.latestContentUpdate(ctx);
        const dirty =
          latest !== null && (release === null || latest.getTime() > Date.parse(release.publishedAt));
        return reply.send({ release, url: `/sites/${project.slug}/`, dirty });
      },
    );

    // Download the published site as a zip artifact (deploy it anywhere at a root).
    // Member-readable: the archive is the already-public published output (also
    // served unauthenticated at /sites/<id>/), so it needs no extra role gate.
    app.get<{ Params: { projectId: string } }>(
      '/projects/:projectId/publish/archive',
      async (req, reply) => {
        const { project } = await resolveProject(req, 'content:read');
        if ((await store.readRelease(project.slug)) === null) {
          return reply.code(409).send({ error: 'publish the site before exporting' });
        }
        const zip = await archiveSite(store.dirFor(project.slug));
        return reply
          .header('content-disposition', `attachment; filename="${project.slug}-site.zip"`)
          .type('application/zip')
          .send(zip);
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
        if ((await store.readRelease(project.slug)) === null) {
          return reply.code(409).send({ error: 'publish the site before deploying' });
        }
        const config = DeployConfigSchema.parse(req.body);
        assertDeployHostAllowed(config.host);
        if (activeDeploys.has(project.id)) {
          return reply.code(409).send({ error: 'a deploy is already in progress for this project' });
        }
        activeDeploys.add(project.id);
        try {
          const result = await deploySite(store.dirFor(project.slug), config);
          return reply.send({ deployed: result });
        } catch (err) {
          // Connection/auth/transfer failure against the operator's target server.
          // Log the detail server-side; return a generic message so the response
          // does not leak the target's banner/timing (SSRF oracle reduction).
          // Log only the message (not the raw err object) so a library error that
          // happens to embed connection details can't reach the structured log.
          app.log.error(
            { host: config.host, protocol: config.protocol, errMsg: err instanceof Error ? err.message : String(err) },
            'deploy failed',
          );
          return reply.code(502).send({ error: 'deploy failed: could not connect or transfer to the target' });
        } finally {
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
        // Bundled binary assets under `_assets/` (images inline; everything else download-only).
        let binary = null;
        try {
          binary = await store.readBinary(slug, path);
        } catch {
          /* invalid slug → fall through to 404 below */
        }
        if (binary !== null) {
          reply
            .header('cache-control', 'public, max-age=31536000, immutable')
            .header('x-content-type-options', 'nosniff');
          if (binary.attachment) reply.header('content-disposition', 'attachment');
          return reply.type(binary.contentType).send(binary.body);
        }
        const asset = await store.readAsset(slug, path);
        if (asset !== null) return reply.type(asset.contentType).send(asset.body);
        const html = await store.readHtml(slug, path);
        if (html === null) return reply.code(404).type('text/html').send('<h1>404 — not published</h1>');
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
          return reply.redirect(`/sites/${slug}/${safePath}/${query}`, 301);
        }
        return reply.type('text/html').send(html);
      },
    );
  }

  // Saved deploy targets (encrypted credentials) — independent of publish serving.
  if (opts.encryptionKey) {
    registerDeployTargetRoutes(app, {
      resolveProject,
      contentRepo,
      publishStore,
      encryptionKey: opts.encryptionKey,
      activeDeploys,
      assertDeployHostAllowed,
      isWriter: (ctx) => WRITE_ROLES.has(ctx.role),
      rl,
    });
    // Per-project SMTP config (for the userSmtp form mode) — encrypted, like deploy targets.
    registerProjectSmtpRoutes(app, {
      resolveProject,
      contentRepo,
      encryptionKey: opts.encryptionKey,
      isWriter: (ctx) => WRITE_ROLES.has(ctx.role),
      assertHostAllowed: assertSmtpHostAllowed,
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
            await mergeFontFaces(contentRepo, mediaStorage, ctx, project.id, existing, faces)
          : await storeFontAsset(contentRepo, mediaStorage, ctx, project.id, {
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
  registerFormRoutes(app, {
    db,
    submissions: submissionsRepo,
    mailer,
    projectMailer,
    hcaptcha: hcaptchaVerifier,
    getHcaptchaSecret: () => instanceSettingsRepo.getHcaptchaSecret(),
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

      // Token-minimizing contract: blocks → JSON tree; copy → plain text.
      const system =
        body.target === 'blocks'
          ? 'Generate Sitewright page content as ONE JSON object with the block-tree shape {id,type,props?,children?}. Output ONLY JSON — no prose, no code fences. Use semantic blocks; never inline styles.'
          : 'You are a concise corporate-website copywriter. Output plain text only — no markdown.';
      const completion = await aiProvider.complete({ system, prompt: body.instruction });
      await aiUsageRepo.record(ctx.userId, ctx.projectId, completion.model, completion.usage);

      let result: { text: string } | { node: unknown } = { text: completion.text };
      if (body.target === 'blocks') {
        try {
          const raw: unknown = JSON.parse(completion.text);
          // Bound recursion BEFORE Zod parses — a pathologically deep tree from
          // the model would otherwise overflow the stack during safeParse.
          assertWithinTreeDepth(raw);
          const parsed = PageNodeSchema.safeParse(raw);
          if (parsed.success) result = { node: parsed.data };
        } catch {
          // Model returned non-JSON or an over-deep tree; fall back to raw text.
        }
      }
      return reply.send({ result, usage: completion.usage, model: completion.model });
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

  app.get('/health', async () => ({ ok: true }));

  // Pull-based update check for the in-app banner. Public + informational.
  app.get('/version', async () => {
    const current = opts.version ?? '0.0.0';
    const latest = opts.latestVersion ? await opts.latestVersion() : null;
    return {
      current,
      latest,
      updateAvailable: latest ? isNewer(latest, current) : false,
      releaseUrl: opts.releaseUrl ?? null,
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
    const editorCsp =
      "default-src 'self'; script-src 'self'; img-src 'self' data: https:; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; " +
      "object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
    // `dotfiles: 'deny'` makes the posture explicit (don't rely on @fastify/send's 'ignore'
    // default): a dotfile under editorDist (e.g. a stray .env) is never served.
    await app.register(fastifyStatic, {
      root: opts.editorDist,
      prefix: '/',
      wildcard: false,
      dotfiles: 'deny',
      setHeaders: (res, path) => {
        if (path.endsWith('index.html')) {
          res.setHeader('content-security-policy', editorCsp);
          res.setHeader('x-frame-options', 'DENY');
        }
      },
    });
    // Rate-limit the catch-all so unknown-path probing/enumeration is throttled too.
    app.setNotFoundHandler({ preHandler: app.rateLimit() }, (req, reply) => {
      if (req.method === 'GET' && !isApiPath(req.url)) {
        return reply.header('content-security-policy', editorCsp).header('x-frame-options', 'DENY').sendFile('index.html');
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
      let pageRichContent: Record<string, string> | undefined;
      if (body.pageId !== undefined) {
        // Re-parse the stored page (not a bare cast) so a dirty/legacy DB row can't reach
        // the render path unvalidated; NotFound → 404.
        const page = PageSchema.parse(await contentRepo.get(ctx, 'page', body.pageId));
        if (!page.source) return reply.code(400).send({ error: 'this page has no template source' });
        templateSource = page.source;
        // `{{ page.path }}` is the full route computed from the parent chain; `page.slug` is the
        // page's OWN segment (its `path` field) — mirrors the member-preview/publish page context.
        const allForPath = pagesById((await contentRepo.list(ctx, 'page')) as Page[]);
        // page.data carries the page's editable text/url overrides (the data-sw-* directives).
        pageCtx = { title: page.title, slug: page.path, path: pagePath(page, allForPath), data: page.data };
        pageRichContent = page.richContent;
      } else {
        templateSource = body.template as string; // refine guarantees one of template/pageId
      }

      // Binding context: company (identity), website (public fields only), page, datasets→data.
      let company: Record<string, unknown> = { name: project.name };
      let website: Record<string, unknown> | undefined;
      let brand: CorporateIdentity = { name: project.name, colors: {} };
      try {
        const settings = (await contentRepo.get(ctx, 'settings', SETTINGS_ENTITY_ID)) as Settings;
        company = settings.identity as unknown as Record<string, unknown>;
        brand = settings.identity;
        website = settings.website ? { siteUrl: settings.website.siteUrl, data: settings.website.data } : undefined;
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err;
      }
      const byDataset = new Map<string, Entry[]>();
      for (const entry of (await contentRepo.list(ctx, 'entry')) as Entry[]) {
        byDataset.set(entry.dataset, [...(byDataset.get(entry.dataset) ?? []), entry]);
      }
      for (const list of byDataset.values()) list.sort(compareEntryOrder);
      const data = Object.fromEntries(byDataset);
      // Reusable Handlebars partials the template can {{> name}} (validated at render): built-in
      // globals + the project's own (project wins on a name collision).
      const partials = {
        ...GLOBAL_SNIPPET_PARTIALS,
        ...Object.fromEntries(((await contentRepo.list(ctx, 'snippet')) as Snippet[]).map((s) => [s.name, s.source])),
      };
      // Keyed entry access for this template (only the datasets it addresses by key). NOTE: this
      // owner render-template tool feeds `data` un-locale-resolved (pre-existing), so `item` here
      // keys the DEFAULT-locale entries — the member /preview + publish paths locale-resolve both.
      const item = keyedDatasets(templateSource, data as Record<string, readonly Entry[]>);
      // Bound the IPC payload serialized in THIS (parent) process — a large dataset must
      // not spike the API's heap (only the worker carries a --max-old-space ceiling).
      if (JSON.stringify(data).length + JSON.stringify(item).length + JSON.stringify(partials).length > 4 * 1024 * 1024) {
        return reply.code(413).send({ error: 'project data is too large to render' });
      }

      try {
        const rendered = await renderPool.render(templateSource, {
          company,
          website,
          page: pageCtx,
          data,
          item,
          partials,
          richContent: pageRichContent,
        });
        if (!body.document) return reply.send({ html: rendered });
        // Styled-document preview: wrap the rendered body in the publish doc shell + inline
        // the source's own Tailwind utilities (shared with the member `/preview` path).
        const previewPage: Page = {
          id: 'preview',
          path: String(pageCtx.path ?? '/'),
          title: String(pageCtx.title ?? project.name),
          root: { id: 'preview-root', type: 'Section' },
        };
        const html = await styledSourceDocument(previewPage, brand, rendered);
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

  // Graceful shutdown for k8s: drain + terminate render workers when Fastify closes.
  if (renderPool) {
    app.addHook('onClose', async () => {
      await renderPool.shutdown();
    });
  }

  return app;
}
