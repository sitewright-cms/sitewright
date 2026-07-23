// The project's Corporate-Identity rich-text palette (brand colours + font slots) as a React context, so the
// dataset `richtext` toolbar (RichTextField, several levels deep) can offer brand colours/fonts without
// prop-drilling. `Project.tsx` fetches the identity once and provides it; `CodePageEditor` also reads it to
// post the same palette to the on-page preview bridge. Empty default → controls fall back to standard palettes.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ciRichPalette, type CiRichPalette } from '@sitewright/blocks';
import type { CorporateIdentity } from '@sitewright/schema';
import { api } from '../api';

const EMPTY: CiRichPalette = { colors: [], fonts: [] };

const CiPaletteContext = createContext<CiRichPalette>(EMPTY);

/** Provide the CI palette derived from a project's identity (or nothing while it's still loading). The value
 *  is memoised per-identity so its object identity is stable across renders — consumers (CodePageEditor's
 *  post-to-bridge effect) can depend on it without re-firing every render. */
export function CiPaletteProvider({
  identity,
  children,
}: {
  identity: CorporateIdentity | null | undefined;
  children: ReactNode;
}) {
  const value = useMemo(() => (identity ? ciRichPalette(identity) : EMPTY), [identity]);
  return <CiPaletteContext.Provider value={value}>{children}</CiPaletteContext.Provider>;
}

/** The current project's brand colours + font slots for the rich-text toolbar. */
export function useCiPalette(): CiRichPalette {
  return useContext(CiPaletteContext);
}

/**
 * Fetches the project's Corporate Identity once and provides its rich-text CI palette to the whole subtree.
 * Placed at the App level so BOTH the in-project page editor (CodePageEditor → the on-page toolbar via
 * postMessage) AND the Datasets rail (DataPanel → EntryEditorModal → RichTextField), which are SIBLINGS in
 * the App tree, share one palette. Its own hooks are always called (it renders unconditionally), so it is
 * safe to place after App's conditional early-returns. `projectId` absent (no project open) → empty palette.
 */
export function CiPaletteForProject({ projectId, children }: { projectId?: string; children: ReactNode }) {
  const [identity, setIdentity] = useState<CorporateIdentity | null>(null);
  useEffect(() => {
    if (!projectId) {
      setIdentity(null);
      return;
    }
    let cancelled = false;
    api
      .getSettings(projectId)
      .then((r) => {
        if (!cancelled) setIdentity(r.item?.identity ?? null);
      })
      .catch(() => {
        /* settings may not exist yet → no CI palette (standard palettes still apply) */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  return <CiPaletteProvider identity={identity}>{children}</CiPaletteProvider>;
}
