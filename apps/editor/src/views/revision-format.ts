// Shared display helpers for revision history (the per-entity modal + the project-wide History view).
import type { RevisionMeta } from '../api';

/** Relative "time ago" (mirrors AgentDetailsModal.when). */
export function when(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * The status pill per revision op. `create` is the write that MADE the item (the server decides it from
 * whether a stored row existed), `put` any later save of it — shown as "Updated", not "Saved", because
 * creating something is a save too.
 */
export const OP_PILL: Record<RevisionMeta['op'], { label: string; cls: string }> = {
  create: { label: 'Created', cls: 'bg-sky-100/80 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  put: { label: 'Updated', cls: 'bg-slate-200/80 text-slate-600 dark:bg-white/10 dark:text-slate-300' },
  restore: { label: 'Restored', cls: 'bg-emerald-100/80 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  delete: { label: 'Deleted', cls: 'bg-red-100/80 text-red-700 dark:bg-red-500/15 dark:text-red-300' },
};

/** The History view's status filter, in the order a reader thinks of an item's life. */
export const OP_FILTERS: ReadonlyArray<{ value: '' | RevisionMeta['op']; label: string }> = [
  { value: '', label: 'All actions' },
  { value: 'create', label: OP_PILL.create.label },
  { value: 'put', label: OP_PILL.put.label },
  { value: 'restore', label: OP_PILL.restore.label },
  { value: 'delete', label: OP_PILL.delete.label },
];

/** "You" / the member's email / "Agent" for a revision's author. */
export function authorLabel(r: { actor: 'user' | 'agent'; author: { isYou: boolean; email: string | null } }): string {
  if (r.actor === 'agent') return 'Agent';
  if (r.author.isYou) return 'You';
  return r.author.email ?? 'A member';
}

/** Human label for a content kind (for the project-wide feed rows). Display only — the stored kind
 *  stays `entry`; "Dataset Entry" says WHICH kind of entry it is. */
export const KIND_LABEL: Record<string, string> = {
  page: 'Page',
  template: 'Template',
  snippet: 'Snippet',
  translation: 'Translation',
  dataset: 'Dataset',
  entry: 'Dataset Entry',
  form: 'Form',
  imagemap: 'Image map',
  settings: 'Settings',
};
