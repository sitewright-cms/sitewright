import { useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { SCHEMA_ORG_TYPES, type SchemaOrgType } from './schema-org-types';
import { glassCard, glassInput, ghostButton, gradientSurface, gradientHover } from '../../theme';

/** Sentinel businessType that suppresses JSON-LD (see packages/blocks/src/head.ts). */
export const BUSINESS_TYPE_DISABLED = 'disabled';

interface BusinessTypeModalProps {
  /** Current businessType: '' = default (Organization), 'disabled', or a schema.org @type. */
  value: string;
  onSelect: (type: string) => void;
  onClose: () => void;
}

/**
 * Picker for the company's schema.org `@type` (the `businessType` that drives JSON-LD). A searchable,
 * grouped list of common types, plus "Default (Organization)" and "Disabled (no structured data)".
 * The current value is highlighted with the primary gradient. Because the field accepts any string
 * (≤80), an unlisted type can still be entered via the "Use custom @type" fallback.
 */
export function BusinessTypeModal({ value, onSelect, onClose }: BusinessTypeModalProps) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      q
        ? SCHEMA_ORG_TYPES.filter((t) => t.label.toLowerCase().includes(q) || t.type.toLowerCase().includes(q))
        : SCHEMA_ORG_TYPES,
    [q],
  );

  // Preserve declaration order while bucketing into groups.
  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, SchemaOrgType[]>();
    for (const t of filtered) {
      let bucket = byGroup.get(t.group);
      if (!bucket) {
        bucket = [];
        byGroup.set(t.group, bucket);
        order.push(t.group);
      }
      bucket.push(t);
    }
    return order.map((g) => [g, byGroup.get(g)!] as const);
  }, [filtered]);

  const pick = (type: string) => {
    onSelect(type);
    onClose();
  };

  // The Default + Disabled specials show unless a search excludes them. The custom-@type fallback
  // appears only when the search matched NOTHING pickable (no preset and neither special) — so a
  // typed type like "Spaceport" can still be used, without doubling up on the special rows.
  const showDefault = !q || 'default organization'.includes(q);
  const showDisabled = !q || 'disabled no structured data'.includes(q);
  const showCustom = q !== '' && filtered.length === 0 && !showDefault && !showDisabled;

  const itemClass = (selected: boolean) =>
    `group block w-full rounded-xl px-3 py-2 text-left transition ${selected ? gradientSurface : `${glassCard} ${gradientHover}`}`;
  const subClass = (selected: boolean) =>
    `font-mono text-[11px] ${selected ? 'text-white/70' : 'text-slate-400 group-hover:text-white/70'}`;

  return (
    <Modal title="Business type" size="2xl" onClose={onClose}>
      <div className="flex flex-col gap-3 p-5">
        <p className="text-xs text-slate-500">
          The schema.org <code className="rounded bg-slate-100 px-1 py-0.5">@type</code> used in your
          site’s structured data (JSON-LD). Pick one, or disable structured data entirely.
        </p>
        <input
          aria-label="Search business types"
          className={glassInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search types…"
          autoFocus
        />

        <div className="flex max-h-[55vh] flex-col gap-3 overflow-auto">
          {/* Default + Disabled specials (hidden when a search excludes them). "Default" means the
              field is UNSET (value === ''); an explicit `Organization` highlights its list item. */}
          {showDefault && (
            <button className={itemClass(value === '')} onClick={() => pick('')}>
              <span className="font-medium">Default</span>{' '}
              <span className={subClass(value === '')}>Organization</span>
            </button>
          )}
          {showDisabled && (
            <button className={itemClass(value === BUSINESS_TYPE_DISABLED)} onClick={() => pick(BUSINESS_TYPE_DISABLED)}>
              <span className="font-medium">Disabled</span>{' '}
              <span className={subClass(value === BUSINESS_TYPE_DISABLED)}>no structured data</span>
            </button>
          )}

          {groups.map(([group, items]) => (
            <div key={group}>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">{group}</p>
              <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((t) => {
                  const selected = value === t.type;
                  return (
                    <li key={t.type}>
                      <button className={itemClass(selected)} onClick={() => pick(t.type)}>
                        <span className="font-medium">{t.label}</span>{' '}
                        <span className={subClass(selected)}>{t.type}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          {/* Custom @type fallback — the field accepts any string, so an unlisted type can be used. */}
          {showCustom && (
            <button className={`${ghostButton} justify-start`} onClick={() => pick(query.trim())}>
              Use “{query.trim()}” as a custom @type
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
