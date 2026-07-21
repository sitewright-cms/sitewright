import { useEffect, useState } from 'react';
import { Server, Upload, TerminalSquare, GitBranch, Pencil, X, type LucideIcon } from 'lucide-react';
import { api, type DeployTargetView, type Project } from '../../api';
import { useDialogs } from '../ui/Dialogs';
import { ghostButton, dangerButton, glassPanel, accentChip } from '../../theme';
import { DeployModal } from './DeployModal';
import { TargetConfigForm, type WizardProtocol } from './TargetConfigForm';

/** The four wizard entry points. `ftp` opens the FTP/FTPS family (a TLS toggle picks the variant). */
const TYPES: ReadonlyArray<{ protocol: WizardProtocol; title: string; blurb: string; icon: LucideIcon }> = [
  { protocol: 'local', title: 'Local Hosting', blurb: 'Serve on this platform at /sites/…', icon: Server },
  { protocol: 'ftp', title: 'FTP / FTPS Upload', blurb: 'Upload to your own server', icon: Upload },
  { protocol: 'sftp', title: 'SSH / SFTP Upload', blurb: 'Upload over SSH (password or key)', icon: TerminalSquare },
  { protocol: 'git', title: 'Git Deploy', blurb: 'Push to a branch (gh-pages style)', icon: GitBranch },
];

/** A human "where" label for a saved target row. */
function whereLabel(t: DeployTargetView): string {
  if (t.protocol === 'local') return 'Local Hosting';
  if (t.protocol === 'git') return `Git · ${t.branch ?? ''}`;
  return `${t.protocol.toUpperCase()}@${t.host ?? ''}`;
}

type Mode = { kind: 'list' } | { kind: 'configure'; protocol: WizardProtocol; editing: DeployTargetView | null };

/**
 * The deploy-target configuration wizard: a list of saved targets (each Deploy/Edit/Delete) plus four
 * entry points to ADD one — Local Hosting / FTP-FTPS / SSH-SFTP / Git. Picking a type (or Edit) opens
 * {@link TargetConfigForm}. Local Hosting is a singleton, so its card is hidden once one exists.
 */
export function DeployTargetWizard({ project }: { project: Project }) {
  const [targets, setTargets] = useState<DeployTargetView[] | null>(null); // null = feature unavailable
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [deploying, setDeploying] = useState<DeployTargetView | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useDialogs();

  async function load() {
    try {
      setTargets((await api.listDeployTargets(project.id)).items);
    } catch {
      setTargets(null);
    }
  }
  useEffect(() => {
    let active = true;
    api
      .listDeployTargets(project.id)
      .then((res) => active && setTargets(res.items))
      .catch(() => active && setTargets(null));
    return () => {
      active = false;
    };
  }, [project.id]);

  if (targets === null) {
    return <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Saved deploy targets are unavailable (no encryption key configured on this server).</p>;
  }

  if (mode.kind === 'configure') {
    return (
      <div className="mt-1">
        <TargetConfigForm
          project={project}
          protocol={mode.protocol}
          editing={mode.editing}
          onCancel={() => setMode({ kind: 'list' })}
          onSaved={() => {
            void load();
            setMode({ kind: 'list' });
          }}
        />
        {dialog}
      </div>
    );
  }

  const hasLocal = targets.some((t) => t.protocol === 'local');

  return (
    <div className="mt-1 flex flex-col gap-4">
      {targets.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">Your deploy targets</h4>
          <ul className="flex flex-col gap-1.5">
            {targets.map((t) => (
              <li key={t.id} className={`flex items-center gap-2 ${glassPanel} px-3 py-2 text-sm`}>
                <span className="font-medium text-slate-800 dark:text-slate-100">{t.name}</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">{whereLabel(t)}</span>
                {t.minifyHtml && <span className="rounded bg-slate-100 dark:bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-400">minified</span>}
                <div className="ml-auto flex items-center gap-1">
                  {/* A `local` target is served via the header's Publish action, not the deploy transport. */}
                  {t.protocol !== 'local' && (
                    <button className={`${ghostButton} px-2 py-0.5 text-xs`} disabled={busy} aria-label={`Deploy to ${t.name}`} onClick={() => setDeploying(t)}>
                      Deploy
                    </button>
                  )}
                  <button className={`${ghostButton} px-1.5 py-0.5 text-xs`} aria-label={`Edit ${t.name}`} onClick={() => setMode({ kind: 'configure', protocol: t.protocol as WizardProtocol, editing: t })}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className={`${dangerButton} px-1.5 py-0.5 text-xs`}
                    aria-label={`Delete ${t.name}`}
                    onClick={async () => {
                      const ok = await confirm({
                        title: 'Delete deploy target',
                        message: `Delete the saved deploy target "${t.name}" (${whereLabel(t)})? This cannot be undone.`,
                        confirmLabel: 'Delete',
                      });
                      if (!ok) return;
                      setBusy(true);
                      try {
                        await api.deleteDeployTarget(project.id, t.id);
                        await load();
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">Add a deploy target</h4>
        <div className="grid grid-cols-2 gap-2">
          {TYPES.filter((ty) => !(ty.protocol === 'local' && hasLocal)).map((ty) => {
            const Icon = ty.icon;
            return (
              <button
                key={ty.protocol}
                type="button"
                className={`${glassPanel} flex items-start gap-3 p-3 text-left transition hover:bg-white dark:hover:bg-white/10`}
                onClick={() => setMode({ kind: 'configure', protocol: ty.protocol, editing: null })}
              >
                <span className={`${accentChip} shrink-0`} aria-hidden>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="flex flex-col">
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{ty.title}</span>
                  <span className="text-xs text-slate-400 dark:text-slate-500">{ty.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
        {hasLocal && <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">Local Hosting is already configured — edit it above.</p>}
      </div>

      {dialog}
      {deploying && <DeployModal project={project} target={deploying} onClose={() => setDeploying(null)} />}
    </div>
  );
}
