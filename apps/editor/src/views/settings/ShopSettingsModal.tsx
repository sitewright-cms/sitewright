import { Modal } from '../ui/Modal';
import { Field, SubLabel } from './ui';
import { ShopChannelsEditor } from './ShopChannelsEditor';
import { glassInput, fieldLabel } from '../../theme';
import type { Patch, SettingsForm } from './model';

/**
 * The full mini-shop configuration, in a modal (mirrors the skeleton-slot CodeField / Translations
 * edit pattern). Opened from the Shop card's **Edit** button once the shop is enabled. Edits patch the
 * settings draft live — like the rest of settings — so the modal needs no own save/cancel (the section's
 * global Save persists everything). Currency, the site-wide labels (these are the NON-localized fallback;
 * per-locale cart strings live in the translation catalog as reserved cart_* keys), and the checkout
 * channels all live here.
 */
export function ShopSettingsModal({ form, patch, onClose }: { form: SettingsForm; patch: Patch; onClose: () => void }) {
  return (
    <Modal title="Shop settings" size="2xl" onClose={onClose}>
      <div className="flex flex-col gap-4 p-5">
        <div>
          <SubLabel>Currency</SubLabel>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Currency code" value={form.shopCurrencyCode} onChange={(v) => patch({ shopCurrencyCode: v })} placeholder="USD" />
            <Field label="Currency symbol" value={form.shopCurrencySymbol} onChange={(v) => patch({ shopCurrencySymbol: v })} placeholder="$" />
            <label className="block">
              <span className={fieldLabel}>Position</span>
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
          <SubLabel>Labels</SubLabel>
          <p className="mb-2 text-[11px] text-slate-400">
            Site-wide fallback labels (one value for every language). For per-locale cart text, translate the
            reserved <code>cart_*</code> keys in the Translations table instead.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Add-to-cart button label" value={form.shopAddToCartLabel} onChange={(v) => patch({ shopAddToCartLabel: v })} placeholder="Add to cart" />
            <Field label="Cart drawer title" value={form.shopTitle} onChange={(v) => patch({ shopTitle: v })} placeholder="Your cart" />
          </div>
          <div className="mt-3">
            <Field
              label="Cart note (shown above checkout)"
              value={form.shopNote}
              onChange={(v) => patch({ shopNote: v })}
              placeholder="Prices are indicative. This sends an order request — the seller confirms availability and final price."
            />
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
