import { AnimatePresence, motion } from 'motion/react';
import { glassInput, ghostButton } from '../../theme';
import { newShopChannel, type KeyedShopChannel } from './model';

const KINDS: Array<{ value: KeyedShopChannel['kind']; label: string }> = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'mailto', label: 'Email (mailto)' },
  { value: 'payment', label: 'Payment link' },
  { value: 'form', label: 'Order form' },
];

/**
 * Inline editor for the mini-shop submission channels — a discriminated list (whatsapp/mailto/payment/
 * form). Each row picks a `kind` and shows only that kind's fields; an optional label overrides the
 * cart's default button text. Rows are keyed on a stable id so add/remove animate cleanly.
 */
export function ShopChannelsEditor({ rows, onChange }: { rows: KeyedShopChannel[]; onChange: (rows: KeyedShopChannel[]) => void }) {
  const set = (id: string, patch: Partial<KeyedShopChannel>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-3">
      <AnimatePresence initial={false}>
        {rows.map((r, i) => (
          <motion.div
            key={r.id}
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className="rounded-lg border border-slate-200/70 p-3"
          >
            <div className="flex items-center gap-2">
              <select
                aria-label={`Channel ${i + 1} kind`}
                className={`${glassInput} w-40`}
                value={r.kind}
                onChange={(e) => set(r.id, { kind: e.target.value as KeyedShopChannel['kind'] })}
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
              <input
                aria-label={`Channel ${i + 1} label`}
                className={glassInput}
                value={r.label}
                placeholder="Button label (optional)"
                onChange={(e) => set(r.id, { label: e.target.value })}
              />
              <button
                type="button"
                aria-label={`Remove channel ${i + 1}`}
                onClick={() => onChange(rows.filter((x) => x.id !== r.id))}
                className="shrink-0 rounded-md px-2 py-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
              >
                ✕
              </button>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {r.kind === 'whatsapp' && (
                <>
                  <input aria-label={`Channel ${i + 1} WhatsApp number`} className={glassInput} value={r.number} placeholder="+14155550123 (E.164)" onChange={(e) => set(r.id, { number: e.target.value })} />
                  <input aria-label={`Channel ${i + 1} intro`} className={glassInput} value={r.intro} placeholder="Intro line (optional)" onChange={(e) => set(r.id, { intro: e.target.value })} />
                </>
              )}
              {r.kind === 'mailto' && (
                <>
                  <input aria-label={`Channel ${i + 1} email`} className={glassInput} value={r.email} placeholder="orders@acme.com" onChange={(e) => set(r.id, { email: e.target.value })} />
                  <input aria-label={`Channel ${i + 1} subject`} className={glassInput} value={r.subject} placeholder="Subject (optional)" onChange={(e) => set(r.id, { subject: e.target.value })} />
                </>
              )}
              {r.kind === 'payment' && (
                <>
                  <input aria-label={`Channel ${i + 1} payment URL template`} className={glassInput} value={r.urlTemplate} placeholder="https://paypal.me/acme/{total}" onChange={(e) => set(r.id, { urlTemplate: e.target.value })} />
                  <select aria-label={`Channel ${i + 1} provider`} className={glassInput} value={r.provider} onChange={(e) => set(r.id, { provider: e.target.value })}>
                    <option value="">Provider (optional)</option>
                    <option value="paypal">PayPal</option>
                    <option value="stripe">Stripe</option>
                    <option value="custom">Custom</option>
                  </select>
                </>
              )}
              {r.kind === 'form' && (
                <input aria-label={`Channel ${i + 1} form id`} className={glassInput} value={r.formId} placeholder="Form id (an existing Form)" onChange={(e) => set(r.id, { formId: e.target.value })} />
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      <button type="button" onClick={() => onChange([...rows, newShopChannel()])} className={`${ghostButton} self-start`}>
        + Add channel
      </button>
    </div>
  );
}
