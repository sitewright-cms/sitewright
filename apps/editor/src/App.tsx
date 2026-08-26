import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { api, downloadProjectExport, setUnauthorizedHandler, type Project } from './api';
import { useSessionPoll } from './lib/use-session-poll';
import { useBranding } from './lib/use-branding';
import { useIsMobile } from './lib/use-is-mobile';
import { Login } from './views/Login';
import { ForcePasswordChange } from './views/ForcePasswordChange';
import { ProjectView, MANAGE_TABS, TAB_LABELS, TAB_LABELS_SHORT, type Tab } from './views/Project';
import { AssetsPanel } from './views/files/AssetsPanel';
import { LibraryPanel } from './views/library/LibraryPanel';
import { CriticalCssShortcut } from './views/settings/CriticalCssShortcut';
import { SnippetsPanel, TemplatesPanel } from './views/code/CodeRailPanels';
import { WidgetsPanel } from './views/widgets/WidgetsPanel';
import { DataPanel } from './views/datasets/DataPanel';
import { CiPaletteForProject } from './lib/ci-palette';
import { PublishBar } from './views/PublishBar';
import { PublishDeployModal } from './views/publish/PublishDeployModal';
import { HeaderSettingsMenu } from './views/HeaderSettingsMenu';
import { DeleteProjectModal } from './views/DeleteProjectModal';
import { UserDropdown } from './views/UserDropdown';
import { SettingsModalHost, type SettingsView } from './views/SettingsModalHost';
import { UserMenu } from './views/UserMenu';
import { ProjectSelectorModal } from './views/ProjectSelectorModal';
import { NewProjectModal } from './views/NewProjectModal';
import { ImportProjectModal } from './views/ImportProjectModal';
import { DuplicateProjectModal } from './views/DuplicateProjectModal';
import { ProjectSettingsModal } from './views/ProjectSettingsModal';
import { AcceptInvite } from './views/AcceptInvite';
import { LivePreview } from './views/LivePreview';
import { SitePreview } from './views/SitePreview';
import { UpdateBanner } from './views/UpdateBanner';
import { BrandLogo } from './views/ui/BrandLogo';
import { ProjectIcon } from './views/ui/ProjectIcon';
import { parseLiveTarget } from './lib/live-target';
import { parsePreviewTarget } from './lib/preview-target';
import { accentChip, glassCard, gradientSurface, gradientHover, primaryButton } from './theme';
import { SkeletonList } from './views/ui/Skeleton';
import { installRipple } from './lib/ripple';

/**
 * A `?next=` value that is safe to navigate to after signing in.
 *
 * OPEN-REDIRECT GUARD, deliberately an ALLOW-LIST of one: the only flow that hands the SPA a return
 * URL is the OAuth/MCP consent endpoint bouncing an unauthenticated agent authorization through the
 * login. Accepting "any same-origin path" would be broader than anything needs, and a scheme-relative
 * value (`//evil.test`) is same-origin to a naive check but off-site to the browser. So: must start
 * with exactly `/oauth/authorize?`, and nothing else is ever honoured.
 */
export function safeReturnTo(search: string): string | null {
  const next = new URLSearchParams(search).get('next');
  if (!next) return null;
  return /^\/oauth\/authorize\?[^\s]*$/.test(next) ? next : null;
}

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
  // Only AGENCY staff (platform admin/developer) may create projects; invited clients cannot.
  const [canCreateProjects, setCanCreateProjects] = useState(false);
  // The signed-in user's email (from /me), surfaced in the header user menu. The user-menu modal is
  // toggled by the person icon next to the settings gear.
  const [email, setEmail] = useState('');
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [recoveryCodesRemaining, setRecoveryCodesRemaining] = useState(0);
  const [hasPassword, setHasPassword] = useState(true);
  // `SW_SITES_DOMAIN`, when subdomain routing is on — drives the deploy UI's "where will this
  // serve" labels, which otherwise hardcode the /sites/ path form the site only redirects from.
  const [sitesDomain, setSitesDomain] = useState<string | undefined>(undefined);
  // Set when the signed-in user still has the seeded default password; gates the whole app behind a
  // forced "set a new password" screen until they change it (the server enforces this independently).
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  // Phone-sized viewport: the edge rails and other desktop-only chrome are not mounted at all (see
  // the rail block at the end of this component, and lib/use-is-mobile).
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<Tab>('pages');
  // The project picker is shown automatically on first load and reachable from the header.
  const [selectorOpen, setSelectorOpen] = useState(false);
  // The project whose view is mounted-but-still-loading; the selector spins on that row until it lands.
  // Mirrored in a ref so finishOpening can read the CURRENT value without being re-created (it is
  // passed to ProjectView, and a changing identity there would re-trigger its mount load).
  const [openingId, setOpeningId] = useState<string | null>(null);
  const openingRef = useRef<string | null>(null);
  openingRef.current = openingId;
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [importZipOpen, setImportZipOpen] = useState(false);
  // The project the Duplicate modal targets, if open.
  const [duplicateFor, setDuplicateFor] = useState<Project | null>(null);
  const [settingsFor, setSettingsFor] = useState<Project | null>(null);
  // The Publish & Deploy Options modal (header overflow); `publishRefresh` bumps PublishBar so its
  // preview-token link stays current after the options are saved.
  const [publishModalTab, setPublishModalTab] = useState<'publish' | 'deploy' | null>(null);
  const [publishRefresh, setPublishRefresh] = useState(0);
  // The header gear menu's settings surfaces (System Settings / Project Members / Administrators / Access), each a modal.
  const [settingsView, setSettingsView] = useState<SettingsView | null>(null);
  // The owner-only "Delete Project" type-to-confirm modal (the project being deleted, or null).
  const [deleteFor, setDeleteFor] = useState<Project | null>(null);

  async function signOut() {
    try {
      await api.logout();
    } catch {
      // best-effort; always return to the auth screen
    }
    setIsInstanceAdmin(false);
    setCanCreateProjects(false);
    setEmail('');
    setTotpEnabled(false);
    setRecoveryCodesRemaining(0);
    setSitesDomain(undefined);
    setMustChangePassword(false);
    setStage({ name: 'auth' });
  }

  /** Reload the signed-in user. `authed` is reported separately from `projects` because an empty
   *  project list is NOT the same as a missing session — a signed-in developer with no projects
   *  yet returns exactly the same array as a 401 does. Anything that gates on being signed in has
   *  to read the flag. */
  async function refresh(): Promise<{ authed: boolean; projects: Project[] }> {
    try {
      const me = await api.me();
      setProjects(me.projects);
      setIsInstanceAdmin(me.isInstanceAdmin);
      setCanCreateProjects(me.platformRole === 'admin' || me.platformRole === 'developer');
      setEmail(me.email);
      setTotpEnabled(me.totpEnabled);
      setRecoveryCodesRemaining(me.recoveryCodesRemaining);
      setHasPassword(me.hasPassword);
      setSitesDomain(me.sitesDomain);
      setMustChangePassword(me.mustChangePassword);
      // First successful load with no project open → show the selector automatically.
      setStage((s) => (s.name === 'project' ? s : { name: 'home' }));
      return { authed: true, projects: me.projects };
    } catch {
      setStage({ name: 'auth' });
      return { authed: false, projects: [] };
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
      setCanCreateProjects(false);
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
    void refresh().then(({ authed }) => {
      // SIGNED IN with a pending agent-authorization to resume? Hand the browser straight back to the
      // consent page rather than dropping the user on the project selector with no idea what happened.
      // `replace`, not `assign`, so Back does not bounce them through the login again.
      //
      // ★ `authed` is the whole point of this guard. /oauth/authorize bounces an unauthenticated agent
      // here as `/?next=/oauth/authorize?…`; following that link while still signed out just gets
      // bounced straight back, and the two redirects chase each other as fast as the browser can go —
      // a login window reloading in a blur until the rate limiter finally stops it. Signed out, the
      // login screen simply stays up; `next` survives in the URL and the post-login handler resumes it.
      if (authed) {
        const next = safeReturnTo(window.location.search);
        if (next) {
          window.location.replace(next);
          return;
        }
      }
      // Open the selector on first SPA load (unless an invite is mid-flow).
      if (!initialInviteToken) setSelectorOpen(true);
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

  // Opening a project MOUNTS the view (so it starts fetching) but keeps the selector up, spinning on
  // the chosen row, until that view reports its pages/locales/templates have settled. Before this the
  // modal vanished instantly and the author watched an empty editor populate itself.
  function openProject(project: Project) {
    setTab('pages');
    setStage({ name: 'project', project });
    setSettingsView(null); // close any open settings modal so it can't outlive its project
    if (!selectorOpen) return; // opened from somewhere else (new/import/rename) — nothing to hold
    setOpeningId(project.id);
  }

  // Release the selector once the project we are ACTUALLY waiting on has loaded.
  //
  // Scoped by id, not a bare "something finished": picking a second project while the first is still
  // in flight remounts ProjectView, but the first instance's fetches are already running and nothing
  // cancels them. An unscoped callback let that stale resolution close the selector and drop the
  // author into the SECOND project's half-loaded editor — reintroducing the exact empty-editor flash
  // this holds the modal to avoid. Comparing against the live openingId makes a superseded load inert.
  const finishOpening = useCallback((projectId: string) => {
    setOpeningId((current) => (current === projectId ? null : current));
    setSelectorOpen((open) => (openingRef.current === projectId ? false : open));
  }, []);

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
    return (
      <Login
        onAuthed={() =>
          void refresh().then(({ authed }) => {
            // Same guard as the mount effect: only resume the agent-authorization once there is
            // actually a session to authorize with, or the two redirects chase each other.
            const next = authed ? safeReturnTo(window.location.search) : null;
            if (next) window.location.replace(next);
            else setSelectorOpen(true);
          })
        }
        initialMfaTicket={mfaTicket}
        initialNotice={notice}
        branding={branding}
      />
    );
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

  /**
   * The project sections. ONE definition, TWO homes: centred inside the header row on desktop, and on
   * mobile a scrollable strip of its own underneath it (see below) — because at 412px the row already
   * holds the brand, the project pill, Publish and two menus, and five tabs do not fit beside them.
   *
   * `flex-wrap` was how it coped before, and wrapping is the wrong answer for a tablist: the header
   * silently becomes one row or two depending on how long the current labels are, so opening a project
   * or switching language moves every control beneath it. A strip that scrolls keeps the header one
   * fixed height and lets the tabs run off the edge, which is the honest thing for a list that does not
   * fit. Snap points stop a flick leaving a tab half-cut.
   */
  const projectTablist = inProject && (
    <div
      role="tablist"
      aria-label="Project sections"
      className={`flex gap-1 rounded-2xl border border-white/50 bg-white/50 p-1 shadow-sm dark:border-white/10 dark:bg-white/5 ${
        isMobile ? 'mx-auto w-max flex-nowrap snap-x snap-mandatory' : 'flex-wrap justify-center'
      }`}
    >
      {MANAGE_TABS.map((t) => (
        <button
          key={t}
          role="tab"
          aria-selected={tab === t}
          onClick={() => setTab(t)}
          className={`waves-effect shrink-0 snap-start rounded-xl px-3 py-1.5 text-sm font-medium transition ${
            tab === t ? gradientSurface : `text-slate-500 dark:text-slate-400 ${gradientHover}`
          }`}
        >
          {/* eslint-disable-next-line security/detect-object-injection -- t is a typed Tab literal */}
          {(isMobile ? TAB_LABELS_SHORT : TAB_LABELS)[t]}
        </button>
      ))}
    </div>
  );

  const header = (
    <header className={`sticky top-0 z-20 border-b border-white/40 bg-white/60 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60 ${
      isMobile ? 'px-3 py-2' : 'px-6 py-3'
    }`}>
      {/* Full-width flex row: project selector at the far left, the tablist centered via its own
          mx-auto, and the publish/admin nav at the far right. */}
      <div className={`flex w-full items-center ${isMobile ? 'gap-x-2' : 'gap-x-4'}`}>
      {/* Left: the brand mark (opens the selector) + the project selector. When a project is open the mark
          becomes that project's favicon (generic globe fallback); otherwise it's the platform logo. The
          mark is scaled 1.7× — a 22px box paints at 37.4px, overhanging ~7.7px per side; `pr-2` (8px) on
          the button absorbs the right overhang so the selector pill stays clear, and the top/bottom
          overhang sits comfortably inside the header's py-3. Keep that relationship if either value changes. */}
      {/* A FIXED 285px left column, so the tablist that follows starts at the same x on every project
          rather than sliding with the length of the project's name.
          Safe at every width despite being fixed: this is a flex CHILD with `min-w-0`, so 285px is the
          PREFERRED size (flex-basis) and the default `flex-shrink: 1` still lets it give way when the
          row is tight — which is the whole story on a phone, where 285px plus the action nav is more
          than the screen. The project name truncates into whatever it actually gets. */}
      <div className={`flex w-[285px] min-w-0 items-center ${isMobile ? 'gap-1' : 'gap-3'}`}>
        <button
          className={`flex shrink-0 items-center text-slate-900 transition hover:text-indigo-700 dark:text-slate-100 dark:hover:text-indigo-300 ${
            // The mark is scaled 1.7×, so it overhangs its 22px box by ~7.7px per side. On desktop the
            // padding absorbs the RIGHT overhang, keeping the selector pill clear. On a phone the pill
            // sits nearly flush against it (gap-1) and the screen edge is the tighter constraint, so the
            // same allowance moves to the LEFT — the overhang itself then does most of the separating.
            isMobile ? 'pl-2' : 'pr-2'
          }`}
          onClick={() => setSelectorOpen(true)}
          aria-label={inProject ? `${inProject.name} — switch project` : `${branding.name} — switch project`}
          title="Switch project"
        >
          <span className="inline-flex" style={{ scale: '1.7' }}>
            {inProject ? (
              <ProjectIcon
                src={inProject.iconUrl}
                boxClassName="flex h-[22px] w-[22px] items-center justify-center overflow-hidden rounded-[5px]"
              />
            ) : (
              <BrandLogo logoUrl={branding.logoUrl} name={branding.name} />
            )}
          </span>
        </button>
        {inProject && (
          <button
            aria-label="Switch project"
            className="flex min-w-0 items-center gap-1.5 rounded-xl border border-white/60 bg-white/50 px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
            onClick={() => setSelectorOpen(true)}
          >
            <span className="truncate">{inProject.name}</span>
            <svg aria-hidden viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m6 9 6 6 6-6" /></svg>
          </button>
        )}
      </div>

      {/* Center: the project tablist (any project member — clients get the full studio too) — mx-auto
          centers it. On MOBILE it is not in this row at all; see the strip below the row. */}
      {!isMobile && <div className="mx-auto flex justify-center">{projectTablist}</div>}

      {/* Right: the publish control (any project member) + the unified settings gear menu, far right. */}
      <nav className={`ml-auto flex items-center justify-end ${isMobile ? 'gap-1.5' : 'gap-3'}`}>
        {inProject && (
          <PublishBar
            project={inProject}
            sitesDomain={sitesDomain}
            onOpenDeploy={() => setPublishModalTab('deploy')}
            refreshSignal={publishRefresh}
            compact={isMobile}
          />
        )}
        {/* The gear menu unifies Publish & Deploy Options, System Settings, Project Members/Administrators/Access,
            and Sign out. Always present when signed in (so Sign out + System Settings never vanish
            with no project open); each item is gated to its valid context inside the menu. */}
        <HeaderSettingsMenu
          inProject={!!inProject}
          isClient={isClient}
          isInstanceAdmin={isInstanceAdmin}
          onPublishDeploy={() => setPublishModalTab('publish')}
          onExportProject={inProject ? () => downloadProjectExport(inProject.id) : undefined}
          onDuplicateProject={inProject && canCreateProjects ? () => setDuplicateFor(inProject) : undefined}
          onProjectSettings={inProject && !isClient ? () => setSettingsFor(inProject) : undefined}
          onSystemSettings={() => setSettingsView('system')}
          onClients={() => setSettingsView('clients')}
          onTeam={() => setSettingsView('team')}
          onDeleteProject={inProject && !isClient ? () => setDeleteFor(inProject) : undefined}
        />
        {/* The user/account menu (person icon → dropdown): "Account Settings" opens the tabbed account
            modal (email, password, access keys, security/MFA); "Logout" signs out (relocated here from
            the settings gear). Sits immediately to the right of the settings gear. */}
        <UserDropdown onAccountSettings={() => setUserMenuOpen(true)} onSignOut={() => void signOut()} />
      </nav>
      </div>

      {/* MOBILE: the tablist's own row. `-mx-3` bleeds it to the header's edges so a tab scrolled to
          the end sits flush rather than stranded behind the padding, and the matching `px-3` keeps the
          first and last tabs inset when the strip is at rest. */}
      {isMobile && projectTablist && (
        <div className="sw-scroll-none -mx-3 mt-2 overflow-x-auto px-3">{projectTablist}</div>
      )}
    </header>
  );

  return (
    <CiPaletteForProject projectId={inProject?.id}>
    <div className="relative min-h-dvh">
      {/* Soft blurred accent blobs over the gradient shell (decorative, behind content). */}
      <div aria-hidden className="pointer-events-none fixed -right-32 -top-32 -z-10 h-96 w-96 rounded-full bg-fuchsia-300/20 blur-3xl dark:bg-fuchsia-500/10" />
      <div aria-hidden className="pointer-events-none fixed -bottom-32 -left-32 -z-10 h-96 w-96 rounded-full bg-sky-300/20 blur-3xl dark:bg-sky-500/10" />
      <UpdateBanner />
      {header}
      {stage.name === 'home' && (
        // The empty SPA (signed in, no project open). A real frosted card carries the invitation
        // rather than muted loose text, so the landing state matches every other editor surface —
        // and the call to action is a real primary button (brand gradient + ripple), not a link.
        <main className="mx-auto max-w-xl px-6 py-16">
          <section className={`${glassCard} p-8 text-center`}>
            <span className={`${accentChip} mb-4`} aria-hidden>
              <FolderOpen className="h-4 w-4" />
            </span>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Pick a project to get started</h1>
            {/* Secondary weight, not muted: this card is translucent over the animated platform
                background, so the muted tier measured 2.87:1 here — it clears AA on a white panel and
                nowhere near it on a mid-tone one. */}
            <p className="mx-auto mt-2 max-w-sm text-sm text-slate-600 dark:text-slate-300">
              Open one of your projects to start editing — or create a new one from the selector.
            </p>
            <button className={`${primaryButton} mt-6`} onClick={() => setSelectorOpen(true)}>
              Open the project selector
            </button>
          </section>
        </main>
      )}
      {stage.name === 'project' && (
        <ProjectView
          key={stage.project.id}
          project={stage.project}
          tab={tab}
          onLoaded={() => finishOpening(stage.project.id)}
        />
      )}

      {selectorOpen && (
        <ProjectSelectorModal
          projects={projects}
          currentId={inProject?.id}
          branding={branding}
          canCreate={canCreateProjects}
          onClose={() => {
            setOpeningId(null);
            setSelectorOpen(false);
          }}
          onOpen={openProject}
          openingId={openingId}
          onNew={() => {
            setSelectorOpen(false);
            setNewProjectOpen(true);
          }}
          onImportZip={() => {
            setSelectorOpen(false);
            setImportZipOpen(true);
          }}
        />
      )}
      {importZipOpen && (
        <ImportProjectModal
          onClose={() => setImportZipOpen(false)}
          onImported={(project) => {
            setImportZipOpen(false);
            void refresh();
            setProjects((prev) => (prev.some((p) => p.id === project.id) ? prev : [...prev, project]));
            openProject(project);
          }}
        />
      )}
      {newProjectOpen && (
        <NewProjectModal
          onClose={() => setNewProjectOpen(false)}
          onCreated={(project) => {
            setNewProjectOpen(false);
            // Re-resolve the list (so the selector is current), then open the new project.
            void refresh();
            setProjects((prev) => (prev.some((p) => p.id === project.id) ? prev : [...prev, project]));
            openProject(project);
          }}
        />
      )}
      {duplicateFor && (
        <DuplicateProjectModal
          project={duplicateFor}
          onClose={() => setDuplicateFor(null)}
          onDuplicated={(copy) => {
            setDuplicateFor(null);
            void refresh();
            setProjects((prev) => (prev.some((p) => p.id === copy.id) ? prev : [...prev, copy]));
            openProject(copy);
          }}
        />
      )}
      {settingsFor && (
        <ProjectSettingsModal
          project={settingsFor}
          existingSlugs={new Set(projects.filter((p) => p.id !== settingsFor.id).map((p) => p.slug))}
          onClose={() => setSettingsFor(null)}
          onSaved={(updated) => {
            setSettingsFor(null);
            setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
            openProject(updated); // id unchanged; refresh the header name/slug + reselect
            void refresh();
          }}
        />
      )}
      {inProject && publishModalTab && (
        <PublishDeployModal
          project={inProject}
          sitesDomain={sitesDomain}
          initialTab={publishModalTab}
          onClose={() => setPublishModalTab(null)}
          onSaved={() => setPublishRefresh((n) => n + 1)}
        />
      )}
      {/* System Settings / Project Members / Administrators — opened (as modals) from the header gear menu. */}
      {settingsView && (
        <SettingsModalHost view={settingsView} project={inProject} onClose={() => setSettingsView(null)} />
      )}
      {/* Owner-only "Delete Project" (type-to-confirm). On success, leave the now-deleted project. */}
      {deleteFor && (
        <DeleteProjectModal
          project={deleteFor}
          onClose={() => setDeleteFor(null)}
          onDeleted={() => {
            setDeleteFor(null);
            setStage({ name: 'home' });
            void refresh();
          }}
        />
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
      {/* The System Library (global reference: snippets/templates/icons/builders) is project-agnostic,
          so it stays on the left edge even with NO project selected — a reachable reference at all times.
          DESKTOP ONLY: it is an authoring reference you read while writing code, and the page editor
          cannot write code on a phone (see CodePageEditor's mobile gate), so on mobile it would occupy
          an edge to serve a workflow that is not reachable from there. */}
      {!isMobile && <LibraryPanel projectId={inProject?.id} isInstanceAdmin={isInstanceAdmin} />}
      {/* Critical CSS on Ctrl/⌘+Alt+C. Mounted here rather than in Settings because it is written
          WHILE looking at the page it is fixing — which is behind the page editor, a modal the
          settings modal cannot open over. It renders nothing until the chord is pressed. */}
      <CriticalCssShortcut projectId={inProject?.id} />
      {/* Project-scoped edge side-panels (any project member): File Manager (right), and the bottom
          rails — Datasets (left), the paired Snippets + Widgets (center), Templates (right). They render
          above modals so their tabs stay reachable; each opens on hover/click of its own edge tab.

          ON MOBILE only TWO of the five survive, and they take the two BOTTOM CORNERS:

            · Datasets  (bottom-left)  — editing website copy is the commonest thing anyone does from a
                                         phone, and a dataset row is a form: entirely usable by thumb.
            · File Manager (bottom-right) — the phone IS the camera. Uploading a photo from the device
                                         that took it is the one job mobile does BETTER than desktop.

          Snippets, Widgets and Templates are all code-authoring rails feeding a code editor that mobile
          does not mount, so they would be tabs leading nowhere. Dropping them also clears `align="end"`,
          which is what lets the File Manager claim the bottom-right corner uncontested — and leaves both
          screen SIDES free, so modals and the SPA body get the full viewport width. */}
      {inProject && (
        <>
          <AssetsPanel key={inProject.id} projectId={inProject.id} mobile={isMobile} />
          <DataPanel key={`dt-${inProject.id}`} project={inProject} mobile={isMobile} />
          {!isMobile && (
            <>
              <SnippetsPanel key={`sn-${inProject.id}`} projectId={inProject.id} isAdmin={isInstanceAdmin} />
              <WidgetsPanel key={`wg-${inProject.id}`} projectId={inProject.id} />
              <TemplatesPanel key={`tp-${inProject.id}`} projectId={inProject.id} isAdmin={isInstanceAdmin} />
            </>
          )}
        </>
      )}
    </div>
    </CiPaletteForProject>
  );
}
