// Public types for the site-import engine — the boundary between the (side-effecting)
// intake adapters that live in the API app and this pure, deterministic transform.
//
// Flow:  intake (crawl / zip) ──► CapturedSite (IR) ──► buildImportBundle ──► ImportBundle(s)
//        The engine never knows which intake produced the CapturedSite. The only side effect
//        it performs is hosting assets, which it does through the injected MediaPort.
import type { CorporateIdentity, Dataset, Entry, Page, Template, WebsiteSettings } from '@sitewright/schema';

/** What kind of resource a captured asset is — drives how the engine treats it. */
export type AssetKind = 'image' | 'css' | 'font' | 'other';

/**
 * One captured asset, keyed by `sourceRef` — the canonical reference both intakes resolve every
 * URL to (an absolute URL for a crawl; a `https://import.local/<path>` for an uploaded bundle). The
 * engine rewrites a page's references by looking them up under this same key. Either `bytes` (the
 * content is already in hand: a zip entry, or a crawl that fetched it) or `remoteUrl` (only the URL
 * is known; the MediaPort fetches it) must be present for the asset to be hostable.
 */
export interface CapturedAsset {
  sourceRef: string;
  kind: AssetKind;
  contentType?: string;
  bytes?: Uint8Array;
  remoteUrl?: string;
  /** `@font-face` metadata for `kind:'font'` (parsed from the source CSS); the actual file format is
   *  detected from the bytes when hosted. */
  font?: { family: string; weight: number; style: 'normal' | 'italic' };
}

/** One captured page: its canonical source URL (the link-rewrite key) and its raw outer HTML. */
export interface CapturedPage {
  sourceUrl: string;
  html: string;
  statusCode?: number;
}

/** The converged intermediate representation both intakes produce. */
export interface CapturedSite {
  /** The origin used to classify internal vs external links and to resolve relative URLs. */
  baseUrl: string;
  pages: CapturedPage[];
  /** Assets discovered by the intake, keyed by `sourceRef` (supplies bytes the engine can't refetch). */
  assets: Map<string, CapturedAsset>;
  origin: { kind: 'crawl' | 'upload'; label: string };
}

/**
 * The one side effect the pure transform delegates to the app: self-host a captured asset and return
 * a Sitewright `AssetRef` (a root-relative `/media/...` path or an absolute https URL). Returns null
 * when the asset can't be hosted (SVG, oversize, fetch failure) — the engine then leaves the original
 * URL in place and records a diagnostic.
 */
export interface MediaPort {
  hostAsset(asset: CapturedAsset): Promise<{ ref: string } | null>;
}

/** Hard caps applied inside the engine (defense-in-depth alongside the intake/route limits). */
export interface ImportLimits {
  /** Max pages emitted into the bundle. */
  maxPages: number;
  /** Max bytes for a single page `source` (schema cap is 256 KiB; over → trimmed). */
  maxSourceBytes: number;
  /** Max images self-hosted across the whole import. */
  maxImages: number;
  /** Max bytes per skeleton slot (topNav/footer); schema cap is 20 KB. */
  maxSlotBytes: number;
}

/** Progress callback granularity (the API streams these as SSE frames). */
export interface ImportProgress {
  phase: 'transform' | 'host-media' | 'assemble';
  done?: number;
  total?: number;
  detail?: string;
}

export interface TransformOptions {
  /** The injected asset self-hosting port. */
  media: MediaPort;
  limits?: Partial<ImportLimits>;
  /** Locale assigned to the produced pages/settings (the project default). Defaults to `en`. */
  defaultLocale?: string;
  /** ISO timestamp stamped onto each imported page's `data.swImport` marker (the route supplies it). */
  importedAt?: string;
  onProgress?: (e: ImportProgress) => void;
}

/** Stable, machine-readable diagnostic codes surfaced in the import report. */
export type DiagnosticCode =
  | 'script-dropped'
  | 'style-removed'
  | 'form-inerted'
  | 'image-host-failed'
  | 'image-budget-exceeded'
  | 'unsafe-url-dropped'
  | 'source-truncated'
  | 'slug-deduped'
  | 'css-overflow'
  | 'page-skipped'
  | 'chrome-extracted'
  | 'locales-detected'
  | 'dataset-inferred'
  | 'invalid-source-fallback'
  | 'bundle-invalid';

export interface ImportDiagnostic {
  code: DiagnosticCode;
  message: string;
  /** The source URL of the page the diagnostic relates to, when applicable. */
  page?: string;
}

/**
 * A self-contained bundle ready for `ContentRepository.importBundle`. The engine may split a large
 * site into several subtree-coherent bundles (each independently valid) — see {@link ImportResult}.
 */
export interface ImportBundle {
  project: {
    identity: CorporateIdentity;
    website?: WebsiteSettings;
    settings: { defaultLocale: string; locales: string[] };
  };
  pages: Page[];
  templates: Template[];
  datasets: Dataset[];
  entries: Entry[];
}

export interface ImportResult {
  /** One or more bundles. The first carries the project settings; all are `validateProject`-clean. */
  bundles: ImportBundle[];
  diagnostics: ImportDiagnostic[];
  stats: {
    pages: number;
    imagesHosted: number;
    scriptsDropped: number;
    chromeExtracted: boolean;
  };
}
