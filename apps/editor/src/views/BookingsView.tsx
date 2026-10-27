import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarCheck, Loader2, Mail, Phone, RefreshCw } from 'lucide-react';
import { api, type BookingItem, type BookingList, type Project } from '../api';
import { accentChip, dangerButton, ghostButton, glassCard, primaryButton } from '../theme';

/**
 * The project's BOOKINGS tab: what visitors booked on the site, and the requests waiting for an answer. Like
 * Orders it is daily work, not configuration, and the tab exists only while the project takes bookings (its
 * booking set-up offers something; see `useBookingActive`).
 *
 * ★ Times are on the BOOKING's clock (its resource's time zone), the one the customer booked on and was mailed;
 * the zone is named when it is not this browser's.
 * ★ Every answer mails the customer, so each asks once more before it goes, saying so.
 */

type View = 'upcoming' | 'requests' | 'past';
const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'requests', label: 'Requests' },
  { id: 'past', label: 'Past' },
];
type Answer = 'accept' | 'decline' | 'cancel';

const browserZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return '';
  }
};

/**
 * Whether a booking's clock reads differently from this browser's at its start. Compared by the time each shows,
 * not by the zones' names: `Europe/Berlin` and `Europe/Brussels` are different names for the same clock.
 */
export function onAnotherClock(b: Pick<BookingItem, 'start' | 'timeZone'>, zone: string = browserZone()): boolean {
  const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  try {
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: b.timeZone }).format(b.start) !== new Intl.DateTimeFormat('en-US', { ...opts, ...(zone ? { timeZone: zone } : {}) }).format(b.start);
  } catch {
    return false;
  }
}

/** A zone's everyday name ("Central European Time"), else its id. */
function zoneName(timeZone: string, at: number): string {
  try {
    const part = new Intl.DateTimeFormat(undefined, { timeZone, timeZoneName: 'longGeneric' }).formatToParts(at).find((p) => p.type === 'timeZoneName');
    if (part?.value) return part.value;
  } catch {
    // An unknown zone: its id says it plainly.
  }
  return timeZone.replace(/_/g, ' ');
}

/** A plain address, safe to put in a mailto link: nothing that would add a header or a body to the draft. */
const PLAIN_ADDRESS = /^[^\s?%&#@]+@[^\s?%&#@]+$/;

function fmt(timeZone: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone, ...opts });
  } catch {
    return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...opts });
  }
}

/** The day a booking starts, on its own clock: the list's group heading. */
export function bookingDay(b: Pick<BookingItem, 'start' | 'timeZone'>): string {
  return fmt(b.timeZone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(b.start);
}

/** When a booking runs, on its own clock: times for appointments and rooms, dates for days and stays. */
export function bookingSpan(b: Pick<BookingItem, 'start' | 'end' | 'timeZone' | 'offering'>): string {
  const date = fmt(b.timeZone, { weekday: 'short', day: 'numeric', month: 'short' });
  const time = fmt(b.timeZone, { hour: 'numeric', minute: '2-digit' });
  if (b.offering.mode === 'days' && b.offering.unit === 'day') {
    const last = b.end - 1;
    return date.format(b.start) === date.format(last) ? date.format(b.start) : `${date.format(b.start)} – ${date.format(last)}`;
  }
  if (b.offering.mode === 'days') return `${date.format(b.start)}, ${time.format(b.start)} – ${date.format(b.end)}, ${time.format(b.end)}`;
  const sameDay = date.format(b.start) === date.format(b.end);
  return `${time.format(b.start)} – ${sameDay ? '' : `${date.format(b.end)}, `}${time.format(b.end)}`;
}

/** A moment in this browser's own terms, to the minute: when it was booked, when a request must be answered. */
const moment = (ms: number): string => {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(ms);
  } catch {
    return new Date(ms).toLocaleString();
  }
};

const STATE_TONE: Record<string, string> = {
  booked: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
};
const STATE_LABEL: Record<string, string> = { booked: 'Booked', pending: 'Request', hold: 'Held' };

/** What each answer says before it goes, and after. */
const ASK: Record<Answer, { question: string; button: string; done: string }> = {
  accept: { question: 'Accept this request? It becomes a booking, and the customer gets a confirmation by email.', button: 'Yes, accept', done: 'Accepted: the customer has been sent a confirmation.' },
  decline: { question: 'Decline this request? Its time becomes free again, and the customer is told by email.', button: 'Yes, decline', done: 'Declined: the customer has been told.' },
  cancel: { question: 'Cancel this booking? Its time becomes free again, and the customer is told by email.', button: 'Yes, cancel it', done: 'Cancelled: the customer has been told.' },
};

export function BookingsView({ project }: { project: Project }) {
  return (
    <section className={`${glassCard} overflow-hidden`} aria-labelledby="bookings-heading">
      <header className="flex items-center gap-3 border-b border-slate-200/70 bg-slate-100/70 px-5 py-3 dark:border-slate-700/70 dark:bg-white/10">
        <span className={accentChip} aria-hidden>
          <CalendarCheck className="h-4 w-4" />
        </span>
        <h2 id="bookings-heading" className="text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
          Bookings
        </h2>
        <span className="text-sm text-slate-500 dark:text-slate-400">What visitors booked, and the requests waiting for you</span>
      </header>
      <BookingsPanel projectId={project.id} />
    </section>
  );
}

export function BookingsPanel({ projectId }: { projectId: string }) {
  const [view, setView] = useState<View>('upcoming');
  const [list, setList] = useState<BookingList | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  /** The answer being asked about, on the open booking. */
  const [asking, setAsking] = useState<Answer | null>(null);
  const [answering, setAnswering] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  // Only the newest load draws: a slow answer for the view the author just left must not land over the one they chose.
  const loads = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const mine = ++loads.current;
    setBusy(true);
    try {
      const got = await api.listBookings(projectId, view);
      if (mine !== loads.current) return;
      setList(got);
      setFailed(false);
    } catch {
      if (mine === loads.current) setFailed(true);
    } finally {
      if (mine === loads.current) setBusy(false);
    }
  }, [projectId, view]);

  useEffect(() => {
    void load();
  }, [load]);

  const zone = browserZone();
  // Grouped by the day each booking starts, on its own clock. The list arrives in order, so groups do too.
  const groups = useMemo(() => {
    const out: Array<{ day: string; items: BookingItem[] }> = [];
    for (const b of list?.bookings ?? []) {
      const day = bookingDay(b);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(b);
      else out.push({ day, items: [b] });
    }
    return out;
  }, [list]);

  const answer = async (b: BookingItem, what: Answer): Promise<void> => {
    setAnswering(true);
    setNote(null);
    try {
      await api.answerBooking(projectId, b.id, what);
      setNote({ tone: 'ok', text: ASK[what].done });
      setAsking(null);
      // Close the row answered, not whichever the author opened meanwhile.
      setOpen((o) => (o === b.id ? null : o));
      await load();
    } catch (e) {
      const d = (e as { details?: { error?: string } }).details;
      setNote({ tone: 'error', text: d?.error ? `That did not work: ${d.error}.` : 'That did not work. Please try again.' });
      setAsking(null);
      await load();
    } finally {
      setAnswering(false);
    }
  };

  const undelivered = list?.undelivered;
  // Times are on each booking's own clock; say whose when it is not this browser's.
  const elsewhere = (list?.bookings ?? []).find((b) => onAnotherClock(b, zone));
  const empty =
    view === 'requests' ? 'No requests are waiting for an answer.' : view === 'past' ? 'No past bookings. A booking is kept for a week after it ends.' : 'No upcoming bookings.';

  return (
    <div className="flex flex-col gap-3 p-5" aria-busy={busy}>
      {/* Telling someone by mail that their mail does not work would not reach them: it goes where they look. */}
      {undelivered && (undelivered.failed > 0 || undelivered.retrying > 0) && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200/70 bg-amber-50/60 p-3 text-xs text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {undelivered.failed > 0 && <strong>{undelivered.failed} booking email(s) could not be sent. </strong>}
            {undelivered.retrying > 0 && <strong>{undelivered.retrying} booking email(s) are being retried. </strong>}
            {undelivered.lastError && <span className="block opacity-80">Last error: {undelivered.lastError}</span>}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Which bookings" className="flex gap-1 rounded-xl border border-slate-200/70 bg-white/50 p-0.5 dark:border-white/10 dark:bg-white/5">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={view === v.id}
              onClick={() => {
                setView(v.id);
                setOpen(null);
                setAsking(null);
                setNote(null);
              }}
              className={`rounded-lg px-3 py-1 text-sm font-medium transition ${
                view === v.id ? 'bg-white text-slate-900 shadow-sm dark:bg-white/15 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {v.label}
              {v.id === 'requests' && (list?.requests ?? 0) > 0 && (
                <>
                  <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white" aria-hidden>
                    {list?.requests}
                  </span>
                  <span className="sr-only"> ({list?.requests} waiting)</span>
                </>
              )}
            </button>
          ))}
        </div>
        <button type="button" className={ghostButton} onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" aria-hidden /> Refresh
        </button>
        {list && (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {list.total} {list.total === 1 ? 'booking' : 'bookings'}
            {list.total > list.bookings.length && ` (the first ${list.bookings.length} shown)`}
          </span>
        )}
        {busy && <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-hidden />}
      </div>

      {elsewhere && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Times are shown on each booking&#8217;s own clock: {zoneName(elsewhere.timeZone, elsewhere.start)}.
        </p>
      )}

      {note && (
        <p role="status" className={`text-sm ${note.tone === 'ok' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
          {note.text}
        </p>
      )}
      {failed && <p className="text-sm text-rose-700 dark:text-rose-300">The bookings could not be loaded. Refresh to try again.</p>}
      {list && list.bookings.length === 0 && !busy && <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">{empty}</p>}

      {/* Keyed by position too: bookings in two time zones can share a day label, apart in the list. */}
      {groups.map((g, gi) => (
        <div key={`${gi}-${g.day}`}>
          <h3 className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{g.day}</h3>
          <ul className="divide-y divide-slate-200/60 rounded-lg border border-slate-200/60 dark:divide-slate-700/60 dark:border-slate-700/60">
            {g.items.map((b) => {
              const isOpen = open === b.id;
              const ended = b.end <= Date.now();
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`booking-${b.id}`}
                    onClick={() => {
                      setOpen(isOpen ? null : b.id);
                      setAsking(null);
                    }}
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    {/* A phone gives the time its own line, so the offering keeps its name. */}
                    <span className="w-full shrink-0 tabular-nums sm:w-44">{bookingSpan(b)}</span>
                    <span className="min-w-0 truncate font-medium sm:flex-1">{b.offering.name}</span>
                    <span className="text-slate-500 dark:text-slate-400">{b.resource.name}</span>
                    <span className="min-w-0 truncate text-slate-600 dark:text-slate-300">{b.customer.name || b.customer.email || '—'}</span>
                    {b.quantity > 1 && <span className="text-xs text-slate-500">× {b.quantity}</span>}
                    <span className={`rounded px-1.5 py-0.5 text-[11px] ${STATE_TONE[b.state] ?? ''}`}>{STATE_LABEL[b.state] ?? b.state}</span>
                  </button>
                  {isOpen && (
                    <div id={`booking-${b.id}`} className="border-t border-slate-200/60 bg-slate-50/60 px-3 py-3 text-sm dark:border-slate-700/60 dark:bg-slate-800/30">
                      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                        <dt className="text-slate-500 dark:text-slate-400">When</dt>
                        <dd>
                          {bookingDay(b)}, {bookingSpan(b)}
                          {onAnotherClock(b, zone) && <span className="text-slate-500 dark:text-slate-400"> ({zoneName(b.timeZone, b.start)})</span>}
                        </dd>
                        {b.customer.name && (
                          <>
                            <dt className="text-slate-500 dark:text-slate-400">Name</dt>
                            <dd>{b.customer.name}</dd>
                          </>
                        )}
                        {b.customer.email && (
                          <>
                            <dt className="text-slate-500 dark:text-slate-400">Email</dt>
                            <dd>
                              {/* A link only for a plain address: `a?cc=…@x` would shape the draft the business sends. */}
                              {PLAIN_ADDRESS.test(b.customer.email) ? (
                                <a className="inline-flex items-center gap-1 underline" href={`mailto:${b.customer.email}`}>
                                  <Mail className="h-3.5 w-3.5" aria-hidden />
                                  {b.customer.email}
                                </a>
                              ) : (
                                b.customer.email
                              )}
                            </dd>
                          </>
                        )}
                        {b.customer.phone && (
                          <>
                            <dt className="text-slate-500 dark:text-slate-400">Phone</dt>
                            <dd>
                              <a className="inline-flex items-center gap-1 underline" href={`tel:${b.customer.phone.replace(/[^\d+]/g, '')}`}>
                                <Phone className="h-3.5 w-3.5" aria-hidden />
                                {b.customer.phone}
                              </a>
                            </dd>
                          </>
                        )}
                        {b.customer.note && (
                          <>
                            <dt className="text-slate-500 dark:text-slate-400">Note</dt>
                            <dd className="whitespace-pre-wrap">{b.customer.note}</dd>
                          </>
                        )}
                        {b.quantity > 1 && (
                          <>
                            <dt className="text-slate-500 dark:text-slate-400">Places</dt>
                            <dd>{b.quantity}</dd>
                          </>
                        )}
                        <dt className="text-slate-500 dark:text-slate-400">Booked</dt>
                        <dd>{moment(b.createdAt)}</dd>
                        {b.state === 'pending' && b.expiresAt && (
                          <>
                            <dt className="text-slate-500 dark:text-slate-400">Answer by</dt>
                            <dd>{moment(b.expiresAt)}, or the request lapses and its time is free again</dd>
                          </>
                        )}
                      </dl>

                      {!ended && !asking && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {b.state === 'pending' && (
                            <>
                              <button type="button" className={primaryButton} onClick={() => setAsking('accept')}>
                                Accept
                              </button>
                              <button type="button" className={ghostButton} onClick={() => setAsking('decline')}>
                                Decline
                              </button>
                            </>
                          )}
                          {b.state === 'booked' && (
                            <button type="button" className={dangerButton} onClick={() => setAsking('cancel')}>
                              Cancel booking
                            </button>
                          )}
                        </div>
                      )}
                      {asking && (
                        <div className="mt-3 rounded-lg border border-slate-200/70 bg-white/70 p-3 dark:border-slate-700/70 dark:bg-white/5">
                          <p>{ASK[asking].question}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              className={asking === 'accept' ? primaryButton : dangerButton}
                              disabled={answering}
                              onClick={() => void answer(b, asking)}
                            >
                              {answering && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                              {ASK[asking].button}
                            </button>
                            <button type="button" className={ghostButton} disabled={answering} onClick={() => setAsking(null)}>
                              Back
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
