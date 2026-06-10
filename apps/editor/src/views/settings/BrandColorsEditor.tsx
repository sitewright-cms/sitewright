import { COLOR_TOKEN_LABELS, MANDATORY_COLOR_TOKENS } from '@sitewright/schema';
import { SubLabel } from './ui';
import { TokenEditor } from './TokenEditor';
import { ColorCard } from './ColorPicker';
import { newPair, type KeyedPair } from './model';

const MANDATORY = new Set<string>(MANDATORY_COLOR_TOKENS);
const labelFor = (key: string): string => Object.entries(COLOR_TOKEN_LABELS).find(([k]) => k === key)?.[1] ?? key;

/**
 * Brand colors editor. The MANDATORY tokens (primary/secondary/accent/neutral + Background/Text)
 * render as fixed, labeled rows with NO delete button — they cannot be removed (clearing a value
 * resets it to the platform default on save). Any other colors are free-form custom tokens.
 */
export function BrandColorsEditor({ rows, onChange }: { rows: KeyedPair[]; onChange: (rows: KeyedPair[]) => void }) {
  const valueOf = (key: string): string => rows.find((r) => r.key === key)?.value ?? '';
  const custom = rows.filter((r) => !MANDATORY.has(r.key));

  const setMandatory = (key: string, value: string) => {
    const exists = rows.some((r) => r.key === key);
    onChange(exists ? rows.map((r) => (r.key === key ? { ...r, value } : r)) : [...rows, { ...newPair(), key, value }]);
  };
  // Replace only the custom portion; mandatory rows are preserved (and stay first). A custom row
  // whose key collides with a mandatory token is dropped here, so it can't shadow (and silently
  // override) the labeled row above it.
  const setCustom = (next: KeyedPair[]) =>
    onChange([...rows.filter((r) => MANDATORY.has(r.key)), ...next.filter((r) => !MANDATORY.has(r.key.trim()))]);

  return (
    <div className="flex flex-col gap-4">
      {/* The mandatory tokens render as a row of centered cards: title, a full-width clickable
          preview that opens the color picker, and the current value. The picker is the ONLY way to
          set a color — there is no typed input. */}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {MANDATORY_COLOR_TOKENS.map((key) => (
          <ColorCard key={key} title={labelFor(key)} value={valueOf(key)} onChange={(v) => setMandatory(key, v)} />
        ))}
      </div>
      <div>
        <SubLabel>Custom colors</SubLabel>
        <p className="mb-2 text-xs text-slate-500">
          Extra named colors, usable as <code className="rounded bg-slate-100 px-1 py-0.5">bg-&lt;name&gt;</code> /{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5">text-&lt;name&gt;</code> utilities.
        </p>
        <TokenEditor rows={custom} onChange={setCustom} keyPlaceholder="brand-teal" valuePlaceholder="#0d9488" swatch picker addLabel="+ Add color" />
      </div>
    </div>
  );
}
