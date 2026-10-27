import { useId, type ReactNode } from 'react';
import { WEEKDAYS, type Weekday } from '@sitewright/schema';
import { fieldLabel, glassInput, gradientSurface, toggleInput } from '../../../theme';
import { SectionHelp } from '../../ui/SectionHelp';
import { WEEKDAY_LABELS } from './model';

/**
 * The booking set-up's small controls. Each shows the schema's message for its field (`error`) under it, the
 * way the shared `Field` does.
 */

const ERROR = 'mt-1 block text-[11px] font-medium text-red-500 dark:text-red-400';
const INVALID = '!border-red-400 sw-invalid-focus';
/** Native options keep readable colours in dark mode (a select's open list paints them itself). */
export const SELECT = `${glassInput} [&>option]:bg-white [&>option]:text-slate-800 dark:[&>option]:bg-slate-900 dark:[&>option]:text-slate-100`;

function Label({ text, tip, htmlFor }: { text: string; tip?: string; htmlFor: string }) {
  return (
    <span className="flex items-center gap-1">
      <label htmlFor={htmlFor} className={fieldLabel}>
        {text}
      </label>
      {tip && <SectionHelp tip={tip} />}
    </span>
  );
}

function ErrorText({ id, error }: { id: string; error?: string }) {
  return error ? (
    <span id={id} className={ERROR}>
      {error}
    </span>
  ) : null;
}

/** A whole number. An empty box is "not a number", which the schema then names. */
export function NumField({
  label,
  value,
  onChange,
  error,
  min,
  max,
  suffix,
  tip,
  placeholder,
  quiet = false,
  ariaLabel,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  error?: string;
  min?: number;
  max?: number;
  suffix?: string;
  tip?: string;
  placeholder?: string;
  /** Marks the field invalid without its message: a row shows its fields' messages under it (see RowErrors). */
  quiet?: boolean;
  /** The name a screen reader announces, where the visible label repeats from row to row. */
  ariaLabel?: string;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col">
      <Label text={label} tip={tip} htmlFor={id} />
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          className={`${glassInput} ${error ? INVALID : ''}`}
          value={value === undefined || Number.isNaN(value) ? '' : String(value)}
          min={min}
          max={max}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-invalid={error ? true : undefined}
          aria-describedby={error && !quiet ? `${id}-error` : undefined}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Math.trunc(Number(e.target.value)))}
        />
        {suffix && <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{suffix}</span>}
      </div>
      {!quiet && <ErrorText id={`${id}-error`} error={error} />}
    </div>
  );
}

/** A line of text (a name, an address, a time of day `HH:MM`). */
export function TextField({
  label,
  value,
  onChange,
  error,
  tip,
  placeholder,
  type = 'text',
  readOnly = false,
  hint,
  quiet = false,
  autoComplete,
  ariaLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  tip?: string;
  placeholder?: string;
  type?: string;
  readOnly?: boolean;
  hint?: string;
  autoComplete?: string;
  /** The name a screen reader announces, where the visible label repeats from row to row ("Opening hours 2: to"). */
  ariaLabel?: string;
  /** Marks the field invalid without its message: a row shows its fields' messages under it (see RowErrors). */
  quiet?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col">
      <Label text={label} tip={tip} htmlFor={id} />
      <input
        id={id}
        type={type}
        className={`${glassInput} ${error ? INVALID : ''} ${readOnly ? 'cursor-default opacity-70' : ''}`}
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        autoComplete={autoComplete}
        spellCheck={autoComplete === 'off' ? false : undefined}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error && !quiet ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && quiet ? null : error ? (
        <ErrorText id={`${id}-error`} error={error} />
      ) : hint ? (
        <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">{hint}</span>
      ) : null}
    </div>
  );
}

/** A choice among a few, as a native select. */
export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  tip,
  error,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  tip?: string;
  error?: string;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col">
      <Label text={label} tip={tip} htmlFor={id} />
      <select
        id={id}
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={error ? true : undefined}
        className={`${SELECT} ${error ? INVALID : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ErrorText id={`${id}-error`} error={error} />
    </div>
  );
}

/** An on/off setting with its explanation beside it. */
export function ToggleRow({ label, checked, onChange, children }: { label: string; checked: boolean; onChange: (v: boolean) => void; children?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-slate-200/70 bg-white/40 px-3 py-2.5 dark:border-white/10 dark:bg-white/5">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span>
        {children && <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{children}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        className={`${toggleInput} mt-0.5 shrink-0`}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

/** Which weekdays: seven buttons, each pressed or not. */
export function DaysPicker({
  label,
  value,
  onChange,
  error,
  quiet = false,
  ariaLabel,
}: {
  label: string;
  value: readonly Weekday[];
  onChange: (v: Weekday[]) => void;
  error?: string;
  quiet?: boolean;
  /** The group's name for a screen reader, where the visible label repeats from row to row. */
  ariaLabel?: string;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col">
      <span id={id} className={fieldLabel}>
        {label}
      </span>
      <div role="group" aria-labelledby={ariaLabel ? undefined : id} aria-label={ariaLabel} className="flex flex-wrap gap-1">
        {WEEKDAYS.map((d) => {
          const on = value.includes(d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== d) : WEEKDAYS.filter((x) => x === d || value.includes(x)))}
              className={`min-w-[3rem] rounded-lg border px-2 py-1 text-xs font-medium transition ${
                on
                  ? `${gradientSurface} border-transparent`
                  : 'border-slate-200 bg-white/60 text-slate-600 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-slate-300'
              }`}
            >
              {WEEKDAY_LABELS[d]}
            </button>
          );
        })}
      </div>
      {!quiet && <ErrorText id={`${id}-error`} error={error} />}
    </div>
  );
}

/** The messages of a row's fields, in one line under the row (narrow fields would wrap them word by word). */
export function RowErrors({ errors }: { errors: ReadonlyArray<string | undefined> }) {
  const list = [...new Set(errors.filter((e): e is string => Boolean(e)))];
  return list.length ? <p className={`${ERROR} mt-1.5`}>{list.join(' · ')}</p> : null;
}

/** A heading inside a card, with an optional "?" for what the part is for. */
export function PartHeading({ children, tip, action }: { children: ReactNode; tip?: string; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {children}
        {tip && <SectionHelp tip={tip} />}
      </h4>
      {action}
    </div>
  );
}
