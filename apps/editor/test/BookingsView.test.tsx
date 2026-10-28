import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { BookingItem, BookingList } from '../src/api';

const { listBookings, answerBooking } = vi.hoisted(() => ({ listBookings: vi.fn(), answerBooking: vi.fn() }));
vi.mock('../src/api', () => ({
  api: {
    listBookings: (p: string, v: string) => listBookings(p, v),
    answerBooking: (p: string, id: string, a: string) => answerBooking(p, id, a),
  },
}));

import { BookingsPanel, bookingSpan, onAnotherClock } from '../src/views/BookingsView';

/**
 * The Bookings tab: the business's bookings and requests, and its answers. ★ Each answer mails the customer, so
 * each asks once more before it goes.
 */

// Wednesday 28 and Thursday 29 October 2026, on Berlin's clock (UTC+1 by then).
const item = (over: Partial<BookingItem>): BookingItem => ({
  id: 'b1',
  state: 'booked',
  offering: { id: 'massage', name: 'Massage', mode: 'duration' },
  resource: { id: 'anna', name: 'Anna' },
  timeZone: 'Europe/Berlin',
  start: Date.UTC(2026, 9, 28, 9),
  end: Date.UTC(2026, 9, 28, 10),
  quantity: 1,
  customer: { name: 'Ada Lovelace', email: 'ada@example.com', phone: '+49 30 1234', note: 'First visit' },
  expiresAt: null,
  createdAt: Date.UTC(2026, 9, 20, 12),
  ...over,
});
const REQUEST = item({ id: 'r1', state: 'pending', offering: { id: 'ask', name: 'Consultation', mode: 'duration' }, start: Date.UTC(2026, 9, 28, 13), end: Date.UTC(2026, 9, 28, 14), expiresAt: Date.UTC(2099, 0, 1) });
const LATER = item({ id: 'b2', start: Date.UTC(2099, 9, 29, 9), end: Date.UTC(2099, 9, 29, 10), customer: { name: 'Grace Hopper', email: 'grace@example.com' } });
const list = (bookings: BookingItem[], over: Partial<BookingList> = {}): BookingList => ({
  bookings,
  total: bookings.length,
  requests: bookings.filter((b) => b.state === 'pending').length,
  undelivered: { failed: 0, retrying: 0 },
  ...over,
});
// The rows the panel shows are not over until 2099, so every action is offered.
const FUTURE = { start: Date.UTC(2099, 9, 28, 9), end: Date.UTC(2099, 9, 28, 10) };

beforeEach(() => {
  listBookings.mockReset();
  answerBooking.mockReset();
});

describe('the list', () => {
  it('groups by day on the booking’s own clock, and badges the requests waiting', async () => {
    listBookings.mockResolvedValue(list([item(FUTURE), { ...REQUEST, start: Date.UTC(2099, 9, 28, 13), end: Date.UTC(2099, 9, 28, 14) }, LATER]));
    render(<BookingsPanel projectId="p" />);
    await screen.findByText('Grace Hopper');
    expect(listBookings).toHaveBeenCalledWith('p', 'upcoming');
    const days = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(days).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Requests/ })).toHaveTextContent('1');
    // Read out as words, not a bare number.
    // (jsdom drops the space a browser keeps between the label and the hidden words.)
    expect(screen.getByRole('button', { name: /^Requests\s?\(1 waiting\)$/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Upcoming' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText('Booked')).toHaveLength(2);
    expect(screen.getByText('Request')).toBeInTheDocument();
    expect(screen.getByText('3 bookings')).toBeInTheDocument();
  });

  it('says where the business’s mail is not going out', async () => {
    listBookings.mockResolvedValue(list([], { undelivered: { failed: 2, retrying: 1, lastError: 'Authentication failed' } }));
    render(<BookingsPanel projectId="p" />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('2 booking email(s) could not be sent.');
    expect(alert).toHaveTextContent('1 booking email(s) are being retried.');
    expect(alert).toHaveTextContent('Last error: Authentication failed');
  });

  it('shows each view’s own empty state, and asks for that view', async () => {
    listBookings.mockResolvedValue(list([]));
    render(<BookingsPanel projectId="p" />);
    expect(await screen.findByText('No upcoming bookings.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Past' }));
    expect(await screen.findByText(/No past bookings\. A booking is kept for a week after it ends\./)).toBeInTheDocument();
    expect(listBookings).toHaveBeenLastCalledWith('p', 'past');
    fireEvent.click(screen.getByRole('button', { name: 'Requests' }));
    expect(await screen.findByText('No requests are waiting for an answer.')).toBeInTheDocument();
  });

  it('says so when the list cannot be loaded', async () => {
    listBookings.mockRejectedValue(new Error('down'));
    render(<BookingsPanel projectId="p" />);
    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument();
  });
});

describe('a booking’s details', () => {
  it('shows the customer, with ways to reach them, and when on the booking’s clock', async () => {
    listBookings.mockResolvedValue(list([item(FUTURE)]));
    render(<BookingsPanel projectId="p" />);
    fireEvent.click(await screen.findByRole('button', { name: /Massage/ }));
    expect(screen.getByRole('link', { name: /ada@example.com/ })).toHaveAttribute('href', 'mailto:ada@example.com');
    expect(screen.getByRole('link', { name: /\+49 30 1234/ })).toHaveAttribute('href', 'tel:+49301234');
    expect(screen.getByText('First visit')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Massage/ })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('answers', () => {
  it('★ accepts a request only after a second yes, then says what happened and lists afresh', async () => {
    const request = { ...REQUEST, ...{ start: Date.UTC(2099, 9, 28, 13), end: Date.UTC(2099, 9, 28, 14) } };
    listBookings.mockResolvedValueOnce(list([request])).mockResolvedValue(list([]));
    answerBooking.mockResolvedValue({ ok: true, booking: null });
    render(<BookingsPanel projectId="p" />);
    fireEvent.click(await screen.findByRole('button', { name: /Consultation/ }));
    expect(screen.getByText(/or the request lapses and its time is free again/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(answerBooking).not.toHaveBeenCalled();
    expect(screen.getByText(/the customer gets a confirmation by email/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, accept' }));
    await waitFor(() => expect(answerBooking).toHaveBeenCalledWith('p', 'r1', 'accept'));
    expect(await screen.findByRole('status')).toHaveTextContent('Accepted: the customer has been sent a confirmation.');
    expect(listBookings).toHaveBeenCalledTimes(2);
  });

  it('declines a request, and can be backed out of', async () => {
    const request = { ...REQUEST, start: Date.UTC(2099, 9, 28, 13), end: Date.UTC(2099, 9, 28, 14) };
    listBookings.mockResolvedValue(list([request]));
    answerBooking.mockResolvedValue({ ok: true, booking: null });
    render(<BookingsPanel projectId="p" />);
    fireEvent.click(await screen.findByRole('button', { name: /Consultation/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, decline' }));
    await waitFor(() => expect(answerBooking).toHaveBeenCalledWith('p', 'r1', 'decline'));
  });

  it('cancels a booking, and offers no answers on one that has ended', async () => {
    listBookings.mockResolvedValue(list([item(FUTURE), item({ id: 'old', offering: { id: 'old', name: 'Old one', mode: 'duration' }, start: Date.UTC(2020, 0, 1, 9), end: Date.UTC(2020, 0, 1, 10) })]));
    answerBooking.mockResolvedValue({ ok: true, booking: null });
    render(<BookingsPanel projectId="p" />);
    fireEvent.click(await screen.findByRole('button', { name: /Old one/ }));
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Massage/ }));
    // Accepting and declining are for requests only.
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }));
    await waitFor(() => expect(answerBooking).toHaveBeenCalledWith('p', 'b1', 'cancel'));
  });

  it('says where a cancelled paid booking’s money stands, and warns when the business must refund it', async () => {
    listBookings.mockResolvedValue(list([item(FUTURE)]));
    answerBooking.mockResolvedValueOnce({ ok: true, booking: null, refund: 'refunded' }).mockResolvedValueOnce({ ok: true, booking: null, refund: 'manual' });
    render(<BookingsPanel projectId="p" />);
    const cancel = async () => {
      fireEvent.click(await screen.findByRole('button', { name: /Massage/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
      expect(screen.getByText(/A paid booking is refunded in full/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }));
    };
    await cancel();
    expect(await screen.findByRole('status')).toHaveTextContent('Cancelled: the customer has been told. The payment has been refunded.');
    await cancel();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('check your payment provider’s dashboard, and refund it there if it has not been'));
    expect(screen.getByRole('status').className).toContain('text-rose-700');
  });

  it('says why an answer did not work', async () => {
    const request = { ...REQUEST, start: Date.UTC(2099, 9, 28, 13), end: Date.UTC(2099, 9, 28, 14) };
    listBookings.mockResolvedValue(list([request]));
    answerBooking.mockRejectedValue(Object.assign(new Error('409'), { details: { error: 'its time ran out and may have been booked by someone else' } }));
    render(<BookingsPanel projectId="p" />);
    fireEvent.click(await screen.findByRole('button', { name: /Consultation/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, accept' }));
    expect(await screen.findByRole('status')).toHaveTextContent('That did not work: its time ran out and may have been booked by someone else.');
  });
});

describe('bookingSpan', () => {
  it('reads times for appointments, and dates for stays and whole days', () => {
    const base = { timeZone: 'Europe/Berlin' };
    expect(bookingSpan({ ...base, start: Date.UTC(2026, 9, 28, 9), end: Date.UTC(2026, 9, 28, 10), offering: { id: 'm', name: 'M', mode: 'duration' } })).toMatch(/^10:00\s?(AM)? – 11:00\s?(AM)?$/);
    const days = bookingSpan({ ...base, start: Date.UTC(2026, 9, 27, 23), end: Date.UTC(2026, 9, 29, 23), offering: { id: 'v', name: 'V', mode: 'days', unit: 'day' } });
    expect(days).toContain('28');
    expect(days).toContain('29');
    expect(days).not.toMatch(/\d:\d\d/);
  });
});

describe('within one group', () => {
  it('lists a day’s bookings in the order they come', async () => {
    listBookings.mockResolvedValue(list([item(FUTURE), { ...item(FUTURE), id: 'b3', start: FUTURE.start + 3_600_000, end: FUTURE.end + 3_600_000, customer: { name: 'Grace Hopper' } }]));
    render(<BookingsPanel projectId="p" />);
    await screen.findByText('Grace Hopper');
    const rows = within(screen.getAllByRole('list')[0]!).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent?.includes('Grace'))).toEqual([false, true]);
  });
});

describe('robustness', () => {
  it('★ draws only the newest load: a slow answer for a view left behind does not land over the one chosen', async () => {
    let slow: (v: BookingList) => void = () => undefined;
    listBookings.mockImplementation((_p: string, v: string) =>
      v === 'upcoming' ? new Promise<BookingList>((r) => (slow = r)) : Promise.resolve(list([], { bookings: [], total: 0 })),
    );
    render(<BookingsPanel projectId="p" />);
    fireEvent.click(screen.getByRole('button', { name: 'Past' }));
    expect(await screen.findByText(/No past bookings/)).toBeInTheDocument();
    slow(list([LATER]));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Grace Hopper')).toBeNull();
    expect(screen.getByText(/No past bookings/)).toBeInTheDocument();
  });

  it('lists bookings of two time zones that share a day label without mixing them up', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // In time order: 29 October in Berlin, then a booking already on the 30th in Auckland, then the 29th in Berlin
    // again. One day label twice, apart in the list.
    const berlin1 = item({ id: 'a', start: Date.UTC(2099, 9, 29, 9), end: Date.UTC(2099, 9, 29, 10) });
    const auckland = item({ id: 'b', timeZone: 'Pacific/Auckland', start: Date.UTC(2099, 9, 29, 12), end: Date.UTC(2099, 9, 29, 13), customer: { name: 'Kiri' } });
    const berlin2 = item({ id: 'c', start: Date.UTC(2099, 9, 29, 13), end: Date.UTC(2099, 9, 29, 14), customer: { name: 'Grace Hopper' } });
    listBookings.mockResolvedValue(list([berlin1, auckland, berlin2]));
    render(<BookingsPanel projectId="p" />);
    await screen.findByText('Grace Hopper');
    const labels = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(labels).toHaveLength(3);
    expect(labels[0]).toBe(labels[2]);
    expect(errors.mock.calls.some((c) => String(c[0]).includes('same key'))).toBe(false);
    errors.mockRestore();
  });

  it('says whose clock the times are on when it is not this browser’s', async () => {
    const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const far = own === 'Pacific/Chatham' ? 'Pacific/Kiritimati' : 'Pacific/Chatham';
    listBookings.mockResolvedValue(list([item({ ...FUTURE, timeZone: far })]));
    render(<BookingsPanel projectId="p" />);
    expect(await screen.findByText(/Times are shown on each booking’s own clock/)).toBeInTheDocument();
    expect(onAnotherClock({ start: FUTURE.start, timeZone: own }, own)).toBe(false);
    // Two names for one clock are one clock.
    expect(onAnotherClock({ start: FUTURE.start, timeZone: 'Europe/Berlin' }, 'Europe/Brussels')).toBe(false);
  });

  it('★ links only a plain address for mail: one carrying a header or a body is shown, not linked', async () => {
    listBookings.mockResolvedValue(list([item({ ...FUTURE, customer: { name: 'Mallory', email: 'a?cc=boss@evil.example' } })]));
    render(<BookingsPanel projectId="p" />);
    fireEvent.click(await screen.findByRole('button', { name: /Massage/ }));
    expect(screen.getByText('a?cc=boss@evil.example')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /evil/ })).toBeNull();
  });
});
