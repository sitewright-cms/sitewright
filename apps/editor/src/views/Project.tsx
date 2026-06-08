import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Page, Template } from '@sitewright/schema';
import { pagePath, pagesById } from '@sitewright/core';
import { api, previewDocUrl, type Project } from '../api';
import { CodePageEditor } from './CodePageEditor';
import { PageSettingsModal, applyPageSettings, pageSettingsFromPage, type PageSettingsValues } from './PageSettingsModal';
import { useDialogs } from './ui/Dialogs';
import { Modal } from './ui/Modal';
import { FormsManager } from './FormsManager';
import { SettingsView } from './settings/SettingsView';
import { AdminView } from './AdminView';
import { glassCard, glassInput, fieldLabel, primaryButton, gradientHover } from '../theme';
import { orderPagesByTree, canReorder, reorderWithinParent, orderedSiblings } from './pages-order';

interface ProjectViewProps {
  project: Project;
  /** The active top-level tab (lifted to App so the tablist can live in the header bar). */
  tab: Tab;
}

// The owner's top-level tabs. Settings is lifted into the two leading tabs (Corporate Identity /
// Website Settings); Clients/Team/Access are grouped under Admin; the submissions Inbox is folded
// into Forms. The constrained client role sees none of these — just the pages list + restricted editor.
export const MANAGE_TABS = [
  'corporate-identity',
  'website-settings',
  'pages',
  'forms',
  'admin',
] as const;
export type Tab = (typeof MANAGE_TABS)[number];
export const TAB_LABELS: Record<Tab, string> = {
  'corporate-identity': 'Corporate Identity',
  'website-settings': 'Website Settings',
  pages: 'Pages',
  forms: 'Forms',
  admin: 'Admin',
};

// A new code page opens with a small, valid Handlebars + Tailwind scaffold so the live
// preview is immediately meaningful: it demonstrates the {{ company.* }} bindings AND an
// {{edit "key" "default"}} region — the marker that makes a piece of text client-editable
// (the re-targeted client model), so a freshly created page already has something a client
// can edit without the developer wiring anything up.
const CODE_PAGE_STARTER = `<main class="mx-auto max-w-3xl px-6 py-16">
  <h1 class="text-4xl font-bold tracking-tight text-slate-900">{{ company.name }}</h1>
  <p class="mt-4 text-lg text-slate-600">{{edit "tagline" "Edit this tagline"}}</p>
</main>
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
  // Pages in page-tree order (parents followed by their children) with a depth for
  // indenting sub-pages in the list.
  const orderedPages = useMemo(() => orderPagesByTree(pages, defaultLocale), [pages, defaultLocale]);
  // The HOME page (empty slug = the tree root) is the default parent for every other
  // page; "no parent" isn't offered for non-home pages.
  const homeId = pages.find((p) => p.path === '')?.id ?? 'home';
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

  useEffect(() => {
    void load();
    void api
      .getSettings(project.id)
      .then((res) => {
        const s = res.item?.settings;
        if (!s?.locales?.length) return;
        // Keep the project's default locale first → `locales[0]` is the default
        // everywhere (Project actions + PageSettingsModal's "Default (…)" label).
        const ordered = [s.defaultLocale, ...s.locales.filter((l) => l !== s.defaultLocale)];
        setLocales(ordered);
      })
      .catch(() => {
        /* settings may not exist yet → single default locale */
      });
  }, [project.id]);

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
    // The id derives from the slug; refuse to clobber an existing page (notably the
    // reserved "home" root, whose id is "home").
    if (pages.some((p) => p.id === seg)) {
      setAddError(seg === 'home' ? '"home" is reserved for the site root — pick another slug.' : `A page "${seg}" already exists.`);
      return;
    }
    const page: Page = {
      id: seg,
      path: seg,
      title,
      // A new page defaults to HOME as its parent (home is the tree root); its full route is
      // computed as `/<…parents>/<slug>`.
      parent: homeId,
      // Every page is code-first: it carries a Handlebars `source` (the block tree is retired).
      // `root` stays a valid placeholder so the unified page model is satisfied.
      root: { id: 'root', type: 'Section', children: [] },
      source: CODE_PAGE_STARTER,
    };
    try {
      await api.putPage(project.id, page);
      setSlug('');
      setTitle('');
      setAddOpen(false);
      await load();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'failed to create page');
    }
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
      if (win) win.location = previewDocUrl(project.id, token);
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

  /** The non-default locales a page is still missing a translation for (drives the action + its gating). */
  function missingLocalesFor(primary: Page): string[] {
    const group = primary.translationGroup ?? primary.id;
    const inGroup = pages.filter((p) => p.translationGroup === group || p.id === primary.id);
    const present = new Set(inGroup.map((p) => p.locale ?? defaultLocale));
    return locales.filter((l) => l !== defaultLocale && !present.has(l));
  }

  /**
   * Creates the missing locale variants of a page (copy-as-translation): each variant is a
   * Page sharing the translation group + the SAME slug, parented under that LOCALE'S HOME
   * (the translated root home) when it exists — so its computed route is `/<locale>/…`. If
   * the locale home doesn't exist yet, the variant lands under the root home and we warn to
   * translate the home first. Translating the home page itself CREATES the locale home
   * (slug = the locale code, parent = the root home).
   */
  async function addTranslations(primary: Page) {
    setError(null);
    const group = primary.translationGroup ?? primary.id;
    const missing = missingLocalesFor(primary);
    if (missing.length === 0) return;
    const rootHome = pages.find((p) => p.id === homeId);
    const isRootHome = primary.path === '' || primary.id === homeId;
    const noLocaleHome: string[] = [];
    try {
      const ops: Promise<unknown>[] = [];
      // Tie the primary into the group (its locale stays the default).
      if (!primary.translationGroup) ops.push(api.putPage(project.id, { ...primary, translationGroup: group }));
      for (const loc of missing) {
        // The home's variant IS the locale home → its slug is the locale code, parented to
        // the root home. Other pages keep their slug and nest under the locale home.
        let parent = homeId;
        if (!isRootHome) {
          const localeHome = pages.find(
            (p) => p.locale === loc && !!rootHome?.translationGroup && p.translationGroup === rootHome.translationGroup,
          );
          if (localeHome) parent = localeHome.id;
          else noLocaleHome.push(loc);
        }
        ops.push(
          api.putPage(project.id, {
            ...primary, // inherits template/source + {{edit}} content as the translation start point
            id: `${primary.id}-${loc}`,
            locale: loc,
            translationGroup: group,
            // The locale home's slug is the locale code, lowercased to satisfy the slug schema
            // (locales may be mixed-case like `pt-BR`); other variants keep the primary's slug.
            path: isRootHome ? loc.toLowerCase() : primary.path,
            parent,
          }),
        );
      }
      await Promise.all(ops);
      await load();
      if (noLocaleHome.length > 0) {
        setError(
          `No home page yet for ${noLocaleHome.join(', ')} — these translations were placed under the site root. ` +
            `Use "Add translation" on the Home page first so they nest under /<locale>.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to add translation');
    }
  }

  /**
   * Promotes a page's source into a reusable project TEMPLATE and converts the page
   * (and its locale siblings) to reference it — so all locales share one structure
   * and supply only their own {{edit}} content. No-op for a page that already
   * references a template.
   */
  async function saveAsTemplate(p: Page) {
    if (!p.source || p.template) return;
    setError(null);
    const tplId = `${p.id}-template`;
    const group = p.translationGroup;
    const targets = group ? pages.filter((pg) => pg.translationGroup === group) : [p];
    try {
      await api.putTemplate(project.id, { id: tplId, name: `${p.title} layout`, source: p.source });
      await Promise.all(targets.map((pg) => api.putPage(project.id, { ...pg, template: tplId, source: undefined })));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save as template');
    }
  }

  /** Deletes a page — every page EXCEPT home (the empty-slug root), which is permanent. */
  async function removePage(p: Page) {
    if (p.path === '') return;
    if (
      !(await confirm({
        title: 'Delete page',
        message: `Delete page "${p.title}" (${fullPath(p)})? This cannot be undone.`,
        confirmLabel: 'Delete',
      }))
    )
      return;
    setError(null);
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
        />
      ) : tab === 'forms' ? (
        // Submissions are folded in per-form (each row's "Show submissions").
        <FormsManager key={project.id} project={project} />
      ) : tab === 'admin' ? (
        // Clients · Team · Access, grouped under sub-tabs.
        <AdminView key={project.id} project={project} />
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-500">Pages</h2>
            <button
              type="button"
              className={primaryButton}
              onClick={() => {
                setAddError(null);
                setAddOpen(true);
              }}
            >
              + New page
            </button>
          </div>
          <ul className="mb-8 flex flex-col gap-2">
            {orderedPages.map(({ page: p, depth }) => {
              const isHome = p.path === '';
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
                    style={indent}
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
                    className={`group relative flex items-center gap-1 ${glassCard} px-3 py-2 transition ${gradientHover} ${dragId === p.id ? 'opacity-40' : ''}`}
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
                    <button
                      type="button"
                      aria-label={`Reorder ${p.title}`}
                      title="Drag to reorder — or focus and use ↑/↓"
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
                  )}
                  <button
                    className="waves-effect flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1 text-left"
                    onClick={() => setEditing(p)}
                  >
                    <span aria-hidden className={`${isHome ? 'text-indigo-500' : 'text-slate-400'} group-hover:text-white`} title={isHome ? 'Home page' : 'Page'}>
                      {isHome ? HOME_ICON : PAGE_ICON}
                    </span>
                    <span className="truncate font-medium">{p.title}</span>
                    <span className="truncate text-sm text-slate-400 group-hover:text-white/90">{fullPath(p)}</span>
                    {p.status === 'draft' && (
                      <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[11px] font-medium text-slate-600 group-hover:bg-white/25 group-hover:text-white">draft</span>
                    )}
                    {p.template && (
                      <span className="rounded-full bg-indigo-100/80 px-2 py-0.5 text-[11px] font-medium text-indigo-700 group-hover:bg-white/25 group-hover:text-white">template</span>
                    )}
                    {multilingual && p.locale && (
                      <span className="rounded-full bg-emerald-100/80 px-2 py-0.5 text-[11px] font-semibold uppercase text-emerald-700 group-hover:bg-white/25 group-hover:text-white">
                        {p.locale}
                      </span>
                    )}
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button aria-label={`Preview ${p.title}`} title="Preview in a new tab" className={ROW_ACTION} onClick={() => void previewInTab(p)}>
                      {PREVIEW_ICON}
                    </button>
                    <button aria-label={`Edit ${p.title}`} title="Open page editor" className={ROW_ACTION} onClick={() => setEditing(p)}>
                      {EDIT_ICON}
                    </button>
                    <button aria-label={`Settings for ${p.title}`} title="Edit page settings" className={ROW_ACTION} onClick={() => void openSettings(p)}>
                      {GEAR_ICON}
                    </button>
                    {/* i18n actions — only for default-locale pages in a multilingual project
                        that are STILL MISSING at least one language variant. "Add translation"
                        fans out the missing locales; once all exist (or on a variant page), the
                        action disappears (you manage translations from the primary). */}
                    {multilingual && !p.locale && missingLocalesFor(p).length > 0 && (
                      <button
                        aria-label={`Add translations for ${p.title}`}
                        title="Create the missing language variants"
                        className={ROW_ACTION}
                        onClick={() => void addTranslations(p)}
                      >
                        {GLOBE_ICON}
                      </button>
                    )}
                    {/* "Save as template" — promote a page's own code into a reusable
                        template shared by its locale siblings. Hidden once templated. */}
                    {p.source && !p.template && (
                      <button
                        aria-label={`Save ${p.title} as template`}
                        title="Promote this page's code to a reusable template"
                        className={ROW_ACTION}
                        onClick={() => void saveAsTemplate(p)}
                      >
                        {TEMPLATE_ICON}
                      </button>
                    )}
                    <button aria-label={`Copy ${p.title}`} title="Copy page" className={ROW_ACTION} onClick={() => void copyPage(p)}>
                      {COPY_ICON}
                    </button>
                    {!isHome && (
                      <button
                        aria-label={`Delete ${p.title}`}
                        title="Delete page"
                        className={`${ROW_ACTION} hover:bg-rose-50 hover:text-rose-600`}
                        onClick={() => void removePage(p)}
                      >
                        {TRASH_ICON}
                      </button>
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
                {addError && <p className="text-sm text-red-600">{addError}</p>}
                <div className="flex justify-end">
                  <button type="submit" className={primaryButton}>
                    Add page
                  </button>
                </div>
              </form>
            </Modal>
          )}
        </>
      )}
      {/* The page editor: a near-fullscreen modal portalled over this list (blurred
          backdrop) — Esc/× returns here. BOTH edit modes live inside it; the initial
          mode is a role-based UI default (owners → source, clients → content), and
          the in-modal toggle switches losslessly. */}
      {editing && (
        <CodePageEditor
          key={editing.id} // React-enforced remount per page — drafts can never bleed across pages
          project={project}
          page={editing}
          pages={pages}
          locales={locales}
          onClose={() => void closeEditor()}
          initialMode={isClient ? 'content' : 'source'}
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
        {pages.map((p) => (
          <li key={p.id}>
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
