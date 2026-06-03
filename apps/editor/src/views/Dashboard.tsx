import { useState, type FormEvent } from 'react';
import { api, type Project } from '../api';

interface DashboardProps {
  projects: Project[];
  onOpen: (project: Project) => void;
  /** Called after a project is created so the app can re-resolve the project list. */
  onProjectsChanged: () => void | Promise<void>;
}

export function Dashboard({ projects, onOpen, onProjectsChanged }: DashboardProps) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createProject(name, slug);
      setName('');
      setSlug('');
      await onProjectsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create project');
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h2 className="mb-4 text-xl font-semibold">Your sites</h2>

      <ul className="mb-8 flex flex-col gap-2">
        {projects.map((p) => (
          <li key={p.id}>
            <button
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-left hover:border-indigo-400"
              onClick={() => onOpen(p)}
            >
              <span className="font-medium">{p.name}</span>{' '}
              <span className="text-sm text-slate-400">/{p.slug}</span>
            </button>
          </li>
        ))}
        {projects.length === 0 && <li className="text-sm text-slate-400">No projects yet.</li>}
      </ul>

      <form onSubmit={create} className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-col">
          <label className="text-xs text-slate-500">Project name</label>
          <input
            aria-label="Project name"
            className="rounded-md border border-slate-300 px-3 py-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-slate-500">Slug</label>
          <input
            aria-label="Project slug"
            className="rounded-md border border-slate-300 px-3 py-2"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="my-client"
            required
          />
        </div>
        <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 font-semibold text-white">
          Create project
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </main>
  );
}
