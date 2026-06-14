import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { isLinkPage, NAV_SLOTS, type NavSlot, type Page, type Template } from '@sitewright/schema';
import { pagePath, pagesById, pagesInLocale, localeOf } from '@sitewright/core';
import { api, previewDocUrl, type Project } from '../api';
import { CodePageEditor } from './CodePageEditor';
import { PageSettingsModal, applyPageSettings, pageSettingsFromPage, type PageSettingsValues } from './PageSettingsModal';
import { useDialogs } from './ui/Dialogs';
import { Modal } from './ui/Modal';
import { Tooltip } from './ui/Tooltip';
import { PlaceholderLabel } from './PlaceholderLabel';
import { FormsManager } from './FormsManager';
import { SettingsView } from './settings/SettingsView';
import { glassCard, glassInput, fieldLabel, primaryButton, ghostButton, gradientHover, gradientSurface, toggleInput } from '../theme';
import { orderPagesByTree, canReorder, reorderWithinParent, orderedSiblings } from './pages-order';
import { LocalePickerModal } from './i18n/LocalePickerModal';
import { localeFlag, localeLabel } from './i18n/locale-catalog';

interface ProjectViewProps {
  project: Project;
  /** The active top-level tab (lifted to App so the tablist can live in the header bar). */
  tab: Tab;
}

// The owner's top-level tabs. Settings is lifted into the two leading tabs (Corporate Identity /
// Website Settings); the submissions Inbox is folded into Forms. Administration (Clients / Team /
// Access / System Settings) now lives in the header gear menu (opened as modals), not a tab. The
// constrained client role sees none of these — just the pages list + restricted editor.
export const MANAGE_TABS = [
  'corporate-identity',
  'website-settings',
  'pages',
  'forms',
] as const;
export type Tab = (typeof MANAGE_TABS)[number];
export const TAB_LABELS: Record<Tab, string> = {
  'corporate-identity': 'Corporate Identity',
  'website-settings': 'Website Settings',
  pages: 'Pages',
  forms: 'Forms',
};

// A new code page opens with a small, valid Handlebars + Tailwind scaffold so the live
// preview is immediately meaningful: it demonstrates the {{ company.* }} bindings AND a `data-sw-text`
// editable region — the marker that makes a piece of text client-editable (bound to page.data), so a
// freshly created page already has something a client can edit without the developer wiring anything up.
// Neutral <section> wrapper: the skeleton wraps the page body in <main id="page-content">, and the
// validator rejects a nested <main> in author content.
const CODE_PAGE_STARTER = `<section class="mx-auto max-w-3xl px-6 py-16">
  <h1 class="text-4xl font-bold tracking-tight text-slate-900">{{ company.name }}</h1>
  <p class="mt-4 text-lg text-slate-600" data-sw-text="tagline">Edit this tagline</p>
</section>
`;

// --- pages-list row icons (lucide-style outlines) -----------------------------
const rowIcon = (paths: ReactNode) => (
  <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {paths}
  </svg>
);
const HOME_ICON = rowIcon(<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10" />);
// Six-dot grip — the drag affordance for reordering a page within its sibling group.
const GRIP_ICON = rowIcon(
  <>
    <circle cx="9" cy="6" r="1" />
    <circle cx="9" cy="12" r="1" />
    <circle cx="9" cy="18" r="1" />
    <circle cx="15" cy="6" r="1" />
    <circle cx="15" cy="12" r="1" />
    <circle cx="15" cy="18" r="1" />
  </>,
);
const PAGE_ICON = rowIcon(
  <>
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z" />
    <path d="M14 2v6h6" />
  </>,
);
const PREVIEW_ICON = rowIcon(
  <>
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </>,
);
const EDIT_ICON = rowIcon(
  <>
    <path d="m16 18 6-6-6-6" />
    <path d="m8 6-6 6 6 6" />
  </>,
);
const GEAR_ICON = rowIcon(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 1v3m0 16v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M1 12h3m16 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
  </>,
);
const COPY_ICON = rowIcon(
  <>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </>,
);
const TRASH_ICON = rowIcon(
  <>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </>,
);
const GLOBE_ICON = rowIcon(
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </>,
);
const TEMPLATE_ICON = rowIcon(
  <>
    <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </>,
);
// A link/chain glyph — a navigation placeholder (kind:'link') has no page of its own.
const LINK_ICON = rowIcon(
  <>
    <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </>,
);

// On row hover the icons tint white for contrast on the gradient — but ONLY while the icon itself
// isn't hovered (`[&:not(:hover)]`), so a direct hover's white-chip (`hover:bg-white text-slate-900`)
// always wins regardless of Tailwind's variant ordering.
const ROW_ACTION =
  'waves-effect inline-flex cursor-pointer items-center justify-center rounded-lg p-1.5 text-slate-400 transition group-hover:[&:not(:hover)]:text-white/90 hover:bg-white hover:text-slate-900';

export function ProjectView({ project, tab }: ProjectViewProps) {
  const { confirm, dialog } = useDialogs();
  // An owner gets the full studio; a `member` is a client with a content-first default surface.
  const isClient = project.role === 'member';
  const [pages, setPages] = useState<Page[]>([]);
  const [editing, setEditing] = useState<Page | null>(null);
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  // The "Add page" form lives in its own modal, opened from a button atop the list.
  const [addOpen, setAddOpen] = useState(false);
  // Add-page errors are scoped to the modal so they never bleed onto the list (and list-op
  // errors never show inside the add form). `error` covers list ops (reorder/delete/copy/…).
  const [addError, setAddError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Settings opened FROM THE LIST (persist-on-save); the editor stacks its own instance.
  const [settingsFor, setSettingsFor] = useState<Page | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [settingsSaving, setSettingsSaving] = useState(false);
  // The project's configured locales (Website Settings) — drives the i18n actions.
  const [locales, setLocales] = useState<string[]>(['en']);
  const defaultLocale = locales[0] ?? 'en';
  const multilingual = locales.length > 1;
  // The language the pages list is showing; the switcher changes it and the list filters
  // to that locale's pages. Kept in sync with the configured locales below.
  const [currentLocale, setCurrentLocale] = useState(defaultLocale);
  // "Add translation" (a new locale target) modal + its async state.
  const [addLocaleOpen, setAddLocaleOpen] = useState(false);
  const [addLocaleBusy, setAddLocaleBusy] = useState(false);
  const [addLocaleError, setAddLocaleError] = useState<string | null>(null);
  // When multilingual, a new page is either created in ALL languages (default) or only the
  // currently-selected one (a locale-only page).
  const [newPageScope, setNewPageScope] = useState<'all' | 'current'>('all');
  // "Add nav placeholder" modal — a kind:'link' entry (no page of its own): a menu item that
  // links somewhere or groups child pages in a dropdown.
  const [phOpen, setPhOpen] = useState(false);
  const [phName, setPhName] = useState('');
  const [phTarget, setPhTarget] = useState('');
  const [phNewTab, setPhNewTab] = useState(false);
  const [phSlots, setPhSlots] = useState<NavSlot[]>(['header']);
  const [phDropdown, setPhDropdown] = useState(false);
  const [phError, setPhError] = useState<string | null>(null);
  // Drag&drop reordering of sibling pages (same parent + locale). `dragId` is the page being
  // dragged; `drop` marks where it will land (a row + which side) so the list opens a gap there.
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; pos: 'before' | 'after' } | null>(null);
  // Screen-reader announcement for a completed reorder (drag or keyboard).
  const [reorderMsg, setReorderMsg] = useState('');
  // Always-current `pages` for the reorder handlers: they must compute against the latest
  // committed list, never a stale render closure (rapid keyboard moves / in-flight saves).
  const pagesRef = useRef<Page[]>(pages);
  pagesRef.current = pages;
  // Pages of the CURRENTLY-SELECTED language, in page-tree order (parents followed by their
  // children) with a depth for indenting sub-pages. The list shows one language at a time;
  // the switcher changes which. (Filtering before ordering makes a locale's home the subtree
  // root — its parent, the root home, is outside the filtered set.)
  const orderedPages = useMemo(
    () => orderPagesByTree(pagesInLocale(pages, currentLocale, defaultLocale), defaultLocale),
    [pages, currentLocale, defaultLocale],
  );
  // The HOME page (empty slug = the tree root) is the default parent for every other
  // page; "no parent" isn't offered for non-home pages.
  const homeId = pages.find((p) => p.path === '' && !isLinkPage(p))?.id ?? 'home';
  // The home page of a given locale (root of its subtree) — the parent for a new locale-only
  // page, falling back to the root home when that locale has no home yet.
  function localeHomeId(locale: string): string {
    if (locale === defaultLocale) return homeId;
    const group = pages.find((p) => p.id === homeId)?.translationGroup ?? homeId;
    return pages.find((p) => (p.translationGroup ?? p.id) === group && localeOf(p, defaultLocale) === locale)?.id ?? homeId;
  }
  // A LOCALE HOME — the root of a language's subtree (a variant of the root home). Treated like
  // the home page in the list: home icon, not draggable, not deletable (remove the whole language
  // in Website Settings instead), and its parent (the root home) is fixed.
  const homeGroup = pages.find((p) => p.id === homeId)?.translationGroup ?? homeId;
  const isLocaleHome = (p: Page): boolean =>
    p.path !== '' && localeOf(p, defaultLocale) !== defaultLocale && (p.translationGroup ?? p.id) === homeGroup;
  // A slugless link placeholder is NOT home — it's a normal, reorderable + deletable nav entry.
  const isHomeLike = (p: Page): boolean => (p.path === '' && !isLinkPage(p)) || isLocaleHome(p);
  // Index for computing each page's full route ({root}/{parent slugs}/{slug}) for display.
  const pageById = useMemo(() => pagesById(pages), [pages]);
  const fullPath = (p: Page): string => pagePath(p, pageById);

  async function load() {
    try {
      const res = await api.listPages(project.id);
      setPages(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load pages');
    }
  }

  /** Re-read the project's configured locales from settings (default first). */
  async function refreshLocales() {
    try {
      const res = await api.getSettings(project.id);
      const s = res.item?.settings;
      if (!s?.locales?.length) return;
      // Keep the project's default locale first → `locales[0]` is the default everywhere
      // (Project actions + PageSettingsModal's "Default (…)" label).
      setLocales([s.defaultLocale, ...s.locales.filter((l) => l !== s.defaultLocale)]);
    } catch {
      /* settings may not exist yet → single default locale */
    }
  }

  // When a language is added/removed in Website Settings (a sibling tab of THIS view), the pages
  // list must refresh its locale set + pages — otherwise a removed language lingers until a full
  // reload. Threaded into SettingsView → WebsiteSection → LocaleManager.
  async function onLocalesChangedInSettings() {
    await refreshLocales();
    await load();
  }

  useEffect(() => {
    void load();
    void refreshLocales();
  }, [project.id]);

  // Keep the selected language valid: when the configured locales load/change (or one is
  // removed), snap back to the default if the current selection is no longer available.
  useEffect(() => {
    // Snap the selected language back to the default whenever it is no longer configured
    // (initial load, or a locale was removed). Terminates: resetting to a valid default no-ops.
    if (!locales.includes(currentLocale)) setCurrentLocale(defaultLocale);
  }, [locales, currentLocale, defaultLocale]);

  /** Commits a drag: reorder the sibling group, apply optimistically, persist moved pages. */
  async function persistReorder(sourceId: string, targetId: string, pos: 'before' | 'after') {
    const current = pagesRef.current; // latest committed list, not a stale closure
    const updated = reorderWithinParent(current, sourceId, targetId, pos, defaultLocale);
    if (updated.length === 0) return;
    const updatedById = new Map(updated.map((p) => [p.id, p] as const));
    const next = current.map((p) => updatedById.get(p.id) ?? p);
    pagesRef.current = next;
    setPages(next); // optimistic
    // Announce the move for assistive tech (the DOM reorder is otherwise silent).
    const srcTitle = current.find((p) => p.id === sourceId)?.title ?? 'page';
    const tgtTitle = current.find((p) => p.id === targetId)?.title ?? '';
    setReorderMsg(`Moved ${srcTitle} ${pos} ${tgtTitle}`.trim());
    try {
      await Promise.all(updated.map((p) => api.putPage(project.id, p)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to reorder pages');
      await load(); // resync from the server on failure
    }
  }

  /** Keyboard reordering parity for the drag handle: Arrow Up/Down move within the sibling group. */
  function moveByKey(p: Page, dir: 'up' | 'down') {
    const group = orderedSiblings(pagesRef.current, p.id, defaultLocale);
    const i = group.findIndex((g) => g.id === p.id);
    if (i < 0) return;
    const prev = group[i - 1];
    const next = group[i + 1];
    if (dir === 'up' && prev) void persistReorder(p.id, prev.id, 'before');
    if (dir === 'down' && next) void persistReorder(p.id, next.id, 'after');
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setAddError(null);
    // The form takes a SLUG (one segment, no slashes) — the full URL is computed from the
    // parent. Slugify the input: lowercase, spaces/slashes/invalid → hyphens, trimmed.
    const seg = slug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!seg) {
      setAddError('Enter a page slug (e.g. "about").');
      return;
    }
    // A locale-only page (created while viewing a non-default language, "only this language")
    // gets a locale-suffixed id so it never collides with a future default page of the same
    // slug; otherwise the id is the slug, with the code authored in the default language.
    const localeOnly = multilingual && currentLocale !== defaultLocale && newPageScope === 'current';
    const id = localeOnly ? `${seg}-${currentLocale.toLowerCase()}` : seg;
    if (pages.some((p) => p.id === id)) {
      setAddError(id === 'home' ? '"home" is reserved for the site root — pick another slug.' : `A page "${id}" already exists.`);
      return;
    }
    const starter: Page = {
      id,
      path: seg,
      title,
      source: CODE_PAGE_STARTER,
      ...(localeOnly
        ? { parent: localeHomeId(currentLocale), locale: currentLocale } // standalone, lives only in this language
        : { parent: homeId }), // the default-language owner (the code source of truth)
    };
    try {
      await api.putPage(project.id, starter);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'failed to create page');
      return;
    }
    // The page exists now — close the form regardless of what the propagation step does.
    setSlug('');
    setTitle('');
    setAddOpen(false);
    // "All languages": the owner was authored in the default language; fan it out into every
    // other configured locale as inherit-mode variants (they follow this page's code). A failure
    // here leaves a valid (un-propagated) page — say so precisely instead of "failed to create".
    if (multilingual && !localeOnly && newPageScope === 'all') {
      try {
        await api.translatePage(project.id, id);
      } catch (err) {
        await load();
        setError(
          `“${title}” was created but could not be added to every language ` +
            `(${err instanceof Error ? err.message : 'error'}). Use the translate action on it to retry.`,
        );
        return;
      }
    }
    await load();
  }

  /** Create a kind:'link' navigation placeholder (no page/code/route). */
  async function createPlaceholder(e: FormEvent) {
    e.preventDefault();
    setPhError(null);
    const name = phName.trim();
    if (!name) {
      setPhError('Enter a name (shown in the menu).');
      return;
    }
    const target = phTarget.trim();
    if (!target && !phDropdown) {
      setPhError('Enter a link target, or enable “Dropdown of child pages”.');
      return;
    }
    if (phSlots.length === 0) {
      setPhError('Pick at least one menu (header / footer / mobile).');
      return;
    }
    // A stable, unique id derived from the name — never the reserved 'home'.
    const base = `nav-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item'}`;
    let id = base;
    for (let n = 2; pages.some((p) => p.id === id); n += 1) id = `${base}-${n}`;
    // Created while viewing a non-default language → a locale-only placeholder; else the
    // default-language owner that fans out to every locale below.
    const localeOnly = multilingual && currentLocale !== defaultLocale;
    const placeholder: Page = {
      id,
      path: '', // routing-transparent: no slug, no emitted route
      title: name,
      kind: 'link',
      link: { ...(target ? { target } : {}), ...(phNewTab ? { newTab: true } : {}) },
      nav: { slots: phSlots, ...(phDropdown ? { dropdown: true } : {}) },
      parent: localeOnly ? localeHomeId(currentLocale) : homeId,
      ...(localeOnly ? { locale: currentLocale } : {}),
    };
    try {
      await api.putPage(project.id, placeholder);
    } catch (err) {
      setPhError(err instanceof Error ? err.message : 'failed to create placeholder');
      return;
    }
    setPhName('');
    setPhTarget('');
    setPhNewTab(false);
    setPhSlots(['header']);
    setPhDropdown(false);
    setPhOpen(false);
    // Fan a default-language placeholder out to every other locale (so it shows in each language's nav).
    if (multilingual && !localeOnly) {
      try {
        await api.translatePage(project.id, id);
      } catch (err) {
        await load();
        setError(`“${name}” was created but could not be added to every language (${err instanceof Error ? err.message : 'error'}).`);
        return;
      }
    }
    await load();
  }

  /** Renders the SAVED page via /preview and opens the sandboxed document in a new tab. */
  async function previewInTab(p: Page) {
    // Open synchronously (popup blockers require a user-gesture window), then navigate.
    // No 'noopener': it would null the handle we need for the deferred navigation, and
    // the preview document is served under `CSP: sandbox` (opaque origin) — its scripts
    // cannot reach `window.opener` across that origin boundary anyway.
    const win = window.open('', '_blank');
    try {
      const { token } = await api.preview(project.id, p);
      if (win) win.location = previewDocUrl(project.slug, token);
    } catch (err) {
      win?.close();
      setError(err instanceof Error ? err.message : 'preview failed');
    }
  }

  /** Opens the page-settings modal (persist-on-save) with the template list loaded. */
  async function openSettings(p: Page) {
    try {
      setTemplates((await api.listTemplates(project.id)).items);
    } catch {
      setTemplates([]); // globals still show
    }
    setSettingsFor(p);
  }

  async function saveSettings(values: PageSettingsValues) {
    if (!settingsFor) return;
    setSettingsSaving(true);
    setError(null);
    try {
      await api.putPage(project.id, applyPageSettings(settingsFor, values));
      setSettingsFor(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save settings');
    } finally {
      setSettingsSaving(false);
    }
  }

  /** Duplicates a page under a fresh path/id (short random suffix). */
  async function copyPage(p: Page) {
    setError(null);
    const rand = Math.random().toString(36).slice(2, 6);
    const copy: Page = {
      ...p,
      id: `${p.id}-${rand}`,
      // Slug-only suffix (the home copy gets a real slug — it can't be the empty root).
      path: p.path === '' ? `home-${rand}` : `${p.path}-${rand}`,
      title: `${p.title} (Copy)`,
      // A copy is its own page, not a translation sibling.
      translationGroup: undefined,
      // The copy is never the home page, so it must have a parent — keep the original's,
      // falling back to HOME (the tree root).
      parent: p.parent ?? homeId,
    };
    try {
      await api.putPage(project.id, copy);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to copy page');
    }
  }

  /** The non-default locales a default-language page is still missing a variant for (gates the action). */
  function missingLocalesFor(primary: Page): string[] {
    const group = primary.translationGroup ?? primary.id;
    const inGroup = pages.filter((p) => p.translationGroup === group || p.id === primary.id);
    const present = new Set(inGroup.map((p) => p.locale ?? defaultLocale));
    return locales.filter((l) => l !== defaultLocale && !present.has(l));
  }

  /** Add a translation target: the server appends the locale + scaffolds a variant of every
   *  default-language page into it (inherit-mode). Jumps the list to the new language after. */
  async function addLocale(locale: string) {
    setAddLocaleError(null);
    setAddLocaleBusy(true);
    try {
      await api.addLocale(project.id, locale);
      setLocales((prev) => (prev.includes(locale) ? prev : [...prev, locale]));
      setAddLocaleOpen(false);
      setCurrentLocale(locale);
      await load();
    } catch (err) {
      setAddLocaleError(err instanceof Error ? err.message : 'failed to add translation');
    } finally {
      setAddLocaleBusy(false);
    }
  }

  /** Make a default-language page available in every language it's still missing (inherit variants). */
  async function translatePage(p: Page) {
    setError(null);
    try {
      await api.translatePage(project.id, p.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to translate page');
    }
  }

  /**
   * Promotes a page's source into a reusable project TEMPLATE and converts the page to
   * reference it. Its inherit-mode locale variants follow automatically (they resolve the
   * owner's template), so only the page itself is converted. No-op once templated.
   */
  async function saveAsTemplate(p: Page) {
    if (!p.source || p.template) return;
    setError(null);
    const tplId = `${p.id}-template`;
    try {
      await api.putTemplate(project.id, { id: tplId, name: `${p.title} layout`, source: p.source });
      await api.putPage(project.id, { ...p, template: tplId, source: undefined });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save as template');
    }
  }

  /**
   * Deletes a page. The root home is permanent; a locale home is removed by removing its
   * whole language (Website Settings). Deleting a MAIN-language page that has translations
   * cascades the variants that FOLLOW its code (forked/template variants are kept) — a clear
   * warning lists them; deleting any other page removes just that one.
   */
  async function removePage(p: Page) {
    if (p.path === '' && !isLinkPage(p)) return; // the root home is permanent (a slugless link IS deletable)
    const homeGroup = pages.find((x) => x.id === homeId)?.translationGroup ?? homeId;
    const isLocaleHome = localeOf(p, defaultLocale) !== defaultLocale && (p.translationGroup ?? p.id) === homeGroup;
    if (isLocaleHome) {
      setError('To remove a language, use Website Settings → Localization.');
      return;
    }
    setError(null);
    const group = p.translationGroup;
    const inGroup = group ? pages.filter((x) => x.translationGroup === group) : [];
    const isOwner = localeOf(p, defaultLocale) === defaultLocale && inGroup.length > 1;
    if (isOwner) {
      const followers = inGroup.filter((x) => x.id !== p.id && !x.source && !x.template);
      const kept = inGroup.filter((x) => x.id !== p.id && (x.source || x.template));
      const labels = (xs: Page[]) => xs.map((x) => localeLabel(x.locale ?? defaultLocale)).join(', ');
      const parts = [`"${p.title}" is the main-language page.`];
      parts.push(
        followers.length
          ? `Deleting it also removes the ${followers.length} translation${followers.length > 1 ? 's' : ''} that follow its layout (${labels(followers)}).`
          : 'It has no translations that follow its layout.',
      );
      if (kept.length) parts.push(`Translations with their own code are kept (${labels(kept)}).`);
      if (!(await confirm({ title: 'Delete across languages', message: parts.join(' '), confirmLabel: 'Delete' }))) return;
      try {
        await api.deletePageGroup(project.id, p.id);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to delete page');
      }
      return;
    }
    if (
      !(await confirm({
        title: 'Delete page',
        message: `Delete page "${p.title}" (${fullPath(p)})? This cannot be undone.`,
        confirmLabel: 'Delete',
      }))
    )
      return;
    try {
      await api.deletePage(project.id, p.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to delete page');
    }
  }

  const closeEditor = async () => {
    setEditing(null);
    await load();
  };

  return (
    <>
    {/* `inert` while the editor modal is open: everything behind the blurred backdrop is
        unfocusable/unclickable (belt-and-suspenders beyond the modal's focus trap). The
        empty-string spread is the React 18 idiom for this boolean HTML attribute. */}
    {/* Owners get the left Library rail (a fixed 44px strip); pad the content so it
        never sits under the collapsed rail. */}
    <main {...(editing ? ({ inert: '' } as object) : {})} className={`mx-auto max-w-5xl px-6 py-8${isClient ? '' : ' pl-14'}`}>
      {dialog}
      {/* The project name, tablist, and Publish control now live in the App header bar. */}
      {isClient ? (
        <ClientPagesList pages={pages} onOpen={setEditing} />
      ) : tab === 'corporate-identity' || tab === 'website-settings' ? (
        // ONE SettingsView instance across both settings tabs (section is a prop, not a remount),
        // so switching Corporate Identity ↔ Website Settings preserves the in-progress form.
        <SettingsView
          key={project.id}
          project={project}
          section={tab === 'corporate-identity' ? 'identity' : 'website'}
          onLocalesChanged={() => void onLocalesChangedInSettings()}
        />
      ) : tab === 'forms' ? (
        // Submissions are folded in per-form (each row's "Show submissions").
        <FormsManager key={project.id} project={project} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {/* Language switcher — the list shows one language at a time. Hidden until a
                  second language exists (a single-language project needs no switcher). */}
              {multilingual && (
                <div role="tablist" aria-label="Language" className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
                  {locales.map((loc) => (
                    <button
                      key={loc}
                      type="button"
                      role="tab"
                      aria-selected={loc === currentLocale}
                      title={`${localeLabel(loc)}${loc === defaultLocale ? ' (main language)' : ''}`}
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-medium transition ${
                        loc === currentLocale ? gradientSurface : `text-slate-500 ${gradientHover}`
                      }`}
                      onClick={() => setCurrentLocale(loc)}
                    >
                      <span aria-hidden>{localeFlag(loc)}</span>
                      <span className="uppercase">{loc}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-white"
                onClick={() => {
                  setAddLocaleError(null);
                  setAddLocaleOpen(true);
                }}
              >
                + Add translation
              </button>
              <button
                type="button"
                className={ghostButton}
                onClick={() => {
                  setPhError(null);
                  setPhName('');
                  setPhTarget('');
                  setPhNewTab(false);
                  setPhSlots(['header']);
                  setPhDropdown(false);
                  setPhOpen(true);
                }}
                title="A menu item with no page of its own — links somewhere or groups child pages in a dropdown"
              >
                + New Placeholder
              </button>
              <button
                type="button"
                className={primaryButton}
                onClick={() => {
                  setAddError(null);
                  setNewPageScope('all');
                  setAddOpen(true);
                }}
              >
                + New page
              </button>
            </div>
          </div>
          <ul className="mb-8 flex flex-col gap-2">
            {orderedPages.map(({ page: p, depth }, i) => {
              // A locale home (the root of a language's subtree) is treated like the root home:
              // home icon, not draggable, not deletable (remove the language in Website Settings).
              const isHome = isHomeLike(p);
              // A navigation placeholder (kind:'link'): no page/code/route — the row opens Settings
              // (not the code editor), shows its link target, and hides the page-only actions.
              const isLink = isLinkPage(p);
              // Indent sub-pages per the page tree — a left margin shrinks the card so nested
              // rows sit inside their parent (capped so deep trees stay readable).
              const indent = depth > 0 ? { marginLeft: `${Math.min(depth, 6) * 1.5}rem` } : undefined;
              // Where a dragged page would land — a thin line drawn in the row's OWN gutter (not a
              // layout-shifting gap), so the geometry under the pointer never changes mid-drag (the
              // gap approach re-triggered dragover and flickered).
              const dropping = drop && drop.id === p.id;
              return (
                  <li
                    key={p.id}
                    style={{ ...indent, animationDelay: `${Math.min(i, 24) * 35}ms` }}
                    // Only non-Home pages reorder (Home is pinned first). The whole row is the
                    // drag source; the grip is the visible affordance + keyboard entry point.
                    draggable={!isHome}
                    onDragStart={(e) => {
                      if (isHome) return;
                      setDragId(p.id);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', p.id);
                    }}
                    onDragOver={(e) => {
                      if (!dragId || !canReorder(pages, dragId, p.id, defaultLocale)) return;
                      e.preventDefault(); // mark this row a valid drop target
                      const r = e.currentTarget.getBoundingClientRect();
                      const pos = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
                      setDrop((d) => (d && d.id === p.id && d.pos === pos ? d : { id: p.id, pos }));
                    }}
                    onDragLeave={(e) => {
                      // Clear this row's gap only when the pointer leaves the row entirely (not
                      // when crossing onto a child element), so the indicator never lingers.
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                        setDrop((d) => (d?.id === p.id ? null : d));
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragId && drop) void persistReorder(dragId, drop.id, drop.pos);
                      setDragId(null);
                      setDrop(null);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setDrop(null);
                    }}
                    className={`sw-stack-in group relative flex items-center gap-1 ${glassCard} px-3 py-2 transition ${gradientHover} ${dragId === p.id ? 'opacity-40' : ''}`}
                  >
                  {dropping && (
                    <span
                      aria-hidden
                      className={`pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded-full bg-indigo-500 ${
                        drop.pos === 'before' ? '-top-1' : '-bottom-1'
                      }`}
                    />
                  )}
                  {!isHome && (
                    <Tooltip tip="Drag to reorder — or focus and use ↑/↓" side="right">
                    <button
                      type="button"
                      aria-label={`Reorder ${p.title}`}
                      className="waves-effect inline-flex shrink-0 cursor-grab items-center justify-center rounded-lg p-1.5 text-slate-300 transition group-hover:[&:not(:hover)]:text-white/80 hover:bg-white hover:text-slate-600 active:cursor-grabbing"
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          moveByKey(p, 'up');
                        } else if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          moveByKey(p, 'down');
                        }
                      }}
                    >
                      {GRIP_ICON}
                    </button>
                    </Tooltip>
                  )}
                  <button
                    className="waves-effect flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1 text-left"
                    onClick={() => (isLink ? void openSettings(p) : setEditing(p))}
                  >
                    <span
                      aria-hidden
                      className={`${isLink ? 'text-violet-500' : isHome ? 'text-indigo-500' : 'text-slate-400'} group-hover:text-white`}
                      title={isLink ? 'Navigation placeholder' : isHome ? 'Home page' : 'Page'}
                    >
                      {isLink ? LINK_ICON : isHome ? HOME_ICON : PAGE_ICON}
                    </span>
                    <span className="truncate font-medium">{isLink ? <PlaceholderLabel name={p.title} /> : p.title}</span>
                    <span className="truncate text-sm text-slate-400 group-hover:text-white/90">
                      {isLink ? p.link?.target || '— (dropdown)' : fullPath(p)}
                    </span>
                    {isLink && (
                      <span className="rounded-full bg-violet-100/80 px-2 py-0.5 text-[11px] font-medium text-violet-700 group-hover:bg-white/25 group-hover:text-white">placeholder</span>
                    )}
                    {p.status === 'draft' && (
                      <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[11px] font-medium text-slate-600 group-hover:bg-white/25 group-hover:text-white">draft</span>
                    )}
                    {p.template && (
                      <span className="rounded-full bg-indigo-100/80 px-2 py-0.5 text-[11px] font-medium text-indigo-700 group-hover:bg-white/25 group-hover:text-white">template</span>
                    )}
                    {/* Code-mode badge for a translated page: it follows the main language's
                        layout ("inherited") or carries its own forked code ("custom code"); a
                        template page already shows the "template" chip above. */}
                    {multilingual && p.locale && !isLink && !p.source && !p.template && (
                      <span title="Layout inherited from the main language" className="rounded-full bg-emerald-100/80 px-2 py-0.5 text-[11px] font-medium text-emerald-700 group-hover:bg-white/25 group-hover:text-white">
                        inherited
                      </span>
                    )}
                    {multilingual && p.locale && !isLink && p.source && (
                      <span title="This language has its own forked code" className="rounded-full bg-amber-100/80 px-2 py-0.5 text-[11px] font-medium text-amber-700 group-hover:bg-white/25 group-hover:text-white">
                        custom code
                      </span>
                    )}
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {/* Preview + code editor are page-only — a link placeholder renders nothing. */}
                    {!isLink && (
                      <>
                        <Tooltip tip="Preview in a new tab" side="top">
                          <button aria-label={`Preview ${p.title}`} className={ROW_ACTION} onClick={() => void previewInTab(p)}>
                            {PREVIEW_ICON}
                          </button>
                        </Tooltip>
                        <Tooltip tip="Open page editor" side="top">
                          <button aria-label={`Edit ${p.title}`} className={ROW_ACTION} onClick={() => setEditing(p)}>
                            {EDIT_ICON}
                          </button>
                        </Tooltip>
                      </>
                    )}
                    <Tooltip tip={isLink ? 'Edit placeholder settings' : 'Edit page settings'} side="top">
                      <button aria-label={`Settings for ${p.title}`} className={ROW_ACTION} onClick={() => void openSettings(p)}>
                        {GEAR_ICON}
                      </button>
                    </Tooltip>
                    {/* "Make available in all languages" — only on a MAIN-language page (default
                        locale view) that's still missing at least one configured language. It fans
                        the page out as inherit-mode variants; once present in every language the
                        action disappears. (Adding a whole new language is the top "Add translation".) */}
                    {currentLocale === defaultLocale && !p.locale && !isLink && missingLocalesFor(p).length > 0 && (
                      <Tooltip tip="Make this page available in all languages" side="top">
                        <button aria-label={`Translate ${p.title} into all languages`} className={ROW_ACTION} onClick={() => void translatePage(p)}>
                          {GLOBE_ICON}
                        </button>
                      </Tooltip>
                    )}
                    {/* "Save as template" — promote a page's own code into a reusable
                        template shared by its locale siblings. Hidden once templated. */}
                    {p.source && !p.template && (
                      <Tooltip tip="Promote this page's code to a reusable template" side="top">
                        <button aria-label={`Save ${p.title} as template`} className={ROW_ACTION} onClick={() => void saveAsTemplate(p)}>
                          {TEMPLATE_ICON}
                        </button>
                      </Tooltip>
                    )}
                    {!isLink && (
                      <Tooltip tip="Copy page" side="top">
                        <button aria-label={`Copy ${p.title}`} className={ROW_ACTION} onClick={() => void copyPage(p)}>
                          {COPY_ICON}
                        </button>
                      </Tooltip>
                    )}
                    {!isHome && (
                      <Tooltip tip="Delete page" side="top">
                        <button
                          aria-label={`Delete ${p.title}`}
                          className={`${ROW_ACTION} hover:bg-rose-50 hover:text-rose-600`}
                          onClick={() => void removePage(p)}
                        >
                          {TRASH_ICON}
                        </button>
                      </Tooltip>
                    )}
                  </div>
                  </li>
              );
            })}
            {pages.length === 0 && <li className="text-sm text-slate-400">No pages yet.</li>}
          </ul>
          {/* Announces a completed reorder to assistive tech (the list re-sort is otherwise silent). */}
          <div role="status" aria-live="polite" className="sr-only">
            {reorderMsg}
          </div>

          {/* List-level errors (reorder/delete) — the add-page error lives inside its own modal. */}
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          {phOpen && (
            <Modal title="New Placeholder" size="md" onClose={() => { setPhOpen(false); setPhError(null); }}>
              <form onSubmit={createPlaceholder} className="flex flex-col gap-4 p-5">
                <div className="flex flex-col">
                  <label className={fieldLabel}>Name (menu label)</label>
                  <input
                    aria-label="Placeholder name"
                    className={glassInput}
                    value={phName}
                    onChange={(e) => setPhName(e.target.value)}
                    placeholder="Services"
                    autoFocus
                    required
                  />
                  <span className="mt-1 text-[11px] text-slate-400">
                    Shown in the menu. Supports basic HTML + <code>{'{{sw-icon "name"}}'}</code> / <code>{'{{sw-flag "de"}}'}</code>.
                  </span>
                </div>
                <div className="flex flex-col">
                  <label className={fieldLabel}>Link target</label>
                  <input
                    aria-label="Link target"
                    list="sw-ph-targets"
                    className={`font-mono ${glassInput}`}
                    value={phTarget}
                    onChange={(e) => setPhTarget(e.target.value)}
                    placeholder="/about, https://…, mailto:…, #section, #dialog-id"
                  />
                  <datalist id="sw-ph-targets">
                    {pages.filter((p) => !isLinkPage(p) && !p.collection).map((p) => (
                      <option key={p.id} value={fullPath(p)}>{p.title}</option>
                    ))}
                  </datalist>
                  <span className="mt-1 text-[11px] text-slate-400">
                    Internal <code>/path</code>, external <code>https://</code>/<code>mailto:</code>/<code>tel:</code>, a same-page <code>#section</code>, or a <code>#dialog-id</code> (opens that modal). Leave empty for a dropdown-only parent.
                  </span>
                  <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" className={toggleInput} aria-label="Open in new tab" checked={phNewTab} onChange={(e) => setPhNewTab(e.target.checked)} />
                    Open in a new tab
                  </label>
                </div>
                <fieldset className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3">
                  <legend className="px-1 text-xs font-medium uppercase tracking-wide text-slate-400">Show in</legend>
                  <div className="flex flex-wrap gap-4">
                    {NAV_SLOTS.map((slot) => (
                      <label key={slot} className="flex items-center gap-1.5 text-sm capitalize">
                        <input
                          type="checkbox"
                          className={toggleInput}
                          aria-label={`Menu: ${slot}`}
                          checked={phSlots.includes(slot)}
                          onChange={(e) => setPhSlots((s) => (e.target.checked ? [...s, slot] : s.filter((x) => x !== slot)))}
                        />
                        {slot}
                      </label>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" className={toggleInput} aria-label="Dropdown of child pages" checked={phDropdown} onChange={(e) => setPhDropdown(e.target.checked)} />
                    Dropdown of child pages
                  </label>
                </fieldset>
                {phError && <p className="text-sm text-red-600">{phError}</p>}
                <div className="flex justify-end">
                  <button type="submit" className={primaryButton}>Add placeholder</button>
                </div>
              </form>
            </Modal>
          )}
          {addOpen && (
            <Modal
              title="Add page"
              size="md"
              onClose={() => {
                // A fresh form each open: drop any abandoned slug/title + error on close.
                setAddOpen(false);
                setSlug('');
                setTitle('');
                setAddError(null);
              }}
            >
              <form onSubmit={create} className="flex flex-col gap-4 p-5">
                <div className="flex flex-col">
                  <label className={fieldLabel}>Page slug</label>
                  <input
                    aria-label="Page path"
                    className={glassInput}
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="about"
                    title="One slug segment (no slashes) — it nests under Home; the URL is built from the page tree."
                    autoFocus
                    required
                  />
                </div>
                <div className="flex flex-col">
                  <label className={fieldLabel}>Title</label>
                  <input
                    aria-label="Page title"
                    className={glassInput}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                </div>
                {/* When the site is multilingual, a new page is either available in EVERY
                    language (one main-language owner + inherit variants) or ONLY the language
                    you're viewing (a standalone locale-only page). */}
                {multilingual && (
                  <fieldset className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3">
                    <legend className="px-1 text-xs font-medium uppercase tracking-wide text-slate-400">Available in</legend>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="radio" name="page-scope" className="mt-0.5" checked={newPageScope === 'all'} onChange={() => setNewPageScope('all')} />
                      <span>
                        <span className="font-medium">All languages</span>
                        <span className="block text-xs text-slate-500">One main-language page; every other language follows its layout.</span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="radio" name="page-scope" className="mt-0.5" checked={newPageScope === 'current'} onChange={() => setNewPageScope('current')} />
                      <span>
                        <span className="font-medium">Only {localeFlag(currentLocale)} {localeLabel(currentLocale)}</span>
                        <span className="block text-xs text-slate-500">A page that exists only in this language.</span>
                      </span>
                    </label>
                  </fieldset>
                )}
                {addError && <p className="text-sm text-red-600">{addError}</p>}
                <div className="flex justify-end">
                  <button type="submit" className={primaryButton}>
                    Add page
                  </button>
                </div>
              </form>
            </Modal>
          )}
          {addLocaleOpen && (
            <LocalePickerModal
              title="Add a translation target"
              description="Pick a language to translate the site into. Every existing page is duplicated into it, following the main language's layout — you then translate the text."
              actionLabel="Add language"
              exclude={locales}
              busy={addLocaleBusy}
              error={addLocaleError}
              onPick={(locale) => void addLocale(locale)}
              onClose={() => {
                if (addLocaleBusy) return;
                setAddLocaleOpen(false);
                setAddLocaleError(null);
              }}
            />
          )}
        </>
      )}
      {/* The page editor: a near-fullscreen modal portalled over this list (blurred
          backdrop) — Esc/× returns here. BOTH edit modes live inside it; it opens in the
          Content Editor (the live preview) for everyone, and the in-modal toggle switches
          to the Code Editor losslessly. */}
      {editing && (
        <CodePageEditor
          key={editing.id} // React-enforced remount per page — drafts can never bleed across pages
          project={project}
          page={editing}
          pages={pages}
          locales={locales}
          onClose={() => void closeEditor()}
          initialMode="content"
        />
      )}
      {/* Page settings opened FROM THE LIST: persist-on-save (the editor's own settings
          modal applies to its draft instead). */}
      {settingsFor && (
        <PageSettingsModal
          page={settingsFor}
          projectId={project.id}
          initial={pageSettingsFromPage(settingsFor)}
          pages={pages}
          templates={templates}
          locales={locales}
          saving={settingsSaving}
          onClose={() => setSettingsFor(null)}
          onSubmit={(values) => void saveSettings(values)}
        />
      )}
    </main>
    </>
  );
}

interface ClientPagesListProps {
  pages: Page[];
  onOpen: (page: Page) => void;
}

/** The client's read-only list of pages — pick one to open the restricted editor. */
function ClientPagesList({ pages, onOpen }: ClientPagesListProps) {
  const byId = pagesById(pages);
  return (
    <>
      <p className="mb-3 text-sm text-slate-500">Choose a page to edit its content.</p>
      <ul className="flex flex-col gap-2">
        {pages.map((p, i) => (
          <li key={p.id} className="sw-stack-in" style={{ animationDelay: `${Math.min(i, 24) * 35}ms` }}>
            <button
              className={`w-full ${glassCard} px-4 py-3 text-left transition hover:bg-white/80`}
              onClick={() => onOpen(p)}
            >
              <span className="font-medium">{p.title}</span>{' '}
              <span className="text-sm text-slate-400">{pagePath(p, byId)}</span>
            </button>
          </li>
        ))}
        {pages.length === 0 && <li className="text-sm text-slate-400">No pages to edit yet.</li>}
      </ul>
    </>
  );
}
