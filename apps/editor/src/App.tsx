import { useEffect, useState } from 'react';
import { api, type Project } from './api';
import { Login } from './views/Login';
import { ProjectView, MANAGE_TABS, TAB_LABELS, type Tab } from './views/Project';
import { AssetsPanel } from './views/files/AssetsPanel';
import { LibraryPanel } from './views/library/LibraryPanel';
import { SnippetsPanel, TemplatesPanel } from './views/code/CodeRailPanels';
import { DataPanel } from './views/datasets/DataPanel';
import { PublishBar } from './views/PublishBar';
import { PublishDeployModal } from './views/publish/PublishDeployModal';
import { HeaderSettingsMenu } from './views/HeaderSettingsMenu';
import { SettingsModalHost, type SettingsView } from './views/SettingsModalHost';
import { UserMenu } from './views/UserMenu';
import { ProjectSelectorModal } from './views/ProjectSelectorModal';
import { NewProjectModal } from './views/NewProjectModal';
import { AcceptInvite } from './views/AcceptInvite';
import { LivePreview } from './views/LivePreview';
import { UpdateBanner } from './views/UpdateBanner';
import { BrandMark } from './views/ui/BrandMark';
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
  | { name: 'project'; project: Project };

function MainApp({ inviteToken: initialInviteToken }: { inviteToken: string | null }) {
  const [stage, setStage] = useState<Stage>({ name: 'loading' });
  const [inviteToken, setInviteToken] = useState<string | null>(initialInviteToken);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isInstanceAdmin, setIsInstanceAdmin] = useState(false);
  // The signed-in user's email (from /me), surfaced in the header user menu. The user-menu modal is
  // toggled by the person icon next to the settings gear.
  const [email, setEmail] = useState('');
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('pages');
  // The project picker is shown automatically on first load and reachable from the header.
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  // The Publish & Deploy Options modal (header overflow); `publishRefresh` bumps PublishBar so its
  // preview-token link stays current after the options are saved.
  const [publishModalTab, setPublishModalTab] = useState<'publish' | 'deploy' | null>(null);
  const [publishRefresh, setPublishRefresh] = useState(0);
  // The header gear menu's settings surfaces (System Settings / Clients / Team / Access), each a modal.
  const [settingsView, setSettingsView] = useState<SettingsView | null>(null);

  async function signOut() {
    try {
      await api.logout();
    } catch {
      // best-effort; always return to the auth screen
    }
    setIsInstanceAdmin(false);
    setEmail('');
    setTotpEnabled(false);
    setStage({ name: 'auth' });
  }

  async function refresh(): Promise<Project[]> {
    try {
      const me = await api.me();
      setProjects(me.projects);
      setIsInstanceAdmin(me.isInstanceAdmin);
      setEmail(me.email);
      setTotpEnabled(me.totpEnabled);
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
    setSettingsView(null); // close any open settings modal so it can't outlive its project
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
    <header className="sticky top-0 z-20 border-b border-white/40 bg-white/60 px-6 py-3 shadow-sm backdrop-blur-xl">
      {/* Full-width flex row: project selector at the far left, the tablist centered via its own
          mx-auto, and the publish/admin nav at the far right. */}
      <div className="flex w-full items-center gap-x-4">
      {/* Left: the brand mark (opens the selector) + the project selector. */}
      <div className="flex min-w-0 items-center gap-3">
        <button
          className="flex shrink-0 items-center text-slate-900 transition hover:text-indigo-700"
          onClick={() => setSelectorOpen(true)}
          aria-label="Sitewright — switch project"
          title="Switch project"
        >
          <BrandMark />
        </button>
        {inProject && (
          <button
            aria-label="Switch project"
            className="flex min-w-0 items-center gap-1 rounded-xl border border-white/60 bg-white/50 px-2.5 py-1 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-white"
            onClick={() => setSelectorOpen(true)}
          >
            <span className="truncate">{inProject.name}</span>
            <span className="shrink-0 text-slate-400">/{inProject.slug}</span>
            <svg aria-hidden viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m6 9 6 6 6-6" /></svg>
          </button>
        )}
      </div>

      {/* Center: the project tablist (owners only) — mx-auto centers it between the left/right groups. */}
      <div className="mx-auto flex justify-center">
        {inProject && !isClient && (
          <div role="tablist" aria-label="Project sections" className="flex flex-wrap justify-center gap-1 rounded-2xl border border-white/50 bg-white/50 p-1 shadow-sm">
            {MANAGE_TABS.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`waves-effect rounded-xl px-3 py-1.5 text-sm transition ${
                  tab === t ? 'bg-white font-bold text-slate-900 shadow-md shadow-slate-900/5' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {/* eslint-disable-next-line security/detect-object-injection -- t is a typed Tab literal */}
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right: the publish control (owners) + the unified settings gear menu, far right. */}
      <nav className="flex items-center justify-end gap-3">
        {inProject && !isClient && (
          <PublishBar
            project={inProject}
            onOpenDeploy={() => setPublishModalTab('deploy')}
            refreshSignal={publishRefresh}
          />
        )}
        {/* The gear menu unifies Publish & Deploy Options, System Settings, Clients/Team/Access,
            and Sign out. Always present when signed in (so Sign out + System Settings never vanish
            with no project open); each item is gated to its valid context inside the menu. */}
        <HeaderSettingsMenu
          inProject={!!inProject}
          isClient={isClient}
          isInstanceAdmin={isInstanceAdmin}
          onPublishDeploy={() => setPublishModalTab('publish')}
          onSystemSettings={() => setSettingsView('system')}
          onClients={() => setSettingsView('clients')}
          onTeam={() => setSettingsView('team')}
          onSignOut={() => void signOut()}
        />
        {/* The user/account menu — account email, password, access keys, and security (MFA). Sits
            immediately to the right of the settings gear. */}
        <button
          type="button"
          aria-label="Account"
          title="Account"
          onClick={() => setUserMenuOpen(true)}
          className="waves-effect rounded-md p-1.5 text-slate-500 transition hover:bg-white/70 hover:text-slate-900"
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21v-1a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7v1" />
          </svg>
        </button>
      </nav>
      </div>
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
      {inProject && !isClient && publishModalTab && (
        <PublishDeployModal
          project={inProject}
          initialTab={publishModalTab}
          onClose={() => setPublishModalTab(null)}
          onSaved={() => setPublishRefresh((n) => n + 1)}
        />
      )}
      {/* System Settings / Clients / Team — opened (as modals) from the header gear menu. */}
      {settingsView && (
        <SettingsModalHost view={settingsView} project={inProject} onClose={() => setSettingsView(null)} />
      )}
      {/* The user/account menu (person icon) — account email, password, access keys, security. */}
      {userMenuOpen && (
        <UserMenu
          email={email}
          project={inProject}
          totpEnabled={totpEnabled}
          onClose={() => setUserMenuOpen(false)}
          onEmailChanged={setEmail}
          onMfaChanged={() => void refresh()}
        />
      )}
      {/* Always-present edge side-panels (owners): System Library (left), File Manager (right), and
          the bottom rails — Datasets (left), Snippets (center), Templates (right). They render above
          modals so their tabs stay reachable; each opens on hover/click of its own edge tab. */}
      {inProject && !isClient && (
        <>
          <LibraryPanel />
          <AssetsPanel key={inProject.id} projectId={inProject.id} />
          <DataPanel key={`dt-${inProject.id}`} project={inProject} />
          <SnippetsPanel key={`sn-${inProject.id}`} projectId={inProject.id} isAdmin={isInstanceAdmin} />
          <TemplatesPanel key={`tp-${inProject.id}`} projectId={inProject.id} isAdmin={isInstanceAdmin} />
        </>
      )}
    </div>
  );
}
