import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { glassCard, glassInput, fieldLabel, accentChip } from '../../theme';
import { cardVariants, cardHover } from './motion';
import { SectionHelp } from '../ui/SectionHelp';

/** A frosted-glass card with a gradient accent chip + title; lifts on hover. An optional `tooltip`
 *  adds a "?" help affordance next to the title (the section's description, shown on hover/focus). */
export function GlassCard({ title, icon, tooltip, children, wide = false }: { title: string; icon: ReactNode; tooltip?: string; children: ReactNode; wide?: boolean }) {
  return (
    <motion.section variants={cardVariants} whileHover={cardHover} className={`${glassCard} p-5 ${wide ? 'sm:col-span-2' : ''}`}>
      <header className="mb-4 flex items-center gap-3">
        <span className={accentChip} aria-hidden>
          {icon}
        </span>
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
        {tooltip && <SectionHelp tip={tooltip} />}
      </header>
      {children}
    </motion.section>
  );
}

/** A labeled single-line input. */
export function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className={fieldLabel}>{label}</span>
      <input
        className={glassInput}
        aria-label={label}
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/** A labeled multi-line textarea (monospace for code-ish fields). */
export function TextArea({
  label,
  value,
  onChange,
  rows = 4,
  mono = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  mono?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className={fieldLabel}>{label}</span>
      <textarea
        className={`${glassInput} ${mono ? 'font-mono text-xs' : ''}`}
        aria-label={label}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/** A labeled control styled like {@link Field} but that OPENS a picker instead of free text — the
 *  current selection is shown with a chevron affordance. */
export function FieldButton({ label, value, onClick }: { label: string; value: ReactNode; onClick: () => void }) {
  return (
    <div className="block">
      <span className={fieldLabel}>{label}</span>
      <button type="button" aria-label={label} onClick={onClick} className={`${glassInput} flex items-center justify-between text-left`}>
        <span className="truncate">{value}</span>
        <svg aria-hidden viewBox="0 0 24 24" className="ml-2 h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </div>
  );
}

/** A small section sub-heading inside a card; an optional `tip` adds a "?" help affordance. */
export function SubLabel({ children, tip }: { children: ReactNode; tip?: string }) {
  return (
    <p className="mb-2 mt-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
      {children}
      {tip && <SectionHelp tip={tip} />}
    </p>
  );
}
