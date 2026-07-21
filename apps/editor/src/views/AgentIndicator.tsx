/** Indicator visual states (see {@link AgentIndicator}). */
export type AgentState = 'none' | 'idle' | 'working';

/** Robot/AI glyph for the "no agent connected — you can connect one" affordance. */
function RobotIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="8" width="16" height="11" rx="2.5" />
      <path d="M12 8V4M9 4h6" />
      <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13" r="1" fill="currentColor" stroke="none" />
      <path d="M9.5 16.5h5" />
    </svg>
  );
}

/** A spinning ring — the "agent is actively working right now" animation. */
function Spinner() {
  return <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />;
}

/**
 * The header's AI-agent presence indicator — always shown (for users who can manage the project),
 * clickable to open the AI agent details modal. Three states:
 *  - **working**: a spinning emerald ring + "Agent working…" — an agent edited within the lull window.
 *  - **idle**: a breathing amber dot + "Agent connected" (· N when more than one) — connected, not editing.
 *  - **none**: a grey robot glyph + "Connect an agent" — nudges that an agent CAN be wired up (the
 *    modal carries the how-to).
 */
export function AgentIndicator({ state, count, onClick }: { state: AgentState; count: number; onClick: () => void }) {
  const base =
    'inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition';
  if (state === 'working') {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/15`}
        title="An agent is editing this project right now — click for details / to disconnect."
      >
        <Spinner />
        Agent working…
      </button>
    );
  }
  if (state === 'idle') {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/15`}
        title="An agent is connected (idle) — click for details / to disconnect."
      >
        <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
        Agent connected{count > 1 ? ` · ${count}` : ''}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-600 dark:hover:text-slate-300`}
      title="No agent connected — click to learn how to connect an AI agent."
    >
      <RobotIcon />
      Connect an agent
    </button>
  );
}
