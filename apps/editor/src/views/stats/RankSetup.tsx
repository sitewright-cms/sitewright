import { useState, type FormEvent } from 'react';
import { Plus, Save } from 'lucide-react';
import { RANK_DEPTHS, type RankDevice, type RankLocationOption, type RankProjectSettings, type RankSchedule } from '@sitewright/schema';
import { api } from '../../api';
import { fieldLabel, glassInput, gradientHover, gradientSurface, primaryButton, toggleInput } from '../../theme';
import { SearchableSelect } from '../ui/SearchableSelect';
import { PlacePicker } from './PlacePicker';
import { COUNTRY_OPTIONS, LANGUAGE_OPTIONS } from './rank-options';

/**
 * The agency's side of rank tracking: a project's setup, and adding keywords. Shown to staff only; the server
 * enforces it whatever the editor shows.
 */

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: ReadonlyArray<{ id: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-white/10">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          className={`rounded-lg px-2.5 py-1 text-sm font-medium transition ${value === o.id ? gradientSurface : `text-slate-600 dark:text-slate-300 ${gradientHover}`}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const SCHEDULES: ReadonlyArray<{ id: RankSchedule; label: string }> = [
  { id: 'weekly', label: 'Weekly' },
  { id: 'daily', label: 'Daily' },
];
const DEVICES: ReadonlyArray<{ id: RankDevice; label: string }> = [
  { id: 'desktop', label: 'Desktop' },
  { id: 'mobile', label: 'Mobile' },
];

/** The project's setup: which site, how often, how deep. */
export function RankSettingsForm({
  projectId,
  current,
  suggestedDomain,
  onSaved,
}: {
  projectId: string;
  current: RankProjectSettings | null;
  suggestedDomain?: string;
  onSaved: () => void;
}) {
  const [domain, setDomain] = useState(current?.domain ?? suggestedDomain ?? '');
  const [includeSubdomains, setIncludeSubdomains] = useState(current?.includeSubdomains ?? true);
  const [schedule, setSchedule] = useState<RankSchedule>(current?.schedule ?? 'weekly');
  const [depth, setDepth] = useState<number>(current?.depth ?? 100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.putRankSettings(projectId, { domain, includeSubdomains, schedule, depth });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the setup');
    } finally {
      setBusy(false);
    }
  }

  const changed = current?.domain && domain.trim() && current.domain !== domain.trim().toLowerCase().replace(/^www\./, '');
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" aria-label="Rank tracking setup">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col">
          <span className={fieldLabel}>Domain the site is published at</span>
          <input className={glassInput} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" required />
        </label>
        <label className="flex flex-col">
          <span className={fieldLabel}>Results read per check</span>
          <select className={glassInput} value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
            {RANK_DEPTHS.map((d) => (
              <option key={d} value={d}>
                Top {d}
                {d === 100 ? ' (most thorough)' : d === 10 ? ' (first page only, cheapest)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <span className="flex items-center gap-2">
          <span className="text-sm text-slate-600 dark:text-slate-300">Checked</span>
          <Segmented label="How often keywords are checked" value={schedule} options={SCHEDULES} onChange={setSchedule} />
        </span>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" className={toggleInput} checked={includeSubdomains} onChange={(e) => setIncludeSubdomains(e.target.checked)} />
          Count subdomains (shop.{domain || 'example.com'}) as the site
        </label>
      </div>
      {changed && (
        <p role="note" className="text-sm text-amber-700 dark:text-amber-300">
          A new domain is another site: its rankings start a new history.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">
          {error}
        </p>
      )}
      <div>
        <button type="submit" className={primaryButton} disabled={busy || !domain.trim()}>
          <Save className="h-4 w-4" aria-hidden /> Save setup
        </button>
      </div>
    </form>
  );
}

/** Adds keywords to the project, all searched from one place, in one language, on one device. */
export function AddKeywordsForm({ projectId, defaultCountry, onAdded }: { projectId: string; defaultCountry?: string; onAdded: (message: string) => void }) {
  const [text, setText] = useState('');
  const [country, setCountry] = useState(defaultCountry ?? '');
  const [location, setLocation] = useState<RankLocationOption | null>(null);
  const [languageCode, setLanguageCode] = useState('en');
  const [device, setDevice] = useState<RankDevice>('desktop');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keywords = text
    .split('\n')
    .map((k) => k.trim())
    .filter(Boolean);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!location) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.addRankKeywords(projectId, { keywords, location: { name: location.name, countryCode: location.countryCode }, languageCode, device });
      setText('');
      onAdded(
        res.existing > 0
          ? `Added ${res.added} keyword${res.added === 1 ? '' : 's'}; ${res.existing} ${res.existing === 1 ? 'was' : 'were'} already tracked.`
          : `Added ${res.added} keyword${res.added === 1 ? '' : 's'}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the keywords');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" aria-label="Add keywords">
      <label className="flex flex-col">
        <span className={fieldLabel}>Keywords, one per line</span>
        <textarea className={`${glassInput} min-h-24`} value={text} onChange={(e) => setText(e.target.value)} placeholder={'plumber windhoek\nemergency plumber'} />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        {/* Searchable: 250 countries and two dozen languages are too many to scroll, and a native select only
            jumps by the first letter. The place is required through the place: no country, no place, no submit. */}
        <div className="flex min-w-0 flex-col">
          <span className={fieldLabel}>Country</span>
          <SearchableSelect ariaLabel="Country" value={country} onChange={setCountry} options={COUNTRY_OPTIONS} placeholder="Choose…" searchPlaceholder="Country or code, e.g. DE" />
        </div>
        <PlacePicker country={country} value={location} onChange={setLocation} />
        <div className="flex min-w-0 flex-col">
          <span className={fieldLabel}>Language</span>
          <SearchableSelect ariaLabel="Language" value={languageCode} onChange={setLanguageCode} options={LANGUAGE_OPTIONS} searchPlaceholder="Language or code, e.g. de" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Device" value={device} options={DEVICES} onChange={setDevice} />
        <button type="submit" className={primaryButton} disabled={busy || keywords.length === 0 || !location}>
          <Plus className="h-4 w-4" aria-hidden /> {keywords.length > 1 ? `Add ${keywords.length} keywords` : 'Add keyword'}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">
          {error}
        </p>
      )}
    </form>
  );
}
