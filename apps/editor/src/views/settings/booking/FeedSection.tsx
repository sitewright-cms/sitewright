import { useEffect, useState } from 'react';
import { CalendarPlus, Check, Copy, Loader2, RefreshCw } from 'lucide-react';
import type { BookingResource } from '@sitewright/schema';
import { api, ApiError, type BookingFeed } from '../../../api';
import { dangerButton, ghostButton, glassInput, smallGhostButton } from '../../../theme';
import { useDialogs } from '../../ui/Dialogs';
import { useCopy } from '../../ui/useCopy';
import { PartHeading, SELECT } from './fields';
import { since } from './model';

const HELP =
  'Every booking and open request in your own calendar, kept up to date by the calendar itself. Google Calendar: Other calendars → + → From URL. Outlook: Add calendar → Subscribe from web. Apple Calendar: File → New Calendar Subscription, or the button here. Calendars fetch it on their own schedule: Google every few hours, Apple and Outlook more often.';

type State = { kind: 'loading' } | { kind: 'forbidden' } | { kind: 'failed' } | { kind: 'ready'; feed: BookingFeed | null };

/**
 * THE BOOKINGS FEED: the address a business's own calendar subscribes to. It acts at once (not with the set-up's
 * Save). ★ The address lists customers' details, so it is shown with a warning, and a new one can replace it.
 */
export function FeedSection({ projectId, resources }: { projectId: string; resources: readonly BookingResource[] }) {
  const { confirm, dialog } = useDialogs();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resource, setResource] = useState('');
  const [copied, copy] = useCopy();

  useEffect(() => {
    let live = true;
    api
      .getBookingFeed(projectId)
      .then((r) => live && setState({ kind: 'ready', feed: r.feed }))
      .catch((err: unknown) => live && setState({ kind: err instanceof ApiError && err.status === 403 ? 'forbidden' : 'failed' }));
    return () => {
      live = false;
    };
  }, [projectId]);

  const act = async (run: () => Promise<BookingFeed | null>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setState({ kind: 'ready', feed: await run() });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };
  const renew = async (): Promise<void> => {
    const sure = await confirm({
      title: 'New calendar address',
      message: 'Calendars subscribed to the current address stop updating, and have to subscribe to the new one.',
      confirmLabel: 'Make a new address',
    });
    if (sure) await act(async () => (await api.renewBookingFeed(projectId)).feed);
  };
  const off = async (): Promise<void> => {
    const sure = await confirm({ title: 'Turn the calendar address off', message: 'Calendars subscribed to it stop updating.', confirmLabel: 'Turn off' });
    if (sure) await act(async () => (await api.disableBookingFeed(projectId), null));
  };

  const withResource = (url: string): string => (resource ? `${url}?resource=${encodeURIComponent(resource)}` : url);

  return (
    <div>
      {dialog}
      <PartHeading tip={HELP}>Bookings in your calendar</PartHeading>
      {state.kind === 'loading' ? (
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </p>
      ) : state.kind === 'forbidden' ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">Only the project’s owners and members can see the calendar address: it lists customers’ details.</p>
      ) : state.kind === 'failed' ? (
        <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
          The calendar address could not be loaded. Close the set-up and open it again.
        </p>
      ) : !state.feed ? (
        <div className="flex max-w-2xl flex-col items-start gap-2">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            See every booking in Google Calendar, Outlook or Apple Calendar: your calendar subscribes to an address and keeps itself up to date.
          </p>
          <button type="button" className={ghostButton} disabled={busy} onClick={() => void act(async () => (await api.renewBookingFeed(projectId)).feed)}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />} Create a calendar address
          </button>
        </div>
      ) : (
        <div className="flex max-w-3xl flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <input className={`${glassInput} min-w-0 flex-1 font-mono text-xs`} readOnly value={withResource(state.feed.url)} aria-label="Calendar address" onFocus={(e) => e.currentTarget.select()} />
            {resources.length > 1 && (
              <select aria-label="Whose bookings" className={`${SELECT} !w-auto`} value={resource} onChange={(e) => setResource(e.target.value)}>
                <option value="">All bookings</option>
                {resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}’s
                  </option>
                ))}
              </select>
            )}
            <button type="button" className={smallGhostButton} onClick={() => copy(withResource(state.feed!.url), 'feed')}>
              {copied === 'feed' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied === 'feed' ? 'Copied' : 'Copy'}
            </button>
            <a className={smallGhostButton} href={withResource(state.feed.webcalUrl)}>
              <CalendarPlus className="h-3.5 w-3.5" /> Subscribe
            </a>
          </div>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            Anyone with this address sees your bookings and your customers’ details. Paste it only into your own calendar.
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="min-w-0 flex-1">
              {state.feed.lastFetchedAt ? `A calendar last fetched it ${since(state.feed.lastFetchedAt, Date.now())}.` : 'No calendar has fetched it yet.'}
            </span>
            <button type="button" className={smallGhostButton} disabled={busy} onClick={() => void renew()}>
              <RefreshCw className="h-3.5 w-3.5" /> New address
            </button>
            <button type="button" className={dangerButton} disabled={busy} onClick={() => void off()}>
              Turn off
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}
