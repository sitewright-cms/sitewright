import { Languages } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { SubLabel } from './ui';
import { Field } from './ui';
import { ShopChannelsEditor, type AvailableGateway } from './ShopChannelsEditor';
import { glassInput, fieldLabel, ghostButton, toggleInput } from '../../theme';
import type { Patch, SettingsForm } from './model';

/**
 * The mini-shop STRUCTURE, in a modal (opened from the Shop card's Edit button once the shop is enabled).
 * Edits patch the settings draft live — the section's global Save persists everything. This holds only the
 * non-text config: currency FORMATTING (symbol placement + decimals) and the checkout channels (kind +
 * config + a stable `key` per channel/field). ALL display TEXT — the add-to-cart button, drawer
 * title/note/etc., currency symbol/code, and each channel/field label — is TRANSLATABLE and edited in
 * "Translations & Labels" (the catalog), reached via the button below.
 */
export function ShopSettingsModal({
  form,
  patch,
  onClose,
  gateways = [],
  onEditLabels,
}: {
  form: SettingsForm;
  patch: Patch;
  onClose: () => void;
  gateways?: AvailableGateway[];
  /** Opens Translations & Labels. Absent falls back to scrolling to the on-page anchor. */
  onEditLabels?: () => void;
}) {
  // A checkout channel cannot be saved without a settlement currency — the schema refuses it, so the
  // form says so BEFORE the save fails rather than after.
  const needsCurrency = form.shopChannels.some((c) => c.kind === 'checkout');
  // Jump to the always-visible "Translations & Labels" card: close this modal, then scroll it into view.
  const editLabels = (): void => {
    onClose();
    if (onEditLabels) {
      onEditLabels();
      return;
    }
    setTimeout(() => document.getElementById('translations-labels')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };
  return (
    <Modal title="Shop settings" size="2xl" onClose={onClose}>
      <div className="flex flex-col gap-4 p-5">
        <div className="rounded-lg border border-indigo-200/70 dark:border-indigo-500/20 bg-indigo-50/50 dark:bg-indigo-500/10 p-3 text-xs text-slate-600 dark:text-slate-300">
          <p>
            <strong className="font-semibold text-slate-700 dark:text-slate-200">Where are the labels?</strong> The cart's wording —
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
          <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">
            The symbol &amp; ISO code are translatable (Translations &amp; Labels → <code>cart.currency_symbol</code> /{' '}
            <code>cart.currency_code</code>). Here you set only how the amount is formatted.
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
          <SubLabel>Settlement currency</SubLabel>
          <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">
            The currency you are actually <strong>paid in</strong>, as a 3-letter ISO code (EUR, USD, GBP).
            Required once you take real payments — it decides what a provider charges, so it is one value
            for the shop, not a per-language display choice.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Currency code"
              value={form.shopCurrencyCode}
              onChange={(v) => patch({ shopCurrencyCode: v.toUpperCase().slice(0, 3) })}
              placeholder="EUR"
            />
            {needsCurrency && !form.shopCurrencyCode.trim() && (
              <p className="self-end rounded-md bg-amber-50 dark:bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-800 dark:text-amber-300">
                A checkout channel cannot be saved without this.
              </p>
            )}
          </div>
        </div>

        <div>
          <SubLabel>Shipping &amp; tax</SubLabel>
          <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">
            Added to the total <strong>on the server</strong>, so what a buyer confirms is what they are
            charged. Leave blank for none. This is a single rate for display and charging — not tax
            determination: there are no per-country rates or thresholds.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={`Shipping (flat${form.shopCurrencyCode ? `, ${form.shopCurrencyCode}` : ''})`}
              value={form.shopShippingFlat}
              onChange={(v) => patch({ shopShippingFlat: v })}
              placeholder="4.99"
            />
            <Field
              label="Free shipping over"
              value={form.shopShippingFreeOver}
              onChange={(v) => patch({ shopShippingFreeOver: v })}
              placeholder="50.00"
            />
            <Field label="Tax rate (%)" value={form.shopTaxRate} onChange={(v) => patch({ shopTaxRate: v })} placeholder="19" />
            <label className="block">
              <span className={fieldLabel}>Prices are</span>
              <select
                className={glassInput}
                aria-label="Tax mode"
                value={form.shopTaxMode}
                onChange={(e) => patch({ shopTaxMode: e.target.value as 'inclusive' | 'exclusive' })}
              >
                <option value="inclusive">Tax included (shown for information)</option>
                <option value="exclusive">Tax added at checkout</option>
              </select>
            </label>
          </div>
        </div>

        <div>
          <SubLabel>Checkout channels</SubLabel>
          <ShopChannelsEditor rows={form.shopChannels} onChange={(shopChannels) => patch({ shopChannels })} gateways={gateways} />
        </div>

        <div>
          <SubLabel>Cart styling</SubLabel>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className={toggleInput}
              checked={form.shopPlatformCartStyles}
              onChange={(e) => patch({ shopPlatformCartStyles: e.target.checked })}
            />
            <span>
              Use the platform&rsquo;s cart styles
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                Your own CSS already overrides these. Turn it off only if you have rewritten the cart drawer
                yourself and the platform&rsquo;s rules are things you keep undoing — then no cart CSS ships at all.
              </span>
            </span>
          </label>
        </div>
      </div>
    </Modal>
  );
}
