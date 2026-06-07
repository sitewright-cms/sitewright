import { useEffect, useMemo, useState, type ReactNode } from 'react';

/** Catalog entry shape (mirrors @sitewright/blocks/google-fonts-catalog, loaded lazily). */
export interface GoogleFontMeta {
  family: string;
  fallback: string;
  weights: number[];
}

const SHOWN_CAP = 48;
const cssFamilyParam = (family: string) => `family=${encodeURIComponent(family).replace(/%20/g, '+')}`;

/**
 * A searchable, previewable gallery of Google Fonts. The catalog is bundled (offline search);
 * previews load the webfont from Google IN THE ADMIN BROWSER ONLY (the editor CSP allows it).
 * The per-font ACTION is supplied by the caller — the settings picker downloads + self-hosts the
 * chosen weight; the library browser copies the family name. Shared so both surfaces preview
 * identically.
 */
export function GoogleFontGallery({
  intro,
  renderAction,
}: {
  intro: string;
  renderAction: (font: GoogleFontMeta) => ReactNode;
}) {
  const [catalog, setCatalog] = useState<GoogleFontMeta[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void import('@sitewright/blocks/google-fonts-catalog')
      .then((m) => alive && setCatalog(m.GOOGLE_FONTS as GoogleFontMeta[]))
      .catch(() => alive && setError('Could not load the font catalog.'));
    return () => {
      alive = false;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => (catalog ? (q ? catalog.filter((f) => f.family.toLowerCase().includes(q)) : catalog).slice(0, SHOWN_CAP) : []),
    [catalog, q],
  );

  // Load the SHOWN families from Google (admin-browser preview only) via one css2 stylesheet link.
  useEffect(() => {
    if (shown.length === 0) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${shown.map((f) => cssFamilyParam(f.family)).join('&')}&display=swap`;
    document.head.appendChild(link);
    return () => link.remove();
  }, [shown]);

  return (
    <div className="flex h-full flex-col gap-3 p-5">
      <p className="text-sm text-slate-500">{intro}</p>
      <input
        aria-label="Search Google Fonts"
        autoFocus
        className="w-full rounded-lg border border-white/60 bg-white/70 px-3 py-2 text-sm outline-none focus:border-indigo-400"
        placeholder="Search fonts (e.g. Inter, Playfair)…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && <p className="text-sm text-rose-500">{error}</p>}
      <div className="min-h-0 flex-1 overflow-auto pr-1">
        {!catalog ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="skeleton h-20 w-full rounded-xl" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No fonts match “{query}”.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {shown.map((font) => (
              <li key={font.family} className="rounded-xl border border-slate-200/70 bg-white/60 p-3">
                <p
                  className="truncate text-xl text-slate-800"
                  style={{ fontFamily: `'${font.family}', ${font.fallback}`, fontWeight: font.weights.includes(400) ? 400 : font.weights[0] }}
                >
                  {font.family}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <span className="mr-1 text-[11px] uppercase tracking-wide text-slate-400">{font.fallback}</span>
                  {renderAction(font)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="shrink-0 text-[11px] text-slate-400">
        {catalog ? `${shown.length} of ${catalog.length} families${q ? '' : ' — search to narrow'}` : 'Loading…'}
      </p>
    </div>
  );
}
