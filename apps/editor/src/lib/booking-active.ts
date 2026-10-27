import { useEffect, useState } from 'react';
import { api } from '../api';

/** Fired when something may have changed whether a project takes bookings. */
const BOOKING_CHANGED = 'sw:booking-changed';

/** Tell the project chrome to re-check a project's booking set-up (after it was saved). */
export function notifyBookingChanged(projectId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(BOOKING_CHANGED, { detail: { projectId } }));
}

/**
 * Whether a project TAKES BOOKINGS: its booking set-up offers at least one thing to book. An empty set-up is
 * how booking is switched off, and a project without one has never switched it on. A refusal or an older API
 * reads as "no".
 */
export async function fetchBookingActive(projectId: string): Promise<boolean> {
  // Promise.resolve().then(...) turns even a synchronous throw into a rejection the catch absorbs.
  return Promise.resolve()
    .then(() => api.getBooking(projectId))
    .then((r) => (r.item.offerings ?? []).length > 0)
    .catch(() => false);
}

/**
 * {@link fetchBookingActive}, kept current: re-checked when the project changes, when anything announces a
 * change ({@link notifyBookingChanged}), and when the window regains focus (an agent may have changed the set-up).
 */
export function useBookingActive(projectId: string | null): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    // A different project starts from "no": never show one project's Bookings tab on another.
    setActive(false);
    if (!projectId) return;
    let live = true;
    const check = (): void => {
      void fetchBookingActive(projectId).then((v) => {
        if (live) setActive(v);
      });
    };
    check();
    const onChanged = (e: Event): void => {
      const id = (e as CustomEvent<{ projectId?: string }>).detail?.projectId;
      if (!id || id === projectId) check();
    };
    window.addEventListener(BOOKING_CHANGED, onChanged);
    window.addEventListener('focus', check);
    return () => {
      live = false;
      window.removeEventListener(BOOKING_CHANGED, onChanged);
      window.removeEventListener('focus', check);
    };
  }, [projectId]);
  return active;
}
