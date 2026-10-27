import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { BOOKING_LIMITS, type BookingConfig, type BookingResource } from '@sitewright/schema';
import type { BookingCalendar } from '../../../api';
import { dangerButton, ghostButton } from '../../../theme';
import { SearchableSelect } from '../../ui/SearchableSelect';
import { BlocksEditor } from './BlocksEditor';
import { CalendarsPanel } from './CalendarsPanel';
import { HoursEditor } from './HoursEditor';
import { NumField, TextField } from './fields';
import { describeHours, idFromName, issuesUnder, newResource, removeResource, replaceResource, timeZones } from './model';
import { useItemKeys } from './use-item-keys';

/** Whether this member may see and manage the outside calendars, or whether they could not be listed. */
export type CalendarAccess = 'ok' | 'forbidden' | 'failed';

/**
 * The RESOURCES: what a booking occupies (a person, a room, a flat, a bike). Each has its own clock, capacity,
 * opening hours, blocked times and outside calendars.
 */
export function ResourcesPanel({
  projectId,
  draft,
  onChange,
  issues,
  savedIds,
  calendars,
  calendarAccess,
  onCalendars,
  onRemoveBlocked,
}: {
  projectId: string;
  draft: BookingConfig;
  onChange: (next: BookingConfig) => void;
  issues: ReadonlyMap<string, string>;
  /** The resources in the saved set-up: their ids are fixed (bookings and calendars name them). */
  savedIds: ReadonlySet<string>;
  calendars: readonly BookingCalendar[];
  calendarAccess: CalendarAccess;
  onCalendars: (update: (all: BookingCalendar[]) => BookingCalendar[]) => void;
  /** Says why a resource cannot be removed yet. */
  onRemoveBlocked: (message: string) => void;
}) {
  const { keys, added, removed } = useItemKeys(draft.resources.map((r) => r.id));
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(keys.length === 1 ? [keys[0]!] : []));
  // Resources with a calendar being connected, read or removed right now.
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (key: string): void => setOpen((s) => (s.has(key) ? new Set([...s].filter((k) => k !== key)) : new Set([...s, key])));
  const set = (i: number, resource: BookingResource): void => onChange(replaceResource(draft, i, resource));
  const add = (): void => {
    const key = added();
    onChange({ ...draft, resources: [...draft.resources, newResource(draft, `Resource ${draft.resources.length + 1}`)] });
    setOpen((s) => new Set([...s, key]));
  };
  const remove = (r: BookingResource, i: number): void => {
    // A saved resource may have calendars: removing it would leave them reading for nothing.
    if (savedIds.has(r.id) && calendarAccess !== 'ok') {
      onRemoveBlocked(
        calendarAccess === 'forbidden'
          ? `Only the project’s owners and members can remove ${r.name}: its calendars, if any, have to be disconnected first.`
          : `${r.name}’s calendars could not be checked. Close the set-up and open it again to remove it.`,
      );
      return;
    }
    if (busy.has(r.id)) {
      onRemoveBlocked(`Wait until ${r.name}’s calendar is done.`);
      return;
    }
    const connected = calendars.filter((c) => c.resourceId === r.id).length;
    if (connected > 0) {
      onRemoveBlocked(`Disconnect ${r.name}’s ${connected === 1 ? 'calendar' : `${connected} calendars`} first.`);
      return;
    }
    removed(i);
    setOpen((s) => new Set([...s].filter((k) => k !== keys[i])));
    onChange(removeResource(draft, r.id));
  };

  return (
    <div className="flex flex-col gap-3">
      {draft.resources.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-white/15 dark:text-slate-400">
          Nothing to book yet. Add what a booking takes: a person, a room, a flat, a bike.
        </p>
      )}
      {draft.resources.map((r, i) => {
        const key = keys[i]!;
        const isOpen = open.has(key);
        const problems = issuesUnder(issues, `resources.${i}`);
        const mine = calendars.filter((c) => c.resourceId === r.id);
        return (
          <section key={key} className="rounded-2xl border border-slate-200/80 bg-white/50 dark:border-white/10 dark:bg-white/5">
            <header className="flex items-center gap-2 px-3 py-2.5">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={isOpen} onClick={() => toggle(key)}>
                {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{r.name || 'Unnamed'}</span>
                  <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                    {r.timeZone} · {describeHours(r.hours)}
                    {r.capacity > 1 ? ` · ${r.capacity} at once` : ''}
                    {mine.length ? ` · ${mine.length} calendar${mine.length === 1 ? '' : 's'}` : ''}
                  </span>
                </span>
              </button>
              {problems.length > 0 && (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                  {problems.length} to fix
                </span>
              )}
              <button type="button" className={dangerButton} aria-label={`Remove ${r.name || 'resource'}`} onClick={() => remove(r, i)}>
                <Trash2 className="h-4 w-4" />
              </button>
            </header>
            {isOpen && (
              <div className="flex flex-col gap-4 border-t border-slate-200/70 px-3 py-3 dark:border-white/10">
                <ResourceFields
                  resource={r}
                  index={i}
                  issues={issues}
                  idFixed={savedIds.has(r.id)}
                  others={new Set(draft.resources.filter((_, j) => j !== i).map((x) => x.id))}
                  onChange={(next) => set(i, next)}
                />
                <HoursEditor hours={r.hours} onChange={(hours) => set(i, { ...r, hours })} issues={issues} path={`resources.${i}.hours`} />
                <BlocksEditor blocks={r.blocks} onChange={(blocks) => set(i, { ...r, blocks })} issues={issues} path={`resources.${i}.blocks`} />
                <CalendarsPanel
                  projectId={projectId}
                  resourceId={r.id}
                  resourceName={r.name}
                  saved={savedIds.has(r.id)}
                  calendars={mine}
                  access={calendarAccess}
                  onChange={onCalendars}
                  onBusy={(b) => setBusy((s) => (b ? new Set([...s, r.id]) : new Set([...s].filter((x) => x !== r.id))))}
                />
              </div>
            )}
          </section>
        );
      })}
      {draft.resources.length < BOOKING_LIMITS.resources && (
        <button type="button" className={`${ghostButton} self-start`} onClick={add}>
          <Plus className="h-4 w-4" /> Add a resource
        </button>
      )}
    </div>
  );
}

function ResourceFields({
  resource: r,
  index: i,
  issues,
  idFixed,
  others,
  onChange,
}: {
  resource: BookingResource;
  index: number;
  issues: ReadonlyMap<string, string>;
  idFixed: boolean;
  /** The other resources' ids: a new one's id is made from its name, unique among them. */
  others: ReadonlySet<string>;
  onChange: (next: BookingResource) => void;
}) {
  const zones = useMemo(
    () =>
      timeZones(r.timeZone).map((z) => ({
        value: z,
        label: z.replace(/_/g, ' '),
        keywords: z,
      })),
    [r.timeZone],
  );
  const err = (field: string): string | undefined => issues.get(`resources.${i}.${field}`);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <TextField
        label="Name"
        value={r.name}
        placeholder="Anna, Room 2, Seaside flat"
        onChange={(name) =>
          onChange({
            ...r,
            name,
            // ★ Always from the name, never typed: ids stay unique at every keystroke, so the offerings that name this
            // resource follow it (replaceResource) without ever being pointed at another one's id.
            id: idFixed ? r.id : idFromName(name, others, 'resource'),
          })
        }
        error={err('name')}
      />
      <TextField
        label="Id"
        value={r.id}
        readOnly
        onChange={() => undefined}
        error={err('id')}
        tip="Made from the name, and fixed once saved: bookings and calendars refer to it."
      />
      <div className="flex min-w-0 flex-col">
        <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Time zone</span>
        <SearchableSelect
          value={r.timeZone}
          onChange={(timeZone) => onChange({ ...r, timeZone })}
          options={zones}
          ariaLabel="Time zone"
          searchPlaceholder="Search time zones…"
        />
        {err('timeZone') && <span className="mt-1 block text-[11px] font-medium text-red-500 dark:text-red-400">{err('timeZone')}</span>}
      </div>
      <NumField
        label="At the same time"
        value={r.capacity}
        min={1}
        max={BOOKING_LIMITS.capacity}
        onChange={(capacity) => onChange({ ...r, capacity: capacity as number })}
        error={err('capacity')}
        tip="How many bookings it takes at once: 1 for a person or a room, the seats of a tour, the bikes of a kind."
      />
      <div className="sm:col-span-2">
        <TextField
          label="Invitations to"
          type="email"
          value={r.email ?? ''}
          placeholder="name@example.com (optional)"
          onChange={(email) => onChange({ ...r, email: email.trim() ? email : undefined })}
          error={err('email')}
          tip="Each booking arrives here as a calendar invitation: a person's own address, or a room calendar that accepts invitations. Never shown to visitors."
        />
      </div>
    </div>
  );
}
