import { useEffect, useState } from 'react';
import { api, type Project } from './api';
import { Login } from './views/Login';
import { Dashboard } from './views/Dashboard';
import { ProjectView } from './views/Project';
import { AcceptInvite } from './views/AcceptInvite';
import { InstanceSettings } from './views/InstanceSettings';
import { LivePreview } from './views/LivePreview';
import { UpdateBanner } from './views/UpdateBanner';
import { parseLiveTarget } from './lib/live-target';

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
  | { name: 'dashboard' }
  | { name: 'admin' }
  | { name: 'project'; project: Project };

function MainApp({ inviteToken: initialInviteToken }: { inviteToken: string | null }) {
  const [stage, setStage] = useState<Stage>({ name: 'loading' });
  const [inviteToken, setInviteToken] = useState<string | null>(initialInviteToken);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isInstanceAdmin, setIsInstanceAdmin] = useState(false);

  async function refresh(): Promise<void> {
    try {
      const me = await api.me();
      setProjects(me.projects);
      setIsInstanceAdmin(me.isInstanceAdmin);
      setStage({ name: 'dashboard' });
    } catch {
      setStage({ name: 'auth' });
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  if (stage.name === 'loading') {
    return <div className="p-8 text-slate-500">Loading…</div>;
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
          void refresh();
        }}
      />
    );
  }

  if (stage.name === 'auth') {
    return <Login onAuthed={() => void refresh()} />;
  }

  const header = (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/40 bg-white/60 px-6 py-3 shadow-sm backdrop-blur-xl">
      <button className="font-bold tracking-tight text-slate-900" onClick={() => setStage({ name: 'dashboard' })}>
        Sitewright
      </button>
      <nav className="flex items-center gap-4">
        {isInstanceAdmin && stage.name !== 'admin' && (
          <button
            className="text-sm text-slate-500 hover:text-slate-900"
            onClick={() => setStage({ name: 'admin' })}
          >
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
      {stage.name === 'dashboard' && (
        <Dashboard
          projects={projects}
          onOpen={(project) => setStage({ name: 'project', project })}
          onProjectsChanged={() => void refresh()}
        />
      )}
      {stage.name === 'admin' && <InstanceSettings />}
      {stage.name === 'project' && (
        <ProjectView project={stage.project} onBack={() => setStage({ name: 'dashboard' })} />
      )}
    </div>
  );
}
