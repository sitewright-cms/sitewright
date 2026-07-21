import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
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
import { SectionHelp } from './ui/SectionHelp';
import { SearchableSelect, type SelectOption } from './ui/SearchableSelect';
import { plainText } from './plain-text';
import { AssetField } from './files/AssetField';
import { localeFlag, localeLabel } from './i18n/locale-catalog';
import { glassInput, toggleInput, gradientSurface } from '../theme';

/** A labeled settings group inside the Page Settings modal: an uppercase heading + an optional (?)
 *  help tooltip (replacing the inline description paragraphs), then the fields. */
function Section({ title, tip, children }: { title: string; tip?: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2.5 flex items-center gap-1.5">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h3>
        {tip && <SectionHelp tip={tip} />}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** Human labels for the nav slots: header = the Main Navigation (desktop + mobile drawer), mobile = the
 *  drawer's own curated menu (else it mirrors Main navigation), footer = the footer, custom = an
 *  author-only slot the default chrome ignores (loop it yourself with {{#each nav.custom}}). */
const NAV_SLOT_LABELS: Record<NavSlot, string> = { header: 'Main navigation', mobile: 'Mobile menu', footer: 'Footer', custom: 'Custom' };

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
  /** Exclude from search indexing + the sitemap (`page.noindex`). */
  noindex: boolean;
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
  /** Raw-HTML page: render `source` free-form, with NO platform CSS/JS injected. */
  rawHtml: boolean;
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
    noindex: page.noindex ?? false,
    linkTarget: page.link?.target ?? '',
    linkNewTab: page.link?.newTab ?? false,
    rawHtml: page.rawHtml ?? false,
  };
}

/** Applies settings form values onto a page (immutably; empty fields are dropped). */
export function applyPageSettings(page: Page, v: PageSettingsValues): Page {
  const nav = v.navSlots.length
    ? {
        slots: v.navSlots,
        // Menu label: persisted when set (the modal mirrors the title into it for new pages, and the
        // field is required); if ever left blank the menu falls back to the page title at render.
        ...(v.navTitle.trim() ? { title: v.navTitle.trim() } : {}),
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
  // The flat SEO fields this modal manages: empty/false → dropped (undefined). The fields it does
  // NOT manage (canonical) pass through untouched via the page spread.
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
    noindex: v.noindex || undefined,
    rawHtml: v.rawHtml || undefined,
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
  /** The project's configured locales (Website Settings) — drives multilingual detection, the
   *  create-mode "Available in" scope control, and parent/locale subtree filtering. */
  locales?: readonly string[];
  saving?: boolean;
  onClose: () => void;
  /** Receives the edited values; the CALLER persists (list) or applies to its draft (editor). */
  onSubmit: (values: PageSettingsValues) => void;
  /**
   * 'create' turns this into the NEW-PAGE form: the home/link/translated branches are forced
   * off (a fresh page is a normal page), the slug is editable, the parent defaults to the home
   * of the chosen language, and — when multilingual — the Language selector is replaced by the
   * `scope` control. The caller's `onSubmit` performs id derivation + persistence + fan-out and
   * reports any failure back via `error` (the modal stays open). Defaults to 'edit'.
   */
  mode?: 'create' | 'edit';
  /** The language the pages list is showing — the target of a "this language only" create. */
  currentLocale?: string;
  /** create-mode: 'all' languages (owner + inherit variants) or 'current' (a locale-only page). */
  scope?: 'all' | 'current';
  onScopeChange?: (scope: 'all' | 'current') => void;
  /** create-mode: a submit error from the caller (slug taken / reserved / failed) — shown inline. */
  error?: string | null;
}

/**
 * Page settings in their OWN modal — it stacks above the page editor modal when
 * opened from there (Esc/save act on the top modal only). Covers the full set,
 * grouped into sections: Basics (title/slug/parent), SEO & Social, Navigation, and
 * a collapsible Advanced (template / raw-HTML / a translated page's code source).
 * Status lives in the header (a segmented switch like the editor's Code/Content one).
 */
export function PageSettingsModal({ page, projectId, initial, pages, templates, locales = [], saving = false, onClose, onSubmit, mode = 'edit', currentLocale, scope = 'all', onScopeChange, error }: PageSettingsModalProps) {
  const defaultLocale = locales[0] ?? 'en';
  const multilingual = locales.length > 1;
  const isCreate = mode === 'create';
  // A "this language only" create targets the currently-viewed non-default language; everything
  // else (incl. an all-languages create) is authored in the default language.
  const createLocale = isCreate && multilingual && scope === 'current' && currentLocale && currentLocale !== defaultLocale ? currentLocale : defaultLocale;
  // A TRANSLATED page is a non-default-locale page whose translation group has a main-language
  // owner — it can inherit that owner's code. The code-source control is shown only for these.
  // A fresh page (create mode) is never home/link/translated — it is a normal, top-of-tree page.
  const owner = isCreate ? undefined : codeOwnerOf(page, pages, defaultLocale);
  const isTranslated = !isCreate && !!owner && owner.id !== page.id;
  // Seed the code mode from the page's current state so the radio reflects reality and an
  // untouched save preserves it.
  const [v, setV] = useState<PageSettingsValues>(() =>
    isTranslated ? { ...initial, codeMode: pageCodeMode(page) } : initial,
  );
  const patch = (next: Partial<PageSettingsValues>) => setV((prev) => ({ ...prev, ...next }));
  // The Advanced section (Template / Raw-HTML / a translated page's code source) is collapsed by
  // default in EDIT to keep the form short — but opens up front in create, or whenever the page
  // already uses one of those power settings (so an active choice is never hidden).
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(
    () => isCreate || isTranslated || !!initial.template || initial.rawHtml,
  );
  // The menu label mirrors the Title for a NEW page until the author edits it directly — so a new
  // page lands in the menu with a sensible, non-blank label without double-typing. In edit mode we
  // never mirror (the page already has its own label).
  const [navLabelEdited, setNavLabelEdited] = useState<boolean>(!isCreate);
  // The menu label is only meaningful — and only persisted — when the page is actually in a menu.
  const inMenu = v.navSlots.length > 0;
  // A navigation placeholder (kind:'link') has no page/code/route — the form drops slug, meta,
  // image, and the code/template controls, and shows a single link Target + new-tab toggle instead.
  const isLink = !isCreate && isLinkPage(page);
  const isRootHome = !isCreate && page.path === '' && !isLinkPage(page); // a slugless link placeholder is NOT the home
  // The language this page lives in for tree/parent purposes — the chosen create language in
  // create mode, else the page's own locale.
  const pageLocale = isCreate ? createLocale : localeOf(page, defaultLocale);
  // A LOCALE HOME is the root of a non-default language's subtree (a variant of the root home):
  // its parent (the site root) and slug (the language code) are fixed — not re-assignable.
  const rootHome = pages.find((p) => p.path === '' && !isLinkPage(p));
  const homeGroup = rootHome?.translationGroup ?? rootHome?.id;
  const isLocaleHome =
    !isCreate && !isRootHome && pageLocale !== defaultLocale && (page.translationGroup ?? page.id) === homeGroup;
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
  // Template options for the (searchable) template selectors — built-in globals first, then the
  // project's own templates. Shown by NAME (the naming convention); the empty option differs per
  // selector ("None (own code)" vs the "Select a template…" placeholder), so it's added at the callsite.
  const templateEntries: SelectOption[] = [
    ...GLOBAL_TEMPLATES.map((t) => ({ value: t.id, label: t.name })),
    ...templates.map((t) => ({ value: t.id, label: t.name })),
  ];

  // Status (Published/Draft) lives in the header — a segmented pill matching the page editor's
  // Code/Content switch (active segment lifts to the brand gradient).
  const statusSwitch = (
    <div
      role="group"
      aria-label="Status"
      className="flex items-center rounded-xl border border-white/60 dark:border-white/10 bg-white/50 dark:bg-white/5 p-0.5 text-xs font-medium shadow-sm backdrop-blur-xl"
    >
      {(['published', 'draft'] as const).map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={v.status === s}
          onClick={() => patch({ status: s })}
          className={`waves-effect rounded-lg px-2.5 py-1 capitalize transition ${
            v.status === s ? `${gradientSurface} font-bold` : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100'
          }`}
        >
          {s}
        </button>
      ))}
    </div>
  );

  return (
    <Modal
      title={isCreate ? 'New page' : `${isLink ? 'Nav placeholder' : 'Page'} settings — ${initial.title}`}
      size="lg"
      onClose={onClose}
      // Coerce the parent: home stays parentless; a non-home page submits its chosen parent or
      // falls back to home. In create mode also stamp the chosen language (default = absence) so
      // the caller persists a locale-only page under the right subtree.
      onSave={() =>
        onSubmit({
          ...v,
          // A page in a menu MUST have a label (it's the menu item's text) — guarantee one by
          // falling back to the page title when the author left it blank.
          navTitle: inMenu && !v.navTitle.trim() ? v.title : v.navTitle,
          parent: effectiveParent,
          ...(isCreate ? { locale: createLocale === defaultLocale ? '' : createLocale } : {}),
        })
      }
      saving={saving}
      saveLabel={isCreate ? 'Create page' : 'Save settings'}
      headerExtra={statusSwitch}
    >
      <div className="flex flex-col gap-6 p-5">
        {/* ── BASICS ─────────────────────────────────────────────────────────── */}
        <Section title="Basics" tip="What the page is called and where it sits in the site tree.">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col text-xs font-bold text-slate-700 dark:text-slate-200">
              <span className="flex items-center gap-1.5">
                {isLink ? 'Name (menu label)' : 'Title'}
                {isLink && <SectionHelp tip={'Shown in the menu. Supports basic HTML + {{sw-icon "name"}} / {{sw-flag "de"}}.'} />}
              </span>
              <input
                aria-label={isLink ? 'Placeholder name' : 'Page title'}
                className={`mt-1.5 font-normal ${glassInput}`}
                value={v.title}
                onChange={(e) => {
                  const title = e.target.value;
                  // Mirror into the (required) menu label until the author sets it explicitly.
                  patch(navLabelEdited ? { title } : { title, navTitle: title });
                }}
              />
            </label>
            {!isLink && (
              <label className="flex flex-col text-xs font-bold text-slate-700 dark:text-slate-200">
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
                <span className="mt-1 font-normal text-[11px] text-slate-400 dark:text-slate-500">
                  {isRootHome ? (
                    'The home page is the site root (/).'
                  ) : (
                    <>
                      URL: <code>{pagePath({ ...page, path: v.path, parent: effectiveParent || undefined }, previewById)}</code>
                    </>
                  )}
                </span>
              </label>
            )}
            {isLink && (
              <label className="flex flex-col text-xs font-bold text-slate-700 dark:text-slate-200">
                <span className="flex items-center gap-1.5">
                  Link target
                  <SectionHelp tip={'Internal /path (rebased), external https:// / mailto: / tel:, a same-page #section, or a #dialog-id (opens that modal). Leave empty for a dropdown-only parent.'} />
                </span>
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
                    .map((p) => (
                      <option key={p.id} value={pagePath(p, previewById)}>{p.title}</option>
                    ))}
                </datalist>
              </label>
            )}
          </div>

          {isLink && (
            <label className="flex items-center gap-2 text-sm font-normal text-slate-600 dark:text-slate-300">
              <input type="checkbox" className={toggleInput} aria-label="Open in new tab" checked={v.linkNewTab} onChange={(e) => patch({ linkNewTab: e.target.checked })} />
              Open in a new tab
            </label>
          )}

          {/* A 2-col grid with ONE child keeps Parent at HALF width, aligned under the Title
              column of the title/slug grid above (not a full-width dropdown across the modal). */}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col text-xs font-bold text-slate-700 dark:text-slate-200">
              <span className="flex items-center gap-1.5">
                Parent Page
                <SectionHelp
                  tip={
                    isRootHome
                      ? 'The home page is the tree root.'
                      : isLocaleHome
                        ? 'The language home nests under the site root (fixed).'
                        : 'Sub-pages nest under a parent in the same language.'
                  }
                />
              </span>
              {/* Root home → None; a locale home → fixed under the site root; every other page picks
                  a parent IN ITS OWN LANGUAGE. Options show the page's PATH (titles get too long) and
                  are searchable by path OR title (keywords). Home-like pages are fixed → disabled. */}
              <div className="mt-1.5">
                <SearchableSelect
                  ariaLabel="Parent page"
                  value={effectiveParent}
                  disabled={isHomeLike}
                  onChange={(val) => patch({ parent: val })}
                  searchPlaceholder="Search by path or title…"
                  options={
                    isRootHome
                      ? [{ value: '', label: 'None (home is the root)' }]
                      : isLocaleHome
                        ? [{ value: effectiveParent, label: `${rootHome?.title ?? 'Home'} (site root)` }]
                        : parentChoices.map((p) => {
                            // A nav PLACEHOLDER (kind:'link') is routing-transparent — its pagePath
                            // collapses to its parent's (e.g. "/"), which duplicates the home entry and
                            // is meaningless. Label it by its (plain-text, de-marked-up) NAME instead;
                            // real pages show their PATH. Both are searchable by name/path (keywords).
                            const link = isLinkPage(p);
                            const name = link ? plainText(p.title) || p.id : p.title;
                            return {
                              value: p.id,
                              label: link ? `${name} (menu)` : pagePath(p, previewById),
                              keywords: name,
                            };
                          })
                  }
                  className="w-full"
                />
              </div>
            </label>
          </div>

          {isCreate && multilingual && (
            <fieldset className="flex flex-col gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/40 dark:bg-white/5 p-3">
              <legend className="px-1 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Available in</legend>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="sw-page-scope" className="mt-0.5" aria-label="Available in all languages" checked={scope === 'all'} onChange={() => onScopeChange?.('all')} />
                <span>
                  <span className="font-medium">All languages</span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400">One main-language page; every other language follows its layout.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="sw-page-scope" className="mt-0.5" aria-label="Available only in the current language" checked={scope === 'current'} onChange={() => onScopeChange?.('current')} />
                <span>
                  <span className="font-medium">Only {localeFlag(currentLocale ?? defaultLocale)} {localeLabel(currentLocale ?? defaultLocale)}</span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400">A page that exists only in this language.</span>
                </span>
              </label>
            </fieldset>
          )}
        </Section>

        {/* Create-mode submit errors (slug taken / reserved / failed) surface high, right under Basics. */}
        {error && <p className="text-sm font-medium text-red-600 dark:text-red-400" role="alert">{error}</p>}

        {/* ── SEO & SOCIAL (concrete pages only) ─────────────────────────────── */}
        {!isLink && (
          <Section title="SEO & Social" tip="How this page appears in search results and in link previews (Open Graph).">
            <label className="flex flex-col text-xs font-bold text-slate-700 dark:text-slate-200">
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

            {/* The (?) SectionHelp is a `type="button"` SIBLING of the checkbox inside the label —
                clicking it opens the tooltip and does NOT toggle the checkbox (per the HTML spec, a
                click on an interactive descendant doesn't activate the label's control). */}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className={toggleInput}
                aria-label="Hide from search engines (noindex)"
                checked={v.noindex}
                onChange={(e) => patch({ noindex: e.target.checked })}
              />
              <span className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-200">
                Hide from search engines
                <SectionHelp tip="Adds a noindex robots tag and drops this page from the sitemap, so search engines won't list it. The page stays published and reachable by direct link." />
              </span>
            </label>
          </Section>
        )}

        {/* ── NAVIGATION ─────────────────────────────────────────────────────── */}
        <Section title="Navigation" tip="Which menus this page appears in, and how it's labeled there.">
          <div className="flex flex-wrap items-center gap-4">
            {NAV_SLOTS.map((slot) => (
              <label key={slot} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  className={toggleInput}
                  aria-label={`Nav: ${NAV_SLOT_LABELS[slot]}`}
                  checked={v.navSlots.includes(slot)}
                  onChange={(e) =>
                    patch({
                      navSlots: e.target.checked ? [...v.navSlots, slot] : v.navSlots.filter((x) => x !== slot),
                    })
                  }
                />
                {NAV_SLOT_LABELS[slot]}
              </label>
            ))}
          </div>
          {v.navSlots.includes('custom') && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              “Custom” isn’t shown by the default menus — loop it in your page or snippet code with <code>{'{{#each nav.custom}}'}</code>.
            </p>
          )}
          {isLink && v.navSlots.length === 0 && (
            <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
              This placeholder isn’t in any menu — pick at least one above, or it won’t appear in the navigation.
            </p>
          )}
          {/* The menu label is ALWAYS shown and required — every page in a menu needs a label. It
              mirrors / defaults to the page title, so it's pre-filled but overridable. (The Order
              field moved to Advanced for concrete pages; a link placeholder keeps its Order here
              because it has no Advanced section.) */}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col text-[11px] text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1">
                Menu label {inMenu && <span className="text-rose-500 dark:text-rose-300" aria-hidden>*</span>}
              </span>
              <input
                aria-label="Nav menu label"
                className={glassInput}
                required={inMenu}
                value={v.navTitle}
                placeholder={v.title || 'e.g. Home, Services, About'}
                onChange={(e) => {
                  setNavLabelEdited(true);
                  patch({ navTitle: e.target.value });
                }}
              />
              {inMenu ? (
                <span className="mt-1 text-slate-400 dark:text-slate-500">Defaults to the page title if left blank.</span>
              ) : (
                <span className="mt-1 text-slate-400 dark:text-slate-500">Only used when the page is in a menu (tick one above).</span>
              )}
            </label>
            {isLink && (
              <label className="flex flex-col text-[11px] text-slate-500 dark:text-slate-400">
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
            )}
            {v.navSlots.length > 0 && (
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  className={toggleInput}
                  aria-label="Show in dropdown"
                  checked={v.navDropdown}
                  onChange={(e) => patch({ navDropdown: e.target.checked })}
                />
                Show child pages in dropdown
              </label>
            )}
          </div>
          {v.navDropdown && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              {childCount > 0
                ? `${childCount} child page${childCount === 1 ? '' : 's'} will nest under this item.`
                : 'Pages whose Parent Page is this page will nest under this nav item.'}
            </p>
          )}
        </Section>

        {/* ── ADVANCED (collapsible; concrete pages only) ────────────────────── */}
        {!isLink && (
          <section>
            <button
              type="button"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((o) => !o)}
              className="flex w-full items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 transition hover:text-slate-700 dark:hover:text-slate-200"
            >
              <ChevronRight className={`h-3.5 w-3.5 transition ${advancedOpen ? 'rotate-90' : ''}`} />
              Advanced
              {!advancedOpen && <span className="font-normal normal-case tracking-normal text-slate-400 dark:text-slate-500">Template · Raw HTML</span>}
            </button>
            {advancedOpen && (
              <div className="mt-3 flex flex-col gap-4">
                {isTranslated ? (
                  // A translated page: choose how it gets its CODE — inherit the main language's
                  // layout, fork its own, or use a template. (The text is always translated via page.data.)
                  <fieldset className="flex flex-col text-xs font-bold text-slate-700 dark:text-slate-200">
                    Code source
                    <div className="mt-1.5 flex flex-col gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/40 dark:bg-white/5 p-2.5 font-normal">
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
                          <span className="block text-[11px] text-slate-400 dark:text-slate-500">Follows the main language’s layout — edit there to change every language.</span>
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
                          <span className="block text-[11px] text-slate-400 dark:text-slate-500">Copies the current layout in; edit it freely in the page editor.</span>
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
                            <div className="mt-1.5">
                              <SearchableSelect
                                ariaLabel="Page template"
                                value={v.template}
                                options={templateEntries}
                                placeholder="Select a template…"
                                searchPlaceholder="Search templates…"
                                onChange={(val) => patch({ template: val })}
                                className="w-full"
                              />
                            </div>
                          )}
                        </span>
                      </label>
                    </div>
                  </fieldset>
                ) : (
                  <label className="flex flex-col text-xs font-bold text-slate-700 dark:text-slate-200">
                    <span className="flex items-center gap-1.5">
                      Template
                      <SectionHelp tip="A templated page renders the template’s code — its editor is locked (fork to customize)." />
                    </span>
                    <div className="mt-1.5">
                      <SearchableSelect
                        ariaLabel="Page template"
                        value={v.template}
                        options={[{ value: '', label: 'None (own code)' }, ...templateEntries]}
                        searchPlaceholder="Search templates…"
                        onChange={(val) => patch({ template: val })}
                        className="w-full"
                      />
                    </div>
                  </label>
                )}

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className={toggleInput}
                    aria-label="Raw HTML page"
                    checked={v.rawHtml}
                    onChange={(e) => patch({ rawHtml: e.target.checked })}
                  />
                  <span className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-200">
                    Raw HTML
                    <SectionHelp tip="Render this page’s source as free-form HTML — no platform CSS or JS is injected (the page brings its own styling and scripts)." />
                  </span>
                </label>

                {/* Menu order lives here (an occasional tweak) — usually you just drag pages in the list. */}
                <label className="flex flex-col text-xs font-bold text-slate-700 dark:text-slate-200">
                  <span className="flex items-center gap-1.5">
                    Menu order
                    <SectionHelp tip="Position among sibling menu items (lower numbers come first). Usually set by dragging pages in the sidebar list instead." />
                  </span>
                  <input
                    type="number"
                    aria-label="Nav order"
                    className={`mt-1.5 w-32 font-normal ${glassInput}`}
                    value={v.navOrder}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      if (!Number.isNaN(n)) patch({ navOrder: n });
                    }}
                  />
                </label>
              </div>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}
