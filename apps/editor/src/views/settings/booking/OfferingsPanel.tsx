import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, Plus, Trash2 } from 'lucide-react';
import { BOOKING_LIMITS, type BookingConfig, type BookingOffering } from '@sitewright/schema';
import { dangerButton, ghostButton, smallGhostButton } from '../../../theme';
import { useCopy } from '../../ui/useCopy';
import { OfferingFields } from './OfferingFields';
import { MODE_LABELS, describeOffering, issuesUnder, newOffering } from './model';
import { useItemKeys } from './use-item-keys';

/** The OFFERINGS: what a visitor books, each put on a page with its own snippet. */
export function OfferingsPanel({
  draft,
  onChange,
  issues,
  savedIds,
}: {
  draft: BookingConfig;
  onChange: (next: BookingConfig) => void;
  issues: ReadonlyMap<string, string>;
  /** The offerings in the saved set-up: their ids are fixed. */
  savedIds: ReadonlySet<string>;
}) {
  const { keys, added, removed } = useItemKeys(draft.offerings.map((o) => o.id));
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(keys.length === 1 ? [keys[0]!] : []));
  const [copied, copy] = useCopy();
  const toggle = (key: string): void => setOpen((s) => (s.has(key) ? new Set([...s].filter((k) => k !== key)) : new Set([...s, key])));
  const set = (i: number, offering: BookingOffering): void =>
    onChange({
      ...draft,
      offerings: draft.offerings.map((o, j) => (j === i ? offering : o)),
    });
  const add = (): void => {
    const key = added();
    onChange({
      ...draft,
      offerings: [...draft.offerings, newOffering(draft, `Offering ${draft.offerings.length + 1}`, 'duration')],
    });
    setOpen((s) => new Set([...s, key]));
  };
  const names = new Map(draft.resources.map((r) => [r.id, r.name]));

  return (
    <div className="flex flex-col gap-3">
      {draft.offerings.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-white/15 dark:text-slate-400">
          Nothing offered yet: booking is off. Add an offering, then put its snippet on a page.
        </p>
      )}
      {draft.offerings.map((o, i) => {
        const key = keys[i]!;
        const isOpen = open.has(key);
        const problems = issuesUnder(issues, `offerings.${i}`);
        const snippet = `{{sw-booking "${o.id}"}}`;
        return (
          <section key={key} className="rounded-2xl border border-slate-200/80 bg-white/50 dark:border-white/10 dark:bg-white/5">
            <header className="flex items-center gap-2 px-3 py-2.5">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={isOpen} onClick={() => toggle(key)}>
                {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{o.name || 'Unnamed'}</span>
                  <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                    {MODE_LABELS[o.mode]} · {describeOffering(o)}
                    {o.resourceIds.length ? ` · ${o.resourceIds.map((id) => names.get(id) ?? id).join(', ')}` : ''}
                    {o.confirmation === 'request' ? ' · on request' : ''}
                  </span>
                </span>
              </button>
              {problems.length > 0 && (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                  {problems.length} to fix
                </span>
              )}
              <button
                type="button"
                className={dangerButton}
                aria-label={`Remove ${o.name || 'offering'}`}
                onClick={() => {
                  removed(i);
                  setOpen((s) => new Set([...s].filter((k) => k !== key)));
                  onChange({
                    ...draft,
                    offerings: draft.offerings.filter((_, j) => j !== i),
                  });
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </header>
            {isOpen && (
              <div className="flex flex-col gap-4 border-t border-slate-200/70 px-3 py-3 dark:border-white/10">
                <OfferingFields
                  offering={o}
                  index={i}
                  config={draft}
                  issues={issues}
                  idFixed={savedIds.has(o.id)}
                  others={new Set(draft.offerings.filter((_, j) => j !== i).map((x) => x.id))}
                  onChange={(next) => set(i, next)}
                />
                <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-100/70 px-3 py-2 text-xs text-slate-600 dark:bg-white/5 dark:text-slate-300">
                  <span>On a page:</span>
                  <code className="rounded bg-white/80 px-1.5 py-0.5 font-mono text-slate-800 dark:bg-slate-900 dark:text-slate-100">{snippet}</code>
                  <button
                    type="button"
                    className={smallGhostButton}
                    onClick={() => copy(snippet, o.id)}
                    aria-label={`Copy the snippet for ${o.name || 'this offering'}`}
                  >
                    {copied === o.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied === o.id ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}
          </section>
        );
      })}
      {draft.offerings.length < BOOKING_LIMITS.offerings && (
        <button type="button" className={`${ghostButton} self-start`} onClick={add} disabled={draft.resources.length === 0}>
          <Plus className="h-4 w-4" /> Add an offering
        </button>
      )}
    </div>
  );
}
