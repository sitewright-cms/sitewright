import { useId, useState, type KeyboardEvent } from 'react';
import { securityLinkIssue } from '@sitewright/schema';
import type { SecurityContactMode } from '../model';
import { Field } from '../ui';
import { SearchableSelect, type SelectOption } from '../../ui/SearchableSelect';
import { fieldLabel, gradientSurface } from '../../../theme';

const CUSTOM = '__custom_url__';

/** A page the security.txt pickers can point at. */
export interface PageChoice {
  id: string;
  /** Shown in the list: the page's path. */
  label: string;
  /** Also matched by the search box: the page's title. */
  keywords: string;
}

/**
 * A security.txt link that is EITHER a page of this site (published as its absolute URL) OR a URL typed
 * by hand. One searchable list holds the pages plus "Custom URL…"; picking that reveals the URL field.
 * The two halves stay in the form so switching back and forth loses nothing; only the chosen one is saved.
 */
export function PageOrUrlField({
  label,
  hint,
  pages,
  pageId,
  url,
  onChange,
  urlPlaceholder,
  pagesState,
}: {
  label: string;
  hint: string;
  pages: readonly PageChoice[];
  /** Whether `pages` is the real list yet — a stored page is only "missing" once the list has loaded. */
  pagesState: 'loading' | 'ready' | 'error';
  pageId: string;
  url: string;
  onChange: (next: { pageId: string; url: string }) => void;
  urlPlaceholder: string;
}) {
  // "Custom" is a choice in its own right, so it must survive an empty URL field while it is being typed.
  const [custom, setCustom] = useState(() => !pageId && url.trim() !== '');
  const known = pages.some((p) => p.id === pageId);
  const options: SelectOption[] = [
    { value: '', label: '— none —' },
    // A stored page the list does not hold. Only once the list has LOADED is that a deleted page — before
    // then (or when it failed) it is simply not known yet, and saying "deleted" would invite a needless fix.
    ...(pageId && !known
      ? [{ value: pageId, label: pagesState === 'ready' ? 'A page that no longer exists' : pagesState === 'loading' ? 'Loading pages…' : 'A page (the list could not load)' }]
      : []),
    ...pages.map((p) => ({ value: p.id, label: p.label, keywords: p.keywords })),
    { value: CUSTOM, label: 'Custom URL…' },
  ];
  const value = pageId || (custom ? CUSTOM : '');
  const urlError = custom && url.trim() ? securityLinkIssue(url.trim()) : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col">
        <span className={fieldLabel}>{label}</span>
        <SearchableSelect
          ariaLabel={label}
          value={value}
          options={options}
          placeholder="— none —"
          searchPlaceholder="Search pages…"
          onChange={(v) => {
            if (v === CUSTOM) {
              setCustom(true);
              onChange({ pageId: '', url });
            } else {
              setCustom(false);
              onChange({ pageId: v, url: v ? url : '' });
            }
          }}
        />
        <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">{hint}</span>
      </div>
      {custom && (
        <Field label={`${label} URL`} value={url} onChange={(v) => onChange({ pageId: '', url: v })} type="url" placeholder={urlPlaceholder} error={urlError} hint="https only — RFC 9116 requires it." />
      )}
    </div>
  );
}

/**
 * A three-way choice for a security.txt phone or email: Disabled | the Corporate Identity value | Custom.
 * The middle option SHOWS the company value, so it is clear what would be published; with none set it is
 * unavailable and says where to set it. Custom reveals an input validated by the schema's own rule.
 */
export function ContactModeField({
  label,
  ciValue,
  ciMissing,
  mode,
  value,
  onChange,
  validate,
  placeholder,
  hint,
  type = 'text',
}: {
  label: string;
  /** The Corporate Identity value this would publish. */
  ciValue: string;
  /** What to say when Corporate Identity has none. */
  ciMissing: string;
  mode: SecurityContactMode;
  value: string;
  onChange: (mode: SecurityContactMode, value: string) => void;
  validate: (v: string) => string | null;
  placeholder: string;
  hint: string;
  type?: string;
}) {
  const ci = ciValue.trim();
  const labelId = useId();
  const choices: Array<{ mode: SecurityContactMode; text: string; disabled?: boolean }> = [
    { mode: 'off', text: 'Disabled' },
    { mode: 'ci', text: ci || ciMissing, disabled: !ci && mode !== 'ci' },
    { mode: 'custom', text: 'Custom' },
  ];
  const error = mode === 'custom' && value.trim() ? validate(value.trim()) : null;
  const enabled = choices.filter((c) => !c.disabled);
  // The ARIA radio-group keyboard model: arrows move AND select, skipping an unavailable choice; only the
  // checked radio is in the tab order.
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const at = Math.max(0, enabled.findIndex((c) => c.mode === mode));
    const next = enabled[(at + step + enabled.length) % enabled.length]!;
    onChange(next.mode, value);
    // currentTarget is gone once the handler returns — hold the group, then focus after the re-render.
    const group = e.currentTarget;
    requestAnimationFrame(() => group.querySelector<HTMLElement>(`[data-mode="${next.mode}"]`)?.focus());
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col">
        <span className={fieldLabel} id={labelId}>
          {label}
        </span>
        <div
          role="radiogroup"
          aria-labelledby={labelId}
          onKeyDown={onKey}
          // As wide as its three choices, not the row: the middle one (the company value) truncates when long.
          className="flex w-fit max-w-full gap-0.5 rounded-xl border border-white/60 bg-white/50 p-0.5 text-sm shadow-sm dark:border-white/10 dark:bg-white/5"
        >
          {choices.map((c) => (
            <button
              key={c.mode}
              type="button"
              role="radio"
              data-mode={c.mode}
              aria-checked={mode === c.mode}
              tabIndex={mode === c.mode ? 0 : -1}
              disabled={c.disabled}
              title={c.mode === 'ci' ? (ci ? `From Corporate Identity: ${ci}` : ciMissing) : undefined}
              onClick={() => onChange(c.mode, value)}
              className={`waves-effect truncate rounded-lg py-1.5 pl-3 pr-3.5 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${c.mode === 'ci' ? 'min-w-0' : 'shrink-0'} ${
                mode === c.mode ? `${gradientSurface} font-semibold` : 'text-slate-600 hover:bg-white/80 dark:text-slate-300 dark:hover:bg-white/10'
              }`}
            >
              {c.text}
            </button>
          ))}
        </div>
        <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">{hint}</span>
      </div>
      {mode === 'custom' && (
        <Field label={`${label} for security.txt`} value={value} onChange={(v) => onChange('custom', v)} type={type} placeholder={placeholder} error={error} />
      )}
    </div>
  );
}
