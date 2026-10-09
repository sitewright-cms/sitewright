import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import type { FulfilmentState } from '@sitewright/schema';
import { FULFILMENT_TRANSITIONS } from '@sitewright/schema';
import { Modal } from '../ui/Modal';
import { api, type ShopTransaction } from '../../api';
import { minorPlaces, majorToMinor } from './model';
import { glassInput, ghostButton } from '../../theme';

/**
 * THE ORDERS INBOX.
 *
 * ★ Two state machines, side by side and never merged: PAYMENT status is the provider's and moves on
 * its own; FULFILMENT is the operator's and only they move it. Collapsing them would make "paid" and
 * "posted" the same fact, which is exactly the confusion a shop cannot afford.
 */

// ★ Uses the SHARED exponent table, not a local copy. The copy that used to live here knew only
// five zero-decimal currencies and nothing about the 3-decimal ones, so a KWD order rendered ten
// times its real value — the same mistake, in a second place, which is the argument for one table.
const money = (minor: number, currency: string): string => {
  const places = minorPlaces(currency);
  return `${(minor / 10 ** places).toFixed(places)} ${currency}`;
};

/** Colour carries MEANING here, not decoration: an operator scans this list for what needs attention. */
const STATUS_TONE: Record<string, string> = {
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  created: 'bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
  expired: 'bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400',
  cancelled: 'bg-slate-100 text-slate-500 dark:bg-slate-700/40 dark:text-slate-400',
  refunded: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300',
  partially_refunded: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300',
};

/**
 * The inbox body — reused by the project's Orders TAB (while payments are active) and by the modal
 * below, which the Shop tile still opens when orders exist but payments are not active, so no order is
 * ever stranded behind a hidden tab.
 */
export function OrdersPanel({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<ShopTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [undelivered, setUndelivered] = useState<{ notify: number; receipt: number; lastError?: string } | null>(null);
  const [busy, setBusy] = useState(true);
  const [open, setOpen] = useState<ShopTransaction | null>(null);
  /** The refund panel: open on one order, with its own amount, restock choice and outcome. */
  const [refunding, setRefunding] = useState<{ amount: string; restock: boolean; busy: boolean; error?: string } | null>(null);

  // Memoized so the effect below can depend on it honestly, rather than on a disable comment that
  // claims the deps are fine.
  const load = useCallback(async (): Promise<void> => {
    setBusy(true);
    const [page, und] = await Promise.all([
      api.listTransactions(projectId, { limit: 50, ...(status ? { status } : {}) }).catch(() => ({ items: [], total: 0 })),
      api.transactionsUndelivered(projectId).catch(() => null),
    ]);
    setRows(page.items);
    setTotal(page.total);
    setUndelivered(und);
    setBusy(false);
  }, [projectId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Everything still refundable on an order, in minor units. */
  const outstandingMinor = (r: ShopTransaction): number => r.amounts.totalMinor - r.refundedMinor;

  /**
   * Issues the refund.
   *
   * ★ A blank amount means "everything outstanding" — the same default the endpoint applies, so the
   * common case never asks an operator to compute the remainder of a partially-refunded order.
   */
  const doRefund = async (row: ShopTransaction): Promise<void> => {
    if (!refunding) return;
    const typed = refunding.amount.trim();
    // Major units in the box, minor units on the wire: an operator types 12.50, not 1250.
    const minor = typed === '' ? undefined : majorToMinor(typed, row.currency);
    if (typed !== '' && (minor === undefined || minor <= 0)) {
      setRefunding({ ...refunding, error: 'Enter an amount, or leave it blank to refund everything outstanding.' });
      return;
    }
    setRefunding({ ...refunding, busy: true, error: undefined });
    try {
      const res = await api.refundTransaction(projectId, row.id, {
        ...(minor !== undefined ? { amountMinor: minor } : {}),
        ...(refunding.restock ? { restock: true } : {}),
      });
      setRows((rs) => rs.map((r) => (r.id === row.id ? res.transaction : r)));
      setOpen(res.transaction);
      setRefunding(null);
    } catch (e) {
      const d = (e as { details?: { error?: string; outstanding?: string } }).details;
      setRefunding({ ...refunding, busy: false, error: d?.error ?? (e as Error).message });
    }
  };

  const move = async (row: ShopTransaction, to: FulfilmentState): Promise<void> => {
    const res = await api.setOrderFulfilment(projectId, row.id, to).catch(() => null);
    if (res) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? res.transaction : r)));
      setOpen((o) => (o && o.id === row.id ? res.transaction : o));
    }
  };

  return (
      <div className="flex flex-col gap-3 p-5">
        {/* ★ Emailing somebody about broken email is circular, so this has to be where they already look. */}
        {undelivered && (undelivered.notify > 0 || undelivered.receipt > 0) && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200/70 dark:border-amber-500/20 bg-amber-50/60 dark:bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {undelivered.notify > 0 && <strong>{undelivered.notify} order notification(s) have not reached you. </strong>}
              {undelivered.receipt > 0 && <strong>{undelivered.receipt} customer receipt(s) have not been sent. </strong>}
              {undelivered.lastError && <span className="block opacity-80">Last error: {undelivered.lastError}</span>}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <select className={`${glassInput} max-w-[14rem]`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by payment status">
            <option value="">All payments</option>
            {['created', 'pending', 'paid', 'failed', 'expired', 'cancelled', 'refunded'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button type="button" className={ghostButton} onClick={() => void load()}>
            <RefreshCw className="mr-1 inline h-4 w-4" /> Refresh
          </button>
          <span className="text-xs text-slate-500 dark:text-slate-400">{total} order(s)</span>
          {busy && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
        </div>

        {rows.length === 0 && !busy && (
          <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">No orders yet.</p>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-2 py-1.5">Placed</th>
                  <th className="px-2 py-1.5">Payment</th>
                  <th className="px-2 py-1.5">Fulfilment</th>
                  <th className="px-2 py-1.5 text-right">Total</th>
                  <th className="px-2 py-1.5">Customer</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-t border-slate-200/60 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    onClick={() => setOpen(r)}
                  >
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {new Date(r.createdAt).toLocaleDateString()}
                      {/* ★ A test or preview order must never be mistaken for a sale. */}
                      {r.mode === 'test' && <span className="ml-1 rounded bg-slate-200 dark:bg-slate-700 px-1 text-[10px]">TEST</span>}
                      {r.preview && <span className="ml-1 rounded bg-slate-200 dark:bg-slate-700 px-1 text-[10px]">PREVIEW</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] ${STATUS_TONE[r.status] ?? ''}`}>{r.status}</span>
                    </td>
                    <td className="px-2 py-1.5 text-[11px] text-slate-600 dark:text-slate-300">{r.fulfilment}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(r.amounts.totalMinor, r.currency)}</td>
                    <td className="px-2 py-1.5 text-[11px] text-slate-600 dark:text-slate-300">{r.customerEmail ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {open && (
          <div className="rounded-lg border border-slate-200/70 dark:border-slate-700/70 p-3">
            <h3 className="text-sm font-semibold">Order {open.id.slice(0, 10)}</h3>
            <ul className="mt-2 text-xs">
              {open.lines.map((l) => (
                <li key={l.sku} className="flex justify-between gap-4 py-0.5">
                  <span>
                    {l.qty} &#215; {l.name}
                  </span>
                  <span className="tabular-nums">{money(l.lineMinor, open.currency)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 border-t border-slate-200/60 dark:border-slate-700/60 pt-2 text-xs">
              <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{money(open.amounts.subtotalMinor, open.currency)}</span></div>
              {open.amounts.shippingMinor > 0 && <div className="flex justify-between"><span>Shipping</span><span className="tabular-nums">{money(open.amounts.shippingMinor, open.currency)}</span></div>}
              {open.amounts.taxMinor > 0 && <div className="flex justify-between"><span>Tax</span><span className="tabular-nums">{money(open.amounts.taxMinor, open.currency)}</span></div>}
              <div className="flex justify-between font-semibold"><span>Total</span><span className="tabular-nums">{money(open.amounts.totalMinor, open.currency)}</span></div>
            </div>
            {Object.keys(open.buyer).length > 0 && (
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 text-xs">
                {Object.entries(open.buyer).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-slate-500 dark:text-slate-400">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(FULFILMENT_TRANSITIONS[open.fulfilment] ?? []).map((to) => (
                <button key={to} type="button" className={ghostButton} onClick={() => void move(open, to)}>
                  Mark {to}
                </button>
              ))}
              <button type="button" className={ghostButton} onClick={() => void api.resendOrderMail(projectId, open.id, 'notify')}>
                Resend my copy
              </button>
              {open.customerEmail && (
                <button type="button" className={ghostButton} onClick={() => void api.resendOrderMail(projectId, open.id, 'receipt')}>
                  Resend customer receipt
                </button>
              )}
              {/* ★ Offered only while there is something left to give back, and never on a preview
                  order, which never took money. A button that can only fail is worse than no button. */}
              {(open.status === 'paid' || open.status === 'partially_refunded') && !open.preview && outstandingMinor(open) > 0 && (
                <button
                  type="button"
                  className={ghostButton}
                  onClick={() => setRefunding(refunding ? null : { amount: '', restock: false, busy: false })}
                >
                  Refund&#8230;
                </button>
              )}
            </div>

            {open.refundedMinor > 0 && (
              <p className="mt-2 text-xs text-indigo-700 dark:text-indigo-300">
                {money(open.refundedMinor, open.currency)} refunded
                {outstandingMinor(open) > 0 && <> &#183; {money(outstandingMinor(open), open.currency)} still outstanding</>}
              </p>
            )}

            {refunding && (
              <div className="mt-3 rounded-lg border border-slate-200/70 dark:border-slate-700/70 bg-slate-50/60 dark:bg-slate-800/40 p-3">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-slate-600 dark:text-slate-300">
                      Amount ({open.currency}) &#8212; blank refunds everything outstanding
                    </span>
                    <input
                      className={`${glassInput} w-40`}
                      inputMode="decimal"
                      placeholder={(outstandingMinor(open) / 10 ** minorPlaces(open.currency)).toFixed(minorPlaces(open.currency))}
                      value={refunding.amount}
                      onChange={(e) => setRefunding({ ...refunding, amount: e.target.value })}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={refunding.restock}
                      onChange={(e) => setRefunding({ ...refunding, restock: e.target.checked })}
                    />
                    {/* ★ Not pre-ticked, and the label says why it is a question rather than a default. */}
                    <span>Put the items back on sale (only if they came back sellable)</span>
                  </label>
                  <button type="button" className={ghostButton} disabled={refunding.busy} onClick={() => void doRefund(open)}>
                    {refunding.busy && <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />}
                    Refund
                  </button>
                  <button type="button" className={ghostButton} disabled={refunding.busy} onClick={() => setRefunding(null)}>
                    Cancel
                  </button>
                </div>
                {refunding.error && (
                  <p className="mt-2 text-xs text-red-700 dark:text-red-300">{refunding.error}</p>
                )}
                <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                  This asks {open.gatewayId} to return the money. It cannot be undone from here.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
  );
}

export function TransactionsInbox({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  return (
    <Modal title="Orders" size="screen" onClose={onClose}>
      <OrdersPanel projectId={projectId} />
    </Modal>
  );
}
