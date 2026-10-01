import { useEffect, useState } from 'react';
import { ChevronDown, Play } from 'lucide-react';
import { primaryButton } from '../../theme';
import type { SvgAnimExample } from './svg-anim-examples';

/**
 * The Studio's shelf of finished example animations.
 *
 * ★ WHY "View" AND NOT "Copy". The shelf this replaces printed four directive snippets as code. A
 * snippet can only show one attribute on one shape — but what an author is trying to work out is how
 * a dozen elements share one timeline, and no amount of `<pre>` conveys that. Handing the example to
 * the Studio instead makes the whole composition inspectable: every element in the tree, its effect,
 * its delay, and the cascade playing on the canvas. The markup is still one click away in the
 * Studio's own code view, so nothing is hidden — it is just no longer the only thing offered.
 *
 * The examples are a DYNAMIC import: they are several KB of inline SVG, and `SvgAnimStudio` is
 * statically imported by the Library panel, so a static import here would put the artwork in the
 * main bundle for every session that never opens the Studio.
 */
export function AnimationExampleShelf({ onView }: { onView: (svg: string) => void }) {
  const [open, setOpen] = useState(true);
  const [examples, setExamples] = useState<SvgAnimExample[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || examples || failed) return;
    let live = true;
    void import('./svg-anim-examples')
      .then((m) => {
        if (live) setExamples(m.SVG_ANIM_EXAMPLES);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [open, examples, failed]);

  return (
    <section className="rounded-xl border border-slate-200/70 dark:border-slate-700">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="waves-effect flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left"
      >
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Animation Examples
          {examples && <span className="font-normal text-slate-500 dark:text-slate-400"> ({examples.length})</span>}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-slate-200/70 p-3 dark:border-slate-700">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Complete marks and scenes, each on one staggered timeline. Open one to step through its elements, retime
            the cascade, and export or save it as your own.
          </p>
          {failed && (
            <p className="text-xs text-rose-500 dark:text-rose-300">Couldn’t load the examples. Close and reopen the studio to retry.</p>
          )}
          {!examples && !failed && (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="skeleton h-[4.5rem] w-full rounded-lg" />
              ))}
            </div>
          )}
          {examples?.map((ex) => (
            <div
              key={ex.id}
              className="flex items-center gap-3 rounded-lg border border-slate-200/70 bg-white/50 p-2.5 dark:border-slate-700 dark:bg-slate-900/40"
            >
              {/* A STATIC thumbnail: the editor does not run the SVG runtime, so this paints the
                  animation's finished state — which is exactly the "what will I get" question. */}
              <span
                aria-hidden
                className="grid h-14 w-14 shrink-0 place-items-center rounded-md bg-white p-1 dark:bg-slate-800 [&>svg]:h-full [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: ex.svg }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{ex.name}</p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{ex.description}</p>
                <ul className="mt-1 flex flex-wrap gap-1">
                  {ex.uses.map((u) => (
                    <li
                      key={u}
                      className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                    >
                      {u}
                    </li>
                  ))}
                </ul>
              </div>
              <button
                type="button"
                onClick={() => onView(ex.svg)}
                aria-label={`View ${ex.name} in the studio`}
                className={`${primaryButton} shrink-0 gap-1.5 px-3 py-1.5 text-xs`}
              >
                <Play className="h-3.5 w-3.5" /> View
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
