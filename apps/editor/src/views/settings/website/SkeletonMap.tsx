import { useState } from 'react';
import { GLOBAL_SNIPPET_PARTIALS } from '@sitewright/core';
import { SLOT_MAX } from '@sitewright/schema';
import type { SettingsForm } from '../model';
import { CodeEditorModal } from '../../ui/CodeEditorModal';
import type { ChromeSlotKey } from '../../SlotEditor';
import { criticalCssUsage, lineCount, partSource, type SkeletonPart } from '../board/summaries';
import { SectionHelp } from '../../ui/SectionHelp';

/** Shared bindings hint for the validated skeleton-slot editors. */
const SLOT_HINT =
  'HTML + Tailwind/DaisyUI (no JS). The skeleton wraps this slot in its own landmark (main-nav/footer/…), so do NOT use <nav>/<main>/<footer>/<aside> here — use <div>. Bindings: {{ company.* }}, {{#each nav.header}}…{{/each}}, {{ website.json_data.* }}, {{ website.data.* }}.';

interface PartConfig {
  part: SkeletonPart;
  /** What the map calls it (the field's own name). */
  name: string;
  /** The code editor's title. */
  title: string;
  /** The old field label — kept as the part's accessible name ("Edit …"), so nothing that found the
   *  field by name loses it in the move onto the map. */
  label: string;
  language: 'html' | 'css';
  hint?: string;
  placeholder: string;
  starter?: { label: string; code: string };
  /** Opens in the FULL editor (live preview, devices, click-to-code — in code mode) rather than the code
   *  editor. The chrome a visitor SEES: the nav, the two sidebars and the footer. */
  fullEditor?: boolean;
}

/** What the Scripts editor tells its author, because the answer is not guessable from the field. */
const SCRIPTS_HINT =
  'Raw HTML, inserted exactly as written at the end of <body> — after the bottom slot, before the platform’s own scripts. Nothing is wrapped for you: put JavaScript inside <script>…</script> tags, e.g. <script async src="https://…"></script>.';

const PARTS: readonly PartConfig[] = [
  { part: 'criticalCss', name: 'criticalCss', title: 'Critical CSS', label: 'Project-wide CSS inlined in <head> (after brand tokens)', language: 'css', placeholder: '.hero { ... }' },
  { part: 'head', name: 'headHtml', title: 'Head HTML', label: 'Raw HTML injected into <head> (analytics, meta)', language: 'html', placeholder: '<meta ... />' },
  {
    part: 'mainNav',
    name: 'mainNav',
    title: 'Main Navigation',
    label: 'mainNav — desktop bar + mobile drawer, on every page',
    language: 'html',
    hint: SLOT_HINT,
    placeholder: '<div class="navbar">{{ company.name }}</div>',
    starter: { label: 'Insert the default navigation', code: GLOBAL_SNIPPET_PARTIALS['nav-header'] ?? '' },
    fullEditor: true,
  },
  { part: 'sidebarLeft', name: 'sidebarLeft', title: 'sidebarLeft partial', label: 'sidebarLeft — after the page body (position via classes)', language: 'html', hint: SLOT_HINT, placeholder: '<div class="menu">…</div>', fullEditor: true },
  { part: 'sidebarRight', name: 'sidebarRight', title: 'sidebarRight partial', label: 'sidebarRight — after the page body (position via classes)', language: 'html', hint: SLOT_HINT, placeholder: '<div class="menu">…</div>', fullEditor: true },
  {
    part: 'footer',
    name: 'footer',
    title: 'footer partial',
    label: 'footer — below body + sidebars',
    language: 'html',
    hint: SLOT_HINT,
    placeholder: '<div class="footer">© {{ company.name }}</div>',
    starter: { label: 'Insert the default footer', code: GLOBAL_SNIPPET_PARTIALS['nav-footer'] ?? '' },
    fullEditor: true,
  },
  { part: 'bottom', name: 'bottom', title: 'bottom partial', label: 'bottom — after the footer (global modals, schema.org microdata)', language: 'html', hint: SLOT_HINT, placeholder: '<div class="modal">…</div>' },
  { part: 'scripts', name: 'scripts', title: 'Scripts', label: 'Raw HTML injected after the page body (3rd-party scripts/widgets)', language: 'html', hint: SCRIPTS_HINT, placeholder: '<script ... ></script>' },
];
const cfg = (part: SkeletonPart): PartConfig => PARTS.find((p) => p.part === part) as PartConfig;

const HEAD_TIP =
  'Critical CSS is inlined in <head> after the brand tokens (up to 256 KB); Head HTML is raw HTML for analytics and meta tags. Both open in the code editor.';
const BODY_TIP =
  'Parts sit in render order. The nav, sidebars and footer open in the full editor with a live preview; bottom and Scripts open in the code editor.';

/** A region label of the map (`<head>`, `<body>`) with its "?". */
function Region({ tag, tip }: { tag: string; tip: string }) {
  return (
    <span className="flex items-center gap-1.5 px-0.5 font-mono text-xs text-slate-500 dark:text-slate-400">
      &lt;{tag}&gt;
      <SectionHelp tip={tip} />
    </span>
  );
}

const kb = (chars: number): string => (chars < 1024 ? `${chars} B` : `${(chars / 1024).toFixed(1)} KB`);

/**
 * The DOCUMENT MAP: every slot that wraps a page, laid out where it renders — `<head>` (Critical CSS,
 * Head HTML), then the body's main nav, the two sidebars around the page content, footer, bottom and,
 * last, Scripts (they render after `bottom`). Each part shows whether it is empty and how much it holds,
 * and opens its own editor: the visible chrome (nav, sidebars, footer) the FULL editor in code mode, the
 * rest the code editor. Both save in the same gesture (`saveNow`) exactly as the old fields did.
 */
export function SkeletonMap({
  form,
  saveNow,
  onOpenFullEditor,
}: {
  form: SettingsForm;
  saveNow: (p: Partial<SettingsForm>) => void | Promise<void>;
  /** Opens a chrome slot in the full editor (live preview + devices). Absent (no project to preview
   *  through) falls back to the code editor for every part. */
  onOpenFullEditor?: (slot: ChromeSlotKey) => void;
}) {
  const [editing, setEditing] = useState<SkeletonPart | null>(null);
  const css = criticalCssUsage(form);

  const part = (p: SkeletonPart, opts: { tall?: boolean } = {}) => {
    const c = cfg(p);
    const src = partSource(form, p);
    const lines = lineCount(src);
    const status = lines === 0 ? 'empty' : p === 'criticalCss' ? kb(css.chars) : `${lines} line${lines === 1 ? '' : 's'}`;
    const filled = lines > 0;
    const full = c.fullEditor === true && onOpenFullEditor !== undefined;
    return (
      <button
        key={p}
        type="button"
        aria-label={`Edit ${c.label}`}
        title={`${c.label} — opens in the ${full ? 'full editor' : 'code editor'}`}
        onClick={() => (full ? onOpenFullEditor(p as ChromeSlotKey) : setEditing(p))}
        className={`waves-effect flex min-w-0 items-center gap-2 rounded-lg border px-2.5 text-left transition hover:border-indigo-500 ${
          opts.tall ? 'h-24 flex-col items-start justify-center gap-0.5' : 'h-12'
        } ${
          filled
            ? 'border-indigo-300/80 bg-indigo-50/80 dark:border-indigo-400/40 dark:bg-indigo-500/10'
            : 'border-dashed border-slate-300 bg-white/60 dark:border-slate-600 dark:bg-white/5'
        }`}
      >
        <span className={`min-w-0 truncate pr-1 font-mono text-xs font-semibold ${filled ? 'text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}>{c.name}</span>
        <span className={`shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400 ${opts.tall ? '' : 'ml-auto'}`}>{status}</span>
      </button>
    );
  };

  /** A part with its one-click starter beside it (same row, so inserting one never changes the height). */
  const withStarter = (p: SkeletonPart) => {
    const c = cfg(p);
    const empty = lineCount(partSource(form, p)) === 0;
    return (
      <span className="flex min-w-0 gap-2">
        <span className="min-w-0 flex-1 [&>button]:w-full">{part(p)}</span>
        {c.starter && empty && (
          <button
            type="button"
            onClick={() => void saveNow({ [p]: c.starter!.code } as Partial<SettingsForm>)}
            className="h-12 shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300 dark:hover:bg-indigo-500/15"
          >
            + {c.starter.label}
          </button>
        )}
      </span>
    );
  };

  const open = editing ? cfg(editing) : null;
  return (
    <>
      <span className="flex flex-col gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 p-2.5 dark:border-slate-700/70 dark:bg-white/5">
        <Region tag="head" tip={HEAD_TIP} />
        <span className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            aria-label={`Edit ${cfg('criticalCss').label}`}
            title={`${kb(css.chars)} of the ${kb(SLOT_MAX)} limit`}
            onClick={() => setEditing('criticalCss')}
            className={`waves-effect flex h-18 min-w-0 flex-col justify-center gap-1.5 rounded-lg border px-2.5 text-left transition hover:border-indigo-500 ${
              css.chars > 0
                ? 'border-indigo-300/80 bg-indigo-50/80 dark:border-indigo-400/40 dark:bg-indigo-500/10'
                : 'border-dashed border-slate-300 bg-white/60 dark:border-slate-600 dark:bg-white/5'
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate pr-1 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">criticalCss</span>
              <span className="ml-auto shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                {css.chars ? `${kb(css.chars)} of ${kb(SLOT_MAX)}` : 'empty'}
              </span>
            </span>
            <span className="h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden>
              <span
                className={`block h-full rounded-full ${css.fraction > 0.75 ? 'bg-amber-500' : 'sw-brand-gradient'}`}
                style={{ width: `${Math.max(css.chars ? 2 : 0, css.fraction * 100)}%` }}
              />
            </span>
          </button>
          <span className="[&>button]:h-18 [&>button]:w-full">{part('head')}</span>
        </span>
        <Region tag="body" tip={BODY_TIP} />
        {withStarter('mainNav')}
        <span className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)_minmax(0,6rem)] gap-2 sm:grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_minmax(0,8.5rem)]">
          {part('sidebarLeft', { tall: true })}
          <span className="grid h-24 place-items-center rounded-lg border border-dashed border-slate-300 font-mono text-xs text-slate-400 dark:border-slate-600 dark:text-slate-500">page content</span>
          {part('sidebarRight', { tall: true })}
        </span>
        {withStarter('footer')}
        {part('bottom')}
        {part('scripts')}
      </span>
      {open && (
        <CodeEditorModal
          title={open.title}
          value={partSource(form, open.part)}
          hint={open.hint}
          language={open.language}
          onSave={(v) => saveNow({ [open.part]: v } as Partial<SettingsForm>)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
