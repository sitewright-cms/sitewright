import { Languages } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { SubLabel } from './ui';
import { Field } from './ui';
import { ShopChannelsEditor } from './ShopChannelsEditor';
import { glassInput, fieldLabel, ghostButton } from '../../theme';
import type { Patch, SettingsForm } from './model';

/**
 * The mini-shop STRUCTURE, in a modal (opened from the Shop card's Edit button once the shop is enabled).
 * Edits patch the settings draft live — the section's global Save persists everything. This holds only the
 * non-text config: currency FORMATTING (symbol placement + decimals) and the checkout channels (kind +
 * config + a stable `key` per channel/field). ALL display TEXT — the add-to-cart button, drawer
 * title/note/etc., currency symbol/code, and each channel/field label — is TRANSLATABLE and edited in
 * "Translations & Labels" (the catalog), reached via the button below.
 */
export function ShopSettingsModal({ form, patch, onClose }: { form: SettingsForm; patch: Patch; onClose: () => void }) {
  // Jump to the always-visible "Translations & Labels" card: close this modal, then scroll it into view.
  const editLabels = (): void => {
    onClose();
    setTimeout(() => document.getElementById('translations-labels')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };
  return (
    <Modal title="Shop settings" size="2xl" onClose={onClose}>
      <div className="flex flex-col gap-4 p-5">
        <div className="rounded-lg border border-indigo-200/70 bg-indigo-50/50 p-3 text-xs text-slate-600">
          <p>
            <strong className="font-semibold text-slate-700">Where are the labels?</strong> The cart's wording —
            the add-to-cart button, drawer title/note, currency symbol &amp; code, and each channel/field label —
            is <strong>translatable</strong>, so it lives in <strong>Translations &amp; Labels</strong> (one row
            per locale), not here. This screen holds only the shop's structure. Cart labels use the reserved{' '}
            <code>cart_*</code> keys; each channel/field label uses its <code>shop.&lt;key&gt;</code> key.
          </p>
          <button type="button" onClick={editLabels} className={`${ghostButton} mt-2`}>
            <Languages className="mr-1 inline h-4 w-4" /> Edit Labels &amp; Translations
          </button>
        </div>

        <div>
          <SubLabel>Currency formatting</SubLabel>
          <p className="mb-2 text-[11px] text-slate-400">
            The symbol &amp; ISO code are translatable (Translations &amp; Labels → <code>cart_currency_symbol</code> /{' '}
            <code>cart_currency_code</code>). Here you set only how the amount is formatted.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={fieldLabel}>Symbol position</span>
              <select
                className={glassInput}
                aria-label="Symbol position"
                value={form.shopCurrencyPosition}
                onChange={(e) => patch({ shopCurrencyPosition: e.target.value as 'before' | 'after' })}
              >
                <option value="before">Before ($9.99)</option>
                <option value="after">After (9.99 €)</option>
              </select>
            </label>
            <Field label="Decimals" value={form.shopCurrencyDecimals} onChange={(v) => patch({ shopCurrencyDecimals: v })} type="number" placeholder="2" />
          </div>
        </div>

        <div>
          <SubLabel>Checkout channels</SubLabel>
          <ShopChannelsEditor rows={form.shopChannels} onChange={(shopChannels) => patch({ shopChannels })} />
        </div>
      </div>
    </Modal>
  );
}
