// @sitewright/site-import — the pure, deterministic engine that turns a captured external website
// (crawled HTML or an uploaded bundle) into a Sitewright import bundle. The side-effecting intake
// adapters (crawl/zip) and the MediaPort implementation live in the API app; this package is I/O-free
// apart from the injected MediaPort.
export { buildImportBundle } from './build.js';
export { DEFAULT_LIMITS, resolveLimits } from './limits.js';
export { normalizePageUrl, assetKey, routePath, sameOrigin, resolveUrl, UPLOAD_BASE } from './url-util.js';
export { looksClientRendered } from './spa-detect.js';
export { mapFaIcon } from './nativize/icon-map.js';
export { type NativizePalette, space, dim, fontSizeClass, radiusClass, colorToken, colorValue, hexOf, spaceToken, arbitrary, DEFAULT_FONT_MAP } from './nativize/tokens.js';
export { type StyleMap, type EmitContext, type GroupResult, type BreakpointGroups, emitGroups, mergeGroups, RESET } from './nativize/tailwind.js';
export { mapAosEffect, ms, aosAttrs, type AosAttrs } from './nativize/aos.js';
export { type CapturedNode, type MergedNode, type NativizeContext, type RenderResult, type SnapKind, mergeTree, mergeTrees, renderTree, toRoute, snapButton, expandCarouselDirect } from './nativize/emit.js';
export { buildPalette, colorToRgbKey } from './nativize/palette.js';
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
