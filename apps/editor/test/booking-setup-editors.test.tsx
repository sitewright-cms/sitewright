import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { BookingBlock, BookingConfig, BookingOffering, HoursRule } from '@sitewright/schema';
import { BlocksEditor } from '../src/views/settings/booking/BlocksEditor';
import { HoursEditor } from '../src/views/settings/booking/HoursEditor';
import { OfferingFields } from '../src/views/settings/booking/OfferingFields';
import { GeneralPanel } from '../src/views/settings/booking/GeneralPanel';
import { toBookingGateway, type BookingGateway, type BookingGateways } from '../src/views/settings/booking/PaymentFields';
import { EMPTY_CONFIG, issuesByPath, newOffering, newResource, withMode } from '../src/views/settings/booking/model';

/**
 * The booking set-up's row editors, each driven as an author would: what every control writes into the set-up.
 * ★ Each result is checked against the schema the server applies.
 */

const NONE = new Map<string, string>();

function Blocks({ out }: { out: { value: BookingBlock[] } }) {
  const [blocks, setBlocks] = useState<BookingBlock[]>([]);
  out.value = blocks;
  return <BlocksEditor blocks={blocks} onChange={setBlocks} issues={NONE} path="resources.0.blocks" />;
}

function Hours({ out }: { out: { value: HoursRule[] } }) {
  const [hours, setHours] = useState<HoursRule[]>([]);
  out.value = hours;
  return <HoursEditor hours={hours} onChange={setHours} issues={NONE} path="resources.0.hours" />;
}

const twoResources = (): BookingConfig => {
  const anna = { ...newResource(EMPTY_CONFIG, 'Anna'), timeZone: 'Europe/Berlin' };
  const withAnna = { ...EMPTY_CONFIG, resources: [anna] };
  return { ...withAnna, resources: [anna, { ...newResource(withAnna, 'Room 2'), timeZone: 'Europe/Berlin' }] };
};

function Offering({ out, start, payment }: { out: { value: BookingConfig }; start: BookingOffering; payment?: BookingConfig['payment'] }) {
  const [config, setConfig] = useState<BookingConfig>(() => ({ ...twoResources(), offerings: [start], ...(payment ? { payment } : {}) }));
  out.value = config;
  const o = config.offerings[0]!;
  return (
    <OfferingFields
      offering={o}
      index={0}
      config={config}
      issues={issuesByPath(config)}
      idFixed={false}
      others={new Set()}
      onChange={(next) => setConfig({ ...config, offerings: [next] })}
    />
  );
}

const set = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('blocked times', () => {
  it('adds each kind, edits it, and removes one', () => {
    const out = { value: [] as BookingBlock[] };
    render(<Blocks out={out} />);
    expect(screen.getByText('Nothing blocked.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Block time/ }));
    set('Blocked time 1: from', '2026-12-24');
    set('Blocked time 1: to', '2026-12-26');
    set('Blocked time 1: note', 'Christmas');
    set('Kind of blocked time', 'once');
    fireEvent.click(screen.getByRole('button', { name: /Block time/ }));
    set('Blocked time 2: starts', '2026-11-03T08:00');
    set('Blocked time 2: ends', '2026-11-03T10:00');
    set('Kind of blocked time', 'weekly');
    fireEvent.click(screen.getByRole('button', { name: /Block time/ }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Blocked time 3: days' })).getByRole('button', { name: 'Sat' }));
    set('Blocked time 3: from', '12:30');
    set('Blocked time 3: to', '13:30');
    // A cleared note is no note.
    set('Blocked time 1: note', '');
    expect(out.value).toEqual([
      { kind: 'dates', from: '2026-12-24', to: '2026-12-26', note: undefined },
      { kind: 'once', start: '2026-11-03T08:00', end: '2026-11-03T10:00' },
      { kind: 'weekly', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], from: '12:30', to: '13:30' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove blocked time 2' }));
    expect(out.value.map((b) => b.kind)).toEqual(['dates', 'weekly']);
  });
});

describe('opening hours', () => {
  it('adds a rule, edits its days and times, and removes it', () => {
    const out = { value: [] as HoursRule[] };
    render(<Hours out={out} />);
    expect(screen.getByText(/No opening hours/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Add hours/ }));
    fireEvent.click(screen.getByRole('button', { name: /Add hours/ }));
    const days = screen.getByRole('group', { name: 'Opening hours 2: days' });
    fireEvent.click(within(days).getByRole('button', { name: 'Mon' }));
    fireEvent.click(within(days).getByRole('button', { name: 'Sat' }));
    expect(within(days).getByRole('button', { name: 'Sat' })).toHaveAttribute('aria-pressed', 'true');
    set('Opening hours 2: from', '10:00');
    set('Opening hours 2: to', '14:00');
    expect(out.value[1]).toEqual({ days: ['tue', 'wed', 'thu', 'fri', 'sat'], from: '10:00', to: '14:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove hours 1' }));
    expect(out.value).toHaveLength(1);
  });
});

describe('an offering’s fields', () => {
  const base = (mode: BookingOffering['mode']) => withMode(newOffering(twoResources(), 'Tour', 'duration'), mode);

  it('appointments: length, grid, buffers, and what all modes share', () => {
    const out = { value: EMPTY_CONFIG };
    render(<Offering out={out} start={base('duration')} />);
    set('Name', 'City walk');
    expect(screen.getByLabelText('Id')).toHaveValue('city-walk');
    set('Length', '90');
    set('A start every', '30');
    set('Free before', '10');
    set('Free after', '5');
    set('Confirmation', 'request');
    set('Booked at least', '1440');
    set('Booked at most', '60');
    set('Per booking up to', '2');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Served by Room 2' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Let visitors choose who or what' }));
    // Cleared, the grid is one start every length again.
    set('A start every', '');
    expect(out.value.offerings[0]).toMatchObject({
      id: 'city-walk',
      durationMin: 90,
      bufferBeforeMin: 10,
      bufferAfterMin: 5,
      confirmation: 'request',
      minNoticeMin: 1440,
      maxAdvanceDays: 60,
      maxQuantity: 2,
      resourceIds: ['anna', 'room-2'],
      chooseResource: true,
    });
    expect(out.value.offerings[0]).not.toHaveProperty('stepMin', expect.anything());
    expect(issuesByPath(out.value).size).toBe(0);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Served by Anna' }));
    expect(out.value.offerings[0]!.resourceIds).toEqual(['room-2']);
  });

  it('set times: adds, edits and removes a time, seats empty for the resource’s own', () => {
    const out = { value: EMPTY_CONFIG };
    render(<Offering out={out} start={base('slots')} />);
    fireEvent.click(screen.getByRole('button', { name: /Add a time/ }));
    set('Set time 2: at', '14:00');
    set('Set time 2: length', '45');
    set('Set time 2: seats', '8');
    fireEvent.click(within(screen.getByRole('group', { name: 'Set time 2: days' })).getByRole('button', { name: 'Sun' }));
    expect(out.value.offerings[0]).toMatchObject({ mode: 'slots', slots: [{ at: '10:00' }, { days: ['sat', 'sun'], at: '14:00', durationMin: 45, capacity: 8 }] });
    set('Set time 2: seats', '');
    expect((out.value.offerings[0] as Extract<BookingOffering, { mode: 'slots' }>).slots[1]!.capacity).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Remove time 1' }));
    expect((out.value.offerings[0] as Extract<BookingOffering, { mode: 'slots' }>).slots).toHaveLength(1);
    // The last time cannot be removed: an offering of set times needs one.
    expect(screen.getByRole('button', { name: 'Remove time 1' })).toBeDisabled();
    expect(issuesByPath(out.value).size).toBe(0);
  });

  it('from–to: the shortest, the longest, and the grid', () => {
    const out = { value: EMPTY_CONFIG };
    render(<Offering out={out} start={base('range')} />);
    set('At least', '30');
    set('At most', '120');
    set('Times on a grid of', '15');
    expect(out.value.offerings[0]).toMatchObject({ mode: 'range', minMin: 30, maxMin: 120, stepMin: 15 });
    expect(issuesByPath(out.value).size).toBe(0);
  });

  it('nights or days: the unit, the length of stay, and check-in and check-out for nights only', () => {
    const out = { value: EMPTY_CONFIG };
    render(<Offering out={out} start={base('days')} />);
    set('At least', '2');
    set('At most', '21');
    set('Check-in from', '16:00');
    set('Check-out by', '10:00');
    expect(out.value.offerings[0]).toMatchObject({ mode: 'days', unit: 'night', minUnits: 2, maxUnits: 21, checkIn: '16:00', checkOut: '10:00' });
    set('By the', 'day');
    expect(screen.queryByLabelText('Check-in from')).toBeNull();
    expect(issuesByPath(out.value).size).toBe(0);
  });
});

describe('an offering’s price', () => {
  const EUR = { gatewayId: 'stripe', currency: 'EUR' };
  const tour = () => withMode(newOffering(twoResources(), 'Tour', 'duration'), 'slots');

  it('is free until the set-up says how bookings are paid', () => {
    render(<Offering out={{ value: EMPTY_CONFIG }} start={tour()} />);
    expect(screen.getByText(/Free\. To take payment when it is booked/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Price/)).toBeNull();
  });

  it('takes a price as the author writes it, per booking or per seat, and empty for free', () => {
    const out = { value: EMPTY_CONFIG };
    render(<Offering out={out} start={tour()} payment={EUR} />);
    set('Price (EUR)', '25,5');
    expect(out.value.offerings[0]!.price).toEqual({ amountMinor: 2550, per: 'booking' });
    // What is typed stays as typed on the way to a whole price.
    set('Price (EUR)', '25.');
    expect(screen.getByLabelText('Price (EUR)')).toHaveValue('25.');
    set('Price (EUR)', '25.50');
    set('Charged', 'unit');
    expect(screen.getByRole('option', { name: 'Per seat' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Per night|Per day/ })).toBeNull();
    expect(out.value.offerings[0]!.price).toEqual({ amountMinor: 2550, per: 'unit' });
    expect(issuesByPath(out.value).size).toBe(0);
    set('Price (EUR)', '');
    expect(out.value.offerings[0]!.price).toBeUndefined();
    expect(screen.queryByLabelText('Charged')).toBeNull();
  });

  it('takes how long before the start a customer’s cancellation is still refunded, in hours; empty for a day', () => {
    const out = { value: EMPTY_CONFIG };
    render(<Offering out={out} start={tour()} payment={EUR} />);
    expect(screen.queryByLabelText('Refunded if cancelled')).toBeNull();
    set('Price (EUR)', '25');
    expect(screen.getByLabelText('Refunded if cancelled')).toHaveAttribute('placeholder', '24');
    set('Refunded if cancelled', '48');
    expect(out.value.offerings[0]!.refundUntilMin).toBe(2880);
    expect(issuesByPath(out.value).size).toBe(0);
    set('Refunded if cancelled', '0');
    expect(out.value.offerings[0]!.refundUntilMin).toBe(0);
    set('Refunded if cancelled', '');
    expect(out.value.offerings[0]!.refundUntilMin).toBeUndefined();
  });

  it('★ refuses what is not a price, and so is never saved as one', () => {
    const out = { value: EMPTY_CONFIG };
    render(<Offering out={out} start={tour()} payment={EUR} />);
    for (const [typed, says] of [
      ['abc', 'a price like 25 or 25.50'],
      ['25.505', 'at most 2 decimals in EUR'],
      ['0', 'leave it empty for free'],
      ['2000000', 'at most 1000000.00'],
    ] as const) {
      set('Price (EUR)', typed);
      expect(screen.getByText(says)).toBeInTheDocument();
      expect(issuesByPath(out.value).size).toBeGreaterThan(0);
    }
  });

  it('per night for a stay, which a change of kind does not carry over', () => {
    const out = { value: EMPTY_CONFIG };
    const stay = withMode(newOffering(twoResources(), 'Flat', 'duration'), 'days');
    render(<Offering out={out} start={stay} payment={EUR} />);
    set('Price (EUR)', '90');
    set('Charged', 'night');
    expect(out.value.offerings[0]!.price).toEqual({ amountMinor: 9000, per: 'night' });
    expect(issuesByPath(out.value).size).toBe(0);
    set('Kind', 'duration');
    expect(out.value.offerings[0]!.price).toEqual({ amountMinor: 9000, per: 'booking' });
  });
});

describe('the set-up’s payment', () => {
  const GATEWAYS: BookingGateway[] = [
    { id: 'stripe', name: 'Stripe Checkout', ready: true },
    { id: 'mollie', name: 'Mollie', currencies: ['EUR', 'CHF'], ready: true },
    { id: 'paypal', name: 'PayPal', ready: false },
  ];
  function Harness({ out, gateways, start = EMPTY_CONFIG }: { out: { value: BookingConfig }; gateways: BookingGateways; start?: BookingConfig }) {
    const [c, setC] = useState<BookingConfig>(start);
    out.value = c;
    return <GeneralPanel draft={c} onChange={setC} issues={issuesByPath(c)} gateways={gateways} />;
  }

  it('offers the providers that are ready, and the currency they take', () => {
    const out = { value: EMPTY_CONFIG };
    render(<Harness out={out} gateways={GATEWAYS} />);
    const select = screen.getByLabelText('Paid through');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['None: every offering is free', 'Stripe Checkout', 'Mollie']);
    set('Paid through', 'stripe');
    expect(out.value.payment).toEqual({ gatewayId: 'stripe', currency: '' });
    expect(screen.getByText('a three-letter currency code, e.g. EUR')).toBeInTheDocument();
    set('Currency', 'chf');
    expect(out.value.payment).toEqual({ gatewayId: 'stripe', currency: 'CHF' });
    // A provider with a list of its own: its currencies, keeping the one chosen where it takes it.
    set('Paid through', 'mollie');
    expect(out.value.payment).toEqual({ gatewayId: 'mollie', currency: 'CHF' });
    expect(within(screen.getByLabelText('Currency')).getAllByRole('option').map((o) => o.textContent)).toEqual(['EUR', 'CHF']);
    set('Paid through', '');
    expect(out.value.payment).toBeUndefined();
  });

  it('keeps showing a provider that is no longer ready, and says what to do', () => {
    const out = { value: EMPTY_CONFIG };
    render(<Harness out={out} gateways={GATEWAYS} start={{ ...EMPTY_CONFIG, payment: { gatewayId: 'paypal', currency: 'EUR' } }} />);
    expect(screen.getByLabelText('Paid through')).toHaveValue('paypal');
    expect(screen.getByRole('option', { name: 'PayPal (not ready)' })).toBeInTheDocument();
    expect(screen.getByText(/Its keys are incomplete/)).toBeInTheDocument();
  });

  it('says where the keys go when no provider is ready, and when the list could not be read', () => {
    const { unmount } = render(<Harness out={{ value: EMPTY_CONFIG }} gateways={[]} />);
    expect(screen.getByText(/Website settings → Shop → Payments/)).toBeInTheDocument();
    unmount();
    render(<Harness out={{ value: EMPTY_CONFIG }} gateways="failed" />);
    expect(screen.getByText('The payment providers could not be loaded.')).toBeInTheDocument();
  });

  it('reads which providers are ready from what the platform reports', () => {
    const keys = (complete: boolean) => ({ mode: 'live' as const, test: { complete: false, missing: ['k'] }, live: { complete, missing: complete ? [] : ['k'] } });
    const base = { id: 'g', name: 'G', credentialFields: [], refunds: true };
    expect(toBookingGateway({ ...base, keys: keys(true) }).ready).toBe(true);
    expect(toBookingGateway({ ...base, keys: keys(false) }).ready).toBe(false);
    expect(toBookingGateway({ ...base, keys: null }).ready).toBe(false);
    expect(toBookingGateway({ ...base, currencies: ['EUR'] })).toEqual({ id: 'g', name: 'G', currencies: ['EUR'], ready: false });
  });
});

describe('the set-up’s own settings', () => {
  it('writes the business’s address, the booking page, and the protection', () => {
    let config: BookingConfig = { ...EMPTY_CONFIG };
    function Harness() {
      const [c, setC] = useState<BookingConfig>(config);
      config = c;
      return <GeneralPanel draft={c} onChange={setC} issues={issuesByPath(c)} />;
    }
    render(<Harness />);
    set('Business address', 'hello@studio.example');
    set('Page path', ' /my-booking/ ');
    fireEvent.click(screen.getByRole('switch', { name: 'Proof of work (recommended)' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Captcha' }));
    expect(config).toMatchObject({ notifyEmail: 'hello@studio.example', statusPath: '/my-booking/', pow: true, captcha: true });
    set('Page path', 'my-booking');
    expect(screen.getByText('must start with /')).toBeInTheDocument();
    set('Business address', '');
    set('Page path', '');
    expect(config.notifyEmail).toBeUndefined();
    expect(config.statusPath).toBeUndefined();
  });
});
