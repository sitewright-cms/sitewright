import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { glassCard, glassInput, fieldLabel, accentChip } from './glass';
import { cardVariants, cardHover } from './motion';

/** A frosted-glass card with a gradient accent chip + title; lifts on hover. */
export function GlassCard({ title, icon, children, wide = false }: { title: string; icon: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <motion.section variants={cardVariants} whileHover={cardHover} className={`${glassCard} p-5 ${wide ? 'sm:col-span-2' : ''}`}>
      <header className="mb-4 flex items-center gap-3">
        <span className={accentChip} aria-hidden>
          {icon}
        </span>
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
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

/** A small section sub-heading inside a card. */
export function SubLabel({ children }: { children: ReactNode }) {
  return <p className="mb-2 mt-1 text-xs font-medium uppercase tracking-wide text-slate-400">{children}</p>;
}
