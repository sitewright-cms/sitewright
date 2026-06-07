import type { NamedSlotForm } from './model';
import { newNamedSlot } from './model';
import type { SelfHostedFont } from '../../api';
import { FontSlotEditor } from './FontSlotEditor';
import { ghostButton } from '../../theme';

const RESERVED = new Set(['heading', 'body', 'sans', 'serif', 'mono']);
/** Lowercase + CSS-ident-safe slug for a `font-<name>` utility (starts with a letter). A transient
 *  trailing hyphen is allowed WHILE TYPING (so "boom-box" is reachable); it's stripped on persist. */
const toSlug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^[^a-z]+/, '');

/**
 * Manages the project's CUSTOM named font slots. Each becomes a `font-<name>` utility (+ a
 * `--sw-font-<name>` var) usable on any element — e.g. a slot named "boombox" → `class="font-boombox"`.
 * A slot's font can be a system family, a Google webfont, or an uploaded file (same editor as the
 * built-in heading/body slots).
 */
export function CustomFontSlots({
  slots,
  onChange,
  projectId,
  fonts,
  onAddFont,
}: {
  slots: NamedSlotForm[];
  onChange: (slots: NamedSlotForm[]) => void;
  projectId: string;
  fonts: SelfHostedFont[];
  onAddFont: (font: SelfHostedFont) => void;
}) {
  const update = (id: string, patch: Partial<NamedSlotForm>) =>
    onChange(slots.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  return (
    <div className="flex flex-col gap-3">
      {slots.map((row) => {
        const reserved = RESERVED.has(row.name);
        return (
          <div key={row.id} className="rounded-xl border border-white/60 bg-white/40 p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">font-</span>
              <input
                aria-label="Custom font name"
                className="w-40 rounded-lg border border-white/60 bg-white/70 px-2 py-1 text-sm outline-none focus:border-indigo-400"
                placeholder="boombox"
                value={row.name}
                onChange={(e) => update(row.id, { name: toSlug(e.target.value) })}
              />
              {row.name && !reserved && (
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">.font-{row.name}</code>
              )}
              {reserved && <span className="text-[11px] text-rose-500">“{row.name}” is reserved</span>}
              <button
                type="button"
                aria-label={`Remove ${row.name || 'custom'} font slot`}
                className="ml-auto rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                onClick={() => onChange(slots.filter((s) => s.id !== row.id))}
              >
                Remove
              </button>
            </div>
            <FontSlotEditor
              label={`${row.name || 'custom'} font`}
              slot={row.slot}
              onChange={(slot) => update(row.id, { slot })}
              projectId={projectId}
              fonts={fonts}
              onAddFont={onAddFont}
            />
          </div>
        );
      })}
      <button
        type="button"
        className={`${ghostButton} self-start px-3 py-1.5 text-xs`}
        onClick={() => onChange([...slots, newNamedSlot()])}
      >
        + Add custom font
      </button>
    </div>
  );
}
