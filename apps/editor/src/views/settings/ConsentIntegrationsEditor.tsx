import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { type ConsentIntegration } from '@sitewright/schema';
import { glassInput, ghostButton } from '../../theme';
import { newConsentIntegration } from './model';

/** Glass select styling WITHOUT a width util, so a native <select> auto-sizes to its widest option. */
const glassSelectAuto =
  'sw-brand-focus shrink-0 rounded-lg border border-white/60 bg-white/70 px-2 py-2 text-sm text-slate-800 shadow-sm outline-none transition';

const PRESETS: Array<{ value: NonNullable<ConsentIntegration['preset']>; label: string }> = [
  { value: 'ga4', label: 'Google Analytics 4' },
  { value: 'gtm', label: 'Google Tag Manager' },
  { value: 'custom', label: 'Custom script' },
];
const CATEGORIES: Array<{ value: ConsentIntegration['category']; label: string }> = [
  { value: 'functional', label: 'Functional' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'marketing', label: 'Marketing' },
];
const MAX = 20;

/**
 * The managed third-party INTEGRATIONS list. Each row is loaded only after its category is consented; the
 * per-site CSP origin allow-list is derived from these on publish. Mirrors the Shop-channels editor: a stable
 * `id` keys React, a "type" (preset) select drives which fields show (a measurement id for GA4/GTM, a script
 * url + optional extra origins for a custom script). The `id` is auto-generated and never edited.
 */
export function ConsentIntegrationsEditor({ rows, onChange }: { rows: ConsentIntegration[]; onChange: (rows: ConsentIntegration[]) => void }) {
  const set = (id: string, patch: Partial<ConsentIntegration>): void => onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const setOrigins = (id: string, text: string): void => {
    const arr = text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    set(id, { origins: arr.length ? arr : undefined });
  };
  return (
    <div className="flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {rows.map((r, i) => {
          const preset = r.preset ?? 'custom';
          return (
            <motion.div key={r.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden rounded-xl border border-white/60 bg-white/50 p-3 shadow-sm">
              <div className="flex items-start gap-2">
                <input aria-label={`Integration ${i + 1} name`} className={`${glassInput} min-w-0 flex-1`} value={r.name} placeholder="Google Analytics" onChange={(e) => set(r.id, { name: e.target.value })} />
                <select
                  aria-label={`Integration ${i + 1} type`}
                  className={glassSelectAuto}
                  value={preset}
                  // Clear the OTHER preset's identifying fields so a stale G-XXX / src doesn't fail the new
                  // preset's validation on save (e.g. a ga4 measurementId left on a gtm row → 400).
                  onChange={(e) => set(r.id, { preset: e.target.value as NonNullable<ConsentIntegration['preset']>, measurementId: undefined, src: undefined, origins: undefined })}
                >
                  {PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <select aria-label={`Integration ${i + 1} category`} className={glassSelectAuto} value={r.category} onChange={(e) => set(r.id, { category: e.target.value as ConsentIntegration['category'] })}>
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <button type="button" aria-label={`Remove integration ${i + 1}`} onClick={() => onChange(rows.filter((x) => x.id !== r.id))} className="shrink-0 rounded-md px-2 py-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {(preset === 'ga4' || preset === 'gtm') && (
                  <input aria-label={`Integration ${i + 1} measurement id`} className={glassInput} value={r.measurementId ?? ''} placeholder={preset === 'ga4' ? 'G-XXXXXXX' : 'GTM-XXXXXX'} onChange={(e) => set(r.id, { measurementId: e.target.value })} />
                )}
                {preset === 'custom' && (
                  <>
                    <input aria-label={`Integration ${i + 1} script url`} className={glassInput} value={r.src ?? ''} placeholder="https://widget.example.com/c.js" onChange={(e) => set(r.id, { src: e.target.value.trim() || undefined })} />
                    <input aria-label={`Integration ${i + 1} extra origins`} className={glassInput} value={(r.origins ?? []).join(' ')} placeholder="Extra hosts (optional): *.intercom.io" onChange={(e) => setOrigins(r.id, e.target.value)} />
                  </>
                )}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
      {rows.length < MAX && (
        <button type="button" onClick={() => onChange([...rows, newConsentIntegration()])} className={`${ghostButton} self-start`}>
          + Add integration
        </button>
      )}
    </div>
  );
}
