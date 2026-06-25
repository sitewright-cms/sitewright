import { useEffect, useRef, useState } from 'react';
import { api, setUnauthorizedHandler, type Project } from './api';
import { useSessionPoll } from './lib/use-session-poll';
import { useBranding } from './lib/use-branding';
import { Login } from './views/Login';
import { ForcePasswordChange } from './views/ForcePasswordChange';
import { ProjectView, MANAGE_TABS, TAB_LABELS, type Tab } from './views/Project';
import { AssetsPanel } from './views/files/AssetsPanel';
import { LibraryPanel } from './views/library/LibraryPanel';
import { SnippetsPanel, TemplatesPanel } from './views/code/CodeRailPanels';
import { WidgetsPanel } from './views/widgets/WidgetsPanel';
import { DataPanel } from './views/datasets/DataPanel';
import { PublishBar } from './views/PublishBar';
import { PublishDeployModal } from './views/publish/PublishDeployModal';
import { HeaderSettingsMenu } from './views/HeaderSettingsMenu';
import { UserDropdown } from './views/UserDropdown';
import { SettingsModalHost, type SettingsView } from './views/SettingsModalHost';
import { UserMenu } from './views/UserMenu';
import { ProjectSelectorModal } from './views/ProjectSelectorModal';
import { NewProjectModal } from './views/NewProjectModal';
import { ImportWebsiteModal } from './views/ImportWebsiteModal';
import { AcceptInvite } from './views/AcceptInvite';
import { LivePreview } from './views/LivePreview';
import { SitePreview } from './views/SitePreview';
import { UpdateBanner } from './views/UpdateBanner';
import { BrandLogo } from './views/ui/BrandLogo';
import { parseLiveTarget } from './lib/live-target';
import { parsePreviewTarget } from './lib/preview-target';
import { gradientSurface, gradientHover } from './theme';
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
  const previewTarget = parsePreviewTarget(window.location.search);
  if (previewTarget) return <SitePreview target={previewTarget} />;
  const params = new URLSearchParams(window.location.search);
  return (
    <MainApp
      inviteToken={params.get('invite')}
      oidcError={params.get('oidc_error')}
      mfaTicket={params.get('mfa_ticket')}
    />
  );
}

// OIDC callback error codes → user-facing copy. A Map (not an object index) so an attacker-supplied
// URL code can't reach a prototype member; an unknown code falls through to the generic message.
const OIDC_ERROR_MESSAGES = new Map<string, string>([
  ['not_provisioned', 'Your account isn’t set up yet — ask an admin for an invite.'],
  ['email_unverified', 'Your identity provider didn’t confirm a verified email address.'],
  ['verification_failed', 'We couldn’t verify that sign-in. Please try again.'],
  ['invalid_state', 'Your sign-in request expired. Please try again.'],
  ['unknown_provider', 'That sign-in provider isn’t available.'],
  ['provider_unavailable', 'That sign-in provider is temporarily unavailable.'],
  ['sign_in_failed', 'Sign-in failed. Please try again.'],
]);

type Stage =
  | { name: 'loading' }
  // `expired` is set when an authenticated session was force-ended by a 401 (vs. a normal sign-out),
  // so the login screen can explain why the user is back here.
  | { name: 'auth'; expired?: boolean }
  | { name: 'home' } // no project open — the selector is shown over a quiet backdrop
  | { name: 'project'; project: Project };

function MainApp({
  inviteToken: initialInviteToken,
  oidcError,
  mfaTicket,
}: {
  inviteToken: string | null;
  oidcError: string | null;
  mfaTicket: string | null;
}) {
  const [stage, setStage] = useState<Stage>({ name: 'loading' });
  // Mirror of `stage` for the (effect-registered, render-stable) unauthorized handler to read the
  // CURRENT stage without re-registering on every change.
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const [inviteToken, setInviteToken] = useState<string | null>(initialInviteToken);
  // OIDC callback artifacts (captured once); the notice maps the error code to friendly copy.
  const oidcNotice = oidcError ? OIDC_ERROR_MESSAGES.get(oidcError) ?? 'Sign-in failed. Please try again.' : null;
  const [projects, setProjects] = useState<Project[]>([]);
  const [isInstanceAdmin, setIsInstanceAdmin] = useState(false);
  // The signed-in user's email (from /me), surfaced in the header user menu. The user-menu modal is
  // toggled by the person icon next to the settings gear.
  const [email, setEmail] = useState('');
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [recoveryCodesRemaining, setRecoveryCodesRemaining] = useState(0);
  const [hasPassword, setHasPassword] = useState(true);
  // Set when the signed-in user still has the seeded default password; gates the whole app behind a
  // forced "set a new password" screen until they change it (the server enforces this independently).
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('pages');
  // The project picker is shown automatically on first load and reachable from the header.
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  // After a new project is created, either open its editor ('open') or open the import wizard ('import').
  const [newProjectIntent, setNewProjectIntent] = useState<'open' | 'import'>('open');
  // The project the import wizard targets (existing project or a freshly-created one), if open.
  const [importFor, setImportFor] = useState<Project | null>(null);
  // Bumped after an import so an already-open project re-mounts and refetches its new content.
  const [projectNonce, setProjectNonce] = useState(0);
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
    setRecoveryCodesRemaining(0);
    setMustChangePassword(false);
    setStage({ name: 'auth' });
  }

  async function refresh(): Promise<Project[]> {
    try {
      const me = await api.me();
      setProjects(me.projects);
      setIsInstanceAdmin(me.isInstanceAdmin);
      setEmail(me.email);
      setTotpEnabled(me.totpEnabled);
      setRecoveryCodesRemaining(me.recoveryCodesRemaining);
      setHasPassword(me.hasPassword);
      setMustChangePassword(me.mustChangePassword);
      // First successful load with no project open → show the selector automatically.
      setStage((s) => (s.name === 'project' ? s : { name: 'home' }));
      return me.projects;
    } catch {
      setStage({ name: 'auth' });
      return [];
    }
  }

  // Session expiry: any API 401 means the login token is no longer valid. Drop an AUTHENTICATED user
  // back to the login screen (with a notice) and clear their identity. While on loading/auth we do
  // nothing — the bootstrap `/me` 401 is handled by `refresh()`, and the login flow surfaces its own
  // 401s (wrong password / MFA), so forcing a redirect there would wipe the user's in-progress entry.
  // The handler reads the CURRENT stage via `stageRef`, so it stays correct without re-registration.
  // MainApp is the app-lifetime root shell (App renders it once, never unmounts it), so we register
  // the global handler for good rather than tearing it down on a transient StrictMode remount — a
  // cleanup that nulled it would leave a window with no handler; re-registration just replaces it.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      const current = stageRef.current.name;
      if (current !== 'home' && current !== 'project') return;
      setIsInstanceAdmin(false);
      setEmail('');
      setTotpEnabled(false);
      setRecoveryCodesRemaining(0);
      setStage({ name: 'auth', expired: true });
    });
  }, []);

  // Proactively detect an EXPIRED/revoked session for an idle user: while signed in, probe `/me` on
  // an interval (pausing on a hidden tab, re-probing on refocus). A 401 from the probe trips the
  // unauthorized handler above → login; success/other errors are ignored (it's a liveness check, not
  // a data refresh). Without this, an idle user only finds out at their next action.
  useSessionPoll(stage.name === 'home' || stage.name === 'project', () => {
    void api.me().catch(() => {});
  });

  // Admin-panel branding (white-label): applies the brand gradient/title/favicon to the chrome and
  // returns the name + logo for the wordmark/header/selector. Defaults render until /auth/config loads.
  const branding = useBranding();

  useEffect(() => {
    void refresh().then((ps) => {
      // Open the selector on first SPA load (unless an invite is mid-flow).
      if (!initialInviteToken) setSelectorOpen(true);
      void ps;
    });
  }, []);

  // Delegated ripple ("waves") feedback for every `.waves-effect` element across the admin UI.
  useEffect(() => installRipple(), []);

  // Strip the OIDC callback artifacts from the URL once captured, so a refresh doesn't resubmit
  // them and the ticket doesn't linger in history.
  useEffect(() => {
    if (!oidcError && !mfaTicket) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('oidc_error');
    url.searchParams.delete('mfa_ticket');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  }, []);

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
        branding={branding}
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
    // A forced logout (expired session) explains itself; otherwise show any OIDC callback notice.
    const notice = stage.expired ? 'Your session expired — please sign in again.' : oidcNotice;
    return <Login onAuthed={() => void refresh().then(() => setSelectorOpen(true))} initialMfaTicket={mfaTicket} initialNotice={notice} branding={branding} />;
  }

  // A signed-in user on the seeded default password can't reach the editor until they change it. The
  // server independently 403s every write with a `password-change-required` sentinel, so this is the UX
  // half of a hard gate, not just a nag. Changing the password re-fetches `/me` (the flag clears).
  if (mustChangePassword) {
    return (
      <ForcePasswordChange
        email={email}
        branding={branding}
        onDone={() => void refresh()}
        onSignOut={() => void signOut()}
      />
    );
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
          aria-label={`${branding.name} — switch project`}
          title="Switch project"
        >
          <BrandLogo logoUrl={branding.logoUrl} name={branding.name} />
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

      {/* Center: the project tablist (any project member — clients get the full studio too) — mx-auto centers it. */}
      <div className="mx-auto flex justify-center">
        {inProject && (
          <div role="tablist" aria-label="Project sections" className="flex flex-wrap justify-center gap-1 rounded-2xl border border-white/50 bg-white/50 p-1 shadow-sm">
            {MANAGE_TABS.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`waves-effect rounded-xl px-3 py-1.5 text-sm font-medium transition ${
                  tab === t ? gradientSurface : `text-slate-500 ${gradientHover}`
                }`}
              >
                {/* eslint-disable-next-line security/detect-object-injection -- t is a typed Tab literal */}
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right: the publish control (any project member) + the unified settings gear menu, far right. */}
      <nav className="flex items-center justify-end gap-3">
        {inProject && (
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
          onImportWebsite={inProject && !isClient ? () => setImportFor(inProject) : undefined}
          onSystemSettings={() => setSettingsView('system')}
          onClients={() => setSettingsView('clients')}
          onTeam={() => setSettingsView('team')}
        />
        {/* The user/account menu (person icon → dropdown): "Account Settings" opens the tabbed account
            modal (email, password, access keys, security/MFA); "Logout" signs out (relocated here from
            the settings gear). Sits immediately to the right of the settings gear. */}
        <UserDropdown onAccountSettings={() => setUserMenuOpen(true)} onSignOut={() => void signOut()} />
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
      {stage.name === 'project' && <ProjectView key={`${stage.project.id}:${projectNonce}`} project={stage.project} tab={tab} />}

      {selectorOpen && (
        <ProjectSelectorModal
          projects={projects}
          currentId={inProject?.id}
          branding={branding}
          onClose={() => setSelectorOpen(false)}
          onOpen={openProject}
          onNew={() => {
            setSelectorOpen(false);
            setNewProjectIntent('open');
            setNewProjectOpen(true);
          }}
          onNewFromWebsite={() => {
            setSelectorOpen(false);
            setNewProjectIntent('import');
            setNewProjectOpen(true);
          }}
        />
      )}
      {newProjectOpen && (
        <NewProjectModal
          onClose={() => setNewProjectOpen(false)}
          onCreated={(project) => {
            setNewProjectOpen(false);
            // Re-resolve the list (so the selector is current) and either open the project or import into it.
            void refresh();
            setProjects((prev) => (prev.some((p) => p.id === project.id) ? prev : [...prev, project]));
            if (newProjectIntent === 'import') setImportFor(project);
            else openProject(project);
          }}
        />
      )}
      {importFor && (
        <ImportWebsiteModal
          projectId={importFor.id}
          projectName={importFor.name}
          onClose={() => setImportFor(null)}
          onImported={() => {
            const target = importFor;
            setImportFor(null);
            void refresh();
            setProjectNonce((n) => n + 1); // force the project view to refetch the imported content
            openProject(target);
          }}
        />
      )}
      {inProject && publishModalTab && (
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
          recoveryCodesRemaining={recoveryCodesRemaining}
          hasPassword={hasPassword}
          onClose={() => setUserMenuOpen(false)}
          onEmailChanged={setEmail}
          onMfaChanged={() => void refresh()}
          onPasswordChanged={() => void refresh()}
        />
      )}
      {/* Always-present edge side-panels (any project member): System Library (left), File Manager
          (right), and the bottom rails — Datasets (left), the paired Snippets + Widgets (center),
          Templates (right). They render above modals so their tabs stay reachable; each opens on
          hover/click of its own edge tab. */}
      {inProject && (
        <>
          <LibraryPanel />
          <AssetsPanel key={inProject.id} projectId={inProject.id} />
          <DataPanel key={`dt-${inProject.id}`} project={inProject} />
          <SnippetsPanel key={`sn-${inProject.id}`} projectId={inProject.id} isAdmin={isInstanceAdmin} />
          <WidgetsPanel key={`wg-${inProject.id}`} projectId={inProject.id} />
          <TemplatesPanel key={`tp-${inProject.id}`} projectId={inProject.id} isAdmin={isInstanceAdmin} />
        </>
      )}
    </div>
  );
}
