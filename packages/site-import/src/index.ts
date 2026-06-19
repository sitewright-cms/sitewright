// @sitewright/site-import — the pure, deterministic engine that turns a captured external website
// (crawled HTML or an uploaded bundle) into a Sitewright import bundle. The side-effecting intake
// adapters (crawl/zip) and the MediaPort implementation live in the API app; this package is I/O-free
// apart from the injected MediaPort.
export { buildImportBundle } from './build.js';
export { DEFAULT_LIMITS, resolveLimits } from './limits.js';
export { normalizePageUrl, assetKey, routePath, sameOrigin, resolveUrl, UPLOAD_BASE } from './url-util.js';
export type {
  AssetKind,
  CapturedAsset,
  CapturedPage,
  CapturedSite,
  DiagnosticCode,
  ImportBundle,
  ImportDiagnostic,
  ImportLimits,
  ImportProgress,
  ImportResult,
  MediaPort,
  TransformOptions,
} from './types.js';
