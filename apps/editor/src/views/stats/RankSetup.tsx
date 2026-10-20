import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Plus, Save } from 'lucide-react';
import {
  COUNTRY_CODES,
  RANK_DEPTHS,
  RANK_LANGUAGES,
  type RankDevice,
  type RankLocationOption,
  type RankProjectSettings,
  type RankSchedule,
} from '@sitewright/schema';
import { api } from '../../api';
import { fieldLabel, glassInput, gradientHover, gradientSurface, primaryButton, toggleInput } from '../../theme';
import { countryName } from './format';

/**
 * The agency's side of rank tracking: a project's setup, and adding keywords. Shown to staff only; the server
 * enforces it whatever the editor shows.
 */

const COUNTRIES = [...COUNTRY_CODES].map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name));

/** `Windhoek,Khomas Region,Namibia` → `Windhoek, Khomas Region, Namibia`. */
export const placeLabel = (name: string): string => name.split(',').join(', ');

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

/** Picks a place from the provider's list for one country. */
function LocationPicker({
  country,
  value,
  onChange,
}: {
  country: string;
  value: RankLocationOption | null;
  onChange: (l: RankLocationOption | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<RankLocationOption[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const listId = useId();

  // A new country starts at the country itself: the most common choice, and always valid.
  useEffect(() => {
    if (!country) return;
    const mine = ++seq.current;
    onChange(null);
    void api
      .searchRankLocations(country, '')
      .then((res) => {
        if (mine !== seq.current) return;
        setError(null);
        onChange(res.locations.find((l) => l.type === 'Country') ?? null);
      })
      .catch((err: unknown) => {
        if (mine === seq.current) setError(err instanceof Error ? err.message : 'Could not load the places');
      });
    // Re-run per country only: `onChange` is the parent's state setter.
  }, [country]);

  useEffect(() => {
    if (!country || !open) return;
    const mine = ++seq.current;
    const t = setTimeout(() => {
      void api
        .searchRankLocations(country, query)
        .then((res) => {
          if (mine === seq.current) setOptions(res.locations);
        })
        .catch((err: unknown) => {
          if (mine === seq.current) setError(err instanceof Error ? err.message : 'Could not search the places');
        });
    }, 250);
    return () => clearTimeout(t);
  }, [country, query, open]);

  return (
    <div className="relative flex flex-col">
      <span className={fieldLabel}>Searched from</span>
      <input
        className={glassInput}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label="Searched from"
        placeholder={value ? placeLabel(value.name) : country ? 'Type a city or region' : 'Choose a country first'}
        disabled={!country}
        value={query}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setQuery(e.target.value)}
      />
      {value && !open && (
        <span className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {placeLabel(value.name)} · {value.type}
        </span>
      )}
      {error && <span className="mt-1 text-xs text-rose-700 dark:text-rose-300">{error}</span>}
      {open && options.length > 0 && (
        <ul id={listId} role="listbox" className="absolute top-full z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-white/10 dark:bg-slate-900">
          {options.map((o) => (
            <li key={o.name} role="option" aria-selected={value?.name === o.name}>
              <button
                type="button"
                className="flex w-full items-baseline justify-between gap-3 rounded-lg px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/10"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(o);
                  setQuery('');
                  setOpen(false);
                }}
              >
                <span className="min-w-0 truncate">{placeLabel(o.name)}</span>
                <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{o.type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
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
        <label className="flex flex-col">
          <span className={fieldLabel}>Country</span>
          <select className={glassInput} value={country} onChange={(e) => setCountry(e.target.value)} required>
            <option value="">Choose…</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <LocationPicker country={country} value={location} onChange={setLocation} />
        <label className="flex flex-col">
          <span className={fieldLabel}>Language</span>
          <select className={glassInput} value={languageCode} onChange={(e) => setLanguageCode(e.target.value)}>
            {RANK_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
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
