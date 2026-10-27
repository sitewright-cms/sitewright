import { useState } from 'react';
import { Link2, Loader2, Search } from 'lucide-react';
import { api, ApiError, type BookingCalendarReading } from '../../../api';
import { ghostButton } from '../../../theme';
import { TextField } from './fields';

/**
 * Connecting a calendar on a CALDAV server (Nextcloud, Fastmail, iCloud, Radicale…): the server's address, a
 * username and an app password find the account's calendars, and one of them is connected. ★ The password is
 * held only while this form is open: sent to find the calendars and to connect one, then cleared.
 */
export function CalDavConnect({
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
  const [server, setServer] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [found, setFound] = useState<Array<{ url: string; name: string }> | null>(null);
  const [chosen, setChosen] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<'find' | 'connect' | null>(null);

  const run = async (kind: 'find' | 'connect', work: () => Promise<void>): Promise<void> => {
    setBusy(kind);
    onBusy(true);
    try {
      await work();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'That did not work. Try again in a moment.');
    } finally {
      setBusy(null);
      onBusy(false);
    }
  };
  const find = () =>
    run('find', async () => {
      const r = await api.discoverBookingCalDav(projectId, { url: server.trim(), username, password });
      setFound(r.calendars);
      setChosen(r.calendars[0]?.url ?? '');
      setName(r.calendars[0]?.name ?? '');
      if (r.calendars.length === 0) onError('The account has no calendars for events on this server.');
    });
  const connect = () =>
    run('connect', async () => {
      const r = await api.connectBookingCalendar(projectId, { kind: 'caldav', resourceId, name: name.trim() || 'Calendar', url: chosen, username, password });
      setPassword('');
      setFound(null);
      onConnected(r);
    });

  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <TextField label="Server address" value={server} type="url" placeholder="https://cloud.example.com" onChange={setServer} autoComplete="off" />
        <TextField label="Username" value={username} placeholder="anna@example.com" onChange={setUsername} autoComplete="off" />
        {/* An app password for this, not the account's own: iCloud and Fastmail require one. */}
        <TextField label="App password" value={password} type="password" onChange={setPassword} autoComplete="new-password" />
      </div>
      <button
        type="button"
        className={`${ghostButton} self-start`}
        disabled={disabled || busy !== null || !server.trim() || !username || !password}
        onClick={() => void find()}
      >
        {busy === 'find' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Find calendars
      </button>
      {found && found.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200/70 bg-white/40 p-2.5 dark:border-white/10 dark:bg-white/5">
          <fieldset className="flex flex-wrap gap-2">
            <legend className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">Which calendar</legend>
            {found.map((c) => (
              <label
                key={c.url}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200/70 px-2.5 py-1 text-sm text-slate-700 dark:border-white/10 dark:text-slate-200"
              >
                <input
                  type="radio"
                  name={`caldav-${resourceId}`}
                  checked={chosen === c.url}
                  onChange={() => {
                    setChosen(c.url);
                    setName(c.name);
                  }}
                />
                {c.name}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,16rem)_auto] sm:items-end">
            <TextField label="Calendar name" value={name} onChange={setName} />
            <button type="button" className={ghostButton} disabled={disabled || busy !== null || !chosen} onClick={() => void connect()}>
              {busy === 'connect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Connect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
