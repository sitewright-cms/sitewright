import { useState } from 'react';
import {
  DEFAULT_PAY_WINDOW_MIN,
  DEFAULT_REFUND_UNTIL_MIN,
  fromMinorUnits,
  toMinorUnits,
  type BookingConfig,
  type BookingOffering,
  type BookingPrice,
  type PaymentGatewayPublic,
  type PaymentKeysStatus,
} from '@sitewright/schema';
import { NumField, SelectField, TextField } from './fields';

/**
 * PREPAYMENT in the set-up: which of the project's payment providers takes a paid booking's money, in which
 * currency (Settings), and what each offering costs (Offerings). The provider's keys are entered where the
 * shop's are: Website settings → Shop → Payments.
 */

/** A payment provider the project may charge through; `ready` once its keys for the mode it runs in are complete. */
export interface BookingGateway {
  id: string;
  name: string;
  currencies?: string[];
  ready: boolean;
}

/** The project's providers: loading (undefined), unreadable ('failed'), or the list. */
export type BookingGateways = readonly BookingGateway[] | 'failed' | undefined;

/** One entry of `/projects/:id/payment-gateways`, as the set-up needs it. */
export function toBookingGateway(g: PaymentGatewayPublic & { keys?: PaymentKeysStatus | null }): BookingGateway {
  return {
    id: g.id,
    name: g.name,
    ...(g.currencies?.length ? { currencies: g.currencies } : {}),
    ready: Boolean(g.keys?.[g.keys.mode].complete),
  };
}

const NONE = '';

/** Settings: the provider and the currency. None: every offering is free. */
export function PaymentSettings({
  draft,
  onChange,
  issues,
  gateways,
}: {
  draft: BookingConfig;
  onChange: (next: BookingConfig) => void;
  issues: ReadonlyMap<string, string>;
  gateways: BookingGateways;
}) {
  const list = Array.isArray(gateways) ? (gateways as readonly BookingGateway[]) : [];
  const chosen = draft.payment ? list.find((g) => g.id === draft.payment?.gatewayId) : undefined;
  const ready = list.filter((g) => g.ready);
  const options = [
    { value: NONE, label: 'None: every offering is free' },
    ...ready.map((g) => ({ value: g.id, label: g.name })),
    // The one chosen is shown even while its keys are missing or it is gone, so the choice is never hidden.
    ...(draft.payment && !chosen?.ready ? [{ value: draft.payment.gatewayId, label: `${chosen?.name ?? draft.payment.gatewayId} (not ready)` }] : []),
  ];
  const choose = (id: string): void => {
    if (id === NONE) {
      onChange({ ...draft, payment: undefined });
      return;
    }
    const g = list.find((x) => x.id === id);
    const current = draft.payment?.currency ?? '';
    const currency = g?.currencies && !g.currencies.includes(current) ? (g.currencies[0] ?? current) : current;
    onChange({ ...draft, payment: { gatewayId: id, currency } });
  };
  const setCurrency = (currency: string): void => {
    if (draft.payment) onChange({ ...draft, payment: { ...draft.payment, currency: currency.trim().toUpperCase() } });
  };
  const note =
    gateways === 'failed'
      ? 'The payment providers could not be loaded.'
      : Array.isArray(gateways) && ready.length === 0
        ? 'No payment provider is ready: enter its keys under Website settings → Shop → Payments.'
        : draft.payment && chosen && !chosen.ready
          ? 'Its keys are incomplete: enter them under Website settings → Shop → Payments, or bookings cannot be paid.'
          : undefined;
  return (
    <div className="flex max-w-2xl flex-col gap-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Paid through" value={draft.payment?.gatewayId ?? NONE} onChange={choose} options={options} error={issues.get('payment.gatewayId')} />
        {draft.payment &&
          (chosen?.currencies ? (
            <SelectField
              label="Currency"
              value={draft.payment.currency}
              onChange={setCurrency}
              options={[...new Set([...chosen.currencies, draft.payment.currency])].filter(Boolean).map((c) => ({ value: c, label: c }))}
              error={issues.get('payment.currency')}
            />
          ) : (
            <TextField
              label="Currency"
              value={draft.payment.currency}
              placeholder="EUR"
              autoComplete="off"
              onChange={setCurrency}
              error={issues.get('payment.currency')}
            />
          ))}
      </div>
      {note && <p className="text-xs text-slate-500 dark:text-slate-400">{note}</p>}
    </div>
  );
}

const MAX_PRICE_MINOR = 100_000_000;

/** What the box says about an amount: the minor units, or why it cannot be one. */
function readPrice(text: string, currency: string): { amount: number | undefined; problem?: string } {
  const raw = text.trim();
  if (raw === '') return { amount: undefined };
  // A decimal comma is as good as a point (25,50).
  const parsed = toMinorUnits(raw.replace(',', '.'), currency);
  if (!parsed.ok) {
    return {
      amount: Number.NaN,
      problem: parsed.reason === 'not-representable' ? `at most ${parsed.allowed} decimals in ${currency}` : 'a price like 25 or 25.50',
    };
  }
  if (parsed.minor === 0) return { amount: Number.NaN, problem: 'leave it empty for free' };
  if (parsed.minor > MAX_PRICE_MINOR) return { amount: Number.NaN, problem: `at most ${fromMinorUnits(MAX_PRICE_MINOR, currency)}` };
  return { amount: parsed.minor };
}

const shown = (price: BookingPrice | undefined, currency: string): string =>
  price && Number.isFinite(price.amountMinor) ? fromMinorUnits(price.amountMinor, currency) : '';

/** An offering's price and what it is per. Empty: free. */
export function PriceFields({
  offering: o,
  index: i,
  config,
  issues,
  onChange,
}: {
  offering: BookingOffering;
  index: number;
  config: BookingConfig;
  issues: ReadonlyMap<string, string>;
  onChange: (next: BookingOffering) => void;
}) {
  const currency = config.payment?.currency ?? '';
  const amount = o.price?.amountMinor;
  // The box keeps what is typed ("25." on the way to "25.50"); an amount changed from outside (a reload) or
  // another currency is shown afresh.
  const [text, setText] = useState(() => shown(o.price, currency));
  const [seen, setSeen] = useState({ amount, currency });
  if (!Object.is(seen.amount, amount) || seen.currency !== currency) {
    setSeen({ amount, currency });
    setText(shown(o.price, currency));
  }
  if (!config.payment && !o.price) {
    return (
      <p className="text-xs text-slate-500 dark:text-slate-400">Free. To take payment when it is booked, choose how bookings are paid under Settings.</p>
    );
  }
  const problem = readPrice(text, currency).problem;
  const type = (value: string): void => {
    const next = readPrice(value, currency).amount;
    setText(value);
    setSeen({ amount: next, currency });
    onChange({ ...o, price: next === undefined ? undefined : { amountMinor: next, per: o.price?.per ?? 'booking' } });
  };
  const perOptions: Array<{ value: BookingPrice['per']; label: string }> = [
    { value: 'booking', label: 'Per booking' },
    { value: 'unit', label: o.mode === 'slots' ? 'Per seat' : 'Per unit booked' },
    ...(o.mode === 'days' ? [{ value: 'night' as const, label: o.unit === 'night' ? 'Per night' : 'Per day' }] : []),
  ];
  const err = (field: string): string | undefined => issues.get(`offerings.${i}.${field}`);
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <TextField
        label={currency ? `Price (${currency})` : 'Price'}
        value={text}
        placeholder="Free"
        autoComplete="off"
        onChange={type}
        error={problem ?? err('price') ?? err('price.amountMinor')}
        tip="Paid when it is booked, on the payment provider's page. The time is held for the customer while they pay, and booked when the payment arrives. On request: paid once you accept it. Empty: free."
      />
      {o.price && (
        <SelectField
          label="Charged"
          value={o.price.per}
          onChange={(per) => onChange({ ...o, price: { ...o.price!, per } })}
          options={perOptions}
          error={err('price.per')}
          tip="Per seat or unit: times the number booked at once. Per night or day: times the length of the stay."
        />
      )}
      {o.price && (
        <NumField
          label="Refunded if cancelled"
          value={o.refundUntilMin === undefined ? undefined : o.refundUntilMin / 60}
          min={0}
          suffix="hours or more before"
          placeholder={String(DEFAULT_REFUND_UNTIL_MIN / 60)}
          onChange={(hours) => onChange({ ...o, refundUntilMin: hours === undefined ? undefined : hours * 60 })}
          error={err('refundUntilMin')}
          tip="A customer who cancels at least this long before it starts gets their payment back in full; later, nothing (they are told before they confirm). You cancelling it always refunds in full. Empty: 24 hours."
        />
      )}
      {o.price && o.confirmation === 'request' && (
        <NumField
          label="Time to pay"
          value={o.payWindowMin === undefined ? undefined : o.payWindowMin / 60}
          min={1}
          suffix="hours after you accept"
          placeholder={String(DEFAULT_PAY_WINDOW_MIN / 60)}
          onChange={(hours) => onChange({ ...o, payWindowMin: hours === undefined ? undefined : hours * 60 })}
          error={err('payWindowMin')}
          tip="A request on a paid offering is paid once you accept it: the customer is emailed a link to pay on their booking page, and has this long (never past its start). Unpaid by then, its time is free again. Empty: 48 hours."
        />
      )}
    </div>
  );
}
