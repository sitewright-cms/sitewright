import type { RankDailyStat } from '@sitewright/schema';

const LABELS: Record<string, string> = { dataforseo: 'DataForSEO', apify: 'Apify', brightdata: 'Bright Data' };

const usd = (n: number): string => `$${n.toFixed(n > 0 && n < 1 ? 3 : 2)}`;

/** A count, or a dash for none — so the rows that need a look stand out. */
const count = (n: number): string => (n === 0 ? '—' : String(n));

/**
 * The last days' checks per provider: how many were made, what they found, what failed or had to be tried again, and
 * what they cost — what tells an admin whether a provider is coping, before a client notices a gap.
 */
export function RankTrackingStats({ recent }: { recent: readonly RankDailyStat[] }) {
  if (recent.length === 0) return <p className="text-xs text-slate-500 dark:text-slate-400">No checks in the last 7 days.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs" aria-label="Checks in the last 7 days">
        <thead className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <tr>
            <th className="px-2 py-1.5">Day</th>
            <th className="px-2 py-1.5">Provider</th>
            <th className="px-2 py-1.5 text-right">Checks</th>
            <th className="px-2 py-1.5 text-right">Found</th>
            <th className="px-2 py-1.5 text-right">Not found</th>
            <th className="px-2 py-1.5 text-right">Failed</th>
            <th className="px-2 py-1.5 text-right" title="Sent, or waiting for a next page or another try">
              Running
            </th>
            <th className="px-2 py-1.5 text-right" title="Tried again later the same day: the provider could not run the search">
              Retried
            </th>
            <th className="px-2 py-1.5 text-right" title="Read a second time to confirm a drop to “not found”">
              Confirmed
            </th>
            <th className="px-2 py-1.5 text-right" title="Results pages of the readings recorded">
              Pages
            </th>
            <th className="px-2 py-1.5 text-right">Cost</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((r) => (
            <tr key={`${r.day} ${r.provider}`} className="border-t border-slate-200/60 dark:border-slate-700/60">
              <td className="px-2 py-1.5 whitespace-nowrap">{r.day}</td>
              <td className="px-2 py-1.5 whitespace-nowrap">{LABELS[r.provider] ?? r.provider}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.checks}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{count(r.found)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{count(r.notFound)}</td>
              <td className={`px-2 py-1.5 text-right tabular-nums ${r.failed > 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{count(r.failed)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{count(r.running)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{count(r.retried)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{count(r.confirmed)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.pages}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{usd(r.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
