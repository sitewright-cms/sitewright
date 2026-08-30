import { AlertCircle, Clock, RotateCw } from 'lucide-react';
import { ApiError } from '../../api';
import { ghostButton } from '../../theme';

/**
 * How a failed heavy operation is reported to the author.
 *
 * The instance sheds work it cannot afford — a Lighthouse audit, a screenshot, an image encode — and
 * answers 503. That is not a fault: the feature works and the instance is momentarily full. Rendering
 * it in the same red "it failed" alert as a real error taught authors that the button is broken, and
 * hid the one piece of information that would have helped: come back in a moment.
 *
 * Three cases, deliberately distinct:
 *  · CAPACITY, transient  — busy; say so calmly, give the interval, offer Retry.
 *  · CAPACITY, sustained  — the ledger has been refusing long enough that retrying is futile. Saying
 *                           "try again shortly" here would be a lie, so it says the instance is under
 *                           sustained pressure instead.
 *  · anything else        — a real failure, in the usual alert. A 503 from a genuinely unavailable
 *                           feature (no headless browser) lands HERE, not above — which is why the
 *                           server sends `code: 'capacity'` and status alone is not enough.
 */
export function CapacityNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const api = error instanceof ApiError ? error : null;
  const message = error instanceof Error ? error.message : 'Something went wrong.';

  if (api?.isCapacity) {
    const sustained = api.transient === false;
    const after = api.retryAfterSeconds;
    return (
      <div
        role="status"
        className="flex flex-col gap-2 rounded-xl border border-amber-300/70 bg-amber-50/70 p-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200"
      >
        <p className="flex items-start gap-1.5">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {sustained ? (
              <>
                <strong>Not enough memory right now.</strong> This instance has been short of memory for a
                while, so trying again immediately will not help. It frees up as other work finishes.
              </>
            ) : (
              <>
                <strong>Busy — not enough memory for this right now.</strong> Nothing is broken; the
                instance is running other work.{' '}
                {after ? <>Try again in about {after} second{after === 1 ? '' : 's'}.</> : <>Try again in a moment.</>}
              </>
            )}
          </span>
        </p>
        {onRetry && !sustained && (
          <div>
            <button type="button" onClick={onRetry} className={`${ghostButton} px-3 py-1 text-xs`}>
              <RotateCw className="mr-1 inline h-3.5 w-3.5" />
              Try again
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <p className="flex items-center gap-1.5 text-sm text-rose-500">
      <AlertCircle className="h-4 w-4 shrink-0" /> {message}
    </p>
  );
}
