import { Languages } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { SubLabel, Field } from './ui';
import { ConsentIntegrationsEditor } from './ConsentIntegrationsEditor';
import { glassInput, fieldLabel, ghostButton, toggleInput } from '../../theme';
import type { Patch, SettingsForm } from './model';
import type { Consent } from '@sitewright/schema';

const CATS: Array<{ id: 'functional' | 'analytics' | 'marketing'; label: string }> = [
  { id: 'functional', label: 'Functional' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'marketing', label: 'Marketing' },
];

/**
 * The CONSENT MANAGER structure, in a modal (opened from the Consent card's Edit button once consent is on).
 * Edits patch the `website.consent` object live; the section's global Save persists it. Holds only non-text
 * config: banner layout / reject button / privacy link / version, which optional categories to offer, and the
 * third-party integrations to gate (each loaded only after its category is consented — the publish step
 * derives the CSP origin allow-list from them). ALL banner COPY is translatable (reserved consent_* keys).
 */
export function ConsentSettingsModal({ form, patch, onClose }: { form: SettingsForm; patch: Patch; onClose: () => void }) {
  const c: Consent = form.consent ?? {};
  const setConsent = (partial: Partial<Consent>): void => patch({ consent: { ...c, ...partial } });
  const editLabels = (): void => {
    onClose();
    setTimeout(() => document.getElementById('translations-labels')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };
  // Which optional categories are offered (unset = all three).
  const offered = new Set(c.categories ?? ['functional', 'analytics', 'marketing']);
  const toggleCat = (id: 'functional' | 'analytics' | 'marketing', on: boolean): void => {
    const next = new Set(offered);
    if (on) next.add(id);
    else next.delete(id);
    const arr = CATS.map((x) => x.id).filter((x) => next.has(x));
    // all-3 = the default (store undefined); all-0 would offer NO optional categories (a dead consent flow),
    // so treat it the same as the default rather than letting the operator brick their own banner.
    setConsent({ categories: arr.length === 3 || arr.length === 0 ? undefined : arr });
  };
  const version = typeof c.version === 'number' ? c.version : 1;
  return (
    <Modal title="Consent settings" size="2xl" onClose={onClose}>
      <div className="flex flex-col gap-4 p-5">
        <div className="rounded-lg border border-indigo-200/70 bg-indigo-50/50 p-3 text-xs text-slate-600">
          <p>
            <strong className="font-semibold text-slate-700">Where is the wording?</strong> The banner heading, intro,
            button labels and category names/descriptions are <strong>translatable</strong>, so they live in{' '}
            <strong>Translations &amp; Labels</strong> (the reserved <code>consent_*</code> keys), not here. This screen
            holds only the structure + the third-party integrations to gate.
          </p>
          <button type="button" onClick={editLabels} className={`${ghostButton} mt-2`}>
            <Languages className="mr-1 inline h-4 w-4" /> Edit Labels &amp; Translations
          </button>
        </div>

        <div>
          <SubLabel>Banner</SubLabel>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={fieldLabel}>Layout</span>
              <select className={glassInput} aria-label="Banner layout" value={c.layout ?? 'bar'} onChange={(e) => setConsent({ layout: e.target.value === 'box' ? 'box' : undefined })}>
                <option value="bar">Bar — centered bottom strip</option>
                <option value="box">Box — bottom-left card</option>
              </select>
            </label>
            <Field label="Privacy policy link" value={c.privacyHref ?? ''} onChange={(v) => setConsent({ privacyHref: v || undefined })} placeholder="/privacy" />
          </div>
          <label className="mt-3 flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className={fieldLabel}>Show “Reject all” button</span>
              <span className="block text-[11px] text-slate-400">Recommended for GDPR — a one-click reject on the first layer.</span>
            </span>
            <input type="checkbox" role="switch" aria-label='Show "Reject all" button' className={toggleInput} checked={c.denyButton !== false} onChange={(e) => setConsent({ denyButton: e.target.checked ? undefined : false })} />
          </label>
        </div>

        <div>
          <SubLabel>Categories offered</SubLabel>
          <p className="mb-2 text-[11px] text-slate-400">“Strictly necessary” is always on. Uncheck a category to hide it from the preferences panel.</p>
          <div className="flex flex-wrap gap-4">
            {CATS.map((cat) => (
              <label key={cat.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="h-4 w-4 accent-indigo-600" aria-label={cat.label} checked={offered.has(cat.id)} onChange={(e) => toggleCat(cat.id, e.target.checked)} />
                {cat.label}
              </label>
            ))}
          </div>
        </div>

        <div>
          <SubLabel>Third-party integrations</SubLabel>
          <p className="mb-2 text-[11px] text-slate-400">Each loads ONLY after its category is consented; the site’s Content-Security-Policy is widened automatically to allow just these.</p>
          <ConsentIntegrationsEditor rows={c.integrations ?? []} onChange={(integrations) => setConsent({ integrations: integrations.length ? integrations : undefined })} />
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-white/60 bg-white/50 p-3 text-xs text-slate-600">
          <span>Changed your trackers? Re-ask every visitor for consent.</span>
          <button type="button" className={ghostButton} onClick={() => setConsent({ version: version + 1 })}>
            Re-ask everyone (v{version})
          </button>
        </div>
      </div>
    </Modal>
  );
}
