import { useEffect, useState } from 'react';
import { api, type Org, type Project } from './api';
import { Login } from './views/Login';
import { Dashboard } from './views/Dashboard';
import { ProjectView } from './views/Project';
import { UpdateBanner } from './views/UpdateBanner';

type Stage =
  | { name: 'loading' }
  | { name: 'auth' }
  | { name: 'dashboard' }
  | { name: 'project'; org: Org; project: Project };

export function App() {
  const [stage, setStage] = useState<Stage>({ name: 'loading' });
  const [orgs, setOrgs] = useState<Org[]>([]);

  async function refresh(): Promise<void> {
    try {
      const me = await api.me();
      setOrgs(me.orgs);
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

  if (stage.name === 'auth') {
    return <Login onAuthed={() => void refresh()} />;
  }

  const header = (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
      <span className="font-bold tracking-tight">Sitewright</span>
      <button
        className="text-sm text-slate-500 hover:text-slate-900"
        onClick={async () => {
          try {
            await api.logout();
          } catch {
            // best-effort; always return to the auth screen
          }
          setStage({ name: 'auth' });
        }}
      >
        Sign out
      </button>
    </header>
  );

  return (
    <div className="min-h-screen">
      <UpdateBanner />
      {header}
      {stage.name === 'dashboard' && (
        <Dashboard
          orgs={orgs}
          onOpen={(org, project) => setStage({ name: 'project', org, project })}
        />
      )}
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
