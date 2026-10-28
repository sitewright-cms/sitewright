import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { BookingConfigSchema, type BookingConfig } from '@sitewright/schema';
import { api, ApiError, type BookingCalendar } from '../../../api';
import { notifyBookingChanged } from '../../../lib/booking-active';
import { useUnsavedWork } from '../../../lib/unsaved-work';
import { gradientSurface, ghostButton } from '../../../theme';
import { Modal } from '../../ui/Modal';
import { useDialogs } from '../../ui/Dialogs';
import { FeedSection } from './FeedSection';
import { GeneralPanel } from './GeneralPanel';
import { toBookingGateway, type BookingGateways } from './PaymentFields';
import { OfferingsPanel } from './OfferingsPanel';
import { ResourcesPanel, type CalendarAccess } from './ResourcesPanel';
import { EMPTY_CONFIG, issuesByPath, stableJson } from './model';

type Tab = 'offerings' | 'resources' | 'general';

/** A stored set-up with the schema's defaults filled in, so an untouched draft compares equal to it. */
function normalized(item: unknown): BookingConfig {
  const parsed = BookingConfigSchema.safeParse(item);
  return parsed.success ? parsed.data : { ...EMPTY_CONFIG, ...(item as Partial<BookingConfig>) };
}

/**
 * The BOOKING SET-UP: what visitors book (offerings), what a booking takes (resources, with their hours, blocked
 * times and outside calendars), and the set-up's own settings. Saved as one document, checked against the same
 * schema the server applies before it is sent, with the version it was read at (an agent may change it too).
 * Calendars act at once and are not part of the Save.
 */
export function BookingSetupModal({ projectId, onClose, onSaved }: { projectId: string; onClose: () => void; onSaved?: (config: BookingConfig) => void }) {
  const { confirm, dialog } = useDialogs();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState<BookingConfig>(EMPTY_CONFIG);
  const [version, setVersion] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<BookingConfig>(EMPTY_CONFIG);
  const [calendars, setCalendars] = useState<BookingCalendar[]>([]);
  const [calendarAccess, setCalendarAccess] = useState<CalendarAccess>('ok');
  const [tab, setTab] = useState<Tab>('offerings');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{
    tone: 'error' | 'ok';
    text: string;
    reload?: boolean;
  } | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setLoadError(null);
    void (async () => {
      const [config, cals] = await Promise.all([
        api
          .getBooking(projectId)
          .catch((err: unknown) => (err instanceof ApiError && err.status === 404 ? { item: EMPTY_CONFIG, version: undefined } : Promise.reject(err))),
        // A refusal is not "no calendars": the panel says which, and a resource cannot be removed blind.
        api
          .listBookingCalendars(projectId)
          .then((r) => ({ access: 'ok' as CalendarAccess, calendars: r.calendars }))
          .catch((err: unknown) => ({
            access: (err instanceof ApiError && err.status === 403 ? 'forbidden' : 'failed') as CalendarAccess,
            calendars: [] as BookingCalendar[],
          })),
      ]).catch((err: unknown) => {
        if (live) setLoadError(err instanceof ApiError ? err.message : 'The booking set-up could not be loaded.');
        return [null, null] as const;
      });
      if (!live || !config) return;
      const item = normalized(config.item);
      setSaved(item);
      setDraft(item);
      setVersion(config.version);
      setCalendars(cals?.calendars ?? []);
      setCalendarAccess(cals?.access ?? 'failed');
      setTab(item.resources.length === 0 ? 'resources' : 'offerings');
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [projectId, reloads]);

  // The payment providers, for paid offerings. Their own read: a refusal only leaves payment unchoosable.
  const [gateways, setGateways] = useState<BookingGateways>(undefined);
  useEffect(() => {
    let live = true;
    api
      .projectPaymentGateways(projectId)
      .then((r) => {
        if (live) setGateways(r.gateways.map(toBookingGateway));
      })
      .catch(() => {
        if (live) setGateways('failed');
      });
    return () => {
      live = false;
    };
  }, [projectId, reloads]);

  const issues = useMemo(() => issuesByPath(draft), [draft]);
  // Compared by content, whatever the order of the keys (a mode switched and back is not a change).
  const dirty = useMemo(() => stableJson(draft) !== stableJson(saved), [draft, saved]);
  // The latest draft, for a save that finishes after more was typed.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useUnsavedWork(dirty, 'Booking set-up');
  const savedResources = useMemo(() => new Set(saved.resources.map((r) => r.id)), [saved]);
  const savedOfferings = useMemo(() => new Set(saved.offerings.map((o) => o.id)), [saved]);
  const counts = {
    offerings: [...issues.keys()].filter((k) => k.startsWith('offerings')).length,
    resources: [...issues.keys()].filter((k) => k.startsWith('resources')).length,
    general: [...issues.keys()].filter((k) => !k.startsWith('offerings') && !k.startsWith('resources')).length,
  };

  const edit = (next: BookingConfig): void => {
    setDraft(next);
    setNotice(null);
  };

  const save = async (): Promise<void> => {
    if (issues.size > 0 || !dirty) return;
    setSaving(true);
    setNotice(null);
    const sent = draft;
    try {
      // The version it was read at; none (a first set-up) falls back to the shared version store.
      const r = await api.putBooking(projectId, sent, version);
      const item = normalized(r.item);
      setSaved(item);
      // ★ What was typed while it saved is kept: the draft becomes the stored copy only if it is still what was sent.
      if (stableJson(draftRef.current) === stableJson(sent)) setDraft(item);
      setVersion(r.version);
      setNotice({
        tone: 'ok',
        text: item.offerings.length ? 'Saved. Booking is on.' : 'Saved. Nothing is offered, so booking is off.',
      });
      notifyBookingChanged(projectId);
      onSaved?.(item);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setNotice({
          tone: 'error',
          text: 'The set-up was changed elsewhere meanwhile (another tab, or an agent). Reload it to see that version; your changes here would be lost.',
          reload: true,
        });
      } else {
        setNotice({
          tone: 'error',
          text: err instanceof ApiError ? err.message : 'The set-up could not be saved. Try again in a moment.',
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const tabs: ReadonlyArray<{ id: Tab; label: string }> = [
    { id: 'offerings', label: `Offerings (${draft.offerings.length})` },
    { id: 'resources', label: `Resources (${draft.resources.length})` },
    { id: 'general', label: 'Settings' },
  ];
  const tabIds = useId();
  // A tablist moves with the arrow keys (Home and End to its ends); Tab goes on into the panel.
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const at = tabs.findIndex((t) => t.id === tab);
    const to = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = tabs[(to + tabs.length) % tabs.length]!;
    setTab(next.id);
    document.getElementById(`${tabIds}-tab-${next.id}`)?.focus();
  };

  return (
    <Modal
      title="Booking set-up"
      size="2xl"
      onClose={onClose}
      onSave={() => void save()}
      saving={saving}
      saveDisabled={loading || !dirty || issues.size > 0}
      saveLabel="Save booking set-up"
      onBeforeClose={
        dirty
          ? () =>
              confirm({
                title: 'Discard changes',
                message: 'Discard your unsaved changes to the booking set-up?',
                confirmLabel: 'Discard',
              })
          : undefined
      }
    >
      {dialog}
      <div className="flex flex-col gap-4 p-5">
        {loading ? (
          loadError ? (
            <p className="flex items-center gap-2 text-sm text-rose-600 dark:text-rose-400">
              <AlertTriangle className="h-4 w-4" /> {loadError}
            </p>
          ) : (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the booking set-up…
            </p>
          )
        ) : (
          <>
            <div
              role="tablist"
              aria-label="Booking set-up"
              onKeyDown={onTabKey}
              className="flex flex-wrap gap-1 rounded-xl border border-slate-200/80 bg-white/50 p-1 dark:border-white/10 dark:bg-white/5"
            >
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`${tabIds}-tab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls={`${tabIds}-panel`}
                  tabIndex={tab === t.id ? 0 : -1}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    tab === t.id ? gradientSurface : 'text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-white/10'
                  }`}
                >
                  {t.label}
                  {counts[t.id] > 0 && (
                    <span className="rounded-full bg-rose-500 px-1.5 text-xs font-semibold text-white">
                      {counts[t.id]}
                      <span className="sr-only"> to fix</span>
                    </span>
                  )}
                </button>
              ))}
            </div>

            {dirty && issues.size > 0 && (
              <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                {issues.size === 1 ? 'One thing to fix' : `${issues.size} things to fix`} before saving: {[...issues.values()][0]}
              </p>
            )}
            {notice && (
              <div
                role={notice.tone === 'error' ? 'alert' : 'status'}
                className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs ${
                  notice.tone === 'error'
                    ? 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300'
                    : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300'
                }`}
              >
                <span className="min-w-0 flex-1">{notice.text}</span>
                {notice.reload && (
                  <button type="button" className={ghostButton} onClick={() => setReloads((n) => n + 1)}>
                    Reload
                  </button>
                )}
              </div>
            )}

            <div role="tabpanel" id={`${tabIds}-panel`} aria-labelledby={`${tabIds}-tab-${tab}`}>
              {tab === 'offerings' && <OfferingsPanel draft={draft} onChange={edit} issues={issues} savedIds={savedOfferings} />}
              {tab === 'resources' && (
                <ResourcesPanel
                  projectId={projectId}
                  draft={draft}
                  onChange={edit}
                  issues={issues}
                  savedIds={savedResources}
                  calendars={calendars}
                  calendarAccess={calendarAccess}
                  onCalendars={(update) => setCalendars(update)}
                  onRemoveBlocked={(text) => setNotice({ tone: 'error', text })}
                />
              )}
              {tab === 'general' && (
                <div className="flex flex-col gap-5">
                  <GeneralPanel draft={draft} onChange={edit} issues={issues} gateways={gateways} />
                  {/* The SAVED resources: a feed for one names it by an id the server knows. */}
                  <FeedSection projectId={projectId} resources={saved.resources} />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
