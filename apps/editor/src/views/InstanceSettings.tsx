import { useEffect, useState, type FormEvent } from 'react';
import { api, type InstanceSettingsInput, type InstanceSettingsPublic } from '../api';
import { glassCard, glassInput, primaryButton } from '../theme';

const FORM_MODE_LABELS: Array<{ key: keyof InstanceSettingsPublic['formModes']; label: string; hint: string }> = [
  { key: 'globalSmtp', label: 'Global SMTP', hint: 'Platform sends form mail via the SMTP configured below.' },
  { key: 'userSmtp', label: 'Project SMTP', hint: 'Each project supplies its own SMTP, sent by the Sitewright mailer.' },
  { key: 'contactPhp', label: 'contact.php', hint: 'Export a PHP contact.php that uses the host’s mail() function.' },
  { key: 'thirdParty', label: 'Third-party', hint: 'Forms post directly to an external endpoint URL.' },
];

const EMPTY_MODES = { globalSmtp: false, userSmtp: false, contactPhp: false, thirdParty: false };

/**
 * Instance admin → settings: the global mail transport, hCaptcha keys, and which
 * web-form mail-delivery modes projects may use. Secrets are write-only here — the
 * API never returns them, so a blank password/secret field means "keep the current
 * one". Shown only to instance admins (gated in App).
 */
export function InstanceSettings() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [modes, setModes] = useState<InstanceSettingsPublic['formModes']>(EMPTY_MODES);

  const [smtpEnabled, setSmtpEnabled] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState(587);
  const [secure, setSecure] = useState(false);
  const [user, setUser] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');
  const [password, setPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(false);

  const [hcaptchaEnabled, setHcaptchaEnabled] = useState(false);
  const [siteKey, setSiteKey] = useState('');
  const [hcSecret, setHcSecret] = useState('');
  const [hasSecret, setHasSecret] = useState(false);

  const [stockEnabled, setStockEnabled] = useState(false);
  const [unsplashKey, setUnsplashKey] = useState('');
  const [pexelsKey, setPexelsKey] = useState('');
  const [hasUnsplash, setHasUnsplash] = useState(false);
  const [hasPexels, setHasPexels] = useState(false);

  function hydrate(s: InstanceSettingsPublic) {
    setModes(s.formModes);
    setSmtpEnabled(Boolean(s.smtp));
    setHost(s.smtp?.host ?? '');
    setPort(s.smtp?.port ?? 587);
    setSecure(s.smtp?.secure ?? false);
    setUser(s.smtp?.user ?? '');
    setFromEmail(s.smtp?.fromEmail ?? '');
    setFromName(s.smtp?.fromName ?? '');
    setHasPassword(s.smtp?.hasPassword ?? false);
    setPassword('');
    setHcaptchaEnabled(Boolean(s.hcaptcha));
    setSiteKey(s.hcaptcha?.siteKey ?? '');
    setHasSecret(s.hcaptcha?.hasSecret ?? false);
    setHcSecret('');
    setStockEnabled(Boolean(s.stock));
    setHasUnsplash(s.stock?.hasUnsplash ?? false);
    setHasPexels(s.stock?.hasPexels ?? false);
    setUnsplashKey('');
    setPexelsKey('');
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.getInstanceSettings();
        if (active) hydrate(res.settings);
      } catch (err) {
        // A failed load must NOT fall through to an editable form: saving from a
        // default/empty form would clobber the real settings. Show an error instead.
        if (active) setLoadError(err instanceof Error ? err.message : 'failed to load settings');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const input: InstanceSettingsInput = { formModes: modes };
    input.smtp = smtpEnabled
      ? {
          host,
          port,
          secure,
          fromEmail,
          ...(user ? { user } : {}),
          ...(fromName ? { fromName } : {}),
          ...(password ? { password } : {}), // blank = keep current
        }
      : null;
    input.hcaptcha = hcaptchaEnabled
      ? { siteKey, ...(hcSecret ? { secret: hcSecret } : {}) }
      : null;
    input.stock = stockEnabled
      ? { ...(unsplashKey ? { unsplash: unsplashKey } : {}), ...(pexelsKey ? { pexels: pexelsKey } : {}) }
      : null; // disabling clears both keys
    try {
      const res = await api.putInstanceSettings(input);
      hydrate(res.settings);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save settings');
    }
  }

  if (loading) return <div className="p-8 text-slate-500">Loading settings…</div>;
  if (loadError) return <div className="p-8 text-red-600">{loadError}</div>;

  const field = glassInput;

  return (
    <form onSubmit={save} className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-lg font-semibold">Instance settings</h1>

      <fieldset className={`${glassCard} p-4`}>
        <legend className="px-1 text-sm font-semibold">Web-form mail modes</legend>
        <p className="mb-3 text-xs text-slate-500">Choose which delivery modes projects may use for their forms.</p>
        <div className="flex flex-col gap-2">
          {FORM_MODE_LABELS.map(({ key, label, hint }) => {
            // eslint-disable-next-line security/detect-object-injection -- key is a typed FormModes literal from a constant list
            const checked = modes[key];
            return (
              <label key={key} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  aria-label={label}
                  checked={checked}
                  onChange={(e) => setModes((m) => ({ ...m, [key]: e.target.checked }))}
                />
                <span>
                  <span className="font-medium">{label}</span>
                  <span className="block text-xs text-slate-500">{hint}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className={`${glassCard} p-4`}>
        <legend className="px-1 text-sm font-semibold">Global SMTP</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            aria-label="Configure global SMTP"
            checked={smtpEnabled}
            onChange={(e) => setSmtpEnabled(e.target.checked)}
          />
          Configure a global SMTP server
        </label>
        {smtpEnabled && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="flex flex-col text-xs text-slate-500">
              Host
              <input className={field} aria-label="SMTP host" value={host} onChange={(e) => setHost(e.target.value)} required />
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Port
              <input
                className={field}
                aria-label="SMTP port"
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!Number.isNaN(v)) setPort(v);
                }}
                required
              />
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Username
              <input className={field} aria-label="SMTP username" value={user} onChange={(e) => setUser(e.target.value)} />
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Password
              <input
                className={field}
                aria-label="SMTP password"
                type="password"
                value={password}
                placeholder={hasPassword ? '•••••• (leave blank to keep)' : ''}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              From email
              <input
                className={field}
                aria-label="SMTP from email"
                type="email"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
                required
              />
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              From name
              <input className={field} aria-label="SMTP from name" value={fromName} onChange={(e) => setFromName(e.target.value)} />
            </label>
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" aria-label="Use implicit TLS" checked={secure} onChange={(e) => setSecure(e.target.checked)} />
              Use implicit TLS (port 465); otherwise STARTTLS
            </label>
          </div>
        )}
      </fieldset>

      <fieldset className={`${glassCard} p-4`}>
        <legend className="px-1 text-sm font-semibold">hCaptcha</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            aria-label="Configure hCaptcha"
            checked={hcaptchaEnabled}
            onChange={(e) => setHcaptchaEnabled(e.target.checked)}
          />
          Enable hCaptcha for forms
        </label>
        {hcaptchaEnabled && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="flex flex-col text-xs text-slate-500">
              Site key
              <input className={field} aria-label="hCaptcha site key" value={siteKey} onChange={(e) => setSiteKey(e.target.value)} required />
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Secret key
              <input
                className={field}
                aria-label="hCaptcha secret"
                type="password"
                value={hcSecret}
                placeholder={hasSecret ? '•••••• (leave blank to keep)' : ''}
                onChange={(e) => setHcSecret(e.target.value)}
              />
            </label>
          </div>
        )}
      </fieldset>

      <fieldset className={`${glassCard} p-4`}>
        <legend className="px-1 text-sm font-semibold">Stock image providers</legend>
        <p className="mb-2 text-xs text-slate-500">
          Openverse needs no key. Add an Unsplash and/or Pexels API key to enable those providers in the media
          stock picker. Keys are encrypted at rest and never leave the server.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            aria-label="Configure stock provider keys"
            checked={stockEnabled}
            onChange={(e) => setStockEnabled(e.target.checked)}
          />
          Configure Unsplash / Pexels API keys
        </label>
        {stockEnabled && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="flex flex-col text-xs text-slate-500">
              Unsplash access key
              <input
                className={field}
                aria-label="Unsplash access key"
                type="password"
                value={unsplashKey}
                placeholder={hasUnsplash ? '•••••• (leave blank to keep)' : ''}
                onChange={(e) => setUnsplashKey(e.target.value)}
              />
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Pexels API key
              <input
                className={field}
                aria-label="Pexels API key"
                type="password"
                value={pexelsKey}
                placeholder={hasPexels ? '•••••• (leave blank to keep)' : ''}
                onChange={(e) => setPexelsKey(e.target.value)}
              />
            </label>
          </div>
        )}
      </fieldset>

      <div className="flex items-center gap-3">
        <button type="submit" className={primaryButton}>
          Save settings
        </button>
        {saved && <span className="text-sm text-green-600">Saved.</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </form>
  );
}
