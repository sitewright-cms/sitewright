import { useEffect, useMemo, useState } from 'react';
import { textureCss, textureUrl } from '@sitewright/blocks';
import { MANDATORY_COLOR_TOKENS, COLOR_TOKEN_LABELS, DEFAULT_BRAND_COLORS } from '@sitewright/schema';
import { Modal } from '../ui/Modal';
import { SearchField } from '../ui/SearchField';
import { useToast } from '../ui/Toast';
import { useCopy } from '../ui/useCopy';
import { ghostButton } from '../../theme';
import { useScrollPaging } from '../../lib/useScrollPaging';
import { BrandColorField } from '../ui/ColorPicker';

// A background-colour choice: `preview` is the swatch/thumbnail colour shown in the editor (the CI
// tokens aren't defined on the editor document, so we preview with their default palette value); `css`
// is what the COPIED snippet emits — a `var(--sw-color-*)` token for CI colours (so it re-tints with
// the brand + theme on the real site) or a literal colour otherwise.
interface BgChoice {
  label: string;
  preview: string;
  css: string;
}
const BG_CHOICES: BgChoice[] = [
  ...MANDATORY_COLOR_TOKENS.map((t) => ({ label: COLOR_TOKEN_LABELS[t], preview: DEFAULT_BRAND_COLORS[t], css: `var(--sw-color-${t})` })),
  { label: 'Neutral grey', preview: '#808080', css: '#808080' },
];

/**
 * The Texture library — a transparenttextures.com-style picker over the ~396 transparent, tileable PNG
 * overlays served at `/authoring/textures/<name>.png` (fetched, never bundled). Pick a background colour
 * (a CI token or custom) and click a texture; the ready-to-paste CSS (`background-color` + tileable
 * `background-image`) copies to the clipboard. Drop it on any element's `style`, a page `<style>`, or
 * website.criticalCss — the colour shows through the transparent texture, and the url resolves in the
 * previews AND exported sites (the publish build rewrites it to a relative `_assets/` path).
 */
export function TexturePicker({ onClose }: { onClose: () => void; projectId?: string }) {
  const toast = useToast();
  const [copiedId, copy] = useCopy(() => toast.show('CSS copied — paste it onto an element'));
  const [names, setNames] = useState<string[]>([]);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [bg, setBg] = useState<BgChoice>(BG_CHOICES[BG_CHOICES.length - 1] as BgChoice); // default: neutral grey
  const [custom, setCustom] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch('/authoring/textures');
        if (!r.ok) throw new Error();
        const d = (await r.json()) as { names: string[] };
        if (alive) setNames(d.names);
      } catch {
        if (alive) setError(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => (q ? names.filter((n) => n.includes(q) || n.replace(/-/g, ' ').includes(q)) : names), [names, q]);
  const { visible, reset, onScroll, ref: scrollRef } = useScrollPaging(filtered.length);
  const shown = filtered.slice(0, visible);

  const previewColor = custom ?? bg.preview;
  const cssColor = custom ?? bg.css;
  const snippet = selected ? textureCss(selected, cssColor) : '';

  return (
    <Modal title="Textures" size="screen" onClose={onClose}>
      <div className="flex h-full min-h-0 flex-col gap-3 p-4">
        {/* controls: search + background colour */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-[200px] flex-1">
            <SearchField
              ariaLabel="Search textures"
              placeholder={`Search ${names.length || ''} textures — paper, fabric, noise…`}
              value={query}
              onChange={(v) => {
                setQuery(v);
                reset();
              }}
              autoFocus
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Background</span>
            {BG_CHOICES.map((c) => (
              <button
                key={c.label}
                type="button"
                title={`${c.label} — ${c.css}`}
                aria-pressed={!custom && bg.label === c.label}
                onClick={() => {
                  setCustom(null);
                  setBg(c);
                }}
                className={`h-6 w-6 rounded-md border transition ${!custom && bg.label === c.label ? 'ring-2 ring-indigo-400' : 'border-slate-300 dark:border-slate-600'}`}
                style={{ background: c.preview }}
              />
            ))}
            {/* The platform picker, not the browser's — and it offers the project's brand colours
                first, which is what a texture tint usually wants. */}
            <BrandColorField
              value={custom ?? '#cfe0ff'}
              onChange={(c) => setCustom(c)}
              label="Custom colour"
            />
          </div>
        </div>

        {/* thumbnail grid (paged so we never mount all ~396 at once) */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 p-3 dark:border-slate-700"
        >
          {error ? (
            <p className="py-8 text-center text-sm text-rose-500">Could not load the texture library.</p>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">No textures match “{query}”.</p>
          ) : (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(148px,1fr))]">
              {shown.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setSelected(name)}
                  aria-pressed={selected === name}
                  title={name}
                  className={`overflow-hidden rounded-lg border text-left transition ${
                    selected === name ? 'border-indigo-500 ring-2 ring-indigo-400/60' : 'border-slate-200 hover:border-indigo-300 dark:border-slate-700'
                  }`}
                >
                  <span
                    className="block h-24"
                    style={{ backgroundColor: previewColor, backgroundImage: `url("${textureUrl(name)}")`, backgroundRepeat: 'repeat' }}
                  />
                  <span className="block truncate border-t border-slate-100 px-2 py-1 text-[11px] text-slate-600 dark:border-slate-700 dark:text-slate-300">
                    {name.replace(/-/g, ' ')}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* selected CSS + copy */}
        <div className="flex shrink-0 items-stretch gap-2">
          <pre className="max-h-24 flex-1 overflow-auto rounded-lg border border-slate-200 bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100 dark:border-slate-700">
            <code>{snippet || '/* click a texture to get its CSS */'}</code>
          </pre>
          <button
            disabled={!selected}
            onClick={() => selected && copy(snippet, 'tex')}
            className={`${ghostButton} shrink-0 self-start px-4 py-2 text-sm font-semibold disabled:opacity-50`}
          >
            {copiedId === 'tex' ? 'Copied!' : 'Copy CSS'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
