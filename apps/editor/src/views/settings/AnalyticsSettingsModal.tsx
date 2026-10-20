import { useEffect, useRef, useState } from 'react';
import type { Consent, ConsentIntegration } from '@sitewright/schema';
import { ghostButton } from '../../theme';
import { Modal } from '../ui/Modal';
import { ConsentIntegrationsEditor } from './ConsentIntegrationsEditor';
import { isAnalyticsIntegration, stalledAnalytics } from './analytics';
import type { Patch, SettingsForm } from './model';

/** The schema's cap on `website.consent.integrations`, analytics and other integrations together. */
const MAX_INTEGRATIONS = 20;

/**
 * The site's ANALYTICS tools, in a modal opened from the Analytics tile. They live in the same integration
 * registry the consent manager gates (`website.consent.integrations`), so this edits the analytics rows of that
 * list IN PLACE (order and ids kept) and leaves every other integration (a chat widget, a pixel) where it is. A
 * tool that waits for consent while the banner is off can never load; the modal says so and offers to turn the
 * banner on.
 */
export function AnalyticsSettingsModal({ form, patch, onClose }: { form: SettingsForm; patch: Patch; onClose: () => void }) {
  const c: Consent = form.consent ?? {};
  const all = c.integrations ?? [];
  // The rows this modal shows: the analytics ones when it opened, plus any added here. Re-filtering on every
  // render would make a custom row vanish mid-edit the moment its category was switched away from Analytics.
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set(all.filter(isAnalyticsIntegration).map((i) => i.id)));
  const rows = all.filter((i) => shown.has(i.id));
  const setRows = (next: ConsentIntegration[]): void => {
    const byId = new Map(next.map((r) => [r.id, r] as const));
    const merged = all.filter((i) => !shown.has(i.id) || byId.has(i.id)).map((i) => byId.get(i.id) ?? i); // removed rows go
    const added = next.filter((r) => !all.some((i) => i.id === r.id));
    if (added.length) setShown(new Set([...shown, ...added.map((r) => r.id)]));
    patch({ consent: { ...c, integrations: [...merged, ...added] } });
  };
  const stalled = stalledAnalytics(c);
  // Turning the banner on removes the button that did it: keep keyboard focus in the dialog, and say it happened.
  const body = useRef<HTMLDivElement>(null);
  const [bannerTurnedOn, setBannerTurnedOn] = useState(false);
  useEffect(() => {
    if (bannerTurnedOn) body.current?.querySelector<HTMLElement>('input, select, button')?.focus();
  }, [bannerTurnedOn]);
  return (
    <Modal title="Analytics" size="2xl" onClose={onClose}>
      <div ref={body} className="flex flex-col gap-4 p-5">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Connect the analytics tool the site uses; copy its id from the tool’s own snippet. Plausible, Umami, Fathom, Simple Analytics and Matomo
          (with its cookies switched off) set nothing on the visitor’s device, so they can load without asking. Every other tool loads only after the
          visitor accepts Analytics in the consent banner. Whether a cookieless tool still needs consent depends on where the site’s visitors are.
        </p>
        {stalled.length > 0 && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300/70 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <span className="min-w-0 flex-1">
              {stalled.map((i) => i.name).join(', ')} {stalled.length === 1 ? 'waits' : 'wait'} for visitor consent, but the consent banner is off, so{' '}
              {stalled.length === 1 ? 'it' : 'they'} will not load.
            </span>
            <button
              type="button"
              className={ghostButton}
              onClick={() => {
                patch({ consent: { ...c, enabled: true } });
                setBannerTurnedOn(true);
              }}
            >
              Turn on the consent banner
            </button>
          </div>
        )}
        {bannerTurnedOn && stalled.length === 0 && (
          <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">
            The consent banner is on. Save to publish it.
          </p>
        )}
        <ConsentIntegrationsEditor rows={rows} onChange={setRows} addLabel="+ Add analytics tool" max={Math.max(0, MAX_INTEGRATIONS - (all.length - rows.length))} />
      </div>
    </Modal>
  );
}
