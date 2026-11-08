import { glassCard, toggleInput } from '../../theme';
import { SectionHelp } from '../ui/SectionHelp';

const code = 'rounded bg-slate-100 dark:bg-white/10 px-1 py-0.5';

/**
 * System Settings → whether locally hosted sites at the PLATFORM's own addresses (`<slug>.<sites domain>`,
 * `/sites/<slug>/`) ask search engines not to index them. A site on its own verified custom domain is never
 * affected. Controlled — the parent loads and saves it with the rest of the settings form.
 */
export function SitesNoindexField({ checked, onChange }: { checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <fieldset className={`${glassCard} p-4`}>
      <legend className="flex items-center gap-1.5 px-1 text-sm font-bold">
        Hosted sites in search results
        <SectionHelp tip="For sites this platform hosts at its own addresses — a staging copy, or a site whose real home is deployed elsewhere. Search engines drop those pages as they visit them again, which can take a few weeks. Each project's Local Hosting target says when its address is hidden." />
      </legend>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className={toggleInput}
          aria-label="Keep sites at platform addresses out of search results"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>
          <span className="font-medium">Keep sites at platform addresses out of search results</span>
          <span className="block text-xs text-slate-500 dark:text-slate-400">
            Everything served at <code className={code}>&lt;slug&gt;.your-domain</code> or{' '}
            <code className={code}>/sites/…</code> is sent with <code className={code}>X-Robots-Tag: noindex</code>. A site served at
            its own verified custom domain (its primary) stays in search results. A site with no custom domain drops out of search
            entirely, so give it one first if it should be found.
          </span>
        </span>
      </label>
    </fieldset>
  );
}
