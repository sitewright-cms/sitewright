import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { RankProviderId, RankProviderView, RankTrackingAdminInput, RankTrackingAdminView } from '@sitewright/schema';
import { api } from '../../api';
import { secretFieldProps } from '../../lib/secret-field';
import { ghostButton, glassCard, glassInput } from '../../theme';
import { SectionHelp } from '../ui/SectionHelp';

/**
 * KEYWORD RANK TRACKING in System Settings (instance admins): which provider runs the searches, its credentials,
 * and the monthly budget. Saved with the rest of the settings — the parent calls {@link RankTrackingSettingsHandle.save}
 * after its own save succeeds. Secret fields are never shown back: a stored one reads "leave blank to keep".
 */

export interface RankTrackingSettingsHandle {
  /** What is wrong with the form, checked BEFORE the parent saves anything; null when it can be saved. */
  validate: () => string | null;
  /** Saves what changed; resolves at once when nothing did. Throws with a message the parent shows. */
  save: () => Promise<void>;
}

/** What a field holds when nothing is stored: a select shows (and the server assumes) its first option. */
const baselineOf = (f: RankProviderView['fields'][number], stored: Record<string, string>): string =>
  stored[f.key] ?? (f.type === 'select' ? (f.options?.[0]?.value ?? '') : '');

const usd = (n: number): string => `$${n.toFixed(n > 0 && n < 1 ? 3 : 2)}`;

export const RankTrackingSettings = forwardRef<RankTrackingSettingsHandle, { onReady?: () => void }>(function RankTrackingSettings({ onReady }, ref) {
  const [view, setView] = useState<RankTrackingAdminView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [active, setActive] = useState<RankProviderId | ''>('');
  const [budget, setBudget] = useState('10');
  /** provider → field → what the admin typed (secrets start empty). */
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  function hydrate(v: RankTrackingAdminView): void {
    setView(v);
    setActive(v.activeProvider ?? '');
    setBudget(String(v.monthlyBudgetUsd));
    setDrafts(Object.fromEntries(v.providers.map((p) => [p.id, Object.fromEntries(p.fields.filter((f) => f.type !== 'secret').map((f) => [f.key, baselineOf(f, p.values)]))])));
  }

  useEffect(() => {
    let live = true;
    api
      .getRankTracking()
      .then((v) => {
        if (live) hydrate(v);
      })
      .catch((err: unknown) => {
        if (live) setLoadError(err instanceof Error ? err.message : 'Could not load rank tracking');
      })
      // The section has its height now (System Settings may be waiting to scroll to it).
      .finally(() => {
        if (live) onReady?.();
      });
    return () => {
      live = false;
    };
    // Read once; `onReady` is a stable callback from the parent.
  }, []);

  const budgetError = (): string | null => {
    const n = Number(budget);
    return budget.trim() === '' || !Number.isFinite(n) || n < 0 ? 'The rank-tracking budget must be a number of dollars, 0 or more.' : null;
  };

  useImperativeHandle(ref, () => ({
    validate: () => (view ? budgetError() : null),
    async save() {
      if (!view) return;
      const invalid = budgetError();
      if (invalid) throw new Error(invalid);
      const input: RankTrackingAdminInput = {};
      const credentials: NonNullable<RankTrackingAdminInput['credentials']> = {};
      for (const p of view.providers) {
        const draft = drafts[p.id] ?? {};
        const fields: Record<string, string> = {};
        let changed = false;
        for (const f of p.fields) {
          const value = (draft[f.key] ?? '').trim();
          if (f.type === 'secret') {
            if (value) {
              fields[f.key] = value;
              changed = true;
            }
          } else if (value !== baselineOf(f, p.values)) {
            fields[f.key] = value;
            changed = true;
          }
        }
        if (changed) credentials[p.id] = fields;
      }
      if (Object.keys(credentials).length > 0) input.credentials = credentials;
      if ((view.activeProvider ?? '') !== active) input.activeProvider = active || null;
      const budgetUsd = Number(budget);
      if (budgetUsd !== view.monthlyBudgetUsd) input.monthlyBudgetUsd = budgetUsd;
      if (Object.keys(input).length === 0) return;
      hydrate(await api.putRankTracking(input));
      setTest(null);
    },
  }));

  async function runTest(provider: RankProviderId): Promise<void> {
    setTesting(true);
    setTest(null);
    try {
      const r = await api.testRankProvider(provider);
      setTest(
        r.ok
          ? { ok: true, text: r.balanceUsd != null ? `Connected · balance ${usd(r.balanceUsd)}` : 'Connected' }
          : { ok: false, text: r.error ?? 'The provider refused' },
      );
    } catch (err) {
      setTest({ ok: false, text: err instanceof Error ? err.message : 'The test failed' });
    } finally {
      setTesting(false);
    }
  }

  const provider = view?.providers.find((p) => p.id === active);
  return (
    <fieldset className={`${glassCard} p-4`}>
      <legend className="flex items-center gap-1.5 px-1 text-sm font-bold">
        Keyword rank tracking
        <SectionHelp tip="Where each project's site ranks in Google for keywords the agency chooses, checked daily or weekly by a paid provider. Agency staff choose each project's keywords; clients only see the results. Credentials are encrypted at rest and never leave the server." />
      </legend>
      {loadError && <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>}
      {view && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
              Provider
              <select className={glassInput} aria-label="Rank tracking provider" value={active} onChange={(e) => setActive(e.target.value as RankProviderId | '')}>
                <option value="">Off: no checks are made</option>
                {view.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
              Monthly budget (USD)
              <input className={glassInput} aria-label="Monthly budget in US dollars" type="number" min={0} step="0.5" value={budget} onChange={(e) => setBudget(e.target.value)} />
              <span className="mt-1">
                {usd(view.spentThisMonthUsd)} spent this month · {view.keywordsTracked} keyword{view.keywordsTracked === 1 ? '' : 's'} in {view.projectsTracked} project
                {view.projectsTracked === 1 ? '' : 's'}
              </span>
            </label>
          </div>

          {provider && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {provider.fields.map((f) => {
                const value = drafts[provider.id]?.[f.key] ?? '';
                const set = (v: string): void => setDrafts((prev) => ({ ...prev, [provider.id]: { ...(prev[provider.id] ?? {}), [f.key]: v } }));
                return (
                  <label key={f.key} className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
                    {f.label}
                    {f.type === 'select' ? (
                      <select className={glassInput} aria-label={f.label} value={value} onChange={(e) => set(e.target.value)}>
                        {f.options?.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className={glassInput}
                        aria-label={f.label}
                        type={f.type === 'secret' ? 'password' : 'text'}
                        {...(f.type === 'secret' ? secretFieldProps : { autoComplete: 'off' })}
                        value={value}
                        placeholder={f.type === 'secret' && provider.secretsSet[f.key] ? '•••••• (leave blank to keep)' : ''}
                        onChange={(e) => set(e.target.value)}
                      />
                    )}
                    {f.help && <span className="mt-1">{f.help}</span>}
                  </label>
                );
              })}
            </div>
          )}

          {provider && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <button type="button" className={`${ghostButton} px-2 py-1 text-xs`} disabled={testing || !provider.configured} onClick={() => void runTest(provider.id)}>
                {testing ? 'Testing…' : 'Test saved credentials'}
              </button>
              {!provider.configured && <span className="text-xs text-slate-500 dark:text-slate-400">Save first, then test.</span>}
              {test && <span className={`text-xs ${test.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{test.ok ? '✓' : '✗'} {test.text}</span>}
              <a href={provider.signupUrl} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs underline">
                {provider.label} account <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </div>
          )}

          {view.lastError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              Last refusal ({new Date(view.lastError.at).toLocaleString()}): {view.lastError.message}
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
});
