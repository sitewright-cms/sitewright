import { useEffect, useState, type FormEvent } from 'react';
import type { Page } from '@sitewright/schema';
import { api, type Org, type Project } from '../api';
import { PageEditor } from './PageEditor';
import { DatasetManager } from './DatasetManager';
import { MediaManager } from './MediaManager';
import { ApiKeysManager } from './ApiKeysManager';
import { PublishBar } from './PublishBar';

interface ProjectViewProps {
  org: Org;
  project: Project;
  onBack: () => void;
}

export function ProjectView({ org, project, onBack }: ProjectViewProps) {
  const [pages, setPages] = useState<Page[]>([]);
  const [editing, setEditing] = useState<Page | null>(null);
  const [tab, setTab] = useState<'pages' | 'data' | 'media' | 'access'>('pages');
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
      root: { id: 'root', type: 'Section', children: [] },
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
    return (
      <PageEditor
        org={org}
        project={project}
        page={editing}
        onClose={async () => {
          setEditing(null);
          await load();
        }}
      />
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
      <PublishBar org={org} project={project} />

      <div className="mb-6 flex gap-1 border-b border-slate-200">
        {(['pages', 'data', 'media', 'access'] as const).map((t) => (
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

      {tab === 'data' ? (
        <DatasetManager org={org} project={project} />
      ) : tab === 'media' ? (
        <MediaManager org={org} project={project} />
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
