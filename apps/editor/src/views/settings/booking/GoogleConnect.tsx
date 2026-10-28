import { useEffect, useState } from 'react';
import { Check, Copy, Link2, Loader2 } from 'lucide-react';
import { api, ApiError, type BookingCalendarReading } from '../../../api';
import { ghostButton, smallGhostButton } from '../../../theme';
import { useCopy } from '../../ui/useCopy';
import { TextField, ToggleRow } from './fields';

/**
 * Connecting a GOOGLE CALENDAR: the business shares it with the platform's service account ("Make changes to
 * events") and gives its Calendar ID. Nothing to sign in to, no password: connecting proves it is shared.
 */
export function GoogleConnect({
  projectId,
  resourceId,
  disabled,
  onBusy,
  onConnected,
  onError,
}: {
  projectId: string;
  resourceId: string;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onConnected: (r: BookingCalendarReading) => void;
  onError: (message: string) => void;
}) {
  const [account, setAccount] = useState<string | null | undefined>(undefined);
  const [proof, setProof] = useState('');
  const [calendarId, setCalendarId] = useState('');
  const [name, setName] = useState('');
  const [writes, setWrites] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, copy] = useCopy();

  useEffect(() => {
    let live = true;
    api
      .getBookingGoogle(projectId)
      .then((r) => {
        if (!live) return;
        setAccount(r.serviceAccount);
        setProof(r.proofCode ?? '');
      })
      .catch(() => live && setAccount(null));
    return () => {
      live = false;
    };
  }, [projectId]);

  const connect = async (): Promise<void> => {
    setBusy(true);
    onBusy(true);
    try {
      const r = await api.connectBookingCalendar(projectId, {
        kind: 'google',
        resourceId,
        name: name.trim() || 'Google calendar',
        calendarId: calendarId.trim(),
        writes,
      });
      setCalendarId('');
      setName('');
      onConnected(r);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'That did not work. Try again in a moment.');
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };

  if (account === undefined) {
    return (
      <p className="flex items-center gap-2 text-xs text-slate-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
      </p>
    );
  }
  if (!account) {
    return (
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Google calendars need the platform’s Google account (System Settings → Search engines). Ask the platform’s administrator.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-600 dark:text-slate-300">
        <li>
          In Google Calendar, open the calendar’s settings, then <strong>Share with specific people</strong>, and add{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono dark:bg-slate-800">{account}</code>{' '}
          <button type="button" className={smallGhostButton} onClick={() => copy(account, 'google-account')} aria-label="Copy the address to share with">
            {copied === 'google-account' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{' '}
            {copied === 'google-account' ? 'Copied' : 'Copy'}
          </button>{' '}
          with <strong>Make changes to events</strong>.
        </li>
        <li>
          To prove the calendar is yours, add{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono dark:bg-slate-800">{proof}</code>{' '}
          <button type="button" className={smallGhostButton} onClick={() => copy(proof, 'google-proof')} aria-label="Copy the code for the calendar’s description">
            {copied === 'google-proof' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied === 'google-proof' ? 'Copied' : 'Copy'}
          </button>{' '}
          to its <strong>Description</strong> (you can remove it once connected).
        </li>
        <li>
          Copy the <strong>Calendar ID</strong> from <strong>Integrate calendar</strong>, a little further down, into the box below.
        </li>
      </ol>
      <div className="grid gap-2 sm:grid-cols-2">
        <TextField label="Calendar ID" value={calendarId} placeholder="…@group.calendar.google.com" onChange={setCalendarId} autoComplete="off" />
        <TextField label="Calendar name" value={name} placeholder="Anna’s Google calendar" onChange={setName} />
      </div>
      <ToggleRow label="Also put the bookings into this calendar" checked={writes} onChange={setWrites}>
        Every booking and request goes into it (requests as tentative), and comes out again when cancelled or declined.
      </ToggleRow>
      <button type="button" className={`${ghostButton} self-start`} disabled={disabled || busy || !calendarId.trim()} onClick={() => void connect()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Connect
      </button>
    </div>
  );
}
