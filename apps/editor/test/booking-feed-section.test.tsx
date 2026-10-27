import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { BookingFeed } from '../src/api';

const { getBookingFeed, renewBookingFeed, disableBookingFeed } = vi.hoisted(() => ({ getBookingFeed: vi.fn(), renewBookingFeed: vi.fn(), disableBookingFeed: vi.fn() }));
vi.mock('../src/api', () => {
  class ApiError extends Error {
    constructor(
      public readonly status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    api: {
      getBookingFeed: (p: string) => getBookingFeed(p),
      renewBookingFeed: (p: string) => renewBookingFeed(p),
      disableBookingFeed: (p: string) => disableBookingFeed(p),
    },
  };
});

import { ApiError } from '../src/api';
import { FeedSection } from '../src/views/settings/booking/FeedSection';

/** ★ The bookings feed's address: a secret that lists customers' details. Made, shown, renewed and switched off. */

const FEED: BookingFeed = { url: 'https://site.example/b/p/feed/tok.ics', webcalUrl: 'webcal://site.example/b/p/feed/tok.ics', createdAt: 1, lastFetchedAt: null };
const RESOURCES = [
  { id: 'anna', name: 'Anna', timeZone: 'Europe/Berlin', capacity: 1, hours: [], blocks: [] },
  { id: 'room-2', name: 'Room 2', timeZone: 'Europe/Berlin', capacity: 1, hours: [], blocks: [] },
];

beforeEach(() => {
  for (const m of [getBookingFeed, renewBookingFeed, disableBookingFeed]) m.mockReset();
});

describe('the calendar address', () => {
  it('is made on request, then shown with a warning, per resource if wanted', async () => {
    getBookingFeed.mockResolvedValue({ feed: null });
    renewBookingFeed.mockResolvedValue({ feed: FEED });
    render(<FeedSection projectId="p" resources={RESOURCES} />);
    fireEvent.click(await screen.findByRole('button', { name: /Create a calendar address/ }));
    expect(await screen.findByLabelText('Calendar address')).toHaveValue(FEED.url);
    expect(renewBookingFeed).toHaveBeenCalledWith('p');
    expect(screen.getByText(/Anyone with this address sees your bookings/)).toBeInTheDocument();
    expect(screen.getByText('No calendar has fetched it yet.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Whose bookings'), { target: { value: 'room-2' } });
    expect(screen.getByLabelText('Calendar address')).toHaveValue(`${FEED.url}?resource=room-2`);
    expect(screen.getByRole('link', { name: /Subscribe/ })).toHaveAttribute('href', `${FEED.webcalUrl}?resource=room-2`);
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }));
  });

  it('★ asks before a new address replaces the old one, and before switching off', async () => {
    getBookingFeed.mockResolvedValue({ feed: { ...FEED, lastFetchedAt: Date.now() - 3 * 60_000 } });
    renewBookingFeed.mockResolvedValue({ feed: { ...FEED, url: 'https://site.example/b/p/feed/new.ics' } });
    disableBookingFeed.mockResolvedValue({ ok: true });
    render(<FeedSection projectId="p" resources={RESOURCES} />);
    expect(await screen.findByText('A calendar last fetched it 3 min ago.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /New address/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Make a new address' }));
    await waitFor(() => expect(screen.getByLabelText('Calendar address')).toHaveValue('https://site.example/b/p/feed/new.ics'));
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    // The confirm dialog's own button.
    const confirmButtons = await screen.findAllByRole('button', { name: 'Turn off' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);
    expect(await screen.findByRole('button', { name: /Create a calendar address/ })).toBeInTheDocument();
    expect(disableBookingFeed).toHaveBeenCalledWith('p');
  });

  it('tells a member who may not see it, says when it could not load, and when an action failed', async () => {
    getBookingFeed.mockRejectedValueOnce(new ApiError(403, 'no'));
    const { unmount } = render(<FeedSection projectId="p" resources={[]} />);
    expect(await screen.findByText(/Only the project’s owners and members can see the calendar address/)).toBeInTheDocument();
    unmount();
    getBookingFeed.mockRejectedValueOnce(new Error('offline'));
    const second = render(<FeedSection projectId="p" resources={[]} />);
    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument();
    second.unmount();
    getBookingFeed.mockResolvedValue({ feed: null });
    renewBookingFeed.mockRejectedValue(new ApiError(429, 'too many requests'));
    render(<FeedSection projectId="p" resources={[]} />);
    fireEvent.click(await screen.findByRole('button', { name: /Create a calendar address/ }));
    expect(await screen.findByText('too many requests')).toBeInTheDocument();
  });
});
