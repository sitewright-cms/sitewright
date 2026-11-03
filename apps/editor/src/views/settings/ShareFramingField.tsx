import { useState } from 'react';
import { FrameAncestorOriginSchema, MAX_SHARE_EMBEDDING_ORIGINS as MAX_ORIGINS } from '@sitewright/schema';
import { glassCard, glassInput, ghostButton } from '../../theme';
import { SectionHelp } from '../ui/SectionHelp';

/**
 * System Settings → which other sites may show a preview SHARE link in a frame.
 *
 * Its own list, not the admin-panel embedding one: an origin allowed to show a client their draft must
 * not be able to frame the admin panel. Controlled — the parent loads and saves it with the rest of the
 * settings form.
 */
export function ShareFramingField({ origins, onChange }: { origins: string[]; onChange: (origins: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  function add() {
    const value = draft.trim();
    if (!value) return;
    const parsed = FrameAncestorOriginSchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'not a valid origin');
      return;
    }
    if (!origins.includes(parsed.data) && origins.length >= MAX_ORIGINS) {
      setError(`At most ${MAX_ORIGINS} sites — remove one first.`);
      return;
    }
    onChange(origins.includes(parsed.data) ? origins : [...origins, parsed.data]);
    setDraft('');
    setError(null);
  }

  return (
    <fieldset className={`${glassCard} p-4`}>
      <legend className="flex items-center gap-1.5 px-1 text-sm font-bold">
        Preview share links in a frame
        <SectionHelp tip="By default a preview share link can only be framed by this platform itself. Add the sites that may show share links inside their own pages, for example a page where a client reviews their draft. Only pages opened through a valid share link are affected: the admin panel, the logged-in preview, expired or withdrawn links and published sites keep their own policy." />
      </legend>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        Each entry is an origin —{' '}
        <code className="rounded bg-slate-100 dark:bg-white/10 px-1 py-0.5">https://review.example.com</code> — optionally with a{' '}
        <code className="rounded bg-slate-100 dark:bg-white/10 px-1 py-0.5">*.</code> wildcard for subdomains. No paths. A site listed here
        can show any share link it is given, so list only sites you run or trust.
      </p>
      <div className="flex flex-col gap-3">
        <div>
          <span className="mb-1 block text-sm font-medium">Sites that may show preview share links in a frame</span>
          {origins.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">None — share links open only on their own, or inside this platform.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {origins.map((o) => (
                <li
                  key={o}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white/80 px-2.5 py-1.5 text-sm dark:border-white/10 dark:bg-white/5"
                >
                  <code className="truncate">{o}</code>
                  <button
                    type="button"
                    className={`${ghostButton} px-2 py-0.5 text-xs`}
                    aria-label={`Remove ${o} from the share-link sites`}
                    onClick={() => onChange(origins.filter((x) => x !== o))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <input
            className={`${glassInput} min-w-[16rem] flex-1`}
            aria-label="Site that may show share links"
            placeholder="https://review.example.com"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              // Enter adds the site rather than submitting the whole settings form.
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <button type="button" className={ghostButton} onClick={add} disabled={!draft.trim()}>
            Add site
          </button>
        </div>
        {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      </div>
    </fieldset>
  );
}
