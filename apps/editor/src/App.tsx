import { useEffect, useState } from 'react';
import { api, type Project } from './api';
import { Login } from './views/Login';
import { ProjectView, MANAGE_TABS, TAB_LABELS, type Tab } from './views/Project';
import { FileManager } from './views/files/FileManager';
import { PublishBar } from './views/PublishBar';
import { ProjectSelectorModal } from './views/ProjectSelectorModal';
import { NewProjectModal } from './views/NewProjectModal';
import { AcceptInvite } from './views/AcceptInvite';
import { InstanceSettings } from './views/InstanceSettings';
import { LivePreview } from './views/LivePreview';
import { UpdateBanner } from './views/UpdateBanner';
import { parseLiveTarget } from './lib/live-target';
import { SkeletonList } from './views/ui/Skeleton';
import { installRipple } from './lib/ripple';

/**
 * Routes to the standalone pop-out live preview when the URL carries `?live=…`;
 * otherwise the normal editor app. Branching here (not inside MainApp) keeps each
 * view's hooks unconditional.
 */
export function App() {
  const liveTarget = parseLiveTarget(window.location.search);
  if (liveTarget) return <LivePreview target={liveTarget} />;
  const inviteToken = new URLSearchParams(window.location.search).get('invite');
  return <MainApp inviteToken={inviteToken} />;
}

type Stage =
  | { name: 'loading' }
  | { name: 'auth' }
  | { name: 'home' } // no project open — the selector is shown over a quiet backdrop
  | { name: 'admin' }
  | { name: 'project'; project: Project };

function MainApp({ inviteToken: initialInviteToken }: { inviteToken: string | null }) {
  const [stage, setStage] = useState<Stage>({ name: 'loading' });
  const [inviteToken, setInviteToken] = useState<string | null>(initialInviteToken);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isInstanceAdmin, setIsInstanceAdmin] = useState(false);
  const [tab, setTab] = useState<Tab>('pages');
  // The project picker is shown automatically on first load and reachable from the header.
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  // The Assets file-manager drawer (replaces the old Assets tab).
  const [assetsOpen, setAssetsOpen] = useState(false);

  async function refresh(): Promise<Project[]> {
    try {
      const me = await api.me();
      setProjects(me.projects);
      setIsInstanceAdmin(me.isInstanceAdmin);
      // First successful load with no project open → show the selector automatically.
      setStage((s) => (s.name === 'project' ? s : { name: 'home' }));
      return me.projects;
    } catch {
      setStage({ name: 'auth' });
      return [];
    }
  }

  useEffect(() => {
    void refresh().then((ps) => {
      // Open the selector on first SPA load (unless an invite is mid-flow).
      if (!initialInviteToken) setSelectorOpen(true);
      void ps;
    });
  }, []);

  // Delegated ripple ("waves") feedback for every `.waves-effect` element across the admin UI.
  useEffect(() => installRipple(), []);

  function openProject(project: Project) {
    setTab('pages');
    setStage({ name: 'project', project });
    setSelectorOpen(false);
  }

  if (stage.name === 'loading') {
    return <SkeletonList rows={4} className="mx-auto max-w-md p-8" label="Loading the editor…" />;
  }

  // An invite link short-circuits the normal app until accepted or dismissed.
  if (inviteToken) {
    return (
      <AcceptInvite
        token={inviteToken}
        authed={stage.name !== 'auth'}
        onAuthed={() => void refresh()}
        onDone={() => {
          setInviteToken(null);
          window.history.replaceState({}, '', window.location.pathname);
          void refresh().then(() => setSelectorOpen(true));
        }}
      />
    );
  }

  if (stage.name === 'auth') {
    return <Login onAuthed={() => void refresh().then(() => setSelectorOpen(true))} />;
  }

  const inProject = stage.name === 'project' ? stage.project : null;
  const isClient = inProject?.role === 'member';

  const header = (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/40 bg-white/60 px-6 py-3 shadow-sm backdrop-blur-xl">
      {/* Left: brand + (when in a project) the project name, which opens the selector. */}
      <button className="font-bold tracking-tight text-slate-900" onClick={() => setSelectorOpen(true)}>
        Sitewright
      </button>
      {inProject && (
        <button
          aria-label="Switch project"
          className="flex items-center gap-1 rounded-xl border border-white/60 bg-white/50 px-2.5 py-1 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-white"
          onClick={() => setSelectorOpen(true)}
        >
          {inProject.name} <span className="text-slate-400">/{inProject.slug}</span>
          <svg aria-hidden viewBox="0 0 24 24" className="h-3.5 w-3.5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      )}

      {/* Center: the project tablist (owners only), in the header bar. */}
      {inProject && !isClient && (
        <div role="tablist" aria-label="Project sections" className="flex flex-wrap gap-1 rounded-2xl border border-white/50 bg-white/50 p-1 shadow-sm">
          {MANAGE_TABS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`waves-effect rounded-xl px-3 py-1.5 text-sm transition ${
                tab === t ? 'bg-white font-semibold text-slate-900 shadow-md shadow-slate-900/5' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {/* eslint-disable-next-line security/detect-object-injection -- t is a typed Tab literal */}
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
      )}

      {/* Right: assets + publish (owners) + admin + sign out. */}
      <nav className="ml-auto flex items-center gap-4">
        {inProject && !isClient && (
          <button className="text-sm text-slate-500 hover:text-slate-900" onClick={() => setAssetsOpen(true)}>
            Assets
          </button>
        )}
        {inProject && !isClient && <PublishBar project={inProject} />}
        {isInstanceAdmin && stage.name !== 'admin' && (
          <button className="text-sm text-slate-500 hover:text-slate-900" onClick={() => setStage({ name: 'admin' })}>
            Admin
          </button>
        )}
        <button
          className="text-sm text-slate-500 hover:text-slate-900"
          onClick={async () => {
            try {
              await api.logout();
            } catch {
              // best-effort; always return to the auth screen
            }
            setIsInstanceAdmin(false);
            setStage({ name: 'auth' });
          }}
        >
          Sign out
        </button>
      </nav>
    </header>
  );

  return (
    <div className="relative min-h-screen">
      {/* Soft blurred accent blobs over the gradient shell (decorative, behind content). */}
      <div aria-hidden className="pointer-events-none fixed -right-32 -top-32 -z-10 h-96 w-96 rounded-full bg-fuchsia-300/20 blur-3xl" />
      <div aria-hidden className="pointer-events-none fixed -bottom-32 -left-32 -z-10 h-96 w-96 rounded-full bg-sky-300/20 blur-3xl" />
      <UpdateBanner />
      {header}
      {stage.name === 'home' && (
        <main className="mx-auto max-w-3xl px-6 py-16 text-center text-slate-400">
          <p>Pick a project to get started.</p>
          <button className="mt-3 text-sm text-indigo-600 hover:underline" onClick={() => setSelectorOpen(true)}>
            Open the project selector
          </button>
        </main>
      )}
      {stage.name === 'admin' && <InstanceSettings />}
      {stage.name === 'project' && <ProjectView key={stage.project.id} project={stage.project} tab={tab} />}

      {selectorOpen && (
        <ProjectSelectorModal
          projects={projects}
          currentId={inProject?.id}
          onClose={() => setSelectorOpen(false)}
          onOpen={openProject}
          onNew={() => {
            setSelectorOpen(false);
            setNewProjectOpen(true);
          }}
        />
      )}
      {newProjectOpen && (
        <NewProjectModal
          onClose={() => setNewProjectOpen(false)}
          onCreated={(project) => {
            setNewProjectOpen(false);
            // Re-resolve the list (so the selector is current) and open the new project.
            void refresh();
            setProjects((prev) => (prev.some((p) => p.id === project.id) ? prev : [...prev, project]));
            openProject(project);
          }}
        />
      )}
      {assetsOpen && inProject && <FileManager key={inProject.id} projectId={inProject.id} onClose={() => setAssetsOpen(false)} />}
    </div>
  );
}
