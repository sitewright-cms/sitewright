/** A build phase reported by the draft-preview builder (`BuildProgress` in the API's build.ts). */
export type PreviewPhase = 'preparing' | 'media' | 'pages' | 'styles' | 'scripts' | 'finalizing';

/** Plain-language label per phase — what the build is doing, in the words an author would use. */
const LABELS: Record<PreviewPhase, string> = {
  preparing: 'Preparing the preview…',
  media: 'Processing images…',
  pages: 'Rendering pages…',
  styles: 'Compiling styles…',
  scripts: 'Bundling scripts…',
  finalizing: 'Finishing up…',
};

const isPhase = (v: string | undefined): v is PreviewPhase => v !== undefined && v in LABELS;

/**
 * What the preview is waiting on, as one line of text.
 *
 * A cold project renders every page, re-encodes every referenced image size and compiles a stylesheet
 * before the iframe can show anything, and that is easily tens of seconds. The two phases that are a
 * countable loop say so — "Rendering pages… 12 of 93", "Processing images… 7 of 30" — because those
 * are also the two long ones; the rest name the step and lean on the spinner to show that something
 * is in fact happening.
 */
export function previewProgressLabel(phase: string | undefined, done?: number, total?: number): string {
  if (!isPhase(phase)) return 'Building the preview…'; // incl. the isolated worker, which reports no phase
  if ((phase === 'pages' || phase === 'media') && typeof total === 'number' && total > 0) {
    // `done` counts items FINISHED, so add one to name the one actually being worked on — and clamp,
    // so the last never reads "94 of 93". The media phase reports a total only for the image
    // re-encode; copying non-image assets is one indivisible step and stays uncounted.
    return `${LABELS[phase]} ${Math.min(total, (done ?? 0) + 1)} of ${total}`;
  }
  return LABELS[phase];
}

/**
 * The loading pill: top-centre of the preview surface, a spinning ring plus the current build step.
 * Sits above the skeleton, and is announced politely so a screen reader hears the wait explained
 * rather than just "loading".
 */
export function PreviewProgressPill({
  phase,
  done,
  total,
}: {
  phase?: string;
  done?: number;
  total?: number;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-5 z-40 flex justify-center">
      <div
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-3.5 py-1.5 text-[13px] font-medium text-slate-700 shadow-lg backdrop-blur dark:border-white/15 dark:bg-slate-800/95 dark:text-slate-100"
      >
        <span
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600 dark:border-white/25 dark:border-t-white"
        />
        {previewProgressLabel(phase, done, total)}
      </div>
    </div>
  );
}
