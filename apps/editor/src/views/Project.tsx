import { useEffect, useState, type FormEvent } from 'react';
import type { Page } from '@sitewright/schema';
import { api, type Org, type Project } from '../api';
import { CodePageEditor } from './CodePageEditor';
import { ClientSourceEditor } from './ClientSourceEditor';
import { DatasetManager } from './DatasetManager';
import { MediaManager } from './MediaManager';
import { ApiKeysManager } from './ApiKeysManager';
import { FormsManager } from './FormsManager';
import { SubmissionsInbox } from './SubmissionsInbox';
import { SettingsView } from './settings/SettingsView';
import { TeamManager } from './TeamManager';
import { ClientsManager } from './ClientsManager';
import { PublishBar } from './PublishBar';

interface ProjectViewProps {
  org: Org;
  project: Project;
  onBack: () => void;
}

// The constrained client role only ever sees the pages list + the restricted editor.
const MANAGE_TABS = ['pages', 'data', 'media', 'forms', 'inbox', 'settings', 'clients', 'team', 'access'] as const;
type Tab = (typeof MANAGE_TABS)[number];

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

export function ProjectView({ org, project, onBack }: ProjectViewProps) {
  // Owner/admin get the full studio; a `member` is a client with a restricted surface.
  const isClient = org.role === 'member';
  const [pages, setPages] = useState<Page[]>([]);
  const [editing, setEditing] = useState<Page | null>(null);
  const [tab, setTab] = useState<Tab>('pages');
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api.listPages(org.id, project.id);
      setPages(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load pages');
    }
  }

  useEffect(() => {
    void load();
  }, [org.id, project.id]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const page: Page = {
      id: slug,
      path: slug === 'home' || slug === 'index' ? '/' : `/${slug}`,
      title,
      // Every page is code-first: it carries a Handlebars `source` (the block tree is retired).
      // `root` stays a valid placeholder so the unified page model is satisfied.
      root: { id: 'root', type: 'Section', children: [] },
      source: CODE_PAGE_STARTER,
    };
    try {
      await api.putPage(org.id, project.id, page);
      setSlug('');
      setTitle('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create page');
    }
  }

  if (editing) {
    const onClose = async () => {
      setEditing(null);
      await load();
    };
    // Code-first is the only authoring model: a client edits the page's bound `{{edit}}`
    // regions; an owner edits the Handlebars source. (A legacy block page — no `source` —
    // opens with an empty editor; its `root` keeps publishing until source is authored.)
    return isClient ? (
      <ClientSourceEditor org={org} project={project} page={editing} onClose={onClose} />
    ) : (
      <CodePageEditor org={org} project={project} page={editing} onClose={onClose} />
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <button
        aria-label="Back to projects"
        className="mb-4 text-sm text-slate-500 hover:text-slate-900"
        onClick={onBack}
      >
        ← Projects
      </button>
      <h2 className="mb-4 text-xl font-semibold">
        {project.name} <span className="text-sm text-slate-400">/{project.slug}</span>
      </h2>
      {/* Publishing is an owner/admin action; clients only edit content. */}
      {!isClient && <PublishBar org={org} project={project} />}

      {/* Clients see no tab bar — just their editable pages. */}
      {!isClient && (
        <div className="mb-6 flex gap-1 border-b border-slate-200">
          {MANAGE_TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm capitalize ${
                tab === t
                  ? 'border-slate-900 font-semibold text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {isClient ? (
        <ClientPagesList pages={pages} onOpen={setEditing} />
      ) : tab === 'data' ? (
        <DatasetManager org={org} project={project} />
      ) : tab === 'media' ? (
        <MediaManager org={org} project={project} />
      ) : tab === 'forms' ? (
        <FormsManager key={`${org.id}/${project.id}`} org={org} project={project} />
      ) : tab === 'inbox' ? (
        <SubmissionsInbox key={`${org.id}/${project.id}`} org={org} project={project} />
      ) : tab === 'settings' ? (
        <SettingsView key={`${org.id}/${project.id}`} org={org} project={project} />
      ) : tab === 'clients' ? (
        <ClientsManager key={`${org.id}/${project.id}`} org={org} project={project} />
      ) : tab === 'team' ? (
        <TeamManager key={org.id} org={org} />
      ) : tab === 'access' ? (
        // Remount on project/org switch → all state (incl. the one-time token banner) resets.
        <ApiKeysManager key={`${org.id}/${project.id}`} org={org} project={project} />
      ) : (
        <>
          <ul className="mb-8 flex flex-col gap-2">
            {pages.map((p) => (
              <li key={p.id}>
                <button
                  className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-left hover:border-slate-400"
                  onClick={() => setEditing(p)}
                >
                  <span className="font-medium">{p.title}</span>{' '}
                  <span className="text-sm text-slate-400">{p.path}</span>
                  {p.status === 'draft' && (
                    <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">draft</span>
                  )}
                </button>
              </li>
            ))}
            {pages.length === 0 && <li className="text-sm text-slate-400">No pages yet.</li>}
          </ul>

          <form onSubmit={create} className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-col">
              <label className="text-xs text-slate-500">Page slug (id)</label>
              <input
                aria-label="Page slug"
                className="rounded-md border border-slate-300 px-3 py-2"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="home"
                required
              />
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-slate-500">Title</label>
              <input
                aria-label="Page title"
                className="rounded-md border border-slate-300 px-3 py-2"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 font-semibold text-white">
              Add page
            </button>
          </form>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </>
      )}
    </main>
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
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-left hover:border-slate-400"
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
