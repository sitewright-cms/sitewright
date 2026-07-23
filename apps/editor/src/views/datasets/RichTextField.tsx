import { useEffect, useRef, useState, type ComponentType, type CSSProperties } from 'react';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Superscript,
  Subscript,
  Palette,
  Highlighter,
  Type,
  AArrowUp,
  Heading2,
  Heading3,
  Pilcrow,
  Quote,
  List,
  ListOrdered,
  IndentIncrease,
  IndentDecrease,
  AlignLeft,
  Link as LinkIcon,
  Table as TableIcon,
  Minus,
  Eraser,
  Code2,
} from 'lucide-react';
import {
  RICH_TOOLBAR,
  RICH_COLORS,
  RICH_HIGHLIGHTS,
  RICH_SIZES,
  RICH_ALIGNS,
  RICH_COLOR_CLASSES,
  RICH_HIGHLIGHT_CLASSES,
  RICH_SIZE_CLASSES,
  RICH_ALIGN_CLASSES,
  type RichCmd,
  type RichSwatch,
  type CiSwatch,
} from '@sitewright/blocks';
import { useCiPalette } from '../../lib/ci-palette';
import {
  runExec,
  applyInlineClass,
  applyBlockClass,
  stepBlockIndent,
  applyLink,
  insertStarterTable,
} from '../../lib/rich-dom';

/** Lucide icon per toolbar command id — the on-page bridge maps the SAME ids to inline SVG paths. */
const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  bold: Bold,
  italic: Italic,
  underline: Underline,
  strike: Strikethrough,
  superscript: Superscript,
  subscript: Subscript,
  color: Palette,
  highlight: Highlighter,
  font: Type,
  size: AArrowUp,
  h2: Heading2,
  h3: Heading3,
  paragraph: Pilcrow,
  quote: Quote,
  bulletList: List,
  orderedList: ListOrdered,
  outdent: IndentDecrease,
  indent: IndentIncrease,
  align: AlignLeft,
  link: LinkIcon,
  table: TableIcon,
  rule: Minus,
  clear: Eraser,
  source: Code2,
};

const btnClass =
  'inline-flex h-7 w-7 items-center justify-center rounded text-slate-500 dark:text-slate-400 transition hover:bg-indigo-50 dark:hover:bg-indigo-500/10 hover:text-indigo-700 dark:hover:text-indigo-400';

/** Which command's popover is open (color/highlight/font/size/align/link), or null. */
type OpenMenu = null | { id: string; kind: RichCmd['kind'] };

/**
 * A compact WYSIWYG editor for a dataset `richtext` field — a `contentEditable` surface driven by the shared
 * toolbar vocabulary (@sitewright/blocks `RICH_TOOLBAR`): text marks, colours + highlight + text size (from a
 * standard palette AND the project's CI brand colours), CI fonts, headings, lists, alignment, indentation,
 * links, tables, a divider, clear-formatting, and a raw HTML-source toggle. Visual formatting is emitted as
 * EXISTING Tailwind utility classes (colour/size/highlight/align/indent) and marks/blocks as semantic HTML —
 * never inline styles. The value is sanitized server-side at render by `{{sw-rich}}` (the same boundary as
 * `data-sw-html`), so this surface only has to produce clean markup, not enforce safety. The on-page
 * `data-sw-html` toolbar (preview-bridge.ts) mirrors this exact command set.
 */
export function RichTextField({
  value,
  onChange,
  id,
  ariaLabel,
}: {
  value: string;
  onChange: (html: string) => void;
  id?: string;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // Latest value, read by the fill effect WITHOUT being a reactive dep (see below).
  const valueRef = useRef(value);
  valueRef.current = value;
  const [source, setSource] = useState(false);
  const [menu, setMenu] = useState<OpenMenu>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const ci = useCiPalette();

  // Dismiss an open popover (colour/highlight/font/size/align/link) on a mousedown outside the toolbar — the
  // popovers are children of the toolbar container, so a click on a swatch/menu item stays open (its own
  // handler applies + closes). Mirrors the on-page bridge toolbar's outside-click dismissal.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [menu]);

  // Fill the editable on mount and whenever we (re)enter WYSIWYG mode (source → false). We do NOT reactively
  // re-set innerHTML when `value` changes: `value` only ever changes via this editor's own onChange (its
  // keystroke echo), and re-setting innerHTML mid-edit would reset the caret. Reading the latest value
  // through a ref keeps the dependency on `source` alone.
  useEffect(() => {
    const el = ref.current;
    if (el && !source) el.innerHTML = valueRef.current ?? '';
  }, [source]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    onChange(el.innerHTML === '<br>' ? '' : el.innerHTML); // normalize a freshly-cleared editable
  };

  // Group class-sets for the toggle math: the STANDARD palette classes ∪ the project's CI classes, so a
  // re-colour/re-font replaces whichever kind is currently applied.
  const colorGroup = new Set<string>([...RICH_COLOR_CLASSES, ...ci.colors.map((c) => c.cls)]);
  const fontGroup = new Set<string>(ci.fonts.map((f) => f.cls));

  const run = (cmd: RichCmd) => {
    const el = ref.current;
    if (!el) return;
    switch (cmd.kind) {
      case 'exec':
        if (cmd.cmd) runExec(el, cmd.cmd, cmd.arg);
        break;
      case 'indent':
        stepBlockIndent(el, cmd.cmd === '-1' ? -1 : 1);
        break;
      case 'source':
        setMenu(null);
        setSource((v) => !v);
        return; // no content mutation
      case 'table':
        insertStarterTable(el);
        break;
      case 'color':
      case 'highlight':
      case 'size':
      case 'align':
      case 'font':
        setMenu((m) => (m?.id === cmd.id ? null : { id: cmd.id, kind: cmd.kind }));
        return; // popover applies the class
      case 'link':
        el.focus();
        setLinkUrl('');
        setMenu((m) => (m?.id === cmd.id ? null : { id: cmd.id, kind: cmd.kind }));
        return;
    }
    setMenu(null);
    emit();
  };

  // Apply a chosen swatch/class then emit + close the popover.
  const applySwatch = (kind: RichCmd['kind'], cls: string) => {
    const el = ref.current;
    if (!el) return;
    if (kind === 'color') applyInlineClass(el, colorGroup, cls);
    else if (kind === 'highlight') applyInlineClass(el, RICH_HIGHLIGHT_CLASSES, cls);
    else if (kind === 'size') applyInlineClass(el, RICH_SIZE_CLASSES, cls);
    else if (kind === 'font') applyInlineClass(el, fontGroup, cls);
    else if (kind === 'align') applyBlockClass(el, RICH_ALIGN_CLASSES, cls);
    setMenu(null);
    emit();
  };

  const applyLinkUrl = () => {
    const el = ref.current;
    if (!el) return;
    applyLink(el, linkUrl.trim());
    setMenu(null);
    emit();
  };

  const toolbar = (
    <div ref={toolbarRef} className="relative flex flex-wrap items-center gap-0.5 border-b border-slate-200/70 dark:border-slate-700/70 bg-white/60 dark:bg-slate-900/60 px-1.5 py-1">
      {/* The `source` command is rendered as the always-visible ml-auto toggle below (it must stay reachable
          in source mode, when the rest of the toolbar is hidden), so skip it here to avoid a duplicate. */}
      {!source &&
        RICH_TOOLBAR.map((c, i) =>
          c === null ? (
            <span key={`sep${i}`} aria-hidden className="mx-0.5 h-4 w-px bg-slate-200 dark:bg-white/10" />
          ) : c.id === 'source' ? null : (
            <ToolbarButton key={c.id} cmd={c} active={menu?.id === c.id} onClick={() => run(c)} />
          ),
        )}
      <button
        type="button"
        aria-label="Edit HTML source"
        aria-pressed={source}
        title="Edit HTML source"
        className={`${btnClass} ml-auto ${source ? 'bg-indigo-100 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-400' : ''}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setMenu(null);
          setSource((v) => !v);
        }}
      >
        <Code2 className="h-4 w-4" />
      </button>

      {menu?.kind === 'color' && (
        <SwatchPopover
          title="Text color"
          brand={ci.colors}
          standard={RICH_COLORS}
          onPick={(cls) => applySwatch('color', cls)}
          swatchStyle={(_cls, value) => ({ color: value ?? 'inherit' })}
          previewChar="A"
        />
      )}
      {menu?.kind === 'highlight' && (
        <SwatchPopover
          title="Highlight"
          standard={RICH_HIGHLIGHTS}
          onPick={(cls) => applySwatch('highlight', cls)}
          swatchStyle={(_cls, value) => ({ background: value ?? 'transparent' })}
          previewChar="A"
        />
      )}
      {menu?.kind === 'font' && (
        <MenuPopover
          title="Font"
          items={[{ label: 'Default', cls: '' }, ...ci.fonts.map((f) => ({ label: f.label, cls: f.cls }))]}
          onPick={(cls) => applySwatch('font', cls)}
        />
      )}
      {menu?.kind === 'size' && <MenuPopover title="Text size" items={RICH_SIZES} onPick={(cls) => applySwatch('size', cls)} />}
      {menu?.kind === 'align' && <MenuPopover title="Alignment" items={RICH_ALIGNS} onPick={(cls) => applySwatch('align', cls)} />}
      {menu?.kind === 'link' && (
        <div className="absolute left-1.5 top-full z-30 mt-1 flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 shadow-lg">
          <input
            type="text"
            autoFocus
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyLinkUrl();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setMenu(null);
              }
            }}
            placeholder="https://… or /path"
            className="w-56 rounded border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-1 text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-[var(--sw-brand-1)]"
          />
          <button
            type="button"
            className="rounded bg-[var(--sw-brand-1)] px-2 py-1 text-xs font-semibold text-white"
            onMouseDown={(e) => e.preventDefault()}
            onClick={applyLinkUrl}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="overflow-visible rounded-lg border border-white/60 dark:border-white/10 bg-white/70 dark:bg-slate-900/70 shadow-sm focus-within:border-[var(--sw-brand-1)]">
      {toolbar}
      {source ? (
        <textarea
          id={id}
          aria-label={ariaLabel ? `${ariaLabel} (HTML source)` : 'HTML source'}
          className="block min-h-28 w-full resize-y bg-transparent px-3 py-2 font-mono text-xs text-slate-800 dark:text-slate-100 outline-none"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div
          ref={ref}
          id={id}
          role="textbox"
          aria-multiline="true"
          aria-label={ariaLabel}
          data-placeholder="Write…"
          contentEditable
          suppressContentEditableWarning
          spellCheck
          className="sw-rich-edit min-h-24 max-w-none px-3 py-2 text-sm text-slate-800 dark:text-slate-100 outline-none"
          onInput={emit}
          onBlur={emit}
        />
      )}
    </div>
  );
}

function ToolbarButton({ cmd, active, onClick }: { cmd: RichCmd; active: boolean; onClick: () => void }) {
  const Icon = ICONS[cmd.id] ?? Pilcrow;
  return (
    <button
      type="button"
      aria-label={cmd.label}
      title={cmd.label}
      className={`${btnClass} ${active ? 'bg-indigo-100 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-400' : ''}`}
      onMouseDown={(e) => e.preventDefault() /* keep the editable's selection */}
      onClick={onClick}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

/** A colour/highlight popover: an optional Brand (CI) row followed by the standard swatches. */
function SwatchPopover({
  title,
  brand = [],
  standard,
  onPick,
  swatchStyle,
  previewChar,
}: {
  title: string;
  brand?: readonly CiSwatch[];
  standard: readonly RichSwatch[];
  onPick: (cls: string) => void;
  swatchStyle: (cls: string, value?: string) => CSSProperties;
  previewChar: string;
}) {
  return (
    <div className="absolute left-1.5 top-full z-30 mt-1 w-max max-w-[16rem] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 shadow-lg">
      <p className="mb-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">{title}</p>
      {brand.length > 0 && (
        <>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">Brand</p>
          <div className="mb-2 flex flex-wrap gap-1">
            {brand.map((s) => (
              <Swatch key={s.cls} label={s.label} style={swatchStyle(s.cls, s.value)} char={previewChar} onClick={() => onPick(s.cls)} />
            ))}
          </div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">Standard</p>
        </>
      )}
      <div className="flex flex-wrap gap-1">
        {standard.map((s) => (
          <Swatch
            key={s.label}
            label={s.label}
            style={swatchStyle(s.cls, s.value)}
            char={previewChar}
            clear={!s.cls}
            onClick={() => onPick(s.cls)}
          />
        ))}
      </div>
    </div>
  );
}

function Swatch({
  label,
  style,
  char,
  clear,
  onClick,
}: {
  label: string;
  style: CSSProperties;
  char: string;
  clear?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 dark:border-slate-600 text-xs font-bold hover:ring-2 hover:ring-indigo-300"
      style={style}
    >
      {clear ? '⊘' : char}
    </button>
  );
}

/** A simple labelled dropdown menu (font / size / alignment). */
function MenuPopover({
  title,
  items,
  onPick,
}: {
  title: string;
  items: readonly RichSwatch[];
  onPick: (cls: string) => void;
}) {
  return (
    <div className="absolute left-1.5 top-full z-30 mt-1 w-max min-w-[9rem] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1 shadow-lg">
      <p className="px-2 py-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">{title}</p>
      {items.map((s) => (
        <button
          key={s.label}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(s.cls)}
          className="block w-full rounded px-2 py-1 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-500/10"
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

