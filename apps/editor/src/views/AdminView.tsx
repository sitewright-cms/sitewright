import { useState } from 'react';
import type { Project } from '../api';
import { ClientsManager } from './ClientsManager';
import { TeamManager } from './TeamManager';
import { ApiKeysManager } from './ApiKeysManager';

/** The ADMIN top tab groups the project/platform administration surfaces under sub-tabs. */
const SUB_TABS = [
  { key: 'clients', label: 'Clients' },
  { key: 'team', label: 'Team' },
  { key: 'access', label: 'Access' },
] as const;
type SubTab = (typeof SUB_TABS)[number]['key'];

/**
 * Admin surface: the project's clients (owners/members), the platform team (developers/admins,
 * instance-wide), and API access keys — grouped under one tab so the top bar stays focused on
 * authoring (Identity / Website / Pages / Media / Forms / Data).
 */
export function AdminView({ project }: { project: Project }) {
  const [sub, setSub] = useState<SubTab>('clients');
  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" aria-label="Admin sections" className="flex w-fit items-center gap-1 rounded-2xl border border-white/50 bg-white/50 p-1 shadow-sm backdrop-blur-xl">
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={sub === t.key}
            onClick={() => setSub(t.key)}
            className={`rounded-xl px-4 py-1.5 text-sm transition ${
              sub === t.key
                ? 'bg-white font-semibold text-slate-900 shadow-md shadow-slate-900/5'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {sub === 'clients' ? (
        <ClientsManager key={project.id} project={project} />
      ) : sub === 'team' ? (
        <TeamManager />
      ) : (
        // Remount on project switch → all state (incl. the one-time token banner) resets.
        <ApiKeysManager key={project.id} project={project} />
      )}
    </div>
  );
}
