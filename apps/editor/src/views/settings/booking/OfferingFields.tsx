import { Plus, Trash2 } from 'lucide-react';
import { BOOKING_LIMITS, type BookingConfig, type BookingOffering, type BookingSlot } from '@sitewright/schema';
import { dangerButton, smallGhostButton, toggleInput } from '../../../theme';
import { DaysPicker, NumField, PartHeading, RowErrors, SelectField, TextField, ToggleRow } from './fields';
import { MODE_HINTS, MODE_LABELS, idFollowingName, withMode } from './model';
import { PriceFields } from './PaymentFields';

/** Steps that divide the day, so the grid of start and end times is the same every day. */
const RANGE_STEPS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 1440];

/** One offering's fields: what all modes share, then its mode's own. */
export function OfferingFields({
  offering: o,
  index: i,
  config,
  issues,
  idFixed,
  others,
  onChange,
}: {
  offering: BookingOffering;
  index: number;
  config: BookingConfig;
  issues: ReadonlyMap<string, string>;
  idFixed: boolean;
  others: ReadonlySet<string>;
  onChange: (next: BookingOffering) => void;
}) {
  const err = (field: string): string | undefined => issues.get(`offerings.${i}.${field}`);
  const resourcesError = [...issues].find(([k]) => k === `offerings.${i}.resourceIds` || k.startsWith(`offerings.${i}.resourceIds.`))?.[1];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          label="Name"
          value={o.name}
          placeholder="Haircut, City tour, Seaside flat"
          onChange={(name) =>
            onChange({
              ...o,
              name,
              id: idFixed ? o.id : idFollowingName(o, name, others, 'offering'),
            })
          }
          error={err('name')}
        />
        <TextField
          label="Id"
          value={o.id}
          readOnly={idFixed}
          onChange={(id) => onChange({ ...o, id })}
          error={err('id')}
          tip="Names this offering in the booking widget's snippet. Fixed once saved: bookings already made refer to it."
        />
        <SelectField
          label="Kind"
          value={o.mode}
          onChange={(mode) => onChange(withMode(o, mode))}
          options={(['duration', 'slots', 'range', 'days'] as const).map((m) => ({ value: m, label: MODE_LABELS[m] }))}
          tip={Object.values(MODE_HINTS).join(' ')}
        />
        <SelectField
          label="Confirmation"
          value={o.confirmation}
          onChange={(confirmation) => onChange({ ...o, confirmation })}
          options={[
            { value: 'instant', label: 'Booked at once' },
            { value: 'request', label: 'You accept each request' },
          ]}
          tip="Booked at once: the visitor's booking is confirmed the moment it is made. A request holds the time until you accept or decline it in the Bookings tab."
        />
      </div>

      <div>
        <PartHeading tip="Who or what can serve it. With several, a visitor gets whichever is free, or picks one if you let them.">Served by</PartHeading>
        {config.resources.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">Add a resource first.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {config.resources.map((r) => (
              <label
                key={r.id}
                className="flex items-center gap-2 rounded-lg border border-slate-200/70 bg-white/40 px-2.5 py-1.5 text-sm dark:border-white/10 dark:bg-white/5"
              >
                <input
                  type="checkbox"
                  className={toggleInput}
                  aria-label={`Served by ${r.name}`}
                  checked={o.resourceIds.includes(r.id)}
                  onChange={(e) =>
                    onChange({
                      ...o,
                      resourceIds: e.target.checked
                        ? config.resources.filter((x) => x.id === r.id || o.resourceIds.includes(x.id)).map((x) => x.id)
                        : o.resourceIds.filter((x) => x !== r.id),
                    })
                  }
                />
                <span className="text-slate-700 dark:text-slate-200">{r.name}</span>
              </label>
            ))}
          </div>
        )}
        {resourcesError && <p className="mt-1 text-[11px] font-medium text-red-500 dark:text-red-400">{resourcesError}</p>}
        {o.resourceIds.length > 1 && (
          <div className="mt-2">
            <ToggleRow label="Let visitors choose who or what" checked={o.chooseResource} onChange={(chooseResource) => onChange({ ...o, chooseResource })}>
              Off: they get whichever is free, and never see the names.
            </ToggleRow>
          </div>
        )}
      </div>

      <ModeFields offering={o} index={i} issues={issues} onChange={onChange} />

      <div>
        <PartHeading>Price</PartHeading>
        <PriceFields offering={o} index={i} config={config} issues={issues} onChange={onChange} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <NumField
          label="Booked at least"
          value={o.minNoticeMin}
          min={0}
          suffix="min ahead"
          onChange={(v) => onChange({ ...o, minNoticeMin: v as number })}
          error={err('minNoticeMin')}
          tip="How long before it starts a booking can still be made: 0 for right up to the start, 1440 for a day ahead."
        />
        <NumField
          label="Booked at most"
          value={o.maxAdvanceDays}
          min={1}
          max={BOOKING_LIMITS.maxAdvanceDays}
          suffix="days ahead"
          onChange={(v) => onChange({ ...o, maxAdvanceDays: v as number })}
          error={err('maxAdvanceDays')}
        />
        <NumField
          label="Per booking up to"
          value={o.maxQuantity}
          min={1}
          max={BOOKING_LIMITS.capacity}
          suffix={o.mode === 'slots' ? 'seats' : 'at once'}
          onChange={(v) => onChange({ ...o, maxQuantity: v as number })}
          error={err('maxQuantity')}
          tip="How many seats or units one booking may take: a family on a tour, three bikes. 1 for an appointment."
        />
      </div>
    </div>
  );
}

function ModeFields({
  offering: o,
  index: i,
  issues,
  onChange,
}: {
  offering: BookingOffering;
  index: number;
  issues: ReadonlyMap<string, string>;
  onChange: (next: BookingOffering) => void;
}) {
  const err = (field: string): string | undefined => issues.get(`offerings.${i}.${field}`);
  switch (o.mode) {
    case 'duration':
      return (
        <div className="grid gap-3 sm:grid-cols-4">
          <NumField
            label="Length"
            value={o.durationMin}
            min={5}
            suffix="min"
            onChange={(v) => onChange({ ...o, durationMin: v as number })}
            error={err('durationMin')}
          />
          <NumField
            label="A start every"
            value={o.stepMin}
            min={5}
            suffix="min"
            placeholder={String(o.durationMin || '')}
            onChange={(v) => onChange({ ...o, stepMin: v })}
            error={err('stepMin')}
            tip="Minutes between possible start times. Empty: one start every length (60-minute appointments at 09:00, 10:00…)."
          />
          <NumField
            label="Free before"
            value={o.bufferBeforeMin}
            min={0}
            suffix="min"
            onChange={(v) => onChange({ ...o, bufferBeforeMin: v as number })}
            error={err('bufferBeforeMin')}
            tip="Kept free before each booking: setting up, travelling."
          />
          <NumField
            label="Free after"
            value={o.bufferAfterMin}
            min={0}
            suffix="min"
            onChange={(v) => onChange({ ...o, bufferAfterMin: v as number })}
            error={err('bufferAfterMin')}
            tip="Kept free after each booking: cleaning up, a break."
          />
        </div>
      );
    case 'slots':
      return <SlotsEditor slots={o.slots} onChange={(slots) => onChange({ ...o, slots })} issues={issues} path={`offerings.${i}.slots`} />;
    case 'range':
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <NumField label="At least" value={o.minMin} min={5} suffix="min" onChange={(v) => onChange({ ...o, minMin: v as number })} error={err('minMin')} />
          <NumField label="At most" value={o.maxMin} min={5} suffix="min" onChange={(v) => onChange({ ...o, maxMin: v as number })} error={err('maxMin')} />
          <SelectField
            label="Times on a grid of"
            value={String(o.stepMin)}
            onChange={(v) => onChange({ ...o, stepMin: Number(v) })}
            // A stored step not in the list (an agent may write any that divides the day) is shown as it is.
            options={[...new Set([...RANGE_STEPS, o.stepMin])]
              .sort((x, y) => x - y)
              .map((s) => ({
                value: String(s),
                label: `${s} min`,
              }))}
            error={err('stepMin')}
            tip="Start and end fall on this grid of the clock: every 30 minutes gives 09:00, 09:30, 10:00…"
          />
        </div>
      );
    case 'days':
      return (
        <div className="grid gap-3 sm:grid-cols-5">
          <SelectField
            label="By the"
            value={o.unit}
            onChange={(unit) => onChange({ ...o, unit })}
            options={[
              { value: 'night', label: 'Night (a stay)' },
              { value: 'day', label: 'Day' },
            ]}
          />
          <NumField
            label="At least"
            value={o.minUnits}
            min={1}
            suffix={o.unit === 'night' ? 'nights' : 'days'}
            onChange={(v) => onChange({ ...o, minUnits: v as number })}
            error={err('minUnits')}
          />
          <NumField
            label="At most"
            value={o.maxUnits}
            min={1}
            suffix={o.unit === 'night' ? 'nights' : 'days'}
            onChange={(v) => onChange({ ...o, maxUnits: v as number })}
            error={err('maxUnits')}
          />
          {o.unit === 'night' && (
            <>
              <TextField
                label="Check-in from"
                value={o.checkIn}
                placeholder="15:00"
                onChange={(checkIn) => onChange({ ...o, checkIn })}
                error={err('checkIn')}
              />
              <TextField
                label="Check-out by"
                value={o.checkOut}
                placeholder="11:00"
                onChange={(checkOut) => onChange({ ...o, checkOut })}
                error={err('checkOut')}
              />
            </>
          )}
        </div>
      );
  }
}

/** The set start times of a `slots` offering: weekdays, a time, a length, and seats of its own. */
function SlotsEditor({
  slots,
  onChange,
  issues,
  path,
}: {
  slots: readonly BookingSlot[];
  onChange: (slots: BookingSlot[]) => void;
  issues: ReadonlyMap<string, string>;
  path: string;
}) {
  const set = (i: number, slot: BookingSlot): void => onChange(slots.map((s, j) => (j === i ? slot : s)));
  const err = (i: number, field: string): string | undefined => issues.get(`${path}.${i}.${field}`);
  return (
    <div>
      <PartHeading
        tip="Each start time takes its resource for its length, and has its own seats (empty: the resource's own number)."
        action={
          slots.length < BOOKING_LIMITS.slots && (
            <button type="button" className={smallGhostButton} onClick={() => onChange([...slots, { days: ['sat'], at: '10:00', durationMin: 60 }])}>
              <Plus className="h-3.5 w-3.5" /> Add a time
            </button>
          )
        }
      >
        Set times
      </PartHeading>
      {issues.get(path) && <p className="mb-1 text-[11px] font-medium text-red-500 dark:text-red-400">{issues.get(path)}</p>}
      <ul className="flex flex-col gap-2">
        {slots.map((slot, i) => (
          <li key={i} className="rounded-xl border border-slate-200/70 bg-white/40 p-2.5 dark:border-white/10 dark:bg-white/5">
            <div className="flex flex-wrap items-end gap-3">
              <DaysPicker
                label="Days"
                ariaLabel={`Set time ${i + 1}: days`}
                value={slot.days}
                onChange={(days) => set(i, { ...slot, days })}
                error={err(i, 'days')}
                quiet
              />
              <div className="w-24">
                <TextField
                  label="At"
                  ariaLabel={`Set time ${i + 1}: at`}
                  value={slot.at}
                  placeholder="10:00"
                  onChange={(at) => set(i, { ...slot, at })}
                  error={err(i, 'at')}
                  quiet
                />
              </div>
              <div className="w-32">
                <NumField
                  label="Length"
                  ariaLabel={`Set time ${i + 1}: length`}
                  value={slot.durationMin}
                  min={5}
                  suffix="min"
                  onChange={(v) => set(i, { ...slot, durationMin: v as number })}
                  error={err(i, 'durationMin')}
                  quiet
                />
              </div>
              <div className="w-28">
                <NumField
                  label="Seats"
                  ariaLabel={`Set time ${i + 1}: seats`}
                  value={slot.capacity}
                  min={1}
                  placeholder="all"
                  onChange={(capacity) => set(i, { ...slot, capacity })}
                  error={err(i, 'capacity')}
                  quiet
                />
              </div>
              <button
                type="button"
                className={`${dangerButton} mb-0.5`}
                aria-label={`Remove time ${i + 1}`}
                onClick={() => onChange(slots.filter((_, j) => j !== i))}
                disabled={slots.length === 1}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <RowErrors errors={['days', 'at', 'durationMin', 'capacity'].map((f) => err(i, f))} />
          </li>
        ))}
      </ul>
    </div>
  );
}
