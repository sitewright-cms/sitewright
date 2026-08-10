// The project's Corporate-Identity rich-text palette (brand colours + font slots) as a React context, so the
// dataset `richtext` toolbar (RichTextField, several levels deep) can offer brand colours/fonts without
// prop-drilling. `Project.tsx` fetches the identity once and provides it; `CodePageEditor` also reads it to
// post the same palette to the on-page preview bridge. Empty default → controls fall back to standard palettes.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ciRichPalette, type CiRichPalette } from '@sitewright/blocks';
import type { CorporateIdentity } from '@sitewright/schema';
import { api } from '../api';
import { richCiCss } from './rich-ci-css';
import type { FontLibraryAsset } from './font-face-css';

const EMPTY: CiRichPalette = { colors: [], fonts: [] };

const CiPaletteContext = createContext<CiRichPalette>(EMPTY);

/**
 * The open project's brand colours keyed by CI token (`primary`, `secondary`, …), or `null` when no
 * project is open.
 *
 * Separate from {@link CiPaletteContext}, which is the rich-text TOOLBAR's view — an ordered list of
 * labelled swatches with the text-only tokens filtered out. A consumer resolving a `--sw-color-<token>`
 * fallback needs the raw map, and reconstructing one from labels would be guesswork.
 */
const CiBrandColorsContext = createContext<Readonly<Record<string, string>> | null>(null);

/**
 * The open project's CI colours, or `null` when none is open.
 *
 * `null` is meaningful and must not be flattened to `{}`: it is what tells a caller to fall back to
 * the PLATFORM palette rather than render a project's brand as missing.
 */
export function useCiBrandColors(): Readonly<Record<string, string>> | null {
  return useContext(CiBrandColorsContext);
}

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
  // The schema guarantees the mandatory tokens are present on a stored identity, so this is a complete
  // palette whenever there is one at all.
  const brand = useMemo(() => identity?.colors ?? null, [identity]);
  return (
    <CiPaletteContext.Provider value={value}>
      <CiBrandColorsContext.Provider value={brand}>{children}</CiBrandColorsContext.Provider>
    </CiPaletteContext.Provider>
  );
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
  const [fonts, setFonts] = useState<FontLibraryAsset[]>([]);
  useEffect(() => {
    // Clear on ANY project change, not just on closing one. These values now paint (they drive the
    // rich-text field's brand colours + fonts), so carrying the previous project's identity across the
    // new fetch would show one project's brand inside another's content for a round trip.
    setIdentity(null);
    setFonts([]);
    if (!projectId) return;
    let cancelled = false;
    api
      .getSettings(projectId)
      .then((r) => {
        if (!cancelled) setIdentity(r.item?.identity ?? null);
      })
      .catch(() => {
        /* settings may not exist yet → no CI palette (standard palettes still apply) */
      });
    // The library's self-hosted fonts, so a brand slot can be drawn in its REAL face inside the
    // rich-text field (an `@font-face` the editor origin never declares otherwise → silent fallback).
    api
      .listMedia(projectId, 'font')
      .then((r) => {
        if (!cancelled) setFonts(r.items.filter((a): a is FontLibraryAsset => a.kind === 'font'));
      })
      .catch(() => {
        /* no library / no access → system-family slots still resolve; asset slots fall back */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Give the project's CI utilities real values inside `.sw-rich-edit` (see lib/rich-ci-css). One
  // document-level <style>: the rules are scoped to the editable, and the Datasets rail lives OUTSIDE
  // ProjectView in the App tree, so a subtree-local sheet would miss it.
  useEffect(() => {
    const css = richCiCss(identity, fonts);
    if (!css) return;
    const style = document.createElement('style');
    style.dataset.swRichCi = '';
    style.textContent = css;
    document.head.appendChild(style);
    return () => style.remove();
  }, [identity, fonts]);

  return <CiPaletteProvider identity={identity}>{children}</CiPaletteProvider>;
}
