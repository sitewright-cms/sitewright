import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Page, Template } from '@sitewright/schema';
import { api, previewDocUrl, type Project } from '../api';
import { CodePageEditor } from './CodePageEditor';
import { PageSettingsModal, applyPageSettings, pageSettingsFromPage, type PageSettingsValues } from './PageSettingsModal';
import { useDialogs } from './ui/Dialogs';
import { LibraryPanel } from './library/LibraryPanel';
import { DatasetManager } from './DatasetManager';
import { MediaManager } from './MediaManager';
import { FormsManager } from './FormsManager';
import { SettingsView } from './settings/SettingsView';
import { AdminView } from './AdminView';
import { glassCard, glassInput, fieldLabel, primaryButton } from '../theme';

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
  'media',
  'forms',
  'data',
  'admin',
] as const;
export type Tab = (typeof MANAGE_TABS)[number];
export const TAB_LABELS: Record<Tab, string> = {
  'corporate-identity': 'Corporate Identity',
  'website-settings': 'Website Settings',
  pages: 'Pages',
  media: 'Assets',
  forms: 'Forms',
  data: 'Data',
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

const ROW_ACTION =
  'inline-flex cursor-pointer items-center justify-center rounded-lg p-1.5 text-slate-400 transition hover:bg-white hover:text-slate-900';

export function ProjectView({ project, tab }: ProjectViewProps) {
  const { confirm, dialog } = useDialogs();
  // An owner gets the full studio; a `member` is a client with a content-first default surface.
  const isClient = project.role === 'member';
  const [pages, setPages] = useState<Page[]>([]);
  const [editing, setEditing] = useState<Page | null>(null);
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Settings opened FROM THE LIST (persist-on-save); the editor stacks its own instance.
  const [settingsFor, setSettingsFor] = useState<Page | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [settingsSaving, setSettingsSaving] = useState(false);

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
  }, [project.id]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // The form takes a PAGE PATH ("/about" or "about"); the id derives from it.
    // "home" / "index" / "/" map to the home page (replacing the auto-created one).
    const trimmed = slug.trim().replace(/^\/+/, '').replace(/\/+$/, '');
    const path = trimmed === '' || trimmed === 'home' || trimmed === 'index' ? '/' : `/${trimmed}`;
    const id = path === '/' ? 'home' : trimmed.replace(/\//g, '-');
    const page: Page = {
      id,
      path,
      title,
      // Every page is code-first: it carries a Handlebars `source` (the block tree is retired).
      // `root` stays a valid placeholder so the unified page model is satisfied.
      root: { id: 'root', type: 'Section', children: [] },
      source: CODE_PAGE_STARTER,
    };
    try {
      await api.putPage(project.id, page);
      setSlug('');
      setTitle('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create page');
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
      path: p.path === '/' ? `/home-${rand}` : `${p.path}-${rand}`,
      title: `${p.title} (Copy)`,
    };
    try {
      await api.putPage(project.id, copy);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to copy page');
    }
  }

  /** Deletes a page — every page EXCEPT home (path "/"), which is permanent. */
  async function removePage(p: Page) {
    if (p.path === '/') return;
    if (
      !(await confirm({
        title: 'Delete page',
        message: `Delete page "${p.title}" (${p.path})? This cannot be undone.`,
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
    <main {...(editing ? ({ inert: '' } as object) : {})} className="mx-auto max-w-5xl px-6 py-8">
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
      ) : tab === 'data' ? (
        <DatasetManager project={project} />
      ) : tab === 'media' ? (
        // key resets folder/view state when switching projects (like the sibling managers).
        <MediaManager key={project.id} project={project} />
      ) : tab === 'forms' ? (
        // Submissions are folded in per-form (each row's "Show submissions").
        <FormsManager key={project.id} project={project} />
      ) : tab === 'admin' ? (
        // Clients · Team · Access, grouped under sub-tabs.
        <AdminView key={project.id} project={project} />
      ) : (
        <>
          <ul className="mb-8 flex flex-col gap-2">
            {pages.map((p) => {
              const isHome = p.path === '/';
              return (
                <li key={p.id} className={`flex items-center gap-1 ${glassCard} px-3 py-2 transition hover:bg-white/80`}>
                  <button
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-1 py-1 text-left"
                    onClick={() => setEditing(p)}
                  >
                    <span aria-hidden className={isHome ? 'text-indigo-500' : 'text-slate-400'} title={isHome ? 'Home page' : 'Page'}>
                      {isHome ? HOME_ICON : PAGE_ICON}
                    </span>
                    <span className="truncate font-medium">{p.title}</span>
                    <span className="truncate text-sm text-slate-400">{p.path}</span>
                    {p.status === 'draft' && (
                      <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[11px] font-medium text-slate-600">draft</span>
                    )}
                    {p.template && (
                      <span className="rounded-full bg-indigo-100/80 px-2 py-0.5 text-[11px] font-medium text-indigo-700">template</span>
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

          <form onSubmit={create} className={`flex flex-wrap items-end gap-2 ${glassCard} p-4`}>
            <div className="flex flex-col">
              <label className={fieldLabel}>Page path</label>
              <input
                aria-label="Page path"
                className={glassInput}
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="/about"
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
            <button type="submit" className={primaryButton}>
              Add page
            </button>
          </form>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
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
          onClose={() => void closeEditor()}
          initialMode={isClient ? 'content' : 'source'}
        />
      )}
      {/* Page settings opened FROM THE LIST: persist-on-save (the editor's own settings
          modal applies to its draft instead). */}
      {settingsFor && (
        <PageSettingsModal
          page={settingsFor}
          initial={pageSettingsFromPage(settingsFor)}
          pages={pages}
          templates={templates}
          saving={settingsSaving}
          onClose={() => setSettingsFor(null)}
          onSubmit={(values) => void saveSettings(values)}
        />
      )}
    </main>
    {/* The permanent project-level Library reference (owners/staff only — clients edit
        content, not code). A fixed right-edge drawer, unaffected by the page list inert. */}
    {!isClient && <LibraryPanel />}
    </>
  );
}

interface ClientPagesListProps {
  pages: Page[];
  onOpen: (page: Page) => void;
}

/** The client's read-only list of pages — pick one to open the restricted editor. */
function ClientPagesList({ pages, onOpen }: ClientPagesListProps) {
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
              <span className="text-sm text-slate-400">{p.path}</span>
            </button>
          </li>
        ))}
        {pages.length === 0 && <li className="text-sm text-slate-400">No pages to edit yet.</li>}
      </ul>
    </>
  );
}
