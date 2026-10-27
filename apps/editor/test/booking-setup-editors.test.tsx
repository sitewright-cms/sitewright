import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { BookingBlock, BookingConfig, BookingOffering, HoursRule } from '@sitewright/schema';
import { BlocksEditor } from '../src/views/settings/booking/BlocksEditor';
import { HoursEditor } from '../src/views/settings/booking/HoursEditor';
import { OfferingFields } from '../src/views/settings/booking/OfferingFields';
import { GeneralPanel } from '../src/views/settings/booking/GeneralPanel';
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

function Offering({ out, start }: { out: { value: BookingConfig }; start: BookingOffering }) {
  const [config, setConfig] = useState<BookingConfig>(() => ({ ...twoResources(), offerings: [start] }));
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
