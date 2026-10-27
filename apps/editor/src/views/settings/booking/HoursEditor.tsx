import { Plus, Trash2 } from 'lucide-react';
import { BOOKING_LIMITS, type HoursRule } from '@sitewright/schema';
import { dangerButton, smallGhostButton } from '../../../theme';
import { DaysPicker, PartHeading, RowErrors, TextField } from './fields';

/**
 * A resource's OPENING HOURS: rules of weekdays and a from–to on the resource's own clock. Several rules make a
 * split day; `24:00` ends a day at midnight, and a rule from `00:00` the next day carries a booking on through it.
 */
export function HoursEditor({
  hours,
  onChange,
  issues,
  path,
}: {
  hours: readonly HoursRule[];
  onChange: (hours: HoursRule[]) => void;
  issues: ReadonlyMap<string, string>;
  /** Where these rules sit in the set-up, for the schema's messages (`resources.0.hours`). */
  path: string;
}) {
  const set = (i: number, rule: HoursRule): void => onChange(hours.map((r, j) => (j === i ? rule : r)));
  return (
    <div>
      <PartHeading
        tip="When this can be booked, on its own clock. Two rules on one day make a split day (09:00–12:00 and 13:00–17:00). Use 24:00 to close at midnight. Set times (tours, classes) ignore opening hours."
        action={
          hours.length < BOOKING_LIMITS.hoursRules && (
            <button
              type="button"
              className={smallGhostButton}
              onClick={() =>
                onChange([
                  ...hours,
                  {
                    days: ['mon', 'tue', 'wed', 'thu', 'fri'],
                    from: '09:00',
                    to: '17:00',
                  },
                ])
              }
            >
              <Plus className="h-3.5 w-3.5" /> Add hours
            </button>
          )
        }
      >
        Opening hours
      </PartHeading>
      {hours.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400">No opening hours: only set times can be booked.</p>}
      <ul className="flex flex-col gap-2">
        {hours.map((rule, i) => (
          <li key={i} className="rounded-xl border border-slate-200/70 bg-white/40 p-2.5 dark:border-white/10 dark:bg-white/5">
            <div className="flex flex-wrap items-end gap-3">
              <DaysPicker
                label="Days"
                ariaLabel={`Opening hours ${i + 1}: days`}
                value={rule.days}
                onChange={(days) => set(i, { ...rule, days })}
                error={issues.get(`${path}.${i}.days`)}
                quiet
              />
              <div className="w-24">
                <TextField
                  label="From"
                  ariaLabel={`Opening hours ${i + 1}: from`}
                  value={rule.from}
                  placeholder="09:00"
                  onChange={(from) => set(i, { ...rule, from })}
                  error={issues.get(`${path}.${i}.from`)}
                  quiet
                />
              </div>
              <div className="w-24">
                <TextField
                  label="To"
                  ariaLabel={`Opening hours ${i + 1}: to`}
                  value={rule.to}
                  placeholder="17:00"
                  onChange={(to) => set(i, { ...rule, to })}
                  error={issues.get(`${path}.${i}.to`)}
                  quiet
                />
              </div>
              <button
                type="button"
                className={`${dangerButton} mb-0.5`}
                aria-label={`Remove hours ${i + 1}`}
                onClick={() => onChange(hours.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <RowErrors errors={['days', 'from', 'to'].map((f) => issues.get(`${path}.${i}.${f}`))} />
          </li>
        ))}
      </ul>
    </div>
  );
}
