import { describe, it, expect, beforeEach, vi } from 'vitest';

const { getBooking } = vi.hoisted(() => ({ getBooking: vi.fn() }));
vi.mock('../src/api', () => ({ api: { getBooking: (p: string) => getBooking(p) } }));

import { fetchBookingActive } from '../src/lib/booking-active';

beforeEach(() => {
  getBooking.mockReset();
});

describe('fetchBookingActive — when the Bookings tab may show', () => {
  it('is true while the booking set-up offers something', async () => {
    getBooking.mockResolvedValue({ item: { resources: [{ id: 'anna' }], offerings: [{ id: 'massage' }] } });
    expect(await fetchBookingActive('p')).toBe(true);
  });

  it('is false for an empty set-up, which is how booking is switched off', async () => {
    getBooking.mockResolvedValue({ item: { resources: [{ id: 'anna' }], offerings: [] } });
    expect(await fetchBookingActive('p')).toBe(false);
  });

  it('is false for a project that never set booking up (the API answers not found)', async () => {
    getBooking.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));
    expect(await fetchBookingActive('p')).toBe(false);
  });

  it('survives an API without the route (a synchronous throw)', async () => {
    getBooking.mockImplementation(() => {
      throw new TypeError('api.getBooking is not a function');
    });
    expect(await fetchBookingActive('p')).toBe(false);
  });
});
