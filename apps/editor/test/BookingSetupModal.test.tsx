import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { BookingConfig } from '@sitewright/schema';
import type { BookingCalendar } from '../src/api';

const { getBooking, putBooking, listBookingCalendars, connectBookingCalendar, testBookingCalendar, removeBookingCalendar, discoverBookingCalDav, setBookingCalendarWrites } = vi.hoisted(() => ({
  discoverBookingCalDav: vi.fn(),
  setBookingCalendarWrites: vi.fn(),
  getBooking: vi.fn(),
  putBooking: vi.fn(),
  listBookingCalendars: vi.fn(),
  connectBookingCalendar: vi.fn(),
  testBookingCalendar: vi.fn(),
  removeBookingCalendar: vi.fn(),
}));
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
      getBooking: (p: string) => getBooking(p),
      putBooking: (p: string, c: unknown, v: unknown) => putBooking(p, c, v),
      listBookingCalendars: (p: string) => listBookingCalendars(p),
      connectBookingCalendar: (p: string, b: unknown) => connectBookingCalendar(p, b),
      testBookingCalendar: (p: string, id: string) => testBookingCalendar(p, id),
      removeBookingCalendar: (p: string, id: string) => removeBookingCalendar(p, id),
      discoverBookingCalDav: (p: string, b: unknown) => discoverBookingCalDav(p, b),
      setBookingCalendarWrites: (p: string, id: string, w: boolean) => setBookingCalendarWrites(p, id, w),
      // The Settings tab's calendar address (its own tests are in booking-feed-section).
      getBookingFeed: async () => ({ feed: null }),
    },
  };
});

import { ApiError } from '../src/api';
import { BookingSetupModal } from '../src/views/settings/booking/BookingSetupModal';

/**
 * The booking set-up screen: what visitors book, what a booking takes, and the calendars read for busy times.
 * ★ Saved as one document, only when the schema accepts it, with the version it was read at.
 */

const SAVED: BookingConfig = {
  resources: [{ id: 'anna', name: 'Anna', timeZone: 'Europe/Berlin', capacity: 1, hours: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '09:00', to: '17:00' }], blocks: [] }],
  offerings: [
    {
      id: 'haircut',
      name: 'Haircut',
      mode: 'duration',
      durationMin: 45,
      bufferBeforeMin: 0,
      bufferAfterMin: 15,
      resourceIds: ['anna'],
      confirmation: 'instant',
      minNoticeMin: 0,
      maxAdvanceDays: 90,
      maxQuantity: 1,
      chooseResource: false,
    },
  ],
  pow: false,
  captcha: false,
};
const CAL: BookingCalendar = { id: 'c1', resourceId: 'anna', kind: 'ics', name: 'Anna’s Google', host: 'calendar.google.com', lastOkAt: Date.now() - 5 * 60_000, lastError: null, lastEvents: 12, createdAt: 0 };

beforeEach(() => {
  for (const m of [getBooking, putBooking, listBookingCalendars, connectBookingCalendar, testBookingCalendar, removeBookingCalendar, discoverBookingCalDav, setBookingCalendarWrites]) m.mockReset();
  getBooking.mockResolvedValue({ item: SAVED, version: 'v1' });
  listBookingCalendars.mockResolvedValue({ calendars: [CAL] });
  putBooking.mockImplementation(async (_p: string, config: BookingConfig) => ({ item: config, version: 'v2' }));
});

const save = () => screen.getByRole('button', { name: 'Save booking set-up' });

describe('editing and saving', () => {
  it('★ saves the whole set-up with the version it was read at, and only once something changed', async () => {
    const onSaved = vi.fn();
    render(<BookingSetupModal projectId="p" onClose={() => undefined} onSaved={onSaved} />);
    await screen.findByText('Haircut');
    expect(save()).toBeDisabled();
    // The only offering opens by itself.
    expect(screen.getByRole('button', { name: /^Haircut/ })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.change(screen.getByLabelText('Length'), { target: { value: '60' } });
    expect(save()).toBeEnabled();
    fireEvent.click(save());
    await waitFor(() => expect(putBooking).toHaveBeenCalledTimes(1));
    const [, sent, version] = putBooking.mock.calls[0]!;
    expect(version).toBe('v1');
    expect((sent as BookingConfig).offerings[0]).toMatchObject({ id: 'haircut', durationMin: 60 });
    expect(await screen.findByRole('status')).toHaveTextContent('Saved. Booking is on.');
    expect(onSaved).toHaveBeenCalled();
    expect(save()).toBeDisabled();
  });

  it('★ will not save what the schema refuses, and says where', async () => {
    render(<BookingSetupModal projectId="p" onClose={() => undefined} />);
    await screen.findByText('Haircut');
    fireEvent.click(screen.getByRole('tab', { name: /Resources/ }));
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '08:00' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/One thing to fix before saving: closes after it opens/);
    expect(screen.getByText('closes after it opens (use two rules to cross midnight)')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Resources/ })).toHaveTextContent('1');
    expect(save()).toBeDisabled();
  });

  it('says when the set-up changed elsewhere meanwhile, and reloads it', async () => {
    putBooking.mockRejectedValueOnce(new ApiError(409, 'conflict'));
    render(<BookingSetupModal projectId="p" onClose={() => undefined} />);
    await screen.findByText('Haircut');
    fireEvent.click(screen.getByRole('tab', { name: /Settings/ }));
    fireEvent.click(screen.getByRole('switch', { name: 'Proof of work (recommended)' }));
    fireEvent.click(save());
    expect(await screen.findByText(/changed elsewhere meanwhile/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(getBooking).toHaveBeenCalledTimes(2));
  });
});

describe('what the review found', () => {
  it('★ keeps what was typed while the set-up saved', async () => {
    let finish: (v: unknown) => void = () => undefined;
    putBooking.mockImplementationOnce(async (_p: string, config: BookingConfig) => new Promise((resolve) => (finish = () => resolve({ item: config, version: 'v2' }))));
    render(<BookingSetupModal projectId="p" onClose={() => undefined} />);
    await screen.findByText('Haircut');
    fireEvent.change(screen.getByLabelText('Length'), { target: { value: '60' } });
    fireEvent.click(save());
    await waitFor(() => expect(putBooking).toHaveBeenCalled());
    // Typed while it saves.
    fireEvent.change(screen.getByLabelText('Length'), { target: { value: '75' } });
    finish(undefined);
    expect(await screen.findByText('Saved. Booking is on.')).toBeInTheDocument();
    expect(screen.getByLabelText('Length')).toHaveValue(75);
    // Still to be saved.
    expect(save()).toBeEnabled();
  });

  it('★ says the calendars could not be loaded, and will not remove a saved resource blind', async () => {
    listBookingCalendars.mockRejectedValue(new ApiError(500, 'boom'));
    render(<BookingSetupModal projectId="p" onClose={() => undefined} />);
    await screen.findByText('Haircut');
    fireEvent.click(screen.getByRole('tab', { name: /Resources/ }));
    expect(within(screen.getByRole('tabpanel')).getByText(/The calendars could not be loaded/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Anna' }));
    expect(await screen.findByText(/Anna’s calendars could not be checked/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Anna/ })).toBeInTheDocument();
  });

  it('★ keeps each new item’s card and typing with it when an earlier one is removed', async () => {
    getBooking.mockRejectedValue(new ApiError(404, 'not found'));
    listBookingCalendars.mockResolvedValue({ calendars: [] });
    render(<BookingSetupModal projectId="p" onClose={() => undefined} />);
    await screen.findByRole('button', { name: 'Add a resource' });
    fireEvent.click(screen.getByRole('button', { name: 'Add a resource' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a resource' }));
    const names = screen.getAllByLabelText('Name');
    fireEvent.change(names[1]!, { target: { value: 'Seaside Flat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Resource 1' }));
    const left = screen.getAllByLabelText('Name');
    expect(left).toHaveLength(1);
    expect(left[0]).toHaveValue('Seaside Flat');
    expect(screen.getByRole('button', { name: /^Seaside Flat/ })).toHaveAttribute('aria-expanded', 'true');
    // A new resource's id is made from its name: it cannot be typed into another's.
    expect(screen.getByLabelText('Id')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Id')).toHaveValue('seaside-flat');
  });

  it('does not count a mode switched there and back as a change', async () => {
    render(<BookingSetupModal projectId="p" onClose={() => undefined} />);
    await screen.findByText('Haircut');
    fireEvent.click(screen.getByRole('button', { name: /^Haircut/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Haircut/ }));
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'slots' } });
    expect(save()).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'duration' } });
    // The duration fields come back at their defaults: put the stored ones back.
    fireEvent.change(screen.getByLabelText('Length'), { target: { value: '45' } });
    fireEvent.change(screen.getByLabelText('Free after'), { target: { value: '15' } });
    expect(save()).toBeDisabled();
  });

  it('moves between the tabs with the arrow keys', async () => {
    render(<BookingSetupModal projectId="p" onClose={() => undefined} />);
    await screen.findByText('Haircut');
    const offerings = screen.getByRole('tab', { name: /Offerings/ });
    expect(offerings).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(offerings, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /Resources/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Resources/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: /Resources/ }), { key: 'End' });
    expect(screen.getByRole('tab', { name: /Settings/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName(/Settings/);
  });
});

describe('the rest of the screen', () => {
  it('edits a resource’s zone, capacity and invitation address', async () => {
    render(<BookingSetupModal projectId="p" onClose={() => undefined} />);
    await screen.findByText('Haircut');
    fireEvent.click(screen.getByRole('tab', { name: /Resources/ }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Time zone' }));
    fireEvent.change(screen.getByLabelText('Search Time zone'), { target: { value: 'lisbon' } });
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Europe/Lisbon'));
    fireEvent.change(screen.getByLabelText('At the same time'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Invitations to'), { target: { value: 'anna@studio.example' } });
    fireEvent.click(save());
    await waitFor(() => expect(putBooking).toHaveBeenCalled());
    expect((putBooking.mock.calls[0]![1] as BookingConfig).resources[0]).toMatchObject({ timeZone: 'Europe/Lisbon', capacity: 3, email: 'anna@studio.example' });
  });

  it('copies an offering’s snippet, and removes the offering', async () => {
    render(<BookingSetupModal projectId="p" onClose={() => undefined} />);
    await screen.findByText('Haircut');
    expect(screen.getByText('{{sw-booking "haircut"}}')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy the snippet for Haircut' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Haircut' }));
    expect(screen.getByText(/Nothing offered yet: booking is off/)).toBeInTheDocument();
    fireEvent.click(save());
    expect(await screen.findByText('Saved. Nothing is offered, so booking is off.')).toBeInTheDocument();
  });
});

describe('a first set-up', () => {
  it('starts from nothing on the resources, and a new offering is served by the new resource', async () => {
    getBooking.mockRejectedValue(new ApiError(404, 'not found'));
    listBookingCalendars.mockResolvedValue({ calendars: [] });
    render(<BookingSetupModal projectId="p" onClose={() => undefined} />);
    expect(await screen.findByRole('tab', { name: /Resources/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Add a resource' }));
    // A new resource's id follows its name.
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Seaside Flat' } });
    expect(screen.getByLabelText('Id')).toHaveValue('seaside-flat');
    expect(screen.getByText(/Save the set-up first/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Offerings/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add an offering' }));
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'days' } });
    fireEvent.click(save());
    await waitFor(() => expect(putBooking).toHaveBeenCalled());
    const sent = putBooking.mock.calls[0]![1] as BookingConfig;
    expect(sent.resources[0]!.id).toBe('seaside-flat');
    expect(sent.offerings[0]).toMatchObject({ mode: 'days', unit: 'night', resourceIds: ['seaside-flat'] });
  });
});

describe('outside calendars', () => {
  it('lists a resource’s calendars, reads one again, and connects another', async () => {
    testBookingCalendar.mockResolvedValue({ calendar: { ...CAL, lastError: 'the calendar answered 404' }, reading: { ok: false, error: 'the calendar answered 404' } });
    connectBookingCalendar.mockResolvedValue({ calendar: { ...CAL, id: 'c2', name: 'Airbnb', host: 'www.airbnb.com', lastEvents: 3 }, reading: { ok: true } });
    render(<BookingSetupModal projectId="p" onClose={() => undefined} />);
    await screen.findByText('Haircut');
    fireEvent.click(screen.getByRole('tab', { name: /Resources/ }));
    expect(screen.getByText('Anna’s Google')).toBeInTheDocument();
    expect(screen.getByText(/read 5 min ago, 12 events in it/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Read Anna’s Google now' }));
    expect(await screen.findByText('Anna’s Google: the calendar answered 404.')).toBeInTheDocument();
    expect(testBookingCalendar).toHaveBeenCalledWith('p', 'c1');

    fireEvent.change(screen.getByLabelText('Calendar name'), { target: { value: 'Airbnb' } });
    fireEvent.change(screen.getByLabelText('Calendar address'), { target: { value: 'https://www.airbnb.com/calendar/ical/1.ics?s=secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('Connected. 3 events in it.')).toBeInTheDocument();
    expect(connectBookingCalendar).toHaveBeenCalledWith('p', { resourceId: 'anna', name: 'Airbnb', url: 'https://www.airbnb.com/calendar/ical/1.ics?s=secret' });
    // The address is not kept on screen once it is connected.
    expect(screen.getByLabelText('Calendar address')).toHaveValue('');
    // Calendars are not part of the set-up's Save.
    expect(save()).toBeDisabled();
  });

  it('★ connects a CalDAV account’s calendar, and lets go of the password once connected', async () => {
    discoverBookingCalDav.mockResolvedValue({ calendars: [{ url: 'https://cloud.example/dav/personal/', name: 'Personal' }, { url: 'https://cloud.example/dav/work/', name: 'Work' }] });
    connectBookingCalendar.mockResolvedValue({ calendar: { ...CAL, id: 'c3', kind: 'caldav', name: 'Work', host: 'cloud.example', lastEvents: 4 }, reading: { ok: true } });
    render(<BookingSetupModal projectId="p" onClose={() => undefined} />);
    await screen.findByText('Haircut');
    fireEvent.click(screen.getByRole('tab', { name: /Resources/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'CalDAV account' }));
    fireEvent.change(screen.getByLabelText('Server address'), { target: { value: 'https://cloud.example' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'anna' } });
    fireEvent.change(screen.getByLabelText('App password'), { target: { value: 'app-pass-1234' } });
    fireEvent.click(screen.getByRole('button', { name: /Find calendars/ }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Work' }));
    expect(screen.getByLabelText('Calendar name')).toHaveValue('Work');
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('Connected. 4 events in it.')).toBeInTheDocument();
    expect(discoverBookingCalDav).toHaveBeenCalledWith('p', { url: 'https://cloud.example', username: 'anna', password: 'app-pass-1234' });
    expect(connectBookingCalendar).toHaveBeenCalledWith('p', { kind: 'caldav', resourceId: 'anna', name: 'Work', url: 'https://cloud.example/dav/work/', username: 'anna', password: 'app-pass-1234', writes: true });
    expect(screen.getByLabelText('App password')).toHaveValue('');
    expect(screen.getByText(/cloud\.example \(CalDAV\)/)).toBeInTheDocument();
  });

  it('switches a CalDAV calendar’s bookings on and off, and shows why a booking could not be written', async () => {
    listBookingCalendars.mockResolvedValue({ calendars: [{ ...CAL, kind: 'caldav', writes: false, writeError: 'a booking could not be written: the calendar server answered 503' }] });
    setBookingCalendarWrites.mockResolvedValue({ calendar: { ...CAL, kind: 'caldav', writes: true, writeError: null } });
    render(<BookingSetupModal projectId="p" onClose={() => undefined} />);
    await screen.findByText('Haircut');
    fireEvent.click(screen.getByRole('tab', { name: /Resources/ }));
    expect(screen.getByText('a booking could not be written: the calendar server answered 503')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Put the bookings into Anna’s Google' }));
    expect(await screen.findByText(/The bookings now go into Anna’s Google, the upcoming ones too\./)).toBeInTheDocument();
    expect(setBookingCalendarWrites).toHaveBeenCalledWith('p', 'c1', true);
    expect(screen.getByRole('switch', { name: 'Put the bookings into Anna’s Google' })).toBeChecked();
    expect(screen.queryByText(/answered 503/)).toBeNull();
  });

  it('says when a CalDAV account’s calendars could not be found', async () => {
    discoverBookingCalDav.mockRejectedValue(new ApiError(400, 'the server did not accept the username or password'));
    render(<BookingSetupModal projectId="p" onClose={() => undefined} />);
    await screen.findByText('Haircut');
    fireEvent.click(screen.getByRole('tab', { name: /Resources/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'CalDAV account' }));
    fireEvent.change(screen.getByLabelText('Server address'), { target: { value: 'https://cloud.example' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'anna' } });
    fireEvent.change(screen.getByLabelText('App password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: /Find calendars/ }));
    expect(await screen.findByText('the server did not accept the username or password')).toBeInTheDocument();
  });

  it('removes a calendar once the author confirms it', async () => {
    removeBookingCalendar.mockResolvedValue({ ok: true });
    render(<BookingSetupModal projectId="p" onClose={() => undefined} />);
    await screen.findByText('Haircut');
    fireEvent.click(screen.getByRole('tab', { name: /Resources/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Anna’s Google' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(removeBookingCalendar).toHaveBeenCalledWith('p', 'c1'));
    await waitFor(() => expect(screen.queryByText('Anna’s Google')).toBeNull());
    // With no calendar left, the resource can go.
    fireEvent.click(screen.getByRole('button', { name: 'Remove Anna' }));
    expect(screen.queryByRole('button', { name: /^Anna/ })).toBeNull();
  });

  it('★ will not remove a resource whose calendars are still connected', async () => {
    render(<BookingSetupModal projectId="p" onClose={() => undefined} />);
    await screen.findByText('Haircut');
    fireEvent.click(screen.getByRole('tab', { name: /Resources/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Anna' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Disconnect Anna’s calendar first.');
    expect(screen.getByRole('button', { name: /^Anna/ })).toBeInTheDocument();
  });

  it('tells a member who may not manage calendars so', async () => {
    listBookingCalendars.mockRejectedValue(new ApiError(403, 'insufficient role'));
    render(<BookingSetupModal projectId="p" onClose={() => undefined} />);
    await screen.findByText('Haircut');
    fireEvent.click(screen.getByRole('tab', { name: /Resources/ }));
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText(/Only the project’s owners and members can connect calendars/)).toBeInTheDocument();
  });
});
