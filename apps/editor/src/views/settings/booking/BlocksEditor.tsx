import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { BOOKING_LIMITS, type BookingBlock } from '@sitewright/schema';
import { dangerButton, smallGhostButton } from '../../../theme';
import { DaysPicker, PartHeading, RowErrors, SELECT, TextField } from './fields';

/** Blocked times, by kind: holidays (whole days), a one-off stretch, and the same hours every week. */
const KINDS: ReadonlyArray<{ value: BookingBlock['kind']; label: string }> = [
  { value: 'dates', label: 'Whole days' },
  { value: 'once', label: 'Once' },
  { value: 'weekly', label: 'Every week' },
];

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fresh(kind: BookingBlock['kind']): BookingBlock {
  const day = today();
  if (kind === 'dates') return { kind, from: day, to: day };
  if (kind === 'once') return { kind, start: `${day}T12:00`, end: `${day}T13:00` };
  return {
    kind,
    days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    from: '12:00',
    to: '13:00',
  };
}

/** A resource's BLOCKED TIMES: when it takes no bookings although open (holidays, a lunch break, a closure). */
export function BlocksEditor({
  blocks,
  onChange,
  issues,
  path,
}: {
  blocks: readonly BookingBlock[];
  onChange: (blocks: BookingBlock[]) => void;
  issues: ReadonlyMap<string, string>;
  path: string;
}) {
  const [kind, setKind] = useState<BookingBlock['kind']>('dates');
  const set = (i: number, block: BookingBlock): void => onChange(blocks.map((b, j) => (j === i ? block : b)));
  const err = (i: number, field: string): string | undefined => issues.get(`${path}.${i}.${field}`);
  return (
    <div>
      <PartHeading
        tip="Times this takes no bookings although it is open: holidays and closures (whole days), a one-off stretch, or the same hours every week (a lunch break). On its own clock."
        action={
          blocks.length < BOOKING_LIMITS.blocks && (
            <span className="flex items-center gap-1.5">
              <select
                aria-label="Kind of blocked time"
                className={`${SELECT} !w-auto !py-1 text-xs`}
                value={kind}
                onChange={(e) => setKind(e.target.value as BookingBlock['kind'])}
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
              <button type="button" className={smallGhostButton} onClick={() => onChange([...blocks, fresh(kind)])}>
                <Plus className="h-3.5 w-3.5" /> Block time
              </button>
            </span>
          )
        }
      >
        Blocked times
      </PartHeading>
      {blocks.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400">Nothing blocked.</p>}
      {issues.get(`${path}`) && <p className="mb-1 text-[11px] font-medium text-red-500 dark:text-red-400">{issues.get(path)}</p>}
      <ul className="flex flex-col gap-2">
        {blocks.map((block, i) => (
          <li key={i} className="rounded-xl border border-slate-200/70 bg-white/40 p-2.5 dark:border-white/10 dark:bg-white/5">
            <div className="flex flex-wrap items-end gap-3">
              <span className="mb-2 w-24 shrink-0 text-xs font-medium text-slate-600 dark:text-slate-300">
                {KINDS.find((k) => k.value === block.kind)?.label}
              </span>
              {block.kind === 'dates' && (
                <>
                  <div className="w-40">
                    <TextField
                      label="From"
                      ariaLabel={`Blocked time ${i + 1}: from`}
                      type="date"
                      value={block.from}
                      onChange={(from) => set(i, { ...block, from })}
                      error={err(i, 'from')}
                      quiet
                    />
                  </div>
                  <div className="w-40">
                    <TextField
                      label="To"
                      ariaLabel={`Blocked time ${i + 1}: to`}
                      type="date"
                      value={block.to}
                      onChange={(to) => set(i, { ...block, to })}
                      error={err(i, 'to')}
                      quiet
                    />
                  </div>
                </>
              )}
              {block.kind === 'once' && (
                <>
                  <div className="w-52">
                    <TextField
                      label="Starts"
                      ariaLabel={`Blocked time ${i + 1}: starts`}
                      type="datetime-local"
                      value={block.start}
                      onChange={(start) => set(i, { ...block, start })}
                      error={err(i, 'start')}
                      quiet
                    />
                  </div>
                  <div className="w-52">
                    <TextField
                      label="Ends"
                      ariaLabel={`Blocked time ${i + 1}: ends`}
                      type="datetime-local"
                      value={block.end}
                      onChange={(end) => set(i, { ...block, end })}
                      error={err(i, 'end')}
                      quiet
                    />
                  </div>
                </>
              )}
              {block.kind === 'weekly' && (
                <>
                  <DaysPicker
                    label="Days"
                    ariaLabel={`Blocked time ${i + 1}: days`}
                    value={block.days}
                    onChange={(days) => set(i, { ...block, days })}
                    error={err(i, 'days')}
                    quiet
                  />
                  <div className="w-24">
                    <TextField
                      label="From"
                      ariaLabel={`Blocked time ${i + 1}: from`}
                      value={block.from}
                      placeholder="12:00"
                      onChange={(from) => set(i, { ...block, from })}
                      error={err(i, 'from')}
                      quiet
                    />
                  </div>
                  <div className="w-24">
                    <TextField
                      label="To"
                      ariaLabel={`Blocked time ${i + 1}: to`}
                      value={block.to}
                      placeholder="13:00"
                      onChange={(to) => set(i, { ...block, to })}
                      error={err(i, 'to')}
                      quiet
                    />
                  </div>
                </>
              )}
              <div className="min-w-[10rem] flex-1">
                <TextField
                  label="Note"
                  ariaLabel={`Blocked time ${i + 1}: note`}
                  value={block.note ?? ''}
                  placeholder="Optional"
                  onChange={(note) => set(i, { ...block, note: note || undefined })}
                  error={err(i, 'note')}
                  quiet
                />
              </div>
              <button
                type="button"
                className={`${dangerButton} mb-0.5`}
                aria-label={`Remove blocked time ${i + 1}`}
                onClick={() => onChange(blocks.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <RowErrors errors={['from', 'to', 'start', 'end', 'days', 'note'].map((f) => err(i, f))} />
          </li>
        ))}
      </ul>
    </div>
  );
}
