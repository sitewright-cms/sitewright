import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { SHOP_MAX_CHANNEL_FIELDS, type ShopFieldType } from '@sitewright/schema';
import { glassInput, ghostButton, toggleInput } from '../../theme';
import { newShopChannel, newShopField, type KeyedShopChannel, type KeyedShopField } from './model';

/** Glass select styling WITHOUT a width util, so a native <select> auto-sizes to its widest option. */
const glassSelectAuto =
  'sw-brand-focus shrink-0 rounded-lg border border-white/60 bg-white/70 px-2 py-2 text-sm text-slate-800 shadow-sm outline-none transition';

const KINDS: Array<{ value: KeyedShopChannel['kind']; label: string }> = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'mailto', label: 'Email (mailto)' },
  { value: 'payment', label: 'Payment link' },
  { value: 'form', label: 'Order form' },
];

/** Order-field input types + their labels (mirrors the schema SHOP_FIELD_TYPES enum; `satisfies` keeps each value valid). */
const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Multi-line' },
  { value: 'tel', label: 'Phone' },
  { value: 'email', label: 'Email' },
] satisfies Array<{ value: ShopFieldType; label: string }>;

/**
 * Per-channel buyer-input fields (whatsapp/mailto only). Each row is a label + input type + a required
 * flag; the cart collects these before the deep link opens and appends them as `Label: value` lines below
 * the order. Rows are keyed on a stable id so add/remove stays clean.
 */
function OrderFieldsEditor({
  fields,
  onChange,
  channelIndex,
}: {
  fields: KeyedShopField[];
  onChange: (fields: KeyedShopField[]) => void;
  channelIndex: number;
}) {
  const setField = (id: string, patch: Partial<KeyedShopField>) =>
    onChange(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  return (
    <div className="mt-2 rounded-md border border-slate-200/60 bg-slate-50/50 p-2">
      <p className="mb-1.5 text-xs font-medium text-slate-500">
        Order fields — collected before sending. Each has a stable <em>key</em>; its label text is set in Translations &amp; Labels under <code>shop.&lt;key&gt;</code>.
      </p>
      <div className="flex flex-col gap-2">
        {fields.map((f, fi) => (
          <div key={f.id} className="flex items-center gap-2">
            <input
              aria-label={`Channel ${channelIndex + 1} field ${fi + 1} key`}
              className={`${glassInput} flex-1 font-mono`}
              value={f.key}
              placeholder="field key (e.g. name)"
              onChange={(e) => setField(f.id, { key: e.target.value })}
            />
            <select
              aria-label={`Channel ${channelIndex + 1} field ${fi + 1} type`}
              className={glassSelectAuto}
              value={f.type}
              onChange={(e) => setField(f.id, { type: e.target.value as ShopFieldType })}
            >
              {FIELD_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
              <input
                type="checkbox"
                className={toggleInput}
                aria-label={`Channel ${channelIndex + 1} field ${fi + 1} required`}
                checked={f.required}
                onChange={(e) => setField(f.id, { required: e.target.checked })}
              />
              required
            </label>
            <button
              type="button"
              aria-label={`Remove field ${fi + 1} from channel ${channelIndex + 1}`}
              onClick={() => onChange(fields.filter((x) => x.id !== f.id))}
              className="shrink-0 rounded-md px-1.5 py-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={fields.length >= SHOP_MAX_CHANNEL_FIELDS}
        onClick={() => onChange([...fields, newShopField()])}
        className={`${ghostButton} mt-2 self-start text-xs disabled:cursor-not-allowed disabled:opacity-40`}
      >
        + Add field
      </button>
    </div>
  );
}

/**
 * Inline editor for the mini-shop submission channels — a discriminated list (whatsapp/mailto/payment/
 * form). Each row picks a `kind`, a stable `key` (its button LABEL text is translatable, set in
 * Translations & Labels under `shop.<key>`), and that kind's config fields. whatsapp/mailto rows also gain
 * an Order-fields sub-editor. Rows are keyed on a stable id so add/remove animate cleanly.
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
                aria-label={`Channel ${i + 1} key`}
                className={`${glassInput} font-mono`}
                value={r.key}
                placeholder="channel key (e.g. whatsapp)"
                onChange={(e) => set(r.id, { key: e.target.value })}
              />
              <button
                type="button"
                aria-label={`Remove channel ${i + 1}`}
                onClick={() => onChange(rows.filter((x) => x.id !== r.id))}
                className="shrink-0 rounded-md px-2 py-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
              >
                <X className="h-4 w-4" />
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
                    <option value="custom">Custom (incl. fixed Stripe links)</option>
                  </select>
                </>
              )}
              {r.kind === 'form' && (
                <input aria-label={`Channel ${i + 1} form id`} className={glassInput} value={r.formId} placeholder="Form id (an existing Form)" onChange={(e) => set(r.id, { formId: e.target.value })} />
              )}
            </div>
            {(r.kind === 'whatsapp' || r.kind === 'mailto') && (
              <OrderFieldsEditor fields={r.fields} onChange={(fields) => set(r.id, { fields })} channelIndex={i} />
            )}
          </motion.div>
        ))}
      </AnimatePresence>
      <button type="button" onClick={() => onChange([...rows, newShopChannel()])} className={`${ghostButton} self-start`}>
        + Add channel
      </button>
    </div>
  );
}
