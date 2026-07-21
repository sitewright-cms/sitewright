import type { ReactNode } from 'react';

// File-type icons for the Assets list — chosen by extension so a glance tells you what a
// file is. lucide-style outlines; one shape per broad category.

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

const CATEGORIES: Record<string, { exts: string[]; color: string; glyph: ReactNode }> = {
  image: { exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp', 'ico'], color: 'text-emerald-500 dark:text-emerald-300', glyph: (
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
  doc: { exts: ['doc', 'docx', 'rtf', 'odt', 'txt', 'md'], color: 'text-sky-500 dark:text-sky-300', glyph: (
    <>
      {PAGE}
      <path d="M8 13h8M8 16h8M8 10h3" />
    </>
  ) },
  sheet: { exts: ['xls', 'xlsx', 'csv', 'ods'], color: 'text-green-600 dark:text-green-400', glyph: (
    <>
      {PAGE}
      <path d="M8 13h8M8 16h8M11 11v8M15 11v8" />
    </>
  ) },
  archive: { exts: ['zip', 'rar', '7z', 'tar', 'gz'], color: 'text-amber-500 dark:text-amber-300', glyph: (
    <>
      {PAGE}
      <path d="M12 8v1m0 2v1m0 2v1m0 2v1" />
    </>
  ) },
  audio: { exts: ['mp3', 'wav', 'ogg', 'flac', 'm4a'], color: 'text-fuchsia-500 dark:text-fuchsia-300', glyph: (
    <>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </>
  ) },
  video: { exts: ['mp4', 'webm', 'mov', 'avi', 'mkv'], color: 'text-purple-500 dark:text-purple-300', glyph: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="m10 9 5 3-5 3z" />
    </>
  ) },
  code: { exts: ['js', 'ts', 'json', 'html', 'css', 'xml', 'yml', 'yaml'], color: 'text-slate-500 dark:text-slate-400', glyph: (
    <>
      {PAGE}
      <path d="m9 13-2 2 2 2M15 13l2 2-2 2" />
    </>
  ) },
};

const GENERIC = { color: 'text-slate-400 dark:text-slate-500', glyph: PAGE };

function categoryFor(filename: string): { color: string; glyph: ReactNode } {
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.') + 1).toLowerCase() : '';
  for (const cat of Object.values(CATEGORIES)) {
    if (cat.exts.includes(ext)) return cat;
  }
  return GENERIC;
}

/** A type-appropriate file icon for `filename`, sized by `className` (default h-6 w-6). */
export function FileTypeIcon({ filename, className = 'h-6 w-6' }: { filename: string; className?: string }) {
  const cat = categoryFor(filename);
  return wrap(cat.glyph, `${className} ${cat.color}`);
}

/** Folder icon (indigo). */
export function FolderIcon({ className = 'h-6 w-6' }: { className?: string }) {
  return wrap(
    <path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2z" />,
    `${className} text-indigo-400`,
  );
}
