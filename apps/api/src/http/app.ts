import { randomUUID, timingSafeEqual, createHmac } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId } from '../id.js';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyBaseLogger } from 'fastify';
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
  StylesheetAssetSchema,
  ScriptAssetSchema,
  FontWeightSchema,
  FontFamilyNameSchema,
  FONT_WEIGHTS,
  PageSchema,
  InstanceSettingsInputSchema,
  maskInstanceSettings,
  DEFAULT_NEW_PROJECT_LOCALE,
  DEFAULT_PLATFORM_NAME,
  DEFAULT_BRAND_PRIMARY,
  DEFAULT_BRAND_SECONDARY,
  passwordSchema,
  websiteEffectsClasses,
  websiteEffectsCustomCode,
  stickyHeaderUsesRuntime,
  isLinkPage,
  type StickyHeaderMode,
  type CorporateIdentity,
  type Entry,
  type FileAsset,
  type StylesheetAsset,
  type ScriptAsset,
  type MediaFolderRecord,
  type Form,
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
  siteCspHeaderFromHtml,
  DatasetSlugSchema,
} from '@sitewright/schema';
import { downloadGoogleFont, FontFetchError } from '../fonts/service.js';
import { detectFontFormat, MAX_FONT_BYTES } from '../fonts/upload.js';
import { createFontAsset as storeFontAsset, mergeFontFaces } from '../fonts/asset.js';
import {
  renderDocument,
  componentTypesInSource,
  componentAssets,
  systemI18nData,
  usesDialog,
  usesAnimations,
  ANIMATION_CSS,
  ANIMATION_JS,
  usesParallax,
  PARALLAX_CSS,
  PARALLAX_JS,
  parallaxPreviewDoc,
  usesMarquee,
  MARQUEE_CSS,
  usesLazyload,
  LAZYLOAD_CSS,
  LAZYLOAD_JS,
  usesRipple,
  RIPPLE_CSS,
  RIPPLE_JS,
  usesNavEffects,
  NAV_EFFECTS_JS,
  STICKY_HEADER_JS,
  usesScrollSpy,
  SCROLLSPY_JS,
  usesButtonEffects,
  BUTTON_EFFECTS_JS,
  usesCart,
  CART_CSS,
  usesConsent,
  CONSENT_CSS,
  usesThemeToggle,
  THEME_TOGGLE_CSS,
  THEME_TOGGLE_JS,
  resolveShopChannels,
  resolveFormEndpoints,
  validateTemplate,
  findSkeletonLandmark,
  TemplateError,
  mediaForRender,
  decorateNav,
  NAV_LINK_JS,
} from '@sitewright/blocks';
import { compileUtilityCss, brandToTailwindTheme } from '@sitewright/tailwind';
import { optimizeImage } from '@sitewright/image-pipeline';
import {
  buildNav,
  extractClassNames,
  isGlobalTemplate,
  publishedPages,
  resolveTemplateSource,
  resolveCodeRef,
  resolveLocaleDatasets,
  compareEntryOrder,
  keyedDatasets,
  translationsOf,
  resolveTranslations,
  localeOf,
  pagesInLocale,
  pagePath,
  pagesById,
  pathToSlug,
  childrenOf,
  parentPageView,
  pagesContext,
  referencesChildren,
  referencesParentPage,
  widgetDatasetsForSources,
  WIDGET_PARTIALS,
  GLOBAL_WIDGETS,
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
import { MediaValidationError } from '../media/errors.js';
import { ancestorPaths, isUnderFolder, reparentPath, validateFolderMove } from '../media/folders.js';
import { PublishError, type ReleaseManifest } from '../publish/build.js';
import { fetchJsonData, JsonDataError } from '../publish/json-data.js';
import { InProcessBuildRunner, type BuildRunner } from '../publish/runner.js';
import { AiProviderError, type AiProvider } from '../ai/provider.js';
import { PublishStore } from '../publish/store.js';
import { PREVIEW_SITE_RUNTIME_JS } from './preview-site-runtime.js';
import { signPreview, verifyPreview } from './preview-token.js';
import { PreviewStore } from './preview-store.js';
import { PREVIEW_BRIDGE_JS } from './preview-bridge.js';
import { archiveSite, deploySite, DeployConfigSchema } from '../publish/adapters.js';
import { assertRemoteFormEndpointsReachable } from '../publish/form-guard.js';
import { isNewer } from '../version/checker.js';
import { registerDeployTargetRoutes } from './deploy-targets.js';
import { registerLocaleRoutes } from './locales.js';
import { registerWebsiteDataRoutes } from './website-data.js';
import { buildEffectForks } from './effect-forks.js';
import { buttonPreviewCss } from './button-preview.js';
import { registerFormRoutes } from './form-routes.js';
import { registerProjectSmtpRoutes } from './project-smtp-routes.js';
import { registerStockRoutes, type StockServiceLike } from './stock-routes.js';
import { registerImportRoutes } from './import-routes.js';
import { registerNativizeRoutes } from './nativize-routes.js';
import { StockService } from '../stock/service.js';
import { defaultStockProviders } from '../stock/providers.js';
import { SubmissionRepository } from '../repo/submissions.js';
import { GlobalSmtpMailer, ProjectSmtpMailer, type SubmissionMailer, type ProjectMailer } from '../mail/mailer.js';
import { HttpHcaptchaVerifier, type HcaptchaVerifier } from '../mail/hcaptcha.js';
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
import { sweepExpiredAuthRows } from '../repo/maintenance.js';
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
import { AiUsageRepository } from '../repo/ai-usage.js';
import { ApiKeyRepository, type ResolvedApiKey } from '../repo/api-keys.js';
import { OAuthRepository } from '../repo/oauth.js';
import { OAuthClientRepository } from '../repo/oauth-clients.js';
import { registerOAuthRoutes } from './oauth-routes.js';
import { registerMcpRoutes } from './mcp-routes.js';
import { registerRevisionRoutes } from './revisions-routes.js';
import { ProjectEventBus } from '../events/bus.js';
import {
  ContentRepository,
  CONTENT_KINDS,
  SETTINGS_ENTITY_ID,
  type Settings,
} from '../repo/content.js';
import { RevisionsRepository } from '../repo/revisions.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  type ProjectContext,
} from '../repo/context.js';
import { RenderPool, RenderUnavailableError } from '../render/render-pool.js';
import { captureScreenshots, closeScreenshotBrowser, type ViewportName, type Shot } from '../render/screenshot.js';
import { captureUrlShots, compareTargets, type ComparePageInput } from '../render/compare.js';
import { SourceRefStore, captureSourceRefs, type ReferencePage } from '../render/source-ref.js';
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
      if (exists) continue; // never overwrite an existing dataset (it holds the user's edits)
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

/** Kinds whose Handlebars `source` is checked at SAVE time, not just at render. */
const SOURCE_KINDS = new Set(['page', 'template', 'snippet']);
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
function validateSourceOnSave(kind: string, body: unknown): void {
  if (SOURCE_KINDS.has(kind)) {
    const source = (body as { source?: unknown } | null | undefined)?.source;
    if (typeof source === 'string' && source.trim() !== '') validateTemplate(source);
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
  email: z.string().email(),
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
  /** Sticky/fixed top-header mode (`website.effects.stickyHeader`) — passed straight to renderDocument. */
  stickyHeader?: StickyHeaderMode | 'none';
  /** Opt-in light/dark color schemes (Website settings) — passed through to renderDocument. */
  theme?: { enabled: boolean; default?: 'auto' | 'light' | 'dark' };
  /** Locale-resolved translation catalog → the SYSTEM i18n dict for component runtimes (window.__SW_T__). */
  systemT?: Record<string, unknown>;
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
  const compileCandidates = [...new Set([...(shell.bodyClass ?? '').split(/\s+/).filter(Boolean), ...classNames])];
  // Platform-runtime markers in the rendered body/slots → inline the first-party
  // runtime(s) so they work live in the sandboxed preview (its CSP allows scripts).
  // The runtime CSS goes BEFORE the utility sheet, so Tailwind wins at equal specificity.
  const animated = usesAnimations(scanHtml);
  const parallaxed = usesParallax(scanHtml);
  const marquee = usesMarquee(scanHtml);
  const lazy = usesLazyload(scanHtml);
  const waves = usesRipple(scanHtml);
  // MINI SHOP: style the add-to-cart buttons in the preview, but do NOT ship the cart runtime here —
  // cart.js is deliberately INERT in the editor preview so its click handlers + floating drawer never
  // fight the click-to-edit bridge. The live cart runs on the published /sites/<slug>/ site.
  const cart = usesCart(scanHtml);
  // CONSENT MANAGER: style the banner in the preview but keep consent.js INERT here (like the cart) — its
  // banner/preferences UI would cover the editor canvas + fight the click-to-edit bridge. It runs live on
  // the published /sites/<slug>/ site.
  const consent = usesConsent(scanHtml);
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
  const stickyHeaderRuntime = stickyHeaderUsesRuntime(shell.stickyHeader);
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
        ...(animated ? [ANIMATION_CSS] : []),
        ...(parallaxed ? [PARALLAX_CSS] : []),
        ...(marquee ? [MARQUEE_CSS] : []),
        ...(lazy ? [LAZYLOAD_CSS] : []),
        ...(waves ? [RIPPLE_CSS] : []),
        ...(cart ? [CART_CSS] : []),
        ...(consent ? [CONSENT_CSS] : []),
        ...(themeToggle ? [THEME_TOGGLE_CSS] : []),
        ...(compileCandidates.length > 0
          ? [await compileUtilityCss([compileCandidates.join(' ')], brandToTailwindTheme(brand))]
          : []),
      ];
  const inlineScripts = rawFidelity
    ? // Raw-HTML page: only the editor↔preview bridge runs (no platform component/effect JS).
      [PREVIEW_BRIDGE_JS]
    : [
        ...(componentJs ? [componentJs] : []),
        ...(animated ? [ANIMATION_JS] : []),
        ...(parallaxed ? [PARALLAX_JS] : []),
        ...(lazy ? [LAZYLOAD_JS] : []),
        ...(waves ? [RIPPLE_JS] : []),
        ...(navRuntime ? [NAV_EFFECTS_JS] : []),
        ...(btnRuntime ? [BUTTON_EFFECTS_JS] : []),
        ...(stickyHeaderRuntime ? [STICKY_HEADER_JS] : []),
        ...(scrollSpyRuntime ? [SCROLLSPY_JS] : []),
        ...(dialog ? [NAV_LINK_JS] : []),
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
    inlineScripts: inlineScripts.length > 0 ? inlineScripts : undefined,
    // The toggle's no-flash init, inlined SYNC in <head> (preview's sandboxed CSP allows inline JS).
    headInlineScripts: themeToggle ? [THEME_TOGGLE_JS] : undefined,
    // SYSTEM i18n dict for the component runtimes (only when a component ships).
    systemI18n: componentJs ? systemI18nData(shell.systemT) : undefined,
    // `...shell` carries `stickyHeader` straight through to renderDocument (fixed `#main-nav` + offset).
    ...shell,
  });
}

/**
 * Best-effort server-side screenshots of a preview document, taken only when the caller passes
 * `?screenshot=1` (the MCP preview_page tool does). Renders against the API's OWN loopback origin so the
 * page's self-hosted media resolves; any failure (e.g. no Chromium in this image) → undefined and the
 * caller still returns the HTML.
 */
async function previewScreenshots(
  req: FastifyRequest,
  html: string,
): Promise<Partial<Record<ViewportName, Shot>> | undefined> {
  const q = req.query as { screenshot?: string; viewports?: string } | undefined;
  const want = String(q?.screenshot ?? '').toLowerCase();
  if (want !== '1' && want !== 'true') return undefined;
  const port = req.socket.localPort ?? (Number(process.env.PORT) || 80);
  const viewports = (q?.viewports ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v): v is ViewportName => isScreenshotViewportName(v));
  try {
    return await captureScreenshots(html, {
      originHostPort: `127.0.0.1:${port}`,
      viewports: viewports.length ? viewports : undefined,
    });
  } catch (err) {
    req.log?.warn({ err: err instanceof Error ? err.message : String(err) }, 'preview screenshot failed');
    return undefined;
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
  /**
   * Base domain for SUBDOMAIN routing of locally-hosted sites. When set (e.g. `agency.site`), a
   * request whose Host is `<slug>.<sitesDomain>` is served as that local site at the ROOT path
   * (the canonical "View live" URL); the path form `/sites/<slug>/` keeps working too. Requires
   * wildcard DNS `*.<sitesDomain>` → this host. Unset → subdomain routing off.
   */
  sitesDomain?: string;
  /** Monthly token quotas for agency-funded metering. Unset/0 = unlimited. */
  aiQuota?: { orgMonthlyTokens?: number; userMonthlyTokens?: number };
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
  const mediaStorage = opts.mediaRoot ? new MediaStorage(opts.mediaRoot) : undefined;
  const publishStore = opts.publishRoot ? new PublishStore(opts.publishRoot) : undefined;
  // The live-preview draft-site store: same on-disk layout as a published site (so the
  // proven path-safe serving logic is reused verbatim), but a separate root holding
  // ephemeral, rebuilt-on-change DRAFT builds served only to authenticated members.
  const previewSiteStore = opts.previewRoot ? new PublishStore(opts.previewRoot) : undefined;
  // Cached source-reference screenshots (captured at import) for compare_to_source.
  const sourceRefStore = opts.sourceRefRoot ? new SourceRefStore(opts.sourceRefRoot) : undefined;
  // Live-preview draft-build state, keyed by project id: the content version currently built,
  // any in-flight build (so concurrent requests coalesce onto one), and the last failed
  // version+time (a short cooldown so a persistently-broken project can't spin a fresh build on
  // every request). Defined unconditionally + cleared on project delete so they can't leak.
  const previewBuiltVersion = new Map<string, string>();
  const previewBuilds = new Map<string, Promise<void>>();
  const previewBuildFail = new Map<string, { version: string; at: number }>();
  // Short-lived store of rendered preview docs, so they can be served (via a token
  // URL) under a `Content-Security-Policy: sandbox` for true WYSIWYG interactivity.
  const previewStore = new PreviewStore();
  const buildRunner = opts.buildRunner ?? new InProcessBuildRunner();
  const aiProvider = opts.aiProvider;
  const aiUsageRepo = new AiUsageRepository(db);
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
  const mailer = opts.mailer ?? new GlobalSmtpMailer(instanceSettingsRepo);
  const projectMailer = opts.projectMailer ?? new ProjectSmtpMailer(db, instanceSettingsRepo, opts.encryptionKey);
  const hcaptchaVerifier = opts.hcaptcha ?? new HttpHcaptchaVerifier();
  const stockService = opts.stockService ?? new StockService(defaultStockProviders(), instanceSettingsRepo);
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
  /** The preview / "View live" URL for a locally-hosted site. Always the path form `/sites/<slug>/`:
   *  it works on the app origin with no extra DNS, so it's the dependable default link. Subdomain
   *  hosting (`<slug>.<sitesDomain>`) still SERVES the site (see `rewriteUrl` below) for anyone who has
   *  wildcard `*.<sitesDomain>` DNS, but we don't advertise it as the link — it 404s in the browser
   *  wherever that wildcard isn't resolvable (e.g. a bare `dind.local` host). */
  const servedSiteUrl = (slug: string): string => `/sites/${slug}/`;

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
          redact: [
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
            'req.body.hcaptcha.secret',
            'req.body.stock.unsplash',
            'req.body.stock.pexels',
            // Not a secret, but the base64 logo upload would otherwise bloat the log line.
            'req.body.platformLogo.data',
          ],
        }
      : false,
    // Behind a reverse proxy, trust X-Forwarded-For so req.ip (the rate-limit key)
    // is the real client IP instead of the proxy's (which would collapse all
    // clients to one bucket).
    trustProxy: opts.trustProxy ?? false,
  });

  // Plugins that integrate per-route (rate-limit hooks `onRoute`) must finish
  // loading BEFORE routes are registered, so these are awaited up front.
  // No `secret` here: the session cookie is signed/verified by our own HMAC (signSession/unsignSession)
  // so a runtime secret rotation applies live. The plugin is still needed for cookie PARSING + setCookie.
  await app.register(cookie, {});
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
    // Default to `same-origin`, but let a route opt into a stricter policy (the signed preview doc
    // sets `no-referrer` so its bearer URL can't leak via the Referer header).
    if (!reply.hasHeader('referrer-policy')) reply.header('referrer-policy', 'same-origin');
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
    if (status === 413) return reply.code(413).send({ error: 'request body too large' });
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

  // Brute-force protection for the LOGIN routes: a per-IP FAILED-attempt throttle (successful logins
  // never consume the budget). The threshold is the admin `authMaxFailures` setting (default 10), read
  // live per request. Flood protection for the whole auth surface is the GLOBAL 200/min limiter.
  const authFailLimit = (): Promise<number> => instanceSettingsRepo.getAuthMaxFailures();
  async function loginThrottleBlocked(reply: FastifyReply, ip: string): Promise<boolean> {
    if (!loginThrottle.isBlocked(ip, await authFailLimit())) return false;
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
    if (await loginThrottleBlocked(reply, req.ip)) return reply;
    let userId: string;
    try {
      userId = await login(db, body.email, body.password);
    } catch (err) {
      loginThrottle.recordFailure(req.ip); // count only FAILED credential checks
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
    if (await loginThrottleBlocked(reply, req.ip)) return reply;
    const userId = await mfaRepo.resolveLoginTicket(body.ticket);
    if (!userId) {
      loginThrottle.recordFailure(req.ip);
      throw new UnauthorizedError('invalid or expired login request — please sign in again');
    }
    const ok = (await mfaRepo.verifyTotpCode(userId, body.code)) || (await mfaRepo.consumeRecoveryCode(userId, body.code));
    if (!ok) {
      loginThrottle.recordFailure(req.ip);
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
    const projects = access.map((a) => ({ id: a.projectId, name: a.projectName, slug: a.projectSlug, role: a.role }));
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
  const oidcErrorRedirect = (reply: FastifyReply, code: string): void => {
    void reply.redirect(`/?oidc_error=${encodeURIComponent(code)}`);
  };

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
      if (err instanceof InvalidOidcConfigError) {
        return reply.code(400).send({ error: err.message });
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
      return reply.code(204).send();
    },
  );

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
      const kind = parseGenericKind(req.params.kind);
      validateSourceOnSave(req.params.kind, req.body); // fail fast on unsafe Handlebars source
      const item = await contentRepo.put(ctx, kind, req.params.entityId, req.body);
      // Saving a page provisions any Widget it composes ({{> name}} → its declared datasets).
      if (kind === 'page') await ensureWidgetDatasets(contentRepo, ctx, (req.body as { source?: unknown }).source, app.log);
      return reply.send({ item });
    },
  );

  app.delete<{ Params: ContentParams }>(
    '/projects/:projectId/content/:kind/:entityId',
    { config: rl(60) },
    async (req, reply) => {
      const { ctx } = await resolveProject(req, 'content:delete');
      await contentRepo.remove(ctx, parseGenericKind(req.params.kind), req.params.entityId);
      return reply.code(204).send();
    },
  );

  // Rename a dataset's SLUG with an optional cascade (default ON): rewrite every entry's `dataset` field
  // + every page/template source's `dataset.<slug>` refs so loops don't break. content:write (it edits
  // pages). `cascade:false` renames only the dataset (the editor's plain "Rename" — leaves refs dangling).
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
    { config: rl(60) },
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
  registerOAuthRoutes(app, { db, oauth: oauthRepo, clients: oauthClients, projects, currentUserId, instanceSettings: instanceSettingsRepo, rl });
  // Remote MCP transport (Streamable HTTP) for hosted clients (ChatGPT/claude.ai), authenticated by
  // the same OAuth bearer tokens; reuses the REST routes in-process. See mcp-routes.ts.
  registerMcpRoutes(app, { rl });

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
      const localeData = resolveLocaleDatasets(sourceData, page.locale);
      // Keyed entry access ({{item.<dataset>.<id>.<field>}}) — built only for datasets this source
      // addresses by key, so a looping-only page pays nothing.
      const item = keyedDatasets(pageSource, localeData);
      // Public form definitions + same-origin `/f/<projectId>/<formId>` endpoints for the form
      // embed ({{sw-form}} / data-sw-form) — parity with publish, which precomputes
      // publicBaseUrl-absolute endpoints. The hCaptcha sitekey upgrades opted-in forms' widgets.
      const previewForms = resolveFormEndpoints(
        Object.fromEntries(((await contentRepo.list(ctx, 'form')) as Form[]).map((f) => [f.id, toPublicForm(f)])),
        (fid) => `/f/${project.id}/${fid}`,
      );
      // The sitekey only matters for an hcaptcha-flagged form — skip the extra settings read
      // (per-preview hot path) for the overwhelmingly common case of none.
      const hcaptchaSiteKey = Object.values(previewForms).some((f) => f.hcaptcha)
        ? (await instanceSettingsRepo.getStored()).hcaptcha?.siteKey
        : undefined;
      // Bound the IPC payload serialized in THIS (parent) process — a large dataset/partial/form
      // set (incl. the keyed `item` map) must not spike the API's heap (only the worker carries a
      // memory ceiling). Mirrors the owner render-template guard.
      if (JSON.stringify(localeData).length + JSON.stringify(item).length + JSON.stringify(partials).length + JSON.stringify(previewForms).length > 4 * 1024 * 1024) {
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
        });
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
        };
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
        // Cross-page slug-path access (`{{pages.services.seo.data.x}}`) — referenced-only + same-locale,
        // shared by the page render AND the slots (a footer/nav may reference another page too).
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
          ...(hcaptchaSiteKey ? { hcaptchaSiteKey } : {}),
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
          media: renderMedia,
          forms: previewForms,
          ...(hcaptchaSiteKey ? { hcaptchaSiteKey } : {}),
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
          mainNav,
          sidebarLeft,
          sidebarRight,
          footer,
          bottom,
          head: website?.head,
          criticalCss: website?.criticalCss,
          containerWidth: website?.containerWidth,
          customScripts: [website?.scripts, fxCode.bodyEnd].filter(Boolean).join('\n') || undefined,
          preloader: fxCode.preloader,
          emitBrandContentTokens: !!(fxCode.bodyEnd || fxCode.preloader),
          bodyClass: websiteEffectsClasses(website?.effects),
          stickyHeader: website?.effects?.stickyHeader,
          theme: { enabled: !!website?.enableThemes, default: website?.defaultTheme },
          lang: previewLocale, // `<html lang>` follows the previewed page's locale (publish parity)
          systemT: resolveTranslations(website?.translations, previewLocale, defaultLocale),
        });
        const sourceToken = previewStore.put(sourceHtml, { projectId: project.id, userId: ctx.userId });
        const screenshots = await previewScreenshots(req, sourceHtml);
        // `slug` so the editor builds the `/preview/<slug>/<token>` doc URL (same as the block branch below).
        return reply.send({ html: sourceHtml, token: sourceToken, slug: project.slug, ...(screenshots ? { screenshots } : {}) });
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
      // SAMEORIGIN framing lets the editor embed it; no third party.
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
      projectSlug: string,
      buffer: Buffer,
      meta: { filename: string; mimetype: string; folder?: string; alt?: string; attribution?: MediaAsset['attribution'] },
    ): Promise<ImageAsset> {
      const assetId = randomUUID();
      const { assetDir, inputPath } = await storage.stageUpload(projectSlug, assetId, buffer);
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
          url: `/media/${projectSlug}/${assetId}/${optimized.fallback}`,
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

    // Store a NON-image upload as-is (any file type). Served download-only (attachment + nosniff),
    // so an uploaded HTML/SVG can never execute on the API/site origin.
    async function createFileAsset(
      ctx: ProjectContext,
      projectSlug: string,
      buffer: Buffer,
      meta: { filename: string; mimetype: string; folder?: string },
    ): Promise<FileAsset> {
      const assetId = randomUUID();
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
          url: `/media/${projectSlug}/${assetId}/file/${storedName}`,
        });
        return (await contentRepo.put(ctx, 'media', assetId, asset)) as FileAsset;
      } catch (err) {
        await storage.remove(projectSlug, assetId);
        throw err;
      }
    }

    // Store an imported site's CSS as one inline-served `.css` file (kind 'stylesheet') so the importer
    // can `<link>` it instead of inlining the bulk CSS into each page's editable source.
    async function createStylesheetAsset(ctx: ProjectContext, projectSlug: string, css: string): Promise<StylesheetAsset> {
      const assetId = randomUUID();
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
          url: `/media/${projectSlug}/${assetId}/${storedName}`,
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
      const assetId = randomUUID();
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
          url: `/media/${projectSlug}/${assetId}/${storedName}`,
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
            const saved = await createMediaAsset(ctx, project.slug, buffer, meta);
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
            const saved = await createFontAsset(ctx, project.slug, {
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
          const saved = await createFileAsset(ctx, project.slug, buffer, meta);
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
        // Follow redirects MANUALLY (most image URLs 302 to a CDN), re-checking EVERY hop against the
        // SSRF guard — a redirect must never become a way to reach a private/internal host or downgrade
        // off https. (The initial `url` was already checked above.)
        let current = url;
        let res = await fetch(current, { signal: controller.signal, redirect: 'manual' });
        for (let hop = 0; res.status >= 300 && res.status < 400 && res.headers.get('location'); hop++) {
          if (hop >= MAX_IMPORT_REDIRECTS) return reply.code(400).send({ error: 'too many redirects' });
          const next = new URL(res.headers.get('location')!, current).href; // resolve relative against the current hop
          if (!/^https:\/\//i.test(next) || targetsPrivateHost(next)) {
            return reply.code(400).send({ error: 'a redirect to a non-public URL was blocked' });
          }
          current = next;
          res = await fetch(next, { signal: controller.signal, redirect: 'manual' });
        }
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
          ? await createMediaAsset(ctx, project.slug, buffer, { filename, mimetype: contentType, folder })
          : await createFileAsset(ctx, project.slug, buffer, { filename, mimetype: contentType, folder });
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

    // Import an external website (crawl a live URL) → a faithful, self-contained Sitewright scaffold,
    // streamed over SSE. Owner-only + SSRF-guarded; the AI rewrite stage turns the scaffold into native
    // idioms afterwards. Lives in the media block since it self-hosts the source site's images.
    registerImportRoutes(app, {
      resolveProject,
      contentRepo,
      createMediaAsset,
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
            faces: [{ weight: font.weight, style: font.style, format, bytes: buffer }],
          });
          return { url: saved.url };
        } catch {
          return null; // invalid family/metadata → leave the original url()
        }
      },
      // Self-host a linked document (PDF/doc/…) as-is via the file-asset path (download-only, no sharp).
      hostFileAsset: async (ctx, slug, buffer, meta) => {
        try {
          const saved = await createFileAsset(ctx, slug, buffer, meta);
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

    // Server-side mechanical nativize of an imported project's rawFidelity pages → native Tailwind+token
    // source, streamed over SSE (reuses the import progress UI). Owner-only; renders each page via the
    // pool, then captures computed styles headlessly + runs the @sitewright/site-import transform.
    registerNativizeRoutes(app, { resolveProject, contentRepo, renderPool, rl, log: app.log });

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
        const { ctx, project } = await resolveProject(req, 'content:delete');
        // DB first: a leaked binary (if fs removal fails) is harmless and GC-able,
        // whereas a leaked DB row would block re-creating the same asset id.
        await contentRepo.remove(ctx, 'media', req.params.id);
        try {
          await storage.remove(project.slug, req.params.id);
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
      // A new asset id keeps FULL UUID entropy — it is public (in the `/media/<slug>/<assetId>/` URL),
      // so it must stay unguessable (unlike the short internal `newId()` used for record PKs).
      const newAssetId = randomUUID();
      await storage.copyAsset(projectSlug, asset.id, newAssetId);
      const url =
        asset.kind === 'image'
          ? `/media/${projectSlug}/${newAssetId}/${asset.fallback}`
          : asset.kind === 'font'
            ? `/media/${projectSlug}/${newAssetId}/${asset.files[0]!.file}`
            : `/media/${projectSlug}/${newAssetId}/file/${asset.storedName}`;
      const copy = { ...asset, id: newAssetId, folder, url } as MediaAsset;
      return (await contentRepo.put(ctx, 'media', newAssetId, copy)) as MediaAsset;
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
        if (isUnderFolder(a.folder, from)) await duplicateAsset(ctx, project.slug, a, reparentPath(a.folder, from, to));
      }
      return reply.send({ ok: true });
    });

    // Delete a folder RECURSIVELY: every folder record + asset (and its binaries) under it.
    app.delete<{ Params: { projectId: string } }>('/projects/:projectId/media/folders', { config: rl(60) }, async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:delete');
      if (!WRITE_ROLES.has(ctx.role)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const body = FolderPathBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid folder path' });
      const folder = body.data.path;
      const assets = (await contentRepo.list(ctx, 'media')) as MediaAsset[];
      for (const a of assets) {
        if (isUnderFolder(a.folder, folder)) {
          await contentRepo.remove(ctx, 'media', a.id);
          try {
            await storage.remove(project.slug, a.id);
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
      const copy = await duplicateAsset(ctx, project.slug, asset, body.data.folder ?? asset.folder);
      return reply.code(201).send({ item: copy });
    });

    // Public serving of optimized IMAGE binaries (published sites are public). The storage layer
    // validates every segment and confines the path to the asset directory, so traversal is
    // impossible; `read` only accepts the image-servable charset (avif/webp/jpg). `nosniff` keeps
    // the browser from re-interpreting the bytes as anything other than the declared image type.
    app.get<{ Params: { projectSlug: string; assetId: string; file: string } }>(
      '/media/:projectSlug/:assetId/:file',
      async (req, reply) => {
        const { projectSlug, assetId, file } = req.params;
        const ext = file.split('.').pop() ?? '';
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
        let bytes: Buffer;
        try {
          bytes = await storage.read(projectSlug, assetId, file);
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
    app.get<{ Params: { projectSlug: string; assetId: string; file: string } }>(
      '/media/:projectSlug/:assetId/file/:file',
      async (req, reply) => {
        const { projectSlug, assetId, file } = req.params;
        let bytes: Buffer;
        try {
          bytes = await storage.readStored(projectSlug, assetId, file);
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
    hcaptchaSiteKey: string | undefined;
    snippets: Record<string, string>;
    globalTemplates: Template[];
  }> {
    const exp = await contentRepo.exportBundle(ctx, project);
    // Per-locale page overrides + form definitions are publish INPUTS (like media), not portable
    // project artifacts — loaded here rather than in the export bundle.
    const translations = (await contentRepo.list(ctx, 'translation')) as PageTranslation[];
    const forms = (await contentRepo.list(ctx, 'form')) as Form[];
    const bundle: ProjectBundle = {
      // ExportBundle.project omits formatVersion (a format concern, not a DB field); re-add it.
      project: { formatVersion: exp.formatVersion, ...exp.project },
      pages: exp.pages,
      templates: exp.templates,
      datasets: exp.datasets,
      entries: exp.entries,
      translations,
      forms,
    };
    // `media` includes `kind:'font'` assets — copyMedia bundles their faces (zero font-CDN refs).
    const media = mediaStorage ? ((await contentRepo.list(ctx, 'media')) as MediaAsset[]) : [];
    const hcaptchaSiteKey = (await instanceSettingsRepo.getStored()).hcaptcha?.siteKey;
    // Reusable `{{> compose}}` partials: built-in globals + the project's own (project wins).
    const snippets = {
      ...(await globalSnippetPartials(contentRepo)),
      ...Object.fromEntries(((await contentRepo.list(ctx, 'snippet')) as Snippet[]).map((s) => [s.name, s.source])),
    };
    // The runtime GLOBAL template library so a `global:<id>` ref resolves to the admin-edited source.
    const globalTemplates = await listGlobalTemplates(contentRepo);
    return { bundle, media, hcaptchaSiteKey, snippets, globalTemplates };
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
    const { bundle, media, hcaptchaSiteKey, snippets, globalTemplates } = await assembleBuildInputs(ctx, project);
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
      ...(hcaptchaSiteKey ? { hcaptchaSiteKey } : {}),
      ...(jsonData !== undefined ? { jsonData } : {}),
      ...(Object.keys(snippets).length ? { snippets } : {}),
      globalTemplates,
      // Minify is now a `local` deploy-target serve option (the caller passes it) — no longer a website field.
      ...(buildOpts.minify ? { minifyHtml: true } : {}),
      // readStored accepts image variant / raw file / font face names (superset) — all copied in.
      readMedia: mediaStorage ? (assetId, file) => mediaStorage.readStored(project.slug, assetId, file) : undefined,
    });
  }

  // The project's `local` deploy target (Local Hosting), or undefined when none is configured. Local
  // hosting is opt-in: a project is built + served at `/sites/<slug>/` only when this target exists.
  async function findLocalTarget(ctx: ProjectContext): Promise<DeployTarget | undefined> {
    const targets = (await contentRepo.list(ctx, 'deploy_target')) as DeployTarget[];
    return targets.find((t) => t.protocol === 'local');
  }

  // Builds the site fresh into a throwaway temp directory and returns its path — used by deploy so the
  // upload ships the CURRENT content without first running (or disturbing) the local-publish artifact.
  // Takes the project ID (re-fetched here) so the deploy-target module needn't carry the project type.
  // The caller MUST remove the directory when done. Propagates PublishError/JsonDataError for a 409.
  async function buildForDeploy(
    ctx: ProjectContext,
    projectId: string,
    deployOpts: { minify?: boolean } = {},
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
      return dir;
    } catch (err) {
      await rm(dir, { recursive: true, force: true });
      throw err;
    }
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
          // Build the local artifact. Minify follows the `local` deploy target's serve option (if one is
          // configured); the site is only SERVED at /sites/<slug>/ when a local target exists (the gate
          // there enforces it) — so building without one just produces a downloadable/servable-later build.
          const local = await findLocalTarget(ctx);
          const release = await buildToDir(ctx, project, store.dirFor(project.slug), { minify: !!local?.minifyHtml });
          // Just published → nothing newer than this release, so the site is not dirty.
          return reply.send({ release, url: servedSiteUrl(project.slug), dirty: false });
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
        const release = await store.readRelease(project.slug);
        // Dirty = there is publishable content AND it changed since the last release (or there is
        // no release yet). Drives the editor's "changes to deploy" hint.
        const latest = await contentRepo.latestContentUpdate(ctx);
        const dirty =
          latest !== null && (release === null || latest.getTime() > Date.parse(release.publishedAt));
        // `localHosting` = a `local` deploy target exists, so the site is (or can be) served at /sites/.
        const local = await findLocalTarget(ctx);
        return reply.send({
          release,
          url: servedSiteUrl(project.slug),
          dirty,
          localHosting: !!local,
          ...(local?.previewToken ? { previewToken: local.previewToken } : {}),
        });
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
          dir = await buildForDeploy(ctx, project.id);
        } catch (err) {
          activeDeploys.delete(project.id);
          if (err instanceof PublishError || err instanceof JsonDataError) {
            return reply.code(409).send({ error: err.message });
          }
          throw err;
        }
        try {
          const result = await deploySite(dir, config);
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
          return reply.type(binary.contentType).send(binary.body);
        }
        const asset = await store.readAsset(slug, path);
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
        // Per-site CSP widening (PAGE responses only): a consent-enabled site WITH third-party integrations
        // bakes a `<meta http-equiv CSP>` into its HTML; reconstruct the RESPONSE-HEADER form from it (the
        // meta = header minus frame-ancestors). This costs only a string scan — no settings read — and is
        // guaranteed consistent with the served HTML. It RELAXES the strict `default-src 'self'` default to
        // EXACTLY the registered origins for BOTH the subdomain and the path form (they share this handler);
        // route-scoped, so the editor/app origin CSP is untouched. No consent meta → strict default stays.
        const siteCsp = siteCspHeaderFromHtml(html);
        if (siteCsp) reply.header('content-security-policy', siteCsp).header('x-frame-options', 'DENY'); // DENY: the onSend default is skipped once we set our own CSP
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
      await buildRunner.run({
        outDir: preview.dirFor(project.slug),
        bundle: inputs.bundle,
        publishedAt: new Date().toISOString(),
        media: inputs.media,
        // The two preview-only switches: show work-in-progress drafts, and inject the parent-bridge
        // runtime so the editor shell can track + auto-navigate the iframe. (No minify — stays readable.)
        includeDrafts: true,
        previewRuntime: PREVIEW_SITE_RUNTIME_JS,
        ...(opts.publicUrl ? { publicBaseUrl: opts.publicUrl } : {}),
        ...(inputs.hcaptchaSiteKey ? { hcaptchaSiteKey: inputs.hcaptchaSiteKey } : {}),
        ...(jsonData !== undefined ? { jsonData } : {}),
        ...(Object.keys(inputs.snippets).length ? { snippets: inputs.snippets } : {}),
        globalTemplates: inputs.globalTemplates,
        readMedia: mediaStorage
          ? (assetId, file) => mediaStorage.readStored(project.slug, assetId, file)
          : undefined,
      });
      previewBuiltVersion.set(project.id, version);
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
        const latest = await contentRepo.latestContentUpdate(ctx);
        const version = latest ? String(latest.getTime()) : 'empty';
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
            .finally(() => previewBuilds.delete(project.id));
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

    // Whether a preview path is a STATIC ASSET (a bundled binary under `_assets/`, or a root-level
    // platform text asset: the compiled stylesheet / runtime bundles / robots / sitemap). Everything
    // else is a page (HTML) request.
    const isPreviewAssetPath = (path: string): boolean =>
      path.startsWith('_assets/') || /^[^/]+\.(css|js|xml|txt)$/.test(path);

    // The member-only endpoint that hands the editor (and a "copy link" affordance) the SIGNED,
    // share-able preview base — `/preview/<projectId>/<sig>/`. Resolving it requires content:read, so
    // only a member can MINT the link; the link itself then works without a login (the sig is the auth).
    app.get<{ Params: { projectId: string } }>(
      '/projects/:projectId/preview-url',
      async (req, reply) => {
        const { project } = await resolveProject(req, 'content:read');
        return reply.send({ base: `/preview-site/${project.id}/${signPreview(project.id, currentCookieSecret)}/` });
      },
    );

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
        const page = (await contentRepo.get(ctx, 'page', req.params.pageId).catch(() => null)) as ComparePageInput | null;
        const port = req.socket.localPort ?? (Number(process.env.PORT) || 80);
        const target = compareTargets({
          page,
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

    // Serve the draft build at a SIGNED path. The `<sig>` segment IS the auth (verified here), so NO
    // membership/cookie is required — which is exactly what lets the sandboxed, opaque-origin preview
    // NAVIGATE: a SameSite=Strict cookie is dropped on in-frame navigation, but the signature lives in
    // the path and every relative link carries it. HTML pages are sandboxed (author JS can't reach the
    // editor session); assets get cross-origin headers (the opaque-origin frame fetches them with no
    // credentials) — both kinds sit behind the same signature.
    //
    // Left on the global request cap: a page view fans out into many asset sub-requests, and the only
    // expensive work (a rebuild) is bounded by the version cache + coalescing + failure cooldown.
    app.get<{ Params: { projectId: string; sig: string; '*': string } }>(
      '/preview-site/:projectId/:sig/*',
      async (req, reply) => {
        const { projectId, sig } = req.params;
        if (!verifyPreview(projectId, sig, currentCookieSecret)) return reply.code(404).send();
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
          // the editor's same-origin session; forms stay inert (no accidental preview submissions).
          .header('content-security-policy', 'sandbox allow-scripts')
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

  app.get('/health', async () => ({ ok: true }));

  // The machine-readable authoring contracts of the first-party interactive components
  // (data-sw-component): markers, part roles, config attributes, and markup skeletons.
  // STATIC platform metadata (the same constant the renderer registry is pinned to — no
  // tenant data, no instance config), served so agents and tooling can discover the
  // component vocabulary structurally instead of relying on prose docs. Public like
  // /health + /version, but rate-limited since the payload is non-trivial.
  app.get('/authoring/components', { config: rl(60) }, async () => ({ components: COMPONENT_CATALOG }));

  // "Fork existing effect" snippets for the Website-settings custom-code editors — each built-in
  // nav/button/preloader effect as a self-contained, ready-to-run HTML snippet (derived from the same
  // source as the built-ins, so it can't drift). STATIC platform data; computed once + cached.
  app.get('/authoring/effect-forks', { config: rl(60) }, async () => buildEffectForks());

  // The compiled button-preview stylesheet for the Website-settings "Button effects" modal — the .btn
  // baseline + every effect/shape/accent utility. STATIC platform CSS (brand-agnostic; the editor
  // injects the project's --sw-color-* into the preview iframe); computed once + cached.
  app.get('/authoring/button-preview-css', { config: rl(60) }, async () => ({ css: await buttonPreviewCss() }));
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
          // The SPA entry must always revalidate so a new deploy's content-hashed asset URLs are picked up.
          res.setHeader('cache-control', 'no-cache');
        } else if (/[/\\]assets[/\\]/.test(path)) {
          // Vite content-hashes asset filenames (the build's `?v`), so cache them forever.
          res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        }
      },
    });
    // Rate-limit the catch-all so unknown-path probing/enumeration is throttled too.
    app.setNotFoundHandler({ preHandler: app.rateLimit() }, (req, reply) => {
      if (req.method === 'GET' && !isApiPath(req.url)) {
        return reply
          .header('content-security-policy', editorCsp)
          .header('x-frame-options', 'DENY')
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
      let themeStickyHeader: StickyHeaderMode | 'none' | undefined;
      let themeCustomScripts: string | undefined;
      let themePreloader: string | undefined;
      let themeEmitContentTokens = false;
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
        const fx = websiteEffectsCustomCode(settings.website?.effects);
        themeCustomScripts = fx.bodyEnd || undefined;
        themePreloader = fx.preloader;
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
        (fid) => `/f/${project.id}/${fid}`,
      );
      // Settings read only when an hcaptcha-flagged form exists (mirrors the /preview gate).
      const renderHcaptchaSiteKey = Object.values(renderForms).some((f) => f.hcaptcha)
        ? (await instanceSettingsRepo.getStored()).hcaptcha?.siteKey
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
          ...(renderHcaptchaSiteKey ? { hcaptchaSiteKey: renderHcaptchaSiteKey } : {}),
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
      let themeStickyHeader: StickyHeaderMode | 'none' | undefined;
      let themeFxBodyEnd: string | undefined;
      let containerWidth: string | undefined;
      try {
        const settings = (await contentRepo.get(ctx, 'settings', SETTINGS_ENTITY_ID)) as Settings;
        brand = settings.identity;
        // Snippet HOVER preview is intentionally lean (empty data/item); `website.t` is omitted too, so
        // {{sw-translate}} in a hovered snippet renders its `default=`/'' fallback (no locale context here).
        website = settings.website ? { siteUrl: settings.website.siteUrl, data: settings.website.data, consent: settings.website.consent } : undefined;
        containerWidth = settings.website?.containerWidth;
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
          bodyClass: themeBodyClass,
          stickyHeader: themeStickyHeader,
          customScripts: themeFxBodyEnd,
          emitBrandContentTokens: !!themeFxBodyEnd,
          containerWidth,
        });
        reply.header('content-security-policy', 'sandbox allow-scripts');
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
  const sweepMs = opts.maintenanceSweepMs ?? 60 * 60 * 1000;
  if (sweepMs > 0) {
    const sweepTimer = setInterval(() => {
      void sweepExpiredAuthRows(db).catch((err) => app.log.warn(err, 'auth-row maintenance sweep failed'));
      void revisionsRepo.sweepOld().catch((err) => app.log.warn(err, 'revision retention sweep failed'));
    }, sweepMs);
    sweepTimer.unref();
    app.addHook('onClose', async () => clearInterval(sweepTimer));
  }

  return app;
}
