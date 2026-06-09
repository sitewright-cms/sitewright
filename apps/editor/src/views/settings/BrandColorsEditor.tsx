import { COLOR_TOKEN_LABELS, MANDATORY_COLOR_TOKENS } from '@sitewright/schema';
import { glassInput } from '../../theme';
import { SubLabel } from './ui';
import { TokenEditor } from './TokenEditor';
import { ColorField } from './ColorPicker';
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
      <div className="flex flex-col gap-2">
        {MANDATORY_COLOR_TOKENS.map((key) => {
          const value = valueOf(key);
          return (
            <div key={key} className="flex items-center gap-2">
              <ColorField value={value} onChange={(v) => setMandatory(key, v)} label={labelFor(key)} />
              <span className="w-36 shrink-0 text-sm text-slate-600">{labelFor(key)}</span>
              <input
                aria-label={labelFor(key)}
                className={glassInput}
                value={value}
                maxLength={64}
                placeholder="#0ea5e9"
                onChange={(e) => setMandatory(key, e.target.value)}
              />
            </div>
          );
        })}
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
