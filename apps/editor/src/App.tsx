import { useEffect, useState } from 'react';
import { api, type Org, type Project, type ProjectAccess } from './api';
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
  | { name: 'project'; org: Org; project: Project };

function MainApp({ inviteToken: initialInviteToken }: { inviteToken: string | null }) {
  const [stage, setStage] = useState<Stage>({ name: 'loading' });
  const [inviteToken, setInviteToken] = useState<string | null>(initialInviteToken);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [projectAccess, setProjectAccess] = useState<ProjectAccess[]>([]);
  const [isInstanceAdmin, setIsInstanceAdmin] = useState(false);

  async function refresh(): Promise<void> {
    try {
      const me = await api.me();
      setOrgs(me.orgs);
      setProjectAccess(me.projectAccess);
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
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
      <button className="font-bold tracking-tight" onClick={() => setStage({ name: 'dashboard' })}>
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
    <div className="min-h-screen">
      <UpdateBanner />
      {header}
      {stage.name === 'dashboard' && (
        <Dashboard
          orgs={orgs}
          projectAccess={projectAccess}
          onOpen={(org, project) => setStage({ name: 'project', org, project })}
        />
      )}
      {stage.name === 'admin' && <InstanceSettings />}
      {stage.name === 'project' && (
        <ProjectView
          org={stage.org}
          project={stage.project}
          onBack={() => setStage({ name: 'dashboard' })}
        />
      )}
    </div>
  );
}
