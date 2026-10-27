import { useEffect, useRef, useState } from 'react';
import { CalendarCheck2, CalendarX2, Link2, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { api, ApiError, type BookingCalendar } from '../../../api';
import { dangerButton, ghostButton, smallGhostButton } from '../../../theme';
import { useDialogs } from '../../ui/Dialogs';
import { PartHeading, TextField } from './fields';
import { since } from './model';
import type { CalendarAccess } from './ResourcesPanel';

const HELP =
  'Busy times read from a calendar kept elsewhere, so a time taken there is not offered here. Google: Settings → the calendar → “Secret address in iCal format”. Outlook: Settings → Calendar → Shared calendars → Publish → the ICS link. Apple iCloud: share the calendar as a public calendar and copy its webcal:// link. Rental platforms: their calendar export link. The address is kept encrypted and never shown again. A calendar that cannot be read for a day makes this busy, not free.';

/**
 * A resource's OUTSIDE CALENDARS. Connecting, re-reading and removing act at once (not with the set-up's Save):
 * the server reads the feed and says how that went.
 */
export function CalendarsPanel({
  projectId,
  resourceId,
  resourceName,
  saved,
  calendars,
  access,
  onChange,
  onBusy,
}: {
  projectId: string;
  resourceId: string;
  resourceName: string;
  /** Whether the resource is in the SAVED set-up: a calendar can only be connected to one that is. */
  saved: boolean;
  calendars: readonly BookingCalendar[];
  /** `forbidden`: this member may not manage calendars (the API answered 403); `failed`: they could not be listed. */
  access: CalendarAccess;
  onChange: (update: (all: BookingCalendar[]) => BookingCalendar[]) => void;
  /** Told while a calendar of this resource is being connected, read or removed (the resource is not removable then). */
  onBusy?: (busy: boolean) => void;
}) {
  const { confirm, dialog } = useDialogs();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const onBusyRef = useRef(onBusy);
  onBusyRef.current = onBusy;
  useEffect(() => onBusyRef.current?.(busy !== null), [busy]);
  // Closed (or removed) while busy: not busy any more as far as the list is concerned.
  useEffect(() => () => onBusyRef.current?.(false), []);

  const put = (calendar: BookingCalendar): void =>
    onChange((all) => (all.some((c) => c.id === calendar.id) ? all.map((c) => (c.id === calendar.id ? calendar : c)) : [...all, calendar]));
  const fail = (err: unknown): void =>
    setMessage({
      ok: false,
      text: err instanceof ApiError ? err.message : 'That did not work. Try again in a moment.',
    });

  const connect = async (): Promise<void> => {
    setBusy('connect');
    setMessage(null);
    try {
      const r = await api.connectBookingCalendar(projectId, {
        resourceId,
        name: name.trim() || 'Calendar',
        url: url.trim(),
      });
      put(r.calendar);
      setUrl('');
      setName('');
      setMessage(
        r.reading.ok
          ? {
              ok: true,
              text: `Connected. ${eventsText(r.calendar.lastEvents)}`,
            }
          : {
              ok: false,
              text: `Connected, but it could not be read: ${r.reading.error}.`,
            },
      );
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };
  const test = async (c: BookingCalendar): Promise<void> => {
    setBusy(c.id);
    setMessage(null);
    try {
      const r = await api.testBookingCalendar(projectId, c.id);
      put(r.calendar);
      setMessage(
        r.reading.ok
          ? {
              ok: true,
              text: `${c.name}: read. ${eventsText(r.calendar.lastEvents)}`,
            }
          : { ok: false, text: `${c.name}: ${r.reading.error}.` },
      );
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };
  const remove = async (c: BookingCalendar): Promise<void> => {
    const sure = await confirm({
      title: 'Remove calendar',
      message: `Stop reading “${c.name}” for ${resourceName}? Its busy times stop counting at once.`,
      confirmLabel: 'Remove',
    });
    if (!sure) return;
    setBusy(c.id);
    try {
      await api.removeBookingCalendar(projectId, c.id);
      onChange((all) => all.filter((x) => x.id !== c.id));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      {dialog}
      <PartHeading tip={HELP}>Outside calendars</PartHeading>
      {access === 'forbidden' ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">Only the project’s owners and members can connect calendars.</p>
      ) : access === 'failed' ? (
        <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
          The calendars could not be loaded. Close the set-up and open it again.
        </p>
      ) : !saved ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">Save the set-up first, then connect calendars to {resourceName || 'this'}.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {calendars.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {calendars.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/70 bg-white/40 px-3 py-2 dark:border-white/10 dark:bg-white/5"
                >
                  {c.lastError ? (
                    <CalendarX2 className="h-4 w-4 shrink-0 text-rose-500" />
                  ) : (
                    <CalendarCheck2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-700 dark:text-slate-200">{c.name}</span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                      {c.host}
                      {' · '}
                      {c.lastError ? (
                        <span className="text-rose-600 dark:text-rose-400">{c.lastError}</span>
                      ) : c.lastOkAt ? (
                        `read ${since(c.lastOkAt, Date.now())}, ${eventsText(c.lastEvents).toLowerCase()}`
                      ) : (
                        'not read yet'
                      )}
                    </span>
                  </span>
                  <button type="button" className={smallGhostButton} disabled={busy !== null} onClick={() => void test(c)} aria-label={`Read ${c.name} now`}>
                    {busy === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Read now
                  </button>
                  <button type="button" className={dangerButton} disabled={busy !== null} onClick={() => void remove(c)} aria-label={`Remove ${c.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] sm:items-end">
            <TextField label="Calendar name" value={name} placeholder="Anna’s Google calendar" onChange={setName} />
            {/* A secret address: never offered back by the browser's form memory. */}
            <TextField label="Calendar address" value={url} type="url" placeholder="https://… or webcal://…" onChange={setUrl} autoComplete="off" />
            <button type="button" className={ghostButton} disabled={busy !== null || !url.trim()} onClick={() => void connect()}>
              {busy === 'connect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Connect
            </button>
          </div>
          {message && (
            <p role="status" className={`text-xs ${message.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {message.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function eventsText(n: number | null): string {
  if (n === null) return 'Nothing read yet.';
  return `${n} event${n === 1 ? '' : 's'} in it.`;
}
