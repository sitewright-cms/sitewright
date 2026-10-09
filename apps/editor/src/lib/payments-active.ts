import { useEffect, useState } from 'react';
import { api } from '../api';

/** Fired when something may have changed whether a project's payments are active. */
const PAYMENTS_CHANGED = 'sw:payments-changed';

/** Tell the project chrome to re-check a project's payments (after keys, the mode or the shop switch change). */
export function notifyPaymentsChanged(projectId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PAYMENTS_CHANGED, { detail: { projectId } }));
}

/**
 * Whether a project's PAYMENTS are actually active: the shop is switched on (as saved) AND a payment
 * gateway is bound with every required credential for its current mode — `binding.complete`, the only
 * state in which a checkout can be attempted. Test mode counts: test orders are real orders to work on.
 *
 * ★ The server decides who may know. The binding endpoint is owner/admin and session only, so for any
 * other member it refuses — and a refusal, like an older API without the route, simply means "not
 * active". The client never re-derives the role rule.
 */
export async function fetchPaymentsActive(projectId: string): Promise<boolean> {
  // Promise.resolve().then(...) turns even a synchronous throw into a rejection the catch absorbs.
  const [shopOn, complete] = await Promise.all([
    Promise.resolve()
      .then(() => api.getSettings(projectId))
      .then((r) => r.item.website?.shop?.enabled === true)
      .catch(() => false),
    Promise.resolve()
      .then(() => api.getProjectPayment(projectId))
      .then((r) => r.binding?.complete === true)
      .catch(() => false),
  ]);
  return shopOn && complete;
}

/**
 * {@link fetchPaymentsActive}, kept current: re-checked when the project changes, when anything announces
 * a payments change ({@link notifyPaymentsChanged}), and when the window regains focus (another tab or an
 * agent may have changed the shop).
 */
export function usePaymentsActive(projectId: string | null): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    // A different project starts from "no" — never show one project's Orders tab on another.
    setActive(false);
    if (!projectId) return;
    let live = true;
    const check = (): void => {
      void fetchPaymentsActive(projectId).then((v) => {
        if (live) setActive(v);
      });
    };
    check();
    const onChanged = (e: Event): void => {
      const id = (e as CustomEvent<{ projectId?: string }>).detail?.projectId;
      if (!id || id === projectId) check();
    };
    window.addEventListener(PAYMENTS_CHANGED, onChanged);
    window.addEventListener('focus', check);
    return () => {
      live = false;
      window.removeEventListener(PAYMENTS_CHANGED, onChanged);
      window.removeEventListener('focus', check);
    };
  }, [projectId]);
  return active;
}
