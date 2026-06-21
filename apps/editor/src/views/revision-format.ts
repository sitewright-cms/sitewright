// Shared display helpers for revision history (the per-entity modal + the project-wide History view).

/** Relative "time ago" (mirrors AgentDetailsModal.when). */
export function when(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export const OP_PILL: Record<'put' | 'delete' | 'restore', { label: string; cls: string }> = {
  put: { label: 'Saved', cls: 'bg-slate-200/80 text-slate-600' },
  restore: { label: 'Restored', cls: 'bg-emerald-100/80 text-emerald-700' },
  delete: { label: 'Deleted', cls: 'bg-red-100/80 text-red-700' },
};

/** "You" / the member's email / "Agent" for a revision's author. */
export function authorLabel(r: { actor: 'user' | 'agent'; author: { isYou: boolean; email: string | null } }): string {
  if (r.actor === 'agent') return 'Agent';
  if (r.author.isYou) return 'You';
  return r.author.email ?? 'A member';
}

/** Human label for a content kind (for the project-wide feed rows). */
export const KIND_LABEL: Record<string, string> = {
  page: 'Page',
  template: 'Template',
  snippet: 'Snippet',
  translation: 'Translation',
  dataset: 'Dataset',
  entry: 'Entry',
  form: 'Form',
  settings: 'Settings',
};
