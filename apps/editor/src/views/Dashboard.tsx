import { useEffect, useState, type FormEvent } from 'react';
import { api, type Org, type Project, type ProjectAccess } from '../api';

interface DashboardProps {
  orgs: Org[];
  projectAccess: ProjectAccess[];
  onOpen: (org: Org, project: Project) => void;
}

export function Dashboard({ orgs, projectAccess, onOpen }: DashboardProps) {
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? '');
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);

  const org = orgs.find((o) => o.id === orgId);

  async function load(id: string) {
    if (!id) return;
    try {
      const res = await api.projects(id);
      setProjects(res.projects);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load projects');
    }
  }

  // Keep the selected org valid if the orgs prop changes (e.g. after re-login).
  useEffect(() => {
    setOrgId((current) => (orgs.some((o) => o.id === current) ? current : (orgs[0]?.id ?? '')));
  }, [orgs]);

  useEffect(() => {
    void load(orgId);
  }, [orgId]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createProject(orgId, name, slug);
      setName('');
      setSlug('');
      await load(orgId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create project');
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      {/* Sites a client can edit (project-scoped access), shown above any org they own. */}
      {projectAccess.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">Your sites</h2>
          <ul className="flex flex-col gap-2">
            {projectAccess.map((pa) => (
              <li key={pa.projectId}>
                <button
                  className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-left hover:border-indigo-400"
                  onClick={() =>
                    onOpen(
                      { id: pa.orgId, name: pa.orgName, slug: pa.orgSlug, role: pa.role },
                      { id: pa.projectId, name: pa.projectName, slug: pa.projectSlug },
                    )
                  }
                >
                  <span className="font-medium">{pa.projectName}</span>{' '}
                  <span className="text-sm text-slate-400">· {pa.orgName}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {orgs.length === 0 ? (
        projectAccess.length === 0 && <p className="text-sm text-slate-400">No projects yet.</p>
      ) : (
        <>
      {orgs.length > 1 && (
        <select
          aria-label="Organization"
          className="mb-4 rounded-md border border-slate-300 px-3 py-2"
          value={orgId}
          onChange={(e) => setOrgId(e.target.value)}
        >
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
      <h2 className="mb-4 text-xl font-semibold">{org?.name} — Projects</h2>

      <ul className="mb-8 flex flex-col gap-2">
        {projects.map((p) => (
          <li key={p.id}>
            <button
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-left hover:border-slate-400"
              onClick={() => org && onOpen(org, p)}
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
        </>
      )}
    </main>
  );
}
