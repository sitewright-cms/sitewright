import type { ReactNode } from 'react';
import type { MediaAsset } from '@sitewright/schema';

// File-type icons for the Assets list. The category is resolved from the asset KIND and its REAL
// stored-file extension (image `format` / file `storedName` / font file format / css / js) — NEVER
// the user-facing display name, which can be renamed to anything (even extension-less). lucide-style
// outlines; one shape (and colour) per broad category.

const wrap = (children: ReactNode, cls: string): ReactNode => (
  <svg aria-hidden viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const PAGE = (
  <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </>
);

interface Category {
  exts: string[];
  color: string;
  glyph: ReactNode;
}

const CATEGORIES = {
  image: { exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp', 'ico', 'heic', 'heif', 'tif', 'tiff', 'jfif', 'apng'], color: 'text-emerald-500 dark:text-emerald-300', glyph: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-4.5-4.5L5 21" />
    </>
  ) },
  pdf: { exts: ['pdf'], color: 'text-rose-500 dark:text-rose-300', glyph: (
    <>
      {PAGE}
      <path d="M8.5 13h1a1.5 1.5 0 0 1 0 3h-1zM14 13v3m0-3h2m-2 1.5h1.5" />
    </>
  ) },
  doc: { exts: ['doc', 'docx', 'rtf', 'odt', 'txt', 'md', 'pages'], color: 'text-sky-500 dark:text-sky-300', glyph: (
    <>
      {PAGE}
      <path d="M8 13h8M8 16h8M8 10h3" />
    </>
  ) },
  sheet: { exts: ['xls', 'xlsx', 'csv', 'tsv', 'ods', 'numbers'], color: 'text-green-600 dark:text-green-400', glyph: (
    <>
      {PAGE}
      <path d="M8 13h8M8 16h8M11 11v8M15 11v8" />
    </>
  ) },
  archive: { exts: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'], color: 'text-amber-500 dark:text-amber-300', glyph: (
    <>
      {PAGE}
      <path d="M12 8v1m0 2v1m0 2v1m0 2v1" />
    </>
  ) },
  audio: { exts: ['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'opus', 'weba'], color: 'text-fuchsia-500 dark:text-fuchsia-300', glyph: (
    <>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </>
  ) },
  video: { exts: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'mpg', 'mpeg', '3gp', 'ogv'], color: 'text-purple-500 dark:text-purple-300', glyph: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="m10 9 5 3-5 3z" />
    </>
  ) },
  font: { exts: ['woff', 'woff2', 'ttf', 'otf', 'eot'], color: 'text-indigo-500 dark:text-indigo-300', glyph: (
    <>
      {PAGE}
      {/* A serifed "A" — reads as "typeface" at a glance. */}
      <path d="M9.2 17 12 9.5 14.8 17M10.1 14.6h3.8" />
    </>
  ) },
  css: { exts: ['css', 'scss', 'sass', 'less'], color: 'text-sky-500 dark:text-sky-300', glyph: (
    <>
      {PAGE}
      {/* `{ }` — a stylesheet. */}
      <path d="M10 10.5c-1 0-1.3.4-1.3 1.6 0 .9-.3 1.4-1 1.6.7.2 1 .7 1 1.6 0 1.2.3 1.6 1.3 1.6" />
      <path d="M14 10.5c1 0 1.3.4 1.3 1.6 0 .9.3 1.4 1 1.6-.7.2-1 .7-1 1.6 0 1.2-.3 1.6-1.3 1.6" />
    </>
  ) },
  js: { exts: ['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx'], color: 'text-amber-500 dark:text-amber-300', glyph: (
    <>
      {PAGE}
      <path d="m9 13-2 2 2 2M15 13l2 2-2 2" />
    </>
  ) },
  code: { exts: ['json', 'html', 'htm', 'xml', 'yml', 'yaml', 'toml', 'ini', 'sh', 'py', 'rb', 'go', 'rs', 'sql'], color: 'text-slate-500 dark:text-slate-400', glyph: (
    <>
      {PAGE}
      <path d="M9 12.5 7 15l2 2.5M15 12.5 17 15l-2 2.5M13 11l-2 8" />
    </>
  ) },
} satisfies Record<string, Category>;

type CategoryName = keyof typeof CATEGORIES;

const GENERIC: Category = { exts: [], color: 'text-slate-400 dark:text-slate-500', glyph: PAGE };

/** Lowercase extension of a file NAME (real stored name), or '' when there is none. */
function extOf(name: string): string {
  return name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
}

/** The real stored-file extension of an asset — derived from its kind, never the display name. */
function assetExt(asset: MediaAsset): string {
  switch (asset.kind) {
    case 'image':
      return asset.format === 'jpeg' ? 'jpg' : asset.format.toLowerCase();
    case 'file':
      return extOf(asset.storedName);
    case 'font':
      return asset.files[0]?.format ?? extOf(asset.url);
    case 'stylesheet':
      return 'css';
    case 'script':
      return 'js';
    default: {
      const _never: never = asset;
      return _never;
    }
  }
}

/** The category whose `exts` contains `ext`, or the generic fallback. */
function categoryForExt(ext: string): Category {
  for (const cat of Object.values(CATEGORIES)) {
    if (cat.exts.includes(ext)) return cat;
  }
  return GENERIC;
}

/** The category implied by an asset KIND alone (no extension needed), or undefined for `file`. */
function categoryForKind(kind: string): Category | undefined {
  switch (kind) {
    case 'font':
      return CATEGORIES.font;
    case 'stylesheet':
      return CATEGORIES.css;
    case 'script':
      return CATEGORIES.js;
    case 'image':
      return CATEGORIES.image;
    default:
      return undefined;
  }
}

/**
 * A type-appropriate file icon, sized by `className` (default h-6 w-6).
 *
 * Pass an `asset` (preferred): the icon is chosen from the asset's KIND and REAL stored-file
 * extension, so a renamed or extension-less display name never changes it. `filename` (+ optional
 * `kind`) is a fallback for callers without a full asset — it sniffs the name's extension.
 */
export function FileTypeIcon({
  asset,
  filename,
  kind,
  className = 'h-6 w-6',
}: {
  asset?: MediaAsset;
  filename?: string;
  kind?: string;
  className?: string;
}) {
  // With a full asset, resolve from its real stored extension. Otherwise prefer a kind-implied
  // category (font/css/js/image) — right even for an extension-less name — then sniff the filename.
  const cat = asset
    ? categoryForExt(assetExt(asset))
    : (kind ? categoryForKind(kind) : undefined) ?? categoryForExt(extOf(filename ?? ''));
  return wrap(cat.glyph, `${className} ${cat.color}`);
}

// Exposed for tests (category resolution without rendering).
export const __icons = { assetExt, categoryForExt, categoryForKind, CATEGORIES } as const;
export type { CategoryName };

/** Folder icon (indigo). */
export function FolderIcon({ className = 'h-6 w-6' }: { className?: string }) {
  return wrap(
    <path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2z" />,
    `${className} text-indigo-400`,
  );
}
