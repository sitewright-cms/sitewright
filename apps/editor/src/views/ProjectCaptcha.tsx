import { useEffect, useState, type FormEvent } from 'react';
import { api, type Project, type CaptchaInput } from '../api';
import { CAPTCHA_PROVIDERS, DEFAULT_RECAPTCHA_MIN_SCORE, isValidSiteKey, needsConsent, type CaptchaProvider } from '@sitewright/schema';
import { glassCard, glassInput, primaryButton, ghostButton, toggleInput } from '../theme';
import { secretFieldProps } from '../lib/secret-field';

const LABEL: Record<CaptchaProvider, string> = {
  hcaptcha: 'hCaptcha',
  'recaptcha-v2': 'Google reCAPTCHA v2 (checkbox)',
  'recaptcha-v3': 'Google reCAPTCHA v3 (invisible, scored)',
};

/**
 * Per-project captcha configuration — the provider and its credentials, used by every form on this
 * site that opts in. Replaced the instance-wide hCaptcha settings: a site key is bound to a domain
 * allowlist in the provider's dashboard, and a domain belongs to a SITE, not to the agency that
 * built it. The secret is write-only (the API returns a presence flag only). Owner/admin.
 */
export function ProjectCaptcha({ project }: { project: Project }) {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<CaptchaProvider>('hcaptcha');
  const [siteKey, setSiteKey] = useState('');
  const [secret, setSecret] = useState('');
  const [hasSecret, setHasSecret] = useState(false);
  const [minScore, setMinScore] = useState(DEFAULT_RECAPTCHA_MIN_SCORE);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { captcha } = await api.getProjectCaptcha(project.id);
        if (!active) return;
        if (captcha) {
          setEnabled(true);
          setProvider(captcha.provider);
          setSiteKey(captcha.siteKey);
          setHasSecret(captcha.hasSecret);
          if (captcha.minScore !== undefined) setMinScore(captcha.minScore);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'failed to load the captcha config');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [project.id]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setResult(null); // what was tested is no longer what is stored
    try {
      if (!enabled) {
        await api.deleteProjectCaptcha(project.id);
        setHasSecret(false);
        setSaved(true);
        return;
      }
      const body: CaptchaInput = {
        provider,
        siteKey: siteKey.trim(),
        ...(secret ? { secret } : {}),
        ...(provider === 'recaptcha-v3' ? { minScore } : {}),
      };
      const { captcha } = await api.putProjectCaptcha(project.id, body);
      setHasSecret(captcha.hasSecret);
      setSecret('');
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save the captcha config');
    }
  }

  async function test() {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.testProjectCaptcha(project.id));
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : 'the test could not be run' });
    } finally {
      setTesting(false);
    }
  }

  if (loading) return null;

  const field = `${glassInput} px-2 py-1`;
  // Live, not just on submit: the whole point of checking the SHAPE is to catch a placeholder while
  // the person who can fix it is still looking at the field.
  const keyLooksWrong = enabled && siteKey.trim().length > 0 && !isValidSiteKey(provider, siteKey);
  // Switching provider invalidates the stored secret — keys are not portable between vendors, or
  // between reCAPTCHA v2 and v3. Say so before the save rather than after a visitor is rejected.
  const secretNeeded = enabled && !hasSecret && !secret;

  return (
    <details className={`mb-4 ${glassCard} p-3`} open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-sm font-bold text-slate-700 dark:text-slate-200">
        Captcha{' '}
        <span className="font-normal text-slate-500 dark:text-slate-400">
          {enabled ? `— ${LABEL[provider]}` : '— not configured'}
        </span>
      </summary>

      <form className="mt-3 flex flex-col gap-3" onSubmit={save}>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className={toggleInput} aria-label="Configure a captcha for this project" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Use a captcha on this site’s forms
        </label>

        {enabled && (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span>Provider</span>
              <select className={field} aria-label="Captcha provider" value={provider} onChange={(e) => setProvider(e.target.value as CaptchaProvider)}>
                {CAPTCHA_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {LABEL[p]}
                  </option>
                ))}
              </select>
            </label>

            {/*
              Said plainly, where the choice is made. Both Google options send visitor data to Google,
              which in the EU generally needs prior consent — so the widget has to sit behind the
              Consent Manager, and a visitor who declines cannot submit the form at all. Proof of work
              (per form, in the form’s own settings) involves no third party and needs no consent.
            */}
            {needsConsent(provider) && (
              <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                reCAPTCHA sends visitor data to Google. In the EU that generally requires prior consent, so gate it with the
                Consent Manager — visitors who decline will not be able to submit. For a no-third-party option, turn on
                proof of work in a form’s own settings instead.
              </p>
            )}

            <label className="flex flex-col gap-1 text-sm">
              <span>Site key (public — it ships in the published page)</span>
              <input className={field} aria-label="Captcha site key" value={siteKey} onChange={(e) => setSiteKey(e.target.value)} required />
              {keyLooksWrong && (
                <span className="text-xs text-red-600 dark:text-red-400">
                  That does not look like a {LABEL[provider]} site key. Check it in the provider’s dashboard.
                </span>
              )}
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span>Secret key {hasSecret && <em className="text-slate-500 dark:text-slate-400">— stored; leave blank to keep it</em>}</span>
              <input className={field} aria-label="Captcha secret key" value={secret} onChange={(e) => setSecret(e.target.value)} {...secretFieldProps} />
              {secretNeeded && (
                <span className="text-xs text-amber-700 dark:text-amber-300">
                  Without a secret the platform cannot verify a solve, so forms requiring a captcha will reject every submission.
                </span>
              )}
            </label>

            {provider === 'recaptcha-v3' && (
              <label className="flex flex-col gap-1 text-sm">
                <span>Pass mark (0–1) — v3 scores every visitor instead of challenging them</span>
                <input
                  className={field}
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  aria-label="reCAPTCHA v3 minimum score"
                  value={minScore}
                  onChange={(e) => setMinScore(Number(e.target.value))}
                />
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Higher is stricter. 0.5 is Google’s suggested starting point; raise it only while watching the filtered count,
                  since every point of strictness also turns away real people.
                </span>
              </label>
            )}
          </>
        )}

        <div className="flex items-center gap-2">
          <button type="submit" className={primaryButton}>
            Save
          </button>
          {enabled && hasSecret && (
            <button type="button" className={ghostButton} onClick={() => void test()} disabled={testing}>
              {testing ? 'Testing…' : 'Test credentials'}
            </button>
          )}
          {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved.</span>}
          {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
        </div>

        {result && (
          <p className={`text-xs ${result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {result.ok ? 'The provider accepted the secret key.' : (result.error ?? 'The provider rejected the credentials.')}
          </p>
        )}
      </form>
    </details>
  );
}
