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
      <div role="tablist" aria-label="Admin sections" className="flex gap-1 border-b border-slate-200">
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={sub === t.key}
            onClick={() => setSub(t.key)}
            className={`-mb-px cursor-pointer border-b-2 px-3 py-2 text-sm ${
              sub === t.key
                ? 'border-slate-900 font-semibold text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800'
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
