import { Receipt } from 'lucide-react';
import type { Project } from '../api';
import { accentChip, glassCard } from '../theme';
import { OrdersPanel } from './settings/TransactionsInbox';

/**
 * The project's ORDERS tab. Orders are daily work, not configuration, so they live beside Pages and
 * Forms rather than inside Website Settings — and the tab exists only while the project's payments are
 * actually active (see `usePaymentsActive`).
 */
export function OrdersView({ project }: { project: Project }) {
  return (
    <section className={`${glassCard} overflow-hidden`} aria-labelledby="orders-heading">
      <header className="flex items-center gap-3 border-b border-slate-200/70 bg-slate-100/70 px-5 py-3 dark:border-slate-700/70 dark:bg-white/10">
        <span className={accentChip} aria-hidden>
          <Receipt className="h-4 w-4" />
        </span>
        <h2 id="orders-heading" className="text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
          Orders
        </h2>
        <span className="text-sm text-slate-500 dark:text-slate-400">Payments, fulfilment, refunds and receipts</span>
      </header>
      <OrdersPanel projectId={project.id} />
    </section>
  );
}
