import type { DeployTargetView, SitewrightClient } from './client.js';

/** What happened at one deploy target. */
export interface TargetOutcome {
  target: string;
  protocol: string;
  /** The target's id, for a re-run against just this one (absent for Local Hosting seen without `deploy`). */
  id?: string;
  ok: boolean;
  /** Where a Local Hosting site answers; a remote target's address is not ours to know. */
  url?: string | null;
  error?: string;
}

/** The deploy_project result. */
export interface DeployReport {
  deployed: TargetOutcome[];
  /** Remote targets this connection can neither see nor deploy (it lacks `deploy`). */
  notDeployed?: string;
  /** The first successful build's manifest — for a shop, the price lists checkout now charges. */
  release?: unknown;
}

type DeployClient = Pick<SitewrightClient, 'publishStatus' | 'publish' | 'listDeployTargets' | 'deployTarget'>;

const NO_TARGET =
  'This project has no deploy target, so there is nowhere to deploy it. Ask the user to add one in the editor ' +
  '(Deploy → Manage deploy targets: Local Hosting, FTP/SFTP or Git). Meanwhile the previewUrl from get_publish_status shows the site.';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Puts the site live on its deploy targets: a Local Hosting target is published (the platform serves
 * the build), a remote one is built fresh and uploaded. Every target unless `targetId` picks one;
 * Local Hosting goes first. Each needs its own capability — `publish` for Local Hosting, `deploy` for
 * a remote target, which is also what lists the targets — so a connection with only `publish` deploys
 * Local Hosting and is told which remote targets it left alone.
 *
 * One target failing does not stop the rest: the report says, per target, what happened. It throws
 * only when nothing was deployed at all.
 */
export async function deployProject(
  client: DeployClient,
  capabilities: readonly string[],
  targetId?: string,
): Promise<DeployReport> {
  const canLocal = capabilities.includes('publish');
  const canRemote = capabilities.includes('deploy');
  // `deploy` lists the targets outright. Without it, the publish status (which needs `content:read`)
  // says only how many there are and whether one is Local Hosting.
  let targets: DeployTargetView[];
  let total: number;
  if (canRemote) {
    targets = (await client.listDeployTargets()).items;
    total = targets.length;
  } else {
    const status = (await client.publishStatus()) as { deployTargets?: number; localHosting?: boolean };
    total = status.deployTargets ?? 0;
    targets = status.localHosting ? [{ id: '', name: 'Local Hosting', protocol: 'local' }] : [];
  }
  if (total === 0) throw new Error(NO_TARGET);
  const unseen = total - targets.length;
  if (targetId !== undefined) {
    if (!canRemote) throw new Error('Choosing a target by id needs the “deploy” capability. Omit targetId to deploy Local Hosting.');
    const picked = targets.find((t) => t.id === targetId);
    if (!picked) {
      throw new Error(`No deploy target "${targetId}". This project's targets: ${targets.map((t) => `${t.name} (${t.id}, ${t.protocol})`).join(', ')}.`);
    }
    targets = [picked];
  }
  targets = [...targets].sort((a, b) => Number(b.protocol === 'local') - Number(a.protocol === 'local'));

  const deployed: TargetOutcome[] = [];
  let release: unknown;
  for (const t of targets) {
    const base = { target: t.name, protocol: t.protocol, ...(t.id ? { id: t.id } : {}) };
    if (t.protocol === 'local') {
      if (!canLocal) {
        deployed.push({ ...base, ok: false, error: 'Local Hosting needs the “publish” capability.' });
        continue;
      }
      try {
        const res = (await client.publish()) as { release?: unknown; url?: string | null };
        release ??= res.release;
        deployed.push({ ...base, ok: true, url: res.url ?? null });
      } catch (err) {
        deployed.push({ ...base, ok: false, error: messageOf(err) });
      }
      continue;
    }
    try {
      const res = (await client.deployTarget(t.id)) as { release?: unknown };
      release ??= res.release;
      deployed.push({ ...base, ok: true });
    } catch (err) {
      deployed.push({ ...base, ok: false, error: messageOf(err) });
    }
  }

  const notDeployed =
    unseen > 0 && targetId === undefined
      ? `${unseen} remote target${unseen === 1 ? ' was' : 's were'} not deployed: this connection lacks the “deploy” capability. Tell the user — they can deploy from the editor, or reconnect you with it.`
      : undefined;
  if (!deployed.some((d) => d.ok)) {
    const failures = deployed.map((d) => `${d.target}: ${d.error ?? 'failed'}`);
    throw new Error(`Nothing was deployed. ${[...failures, ...(notDeployed ? [notDeployed] : [])].join(' ')}`);
  }
  return { deployed, ...(notDeployed ? { notDeployed } : {}), ...(release !== undefined ? { release } : {}) };
}
