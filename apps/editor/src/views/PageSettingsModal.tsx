import { useState } from 'react';
import {
  GLOBAL_TEMPLATES,
  GLOBAL_TEMPLATE_PREFIX,
  pagePath,
  pagesById,
  codeOwnerOf,
  pageCodeMode,
  resolveCodeRef,
  resolveTemplateSource,
  localeOf,
  type PageCodeMode,
} from '@sitewright/core';
import { isLinkPage, NAV_SLOTS, type NavSlot, type Page, type Template } from '@sitewright/schema';
import { Modal } from './ui/Modal';
import { AssetField } from './files/AssetField';
import { glassInput } from '../theme';

/** The editable page-settings fields, flattened for form state. */
export interface PageSettingsValues {
  title: string;
  path: string;
  status: 'draft' | 'published';
  navSlots: NavSlot[];
  navTitle: string;
  navOrder: number;
  /** Show this page's CHILD pages in a dropdown under its nav item. */
  navDropdown: boolean;
  /** Parent page id ('' = top-level). */
  parent: string;
  /** Template reference ('' = none; 'global:<key>' or a project template id). */
  template: string;
  /** The page's language ('' = the project default locale). */
  locale: string;
  /** Meta description (`page.description`). */
  description: string;
  /** Open Graph / share image (`page.image`). */
  image: string;
  /**
   * For a TRANSLATED page only: how it gets its code — `inherit` (follows the main
   * language, no own code), `fork` (its own editable source), or `template`. Undefined on a
   * main-language/standalone page (its code is managed in the editor as before).
   */
  codeMode?: PageCodeMode;
  /** The source copied into the page when switching to `fork` (the resolved owner code). */
  forkSource?: string;
  /** Link-placeholder (`kind:'link'`) only: where the nav item points (a target string). */
  linkTarget: string;
  /** Link-placeholder only: open the target in a new tab. */
  linkNewTab: boolean;
}

/** Extracts the settings form values from a page. */
export function pageSettingsFromPage(page: Page): PageSettingsValues {
  return {
    title: page.title,
    path: page.path,
    status: page.status ?? 'published',
    navSlots: page.nav?.slots ?? [],
    navTitle: page.nav?.title ?? '',
    navOrder: page.nav?.order ?? 0,
    navDropdown: page.nav?.dropdown ?? false,
    parent: page.parent ?? '',
    template: page.template ?? '',
    locale: page.locale ?? '',
    description: page.description ?? '',
    image: page.image ?? '',
    linkTarget: page.link?.target ?? '',
    linkNewTab: page.link?.newTab ?? false,
  };
}

/** Applies settings form values onto a page (immutably; empty fields are dropped). */
export function applyPageSettings(page: Page, v: PageSettingsValues): Page {
  const nav = v.navSlots.length
    ? {
        slots: v.navSlots,
        ...(v.navTitle ? { title: v.navTitle } : {}),
        order: v.navOrder,
        ...(v.navDropdown ? { dropdown: true } : {}),
      }
    : undefined;
  // A link placeholder: keep it routing-transparent (path:'', no code/SEO); persist only the
  // name (title), the link target + new-tab, the parent, nav placement, locale, and status.
  if (page.kind === 'link') {
    const target = v.linkTarget.trim();
    return {
      ...page,
      title: v.title,
      path: '',
      nav,
      parent: v.parent || undefined,
      locale: v.locale || undefined,
      status: v.status,
      link: { ...(target ? { target } : {}), ...(v.linkNewTab ? { newTab: true } : {}) },
      source: undefined,
      template: undefined,
      description: undefined,
      image: undefined,
    };
  }
  // Code source: for a translated page the `codeMode` control decides whether it inherits the
  // main language's code (no own source/template), forks its own source, or uses a template.
  // For a main-language/standalone page `codeMode` is undefined → keep its source, apply the
  // template select (the prior behavior).
  let source = page.source;
  let template: string | undefined = v.template || undefined;
  if (v.codeMode === 'inherit') {
    source = undefined;
    template = undefined;
  } else if (v.codeMode === 'fork') {
    // Forking copies the resolved layout in; if there's nothing to copy (owner has no resolvable
    // code), stay in inherit mode rather than persisting an empty `source` that silently no-ops.
    source = v.forkSource || page.source || undefined;
    template = undefined;
  } else if (v.codeMode === 'template') {
    source = undefined;
  }
  // The flat SEO fields this modal manages: empty → dropped (undefined). The fields it does NOT
  // manage (canonical/noindex) pass through untouched via the page spread.
  return {
    ...page, // preserves translationGroup (set by "Add translation", not edited here)
    title: v.title,
    path: v.path,
    status: v.status,
    nav,
    parent: v.parent || undefined,
    source,
    template,
    locale: v.locale || undefined,
    description: v.description || undefined,
    image: v.image || undefined,
  };
}

/** Ids of `page` and all its descendants (cycle-safe) — invalid parent choices. */
function selfAndDescendants(pageId: string, pages: readonly Page[]): Set<string> {
  const blocked = new Set([pageId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of pages) {
      if (p.parent && blocked.has(p.parent) && !blocked.has(p.id)) {
        blocked.add(p.id);
        grew = true;
      }
    }
  }
  return blocked;
}

interface PageSettingsModalProps {
  /** The page being configured (identity + home detection). */
  page: Page;
  /** Owning project — for the OG-image file picker. */
  projectId: string;
  initial: PageSettingsValues;
  /** All project pages — feeds the parent selector. */
  pages: readonly Page[];
  /** Project templates (built-in globals are added automatically). */
  templates: readonly Template[];
  /** The project's configured locales (Website Settings) — feeds the Language selector. */
  locales?: readonly string[];
  saving?: boolean;
  onClose: () => void;
  /** Receives the edited values; the CALLER persists (list) or applies to its draft (editor). */
  onSubmit: (values: PageSettingsValues) => void;
}

/**
 * Page settings in their OWN modal — it stacks above the page editor modal when
 * opened from there (Esc/save act on the top modal only). Covers the full set:
 * title, path, status, meta description, OG image, parent page, show-children-
 * in-dropdown, template reference, and nav placement.
 */
export function PageSettingsModal({ page, projectId, initial, pages, templates, locales = [], saving = false, onClose, onSubmit }: PageSettingsModalProps) {
  const defaultLocale = locales[0] ?? 'en';
  // A TRANSLATED page is a non-default-locale page whose translation group has a main-language
  // owner — it can inherit that owner's code. The code-source control is shown only for these.
  const owner = codeOwnerOf(page, pages, defaultLocale);
  const isTranslated = !!owner && owner.id !== page.id;
  // Seed the code mode from the page's current state so the radio reflects reality and an
  // untouched save preserves it.
  const [v, setV] = useState<PageSettingsValues>(() =>
    isTranslated ? { ...initial, codeMode: pageCodeMode(page) } : initial,
  );
  const patch = (next: Partial<PageSettingsValues>) => setV((prev) => ({ ...prev, ...next }));
  // A navigation placeholder (kind:'link') has no page/code/route — the form drops slug, meta,
  // image, and the code/template controls, and shows a single link Target + new-tab toggle instead.
  const isLink = isLinkPage(page);
  const isRootHome = page.path === '' && !isLinkPage(page); // a slugless link placeholder is NOT the home
  const pageLocale = localeOf(page, defaultLocale);
  // A LOCALE HOME is the root of a non-default language's subtree (a variant of the root home):
  // its parent (the site root) and slug (the language code) are fixed — not re-assignable.
  const rootHome = pages.find((p) => p.path === '' && !isLinkPage(p));
  const homeGroup = rootHome?.translationGroup ?? rootHome?.id;
  const isLocaleHome =
    !isRootHome && pageLocale !== defaultLocale && (page.translationGroup ?? page.id) === homeGroup;
  // "Home-like": the root home OR a locale home — slug + parent are fixed.
  const isHomeLike = isRootHome || isLocaleHome;
  /** The main language's effective source (resolved through its template if any) — copied in on fork. */
  const ownerSource = (): string => {
    if (!owner) return page.source ?? '';
    const ref = resolveCodeRef(owner, pages, defaultLocale);
    if (ref.source !== undefined) return ref.source;
    if (ref.template) {
      const projMap = new Map(templates.map((t) => [t.id, t]));
      const globalMap = new Map(GLOBAL_TEMPLATES.map((t) => [GLOBAL_TEMPLATE_PREFIX + t.id, t]));
      try {
        return resolveTemplateSource(ref.template, projMap, globalMap);
      } catch {
        return '';
      }
    }
    return '';
  };
  // HOME (the empty-slug root) is the tree root: every other page must have a parent,
  // defaulting to home — so non-home pages are never offered a "None (top-level)" choice.
  // The literal fallback matches the create/copy defaults so the select always has a value.
  const homeId = rootHome?.id ?? 'home';
  // The home of the page's OWN language (root of its subtree) — the default parent for a page
  // in that language; for the default locale this is the root home.
  const localeHomeId =
    pages.find((p) => (p.translationGroup ?? p.id) === homeGroup && localeOf(p, defaultLocale) === pageLocale)?.id ?? homeId;
  const invalidParents = selfAndDescendants(page.id, pages);
  // A page nests only within its OWN language's subtree — offer only same-locale pages as parents.
  const parentChoices = pages.filter(
    (p) => !invalidParents.has(p.id) && !p.collection && localeOf(p, defaultLocale) === pageLocale,
  );
  // The parent the form submits: the root home has none; a locale home keeps its fixed parent
  // (the site root); every other page submits its chosen parent (defaulting to its language home).
  // Only trust `v.parent` when it's actually an offered (same-locale, non-cyclic) choice, so a
  // stale/cross-locale id can't leave the select blank and then re-save the wrong parent.
  const chosenParent = parentChoices.some((p) => p.id === v.parent) ? v.parent : '';
  const effectiveParent = isRootHome
    ? ''
    : isLocaleHome
      ? page.parent ?? homeId
      : chosenParent || localeHomeId || '';
  // Index for the live "full URL" preview as the slug/parent are edited.
  const previewById = pagesById(pages);
  const childCount = pages.filter((p) => p.parent === page.id).length;
  // Sibling locale variants (same translation group), for context.
  const siblings = page.translationGroup ? pages.filter((p) => p.translationGroup === page.translationGroup && p.id !== page.id) : [];

  return (
    <Modal
      title={`${isLink ? 'Nav placeholder' : 'Page'} settings — ${initial.title}`}
      size="lg"
      onClose={onClose}
      // Coerce the parent: home stays parentless; a non-home page submits its chosen
      // parent or falls back to home (there is no "None" for non-home pages).
      onSave={() => onSubmit({ ...v, parent: effectiveParent })}
      saving={saving}
      saveLabel="Save settings"
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col text-xs font-bold text-slate-700">
            {isLink ? 'Name (menu label)' : 'Title'}
            <input
              aria-label={isLink ? 'Placeholder name' : 'Page title'}
              className={`mt-1.5 font-normal ${glassInput}`}
              value={v.title}
              onChange={(e) => patch({ title: e.target.value })}
            />
            {isLink && (
              <span className="mt-1 font-normal text-[11px] text-slate-400">
                Shown in the menu. Supports basic HTML + <code>{'{{sw-icon "name"}}'}</code> / <code>{'{{sw-flag "de"}}'}</code>.
              </span>
            )}
          </label>
          {!isLink && (
          <label className="flex flex-col text-xs font-bold text-slate-700">
            Page Slug
            <input
              aria-label="Page path"
              className={`mt-1.5 font-mono font-normal ${glassInput}`}
              value={v.path}
              disabled={isHomeLike}
              placeholder="about"
              title={
                isRootHome
                  ? 'The home page is the site root'
                  : isLocaleHome
                    ? 'The language home — its slug is the language code'
                    : 'One segment, no slashes — the URL is built from the parent chain'
              }
              // No slashes: lowercase + slugify as you type. Nesting comes from the parent.
              onChange={(e) => patch({ path: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+/, '') })}
            />
            <span className="mt-1 font-normal text-[11px] text-slate-400">
              {isRootHome ? (
                'The home page is the site root (/).'
              ) : (
                <>
                  URL: <code>{pagePath({ ...page, path: v.path, parent: effectiveParent || undefined }, previewById)}</code> — built from the parent chain + this slug.
                </>
              )}
            </span>
          </label>
          )}
          {isLink && (
            <div className="flex flex-col">
              <label className="flex flex-col text-xs font-bold text-slate-700">
                Link target
                <input
                  aria-label="Link target"
                  list="sw-page-targets"
                  className={`mt-1.5 font-mono font-normal ${glassInput}`}
                  value={v.linkTarget}
                  placeholder="/about, https://…, mailto:…, #section, #dialog-id"
                  onChange={(e) => patch({ linkTarget: e.target.value })}
                />
                {/* Convenience: pick an existing page's route; the value is still a free string. */}
                <datalist id="sw-page-targets">
                  {pages
                    .filter((p) => !isLinkPage(p) && !p.collection)
                    .map((p) => {
                      const route = pagePath(p, previewById);
                      return <option key={p.id} value={route}>{p.title}</option>;
                    })}
                </datalist>
                <span className="mt-1 font-normal text-[11px] text-slate-400">
                  Internal <code>/path</code> (rebased), external <code>https://</code>/<code>mailto:</code>/<code>tel:</code>, a same-page <code>#section</code>, or a <code>#dialog-id</code> (opens that modal). Leave empty for a dropdown-only parent.
                </span>
              </label>
              {/* A sibling of the label (NOT nested) so the checkbox click toggles the checkbox. */}
              <label className="mt-2 flex items-center gap-2 text-sm font-normal text-slate-600">
                <input type="checkbox" aria-label="Open in new tab" checked={v.linkNewTab} onChange={(e) => patch({ linkNewTab: e.target.checked })} />
                Open in a new tab
              </label>
            </div>
          )}
        </div>

        {!isLink && (
        <>
        <label className="flex flex-col text-xs font-bold text-slate-700">
          Meta Description
          <textarea
            aria-label="Meta description"
            className={`mt-1.5 resize-y font-normal ${glassInput}`}
            rows={2}
            maxLength={1000}
            placeholder="Shown in search results — one or two crisp sentences."
            value={v.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </label>

        <AssetField
          label="Image (Open Graph)"
          value={v.image}
          onChange={(val) => patch({ image: val })}
          projectId={projectId}
          placeholder="https://… or /media/… (used in link previews)"
        />
        </>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col text-xs font-bold text-slate-700">
            Parent Page
            <select
              aria-label="Parent page"
              className={`mt-1.5 font-normal ${glassInput}`}
              value={effectiveParent}
              // The root home and each LOCALE home are fixed roots — their parent can't be reassigned.
              disabled={isHomeLike}
              title={isHomeLike ? 'A home page is the root of its language and cannot be re-parented' : undefined}
              onChange={(e) => patch({ parent: e.target.value })}
            >
              {/* Root home → None; a locale home → fixed under the site root; every other page
                  picks a parent IN ITS OWN LANGUAGE (defaults to that language's home). */}
              {isRootHome ? (
                <option value="">None (home is the root)</option>
              ) : isLocaleHome ? (
                <option value={effectiveParent}>{rootHome?.title ?? 'Home'} (site root)</option>
              ) : (
                parentChoices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} ({pagePath(p, previewById)})
                  </option>
                ))
              )}
            </select>
            {isRootHome ? (
              <span className="mt-1 font-normal text-[11px] text-slate-400">The home page is the tree root.</span>
            ) : isLocaleHome ? (
              <span className="mt-1 font-normal text-[11px] text-slate-400">The language home nests under the site root (fixed).</span>
            ) : (
              <span className="mt-1 font-normal text-[11px] text-slate-400">Sub-pages nest under a parent in the same language.</span>
            )}
          </label>
          {isLink ? null : isTranslated ? (
            // A translated page: choose how it gets its CODE — inherit the main language's
            // layout, fork its own, or use a template. (The text is always translated via page.data.)
            <fieldset className="flex flex-col text-xs font-bold text-slate-700">
              Code source
              <div className="mt-1.5 flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white/40 p-2.5 font-normal">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="code-mode"
                    aria-label="Inherit code from the main language"
                    className="mt-0.5"
                    checked={v.codeMode === 'inherit'}
                    onChange={() => patch({ codeMode: 'inherit' })}
                  />
                  <span>
                    Inherit from {owner ? `“${owner.title}”` : 'the main language'}
                    <span className="block text-[11px] text-slate-400">Follows the main language’s layout — edit there to change every language.</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="code-mode"
                    aria-label="Fork the code for this language"
                    className="mt-0.5"
                    checked={v.codeMode === 'fork'}
                    onChange={() => patch({ codeMode: 'fork', forkSource: page.source ?? ownerSource() })}
                  />
                  <span>
                    Fork — this language gets its own code
                    <span className="block text-[11px] text-slate-400">Copies the current layout in; edit it freely in the page editor.</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="code-mode"
                    aria-label="Use a template"
                    className="mt-0.5"
                    checked={v.codeMode === 'template'}
                    onChange={() => patch({ codeMode: 'template' })}
                  />
                  <span className="w-full">
                    Use a template
                    {v.codeMode === 'template' && (
                      <select
                        aria-label="Page template"
                        className={`mt-1.5 font-normal ${glassInput}`}
                        value={v.template}
                        onChange={(e) => patch({ template: e.target.value })}
                      >
                        <option value="">Select a template…</option>
                        {GLOBAL_TEMPLATES.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    )}
                  </span>
                </label>
              </div>
            </fieldset>
          ) : (
            <label className="flex flex-col text-xs font-bold text-slate-700">
              Template
              <select
                aria-label="Page template"
                className={`mt-1.5 font-normal ${glassInput}`}
                value={v.template}
                onChange={(e) => patch({ template: e.target.value })}
              >
                <option value="">None (own code)</option>
                {GLOBAL_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <span className="mt-1 font-normal text-[11px] text-slate-400">
                A templated page renders the template’s code — its editor is locked (fork to customize).
              </span>
            </label>
          )}
        </div>

        {locales.length > 1 && (
          <label className="flex flex-col text-xs font-bold text-slate-700">
            Language
            <select
              aria-label="Page language"
              className={`mt-1.5 font-normal ${glassInput}`}
              value={v.locale}
              onChange={(e) => patch({ locale: e.target.value })}
            >
              {/* The default locale is stored as ABSENCE (value ""); the explicit options
                  are the non-default locales only — no duplicate entry for the default. */}
              <option value="">Default ({locales[0]})</option>
              {locales.slice(1).map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
            <span className="mt-1 font-normal text-[11px] text-slate-400">
              Sets &lt;html lang&gt;; data bindings resolve to the matching <code>&lt;dataset&gt;-{v.locale || locales[0]}</code> variant.
              {siblings.length > 0 && <> Linked translations: {siblings.map((s) => s.locale ?? locales[0]).join(', ')}.</>}
            </span>
          </label>
        )}

        <div className="rounded-2xl border border-white/60 bg-white/40 p-3">
          <p className="mb-2 text-xs font-bold text-slate-700">Navigation</p>
          <div className="flex flex-wrap items-center gap-4">
            {NAV_SLOTS.map((slot) => (
              <label key={slot} className="flex items-center gap-1.5 text-sm capitalize">
                <input
                  type="checkbox"
                  aria-label={`Nav: ${slot}`}
                  checked={v.navSlots.includes(slot)}
                  onChange={(e) =>
                    patch({
                      navSlots: e.target.checked ? [...v.navSlots, slot] : v.navSlots.filter((x) => x !== slot),
                    })
                  }
                />
                {slot}
              </label>
            ))}
          </div>
          {isLink && v.navSlots.length === 0 && (
            <p className="mt-2 text-[11px] font-medium text-amber-600">
              This placeholder isn’t in any menu — pick at least one above, or it won’t appear in the navigation.
            </p>
          )}
          {v.navSlots.length > 0 && (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col text-[11px] text-slate-500">
                Menu label
                <input
                  aria-label="Nav menu label"
                  className={glassInput}
                  value={v.navTitle}
                  placeholder={v.title}
                  onChange={(e) => patch({ navTitle: e.target.value })}
                />
              </label>
              <label className="flex flex-col text-[11px] text-slate-500">
                Order
                <input
                  aria-label="Nav order"
                  type="number"
                  className={glassInput}
                  value={v.navOrder}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!Number.isNaN(n)) patch({ navOrder: n });
                  }}
                />
              </label>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  aria-label="Show in dropdown"
                  checked={v.navDropdown}
                  onChange={(e) => patch({ navDropdown: e.target.checked })}
                />
                Show child pages in dropdown
              </label>
            </div>
          )}
          {v.navDropdown && (
            <p className="mt-2 text-[11px] text-slate-400">
              {childCount > 0
                ? `${childCount} child page${childCount === 1 ? '' : 's'} will nest under this item.`
                : 'Pages whose Parent Page is this page will nest under this nav item.'}
            </p>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-xs font-bold text-slate-700">Status</p>
          <div className="inline-flex rounded-xl border border-white/60 bg-white/40 p-0.5">
            {(['published', 'draft'] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={v.status === s}
                onClick={() => patch({ status: s })}
                className={`rounded-lg px-3 py-1 text-sm capitalize transition ${
                  v.status === s ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-white/60'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
