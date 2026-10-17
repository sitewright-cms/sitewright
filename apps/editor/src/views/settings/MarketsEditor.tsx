import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { COUNTRY_CODES, type ShopMarket, type ShopPricing } from '@sitewright/schema';
import { glassInput, fieldLabel, ghostButton, toggleInput } from '../../theme';
import { localeLabel } from '../i18n/locale-catalog';
import { majorToMinor, minorPlaces, minorToMajor } from './model';

/**
 * The shop's MARKETS: where it sells, in which currency, shipping where, at which shipping and tax,
 * through which checkout channels. The first market is the DEFAULT — the one a visitor lands in when
 * nothing else decides, and the one a plain `price=` sells in.
 *
 * Every rule a checkout depends on is the schema's (ShopSchema): this editor shows its verdict
 * (`issues`) rather than keeping a second copy of the rules that could drift from it.
 */
export interface MarketsEditorProps {
  markets: ShopMarket[];
  onChange: (markets: ShopMarket[]) => void;
  /** The shop's checkout channels, by key — what a market may offer. */
  checkoutChannels: ReadonlyArray<{ key: string; label: string }>;
  /** The site's languages — a market may be the default for one. */
  locales: readonly string[];
  /** The shop's own settlement currency: a market in it may use the shop's shipping and tax. */
  shopCurrency: string;
  /** The schema's complaints about the markets, as messages. */
  issues: readonly string[];
}

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();
const countryName = (code: string): string => {
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
};
const COUNTRIES = [...COUNTRY_CODES].map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name));

/** A copy of `obj` without `key` — an optional field cleared, rather than stored empty. */
function without<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

/** A market id from a name: lowercase letters, digits and underscores, never starting with a digit. */
function idFrom(name: string, taken: ReadonlySet<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'm_$1') || 'market';
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}_${i}`;
  return id;
}

/**
 * A number typed as text: kept exactly as typed while focused (so "4." and "7." survive), and committed
 * only when it parses — or is cleared. A half-typed value never reaches the stored settings.
 */
function DraftInput({
  label,
  shown,
  parse,
  onCommit,
  disabled,
  hint,
}: {
  label: string;
  shown: string;
  /** The stored value for what was typed, or `invalid` when it does not parse (yet). Blank = undefined. */
  parse: (typed: string) => number | undefined | 'invalid';
  onCommit: (value: number | undefined) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="block">
      <span className={fieldLabel}>{label}</span>
      <input
        className={glassInput}
        inputMode="decimal"
        aria-label={label}
        value={draft ?? shown}
        placeholder="none"
        disabled={disabled}
        title={hint}
        onFocus={() => setDraft(shown)}
        onBlur={() => setDraft(null)}
        onChange={(e) => {
          setDraft(e.target.value);
          const v = parse(e.target.value);
          if (v !== 'invalid') onCommit(v);
        }}
      />
      {hint && disabled && <span className="mt-0.5 block text-[10px] text-slate-500 dark:text-slate-400">{hint}</span>}
    </label>
  );
}

/** A money amount in MAJOR units of `currency`, stored in its minor units. */
const parseMoney = (currency: string) => (typed: string): number | undefined | 'invalid' => {
  if (typed.trim() === '') return undefined;
  return majorToMinor(typed, currency) ?? 'invalid';
};
/** A tax rate in percent, stored in basis points (19.6% → 1960). */
const parseRate = (typed: string): number | undefined | 'invalid' => {
  const v = typed.trim();
  if (v === '') return undefined;
  return /^\d+(\.\d+)?$/.test(v) && Number(v) <= 100 ? Math.round(Number(v) * 100) : 'invalid';
};

/** Minor units re-expressed for another currency's exponent, so the amount SHOWN stays the same. */
function rescaleMinor(minor: number | undefined, from: string, to: string): number | undefined {
  if (minor === undefined) return undefined;
  const shift = minorPlaces(to) - minorPlaces(from);
  return shift === 0 ? minor : Math.round(minor * 10 ** shift);
}
function rescalePricing(pricing: ShopPricing | undefined, from: string, to: string): ShopPricing | undefined {
  if (!pricing?.shipping) return pricing;
  const flatMinor = rescaleMinor(pricing.shipping.flatMinor, from, to)!;
  const freeOverMinor = rescaleMinor(pricing.shipping.freeOverMinor, from, to);
  return { ...pricing, shipping: { flatMinor, ...(freeOverMinor !== undefined ? { freeOverMinor } : {}) } };
}

function MarketCard({
  market,
  index,
  count,
  others,
  props,
  update,
  move,
  remove,
}: {
  market: ShopMarket;
  index: number;
  count: number;
  /** Country → the OTHER market that ships there. */
  others: ReadonlyMap<string, string>;
  props: MarketsEditorProps;
  update: (next: ShopMarket) => void;
  move: (delta: -1 | 1) => void;
  remove: () => void;
}) {
  const [filter, setFilter] = useState('');
  const own = new Set(market.countries);
  const ownPricing = market.pricing !== undefined;
  const pricing: ShopPricing = market.pricing ?? {};
  const setPricing = (next: ShopPricing) => update({ ...market, pricing: next });
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q) : COUNTRIES;
  }, [filter]);
  const label = `market ${market.name || market.id}`;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/60 dark:border-white/10 bg-white/40 dark:bg-white/5 p-3" aria-label={label} role="group">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block min-w-40 flex-1">
          <span className={fieldLabel}>Name{index === 0 && <span className="ml-1 rounded bg-indigo-100 px-1 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">default</span>}</span>
          <input className={glassInput} aria-label={`Name of ${label}`} value={market.name} onChange={(e) => update({ ...market, name: e.target.value })} />
        </label>
        <label className="block w-36">
          <span className={fieldLabel}>Id</span>
          <input
            className={glassInput}
            aria-label={`Id of ${label}`}
            value={market.id}
            title="Prices are entered per market id: changing it disconnects the prices entered for the old one."
            onChange={(e) => update({ ...market, id: e.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 64) })}
          />
        </label>
        <label className="block w-24">
          <span className={fieldLabel}>Currency</span>
          <input
            className={glassInput}
            aria-label={`Currency of ${label}`}
            value={market.currency}
            placeholder="EUR"
            onChange={(e) => {
              const currency = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
              // A shipping fee is stored in minor units: moving to a currency with another exponent
              // (EUR → JPY) keeps the amount the merchant SEES, rather than silently scaling it by 100.
              const complete = currency.length === 3 && market.currency.length === 3;
              const pricing = complete ? rescalePricing(market.pricing, market.currency, currency) : market.pricing;
              update({ ...market, currency, ...(pricing !== undefined ? { pricing } : {}) });
            }}
          />
        </label>
        <label className="block w-40">
          <span className={fieldLabel}>Default for language</span>
          <select
            className={glassInput}
            aria-label={`Language of ${label}`}
            value={market.locale ?? ''}
            onChange={(e) => {
              const rest = without(market, 'locale');
              update(e.target.value ? { ...rest, locale: e.target.value } : rest);
            }}
          >
            <option value="">—</option>
            {props.locales.map((l) => (
              <option key={l} value={l}>
                {localeLabel(l)}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex gap-1">
          <button type="button" className={`${ghostButton} px-2`} aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => move(-1)}>
            <ArrowUp className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" className={`${ghostButton} px-2`} aria-label={`Move ${label} down`} disabled={index === count - 1} onClick={() => move(1)}>
            <ArrowDown className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" className={`${ghostButton} px-2`} aria-label={`Remove ${label}`} onClick={remove}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <div>
        <span className={fieldLabel}>Ships to</span>
        <label className="mb-1 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className={toggleInput}
            checked={market.restOfWorld === true}
            onChange={(e) => {
              const rest = without(market, 'restOfWorld');
              update(e.target.checked ? { ...rest, restOfWorld: true } : rest);
            }}
          />
          Rest of world — also every country no other market ships to
        </label>
        <p className="mb-1 text-[11px] text-slate-500 dark:text-slate-400">
          {market.countries.length === 0 ? 'No countries of its own.' : `${market.countries.length} selected: ${market.countries.map(countryName).join(', ')}`}
        </p>
        <input className={`${glassInput} mb-1`} aria-label={`Find a country for ${label}`} placeholder="Find a country…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="max-h-40 overflow-y-auto rounded-lg border border-white/60 dark:border-white/10 p-1">
          {shown.map((c) => {
            const elsewhere = others.get(c.code);
            return (
              <label key={c.code} className={`flex items-center gap-2 px-1 py-0.5 text-xs ${elsewhere ? 'opacity-50' : ''}`}>
                <input
                  type="checkbox"
                  checked={own.has(c.code)}
                  disabled={elsewhere !== undefined && !own.has(c.code)}
                  aria-label={`${c.name} for ${label}`}
                  onChange={(e) =>
                    update({ ...market, countries: e.target.checked ? [...market.countries, c.code] : market.countries.filter((x) => x !== c.code) })
                  }
                />
                {c.name} <span className="text-slate-400">{c.code}</span>
                {elsewhere && <span className="text-[10px] text-slate-500">— in {elsewhere}</span>}
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <span className={fieldLabel}>Checkout channels (payment providers)</span>
        <label className="mb-1 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className={toggleInput}
            checked={market.channels === undefined}
            onChange={(e) => {
              const rest = without(market, 'channels');
              update(e.target.checked ? rest : { ...rest, channels: props.checkoutChannels.map((c) => c.key) });
            }}
          />
          Every checkout channel
        </label>
        {market.channels !== undefined && (
          <div className="flex flex-wrap gap-3">
            {props.checkoutChannels.map((c) => (
              <label key={c.key} className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  aria-label={`${c.label} in ${label}`}
                  checked={market.channels!.includes(c.key)}
                  onChange={(e) =>
                    update({ ...market, channels: e.target.checked ? [...market.channels!, c.key] : market.channels!.filter((k) => k !== c.key) })
                  }
                />
                {c.label}
              </label>
            ))}
            {market.channels.length === 0 && <span className="text-[11px] text-amber-700 dark:text-amber-300">None ticked: no online checkout in this market.</span>}
          </div>
        )}
      </div>

      <div>
        <span className={fieldLabel}>Shipping &amp; tax</span>
        <label className="mb-1 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className={toggleInput}
            checked={!ownPricing}
            onChange={(e) => {
              const rest = without(market, 'pricing');
              update(e.target.checked ? rest : { ...rest, pricing: {} });
            }}
          />
          The shop&rsquo;s shipping and tax{market.currency !== props.shopCurrency ? ` (only possible in ${props.shopCurrency || 'the shop currency'})` : ''}
        </label>
        {ownPricing && (
          <div className="grid gap-2 sm:grid-cols-4">
            <DraftInput
              label={`Shipping (${market.currency || '…'})`}
              shown={pricing.shipping ? minorToMajor(pricing.shipping.flatMinor, market.currency) : ''}
              parse={parseMoney(market.currency)}
              onCommit={(flatMinor) => {
                // No fee means no shipping at all — and so no "free over" either.
                setPricing(flatMinor === undefined ? without(pricing, 'shipping') : { ...pricing, shipping: { ...pricing.shipping, flatMinor } });
              }}
            />
            <DraftInput
              label="Free over"
              shown={pricing.shipping?.freeOverMinor !== undefined ? minorToMajor(pricing.shipping.freeOverMinor, market.currency) : ''}
              parse={parseMoney(market.currency)}
              disabled={!pricing.shipping}
              hint="Set a shipping fee first."
              onCommit={(freeOverMinor) => {
                if (!pricing.shipping) return;
                const shipping = without(pricing.shipping, 'freeOverMinor');
                setPricing({ ...pricing, shipping: freeOverMinor === undefined ? shipping : { ...shipping, freeOverMinor } });
              }}
            />
            <DraftInput
              label={`Tax rate of ${label}`}
              shown={pricing.tax ? String(pricing.tax.rateBp / 100) : ''}
              parse={parseRate}
              onCommit={(rateBp) => {
                const rest = without(pricing, 'tax');
                setPricing(rateBp === undefined ? rest : { ...rest, tax: { rateBp, mode: pricing.tax?.mode ?? 'inclusive' } });
              }}
            />
            <label className="block">
              <span className={fieldLabel}>Prices are</span>
              <select
                className={glassInput}
                aria-label={`Tax mode of ${label}`}
                value={pricing.tax?.mode ?? 'inclusive'}
                disabled={!pricing.tax}
                onChange={(e) => pricing.tax && setPricing({ ...pricing, tax: { ...pricing.tax, mode: e.target.value as 'inclusive' | 'exclusive' } })}
              >
                <option value="inclusive">Tax included</option>
                <option value="exclusive">Tax added</option>
              </select>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

let nextCardKey = 0;
const cardKey = () => `market-card-${(nextCardKey += 1)}`;

export function MarketsEditor(props: MarketsEditorProps) {
  const { markets, onChange } = props;
  // A STABLE key per card that moves with it (a market's id is editable, so it cannot be the key): a
  // card's filter text and half-typed amounts stay with ITS market across a reorder or a removal.
  const [keys, setKeys] = useState<string[]>(() => markets.map(cardKey));
  const cardKeys = keys.length === markets.length ? keys : markets.map((_, i) => keys[i] ?? cardKey());
  // Country → the INDEX of the market that ships there (names can repeat; positions cannot).
  const claimed = useMemo(() => {
    const out = new Map<string, number>();
    markets.forEach((m, i) => m.countries.forEach((c) => !out.has(c) && out.set(c, i)));
    return out;
  }, [markets]);

  const commit = (next: ShopMarket[], nextKeys: string[]) => {
    setKeys(nextKeys);
    onChange(next);
  };
  const set = (i: number, next: ShopMarket) => onChange(markets.map((m, j) => (j === i ? next : m)));
  const add = () => {
    const taken = new Set(markets.map((m) => m.id));
    const name = markets.length === 0 ? 'Default' : `Market ${markets.length + 1}`;
    commit([...markets, { id: idFrom(name, taken), name, currency: props.shopCurrency || 'EUR', countries: [] }], [...cardKeys, cardKey()]);
  };
  const remove = (i: number) => {
    const m = markets[i]!;
    const what = i === 0 ? `the default market "${m.name || m.id}" (the next one becomes the default)` : `market "${m.name || m.id}"`;
    if (!window.confirm(`Remove ${what}? Products priced for it will no longer be sold there.`)) return;
    commit(markets.filter((_, j) => j !== i), cardKeys.filter((_, j) => j !== i));
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= markets.length) return;
    const next = [...markets];
    const nextKeys = [...cardKeys];
    [next[i], next[j]] = [next[j]!, next[i]!];
    [nextKeys[i], nextKeys[j]] = [nextKeys[j]!, nextKeys[i]!];
    commit(next, nextKeys);
  };

  return (
    <div className="flex flex-col gap-3">
      {markets.length === 0 && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          No markets: the shop sells in one currency, at one set of prices, everywhere. Add markets to sell in several currencies —
          each with its own prices (a dataset <em>Prices</em> field), countries, shipping, tax and payment providers.
        </p>
      )}
      {markets.map((m, i) => {
        const others = new Map<string, string>();
        for (const [country, owner] of claimed) if (owner !== i) others.set(country, markets[owner]!.name || markets[owner]!.id);
        return (
          <MarketCard
            key={cardKeys[i]}
            market={m}
            index={i}
            count={markets.length}
            others={others}
            props={props}
            update={(next) => set(i, next)}
            move={(d) => move(i, d)}
            remove={() => remove(i)}
          />
        );
      })}
      {props.issues.length > 0 && (
        <ul className="rounded-md bg-red-50 dark:bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300" aria-label="Market problems" aria-live="polite">
          {props.issues.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      <div>
        <button type="button" className={ghostButton} onClick={add}>
          <Plus className="mr-1 inline h-4 w-4" aria-hidden /> Add market
        </button>
      </div>
    </div>
  );
}
