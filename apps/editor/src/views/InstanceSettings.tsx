import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  DEFAULT_AGENT_INSTRUCTIONS,
  DEFAULT_AGENT_SESSION_HOURS,
  DEFAULT_REVISION_COALESCE_MS,
  DEFAULT_REVISION_RETENTION_DAYS,
  DEFAULT_AUTH_MAX_FAILURES,
  DEFAULT_NEW_PROJECT_LOCALE,
  DEFAULT_PLATFORM_NAME,
  DEFAULT_BRAND_PRIMARY,
  DEFAULT_BRAND_SECONDARY,
  LOGO_MIME_TYPES,
  MAX_LOGO_BASE64_LEN,
  MCP_TOOL_CATALOG,
  type PlatformLogo,
} from '@sitewright/schema';
import { api, type InstanceSettingsInput, type InstanceSettingsPublic } from '../api';
import { glassCard, glassInput, primaryButton, toggleInput } from '../theme';
import { applyBranding } from '../lib/use-branding';
import { ColorField } from './settings/ColorPicker';
import { SkeletonList } from './ui/Skeleton';
import { SectionHelp } from './ui/SectionHelp';
import { LocalePickerModal } from './i18n/LocalePickerModal';
import { localeFlag, localeLabel } from './i18n/locale-catalog';
import { OidcProvidersField, nextOidcProviderKey, type OidcProviderDraft } from './settings/OidcProvidersField';

const FORM_MODE_LABELS: Array<{ key: keyof InstanceSettingsPublic['formModes']; label: string; hint: string }> = [
  { key: 'globalSmtp', label: 'Global SMTP', hint: 'Platform sends form mail via the SMTP configured below.' },
  { key: 'userSmtp', label: 'Project SMTP', hint: 'Each project supplies its own SMTP, sent by the platform mailer.' },
  { key: 'contactPhp', label: 'contact.php', hint: 'Export a PHP contact.php that uses the host’s mail() function.' },
  { key: 'thirdParty', label: 'Third-party', hint: 'Forms post directly to an external endpoint URL.' },
];

const EMPTY_MODES = { globalSmtp: false, userSmtp: false, contactPhp: false, thirdParty: false };

/** Coerce the agent-session field to the server-accepted integer range [1, 720] (hours). */
const clampSessionHours = (n: number): number => Math.max(1, Math.min(720, Math.round(n)));
// Revision coalesce window shown in SECONDS (0 = every save a separate revision); stored in ms.
const clampCoalesceSeconds = (n: number): number => Math.max(0, Math.min(86_400, Math.round(n)));
const clampRetentionDays = (n: number): number => Math.max(1, Math.min(3650, Math.round(n)));
const DEFAULT_COALESCE_SECONDS = DEFAULT_REVISION_COALESCE_MS / 1000;

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
  // The agent (MCP) instructions textarea — pre-filled with the override or the built-in default.
  const [agentInstructions, setAgentInstructions] = useState(DEFAULT_AGENT_INSTRUCTIONS);
  // The hydrated value, so save only sends agentInstructions when the admin actually edited it
  // (an unrelated save must never touch the stored override).
  const initialInstructionsRef = useRef(DEFAULT_AGENT_INSTRUCTIONS);
  // The agent session cap (hours) — how long an MCP/OAuth connection lasts before re-consent.
  const [agentSessionHours, setAgentSessionHours] = useState(DEFAULT_AGENT_SESSION_HOURS);
  const initialSessionHoursRef = useRef(DEFAULT_AGENT_SESSION_HOURS);
  // Revision history: coalesce window (seconds; 0 = every save distinct) + retention (days).
  const [coalesceSeconds, setCoalesceSeconds] = useState(DEFAULT_COALESCE_SECONDS);
  const initialCoalesceSecondsRef = useRef(DEFAULT_COALESCE_SECONDS);
  const [retentionDays, setRetentionDays] = useState(DEFAULT_REVISION_RETENTION_DAYS);
  const initialRetentionDaysRef = useRef(DEFAULT_REVISION_RETENTION_DAYS);
  // The default locale new projects start in (their defaultLocale + sole initial locale).
  const [newProjectLocale, setNewProjectLocale] = useState(DEFAULT_NEW_PROJECT_LOCALE);
  const initialLocaleRef = useRef(DEFAULT_NEW_PROJECT_LOCALE);
  const [localePickerOpen, setLocalePickerOpen] = useState(false);

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

  const [oidcProviders, setOidcProviders] = useState<OidcProviderDraft[]>([]);

  // Max failed login/2FA attempts per IP per minute before throttling (brute-force protection).
  const [authMaxFailures, setAuthMaxFailures] = useState(DEFAULT_AUTH_MAX_FAILURES);
  const initialAuthMaxFailuresRef = useRef(DEFAULT_AUTH_MAX_FAILURES);

  // Session-cookie signing key: whether it's env-pinned (rotation disabled), + the rotate action's state.
  const [cookieSecretPinned, setCookieSecretPinned] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotateMsg, setRotateMsg] = useState<string | null>(null);

  async function rotateSessionKey() {
    if (!window.confirm('Rotate the session signing key? This signs everyone out immediately (you will need to log in again) and invalidates existing preview share-links.')) return;
    setRotating(true);
    setRotateMsg(null);
    try {
      await api.rotateCookieSecret();
      // The current session cookie is now invalid → send the admin to log in again.
      window.location.reload();
    } catch (err) {
      setRotateMsg(err instanceof Error ? err.message : 'Could not rotate the key.');
      setRotating(false);
    }
  }

  // Admin-panel branding (white-label). Name/colors are sent only when changed (refs track the
  // hydrated value); the logo is `undefined` = keep, `null` = remove, or a fresh `{mime,data}` upload.
  const [platformName, setPlatformName] = useState(DEFAULT_PLATFORM_NAME);
  const initialNameRef = useRef(DEFAULT_PLATFORM_NAME);
  const [brandPrimary, setBrandPrimary] = useState(DEFAULT_BRAND_PRIMARY);
  const initialPrimaryRef = useRef(DEFAULT_BRAND_PRIMARY);
  const [brandSecondary, setBrandSecondary] = useState(DEFAULT_BRAND_SECONDARY);
  const initialSecondaryRef = useRef(DEFAULT_BRAND_SECONDARY);
  const [hasLogo, setHasLogo] = useState(false);
  const [logoDraft, setLogoDraft] = useState<PlatformLogo | null | undefined>(undefined);
  const [logoError, setLogoError] = useState<string | null>(null);
  // Cache-buster for the current-logo <img> preview — bumped after a save so a replaced logo refreshes.
  const [logoBust, setLogoBust] = useState(0);

  function hydrate(s: InstanceSettingsPublic) {
    setModes(s.formModes);
    const maxFail = s.authMaxFailures ?? DEFAULT_AUTH_MAX_FAILURES;
    setAuthMaxFailures(maxFail);
    initialAuthMaxFailuresRef.current = maxFail;
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
    setOidcProviders(
      (s.oidcProviders ?? []).map((p) => ({
        _key: nextOidcProviderKey(),
        id: p.id,
        label: p.label,
        issuer: p.issuer,
        clientId: p.clientId,
        scopes: p.scopes.join(' '),
        enabled: p.enabled,
        hasClientSecret: p.hasClientSecret,
        secret: '',
        usePkce: p.usePkce,
      })),
    );
    const instr = s.agentInstructions ?? DEFAULT_AGENT_INSTRUCTIONS;
    setAgentInstructions(instr);
    initialInstructionsRef.current = instr;
    const hours = s.agentSessionHours ?? DEFAULT_AGENT_SESSION_HOURS;
    setAgentSessionHours(hours);
    initialSessionHoursRef.current = hours;
    const coalesceSec = Math.round((s.revisionCoalesceMs ?? DEFAULT_REVISION_COALESCE_MS) / 1000);
    setCoalesceSeconds(coalesceSec);
    initialCoalesceSecondsRef.current = coalesceSec;
    const retention = s.revisionRetentionDays ?? DEFAULT_REVISION_RETENTION_DAYS;
    setRetentionDays(retention);
    initialRetentionDaysRef.current = retention;
    const locale = s.defaultLocale ?? DEFAULT_NEW_PROJECT_LOCALE;
    setNewProjectLocale(locale);
    initialLocaleRef.current = locale;
    // Trim on hydrate so the "changed?" guard compares like-for-like (the save sends the trimmed value);
    // otherwise a stored name with stray whitespace would look dirty on an untouched save.
    const name = (s.platformName ?? DEFAULT_PLATFORM_NAME).trim();
    setPlatformName(name);
    initialNameRef.current = name;
    const primary = s.brandPrimary ?? DEFAULT_BRAND_PRIMARY;
    setBrandPrimary(primary);
    initialPrimaryRef.current = primary;
    const secondary = s.brandSecondary ?? DEFAULT_BRAND_SECONDARY;
    setBrandSecondary(secondary);
    initialSecondaryRef.current = secondary;
    setHasLogo(s.hasLogo ?? false);
    setLogoDraft(undefined); // a fresh load discards any un-saved logo pick
    setLogoError(null);
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.getInstanceSettings();
        if (active) {
          hydrate(res.settings);
          setCookieSecretPinned(res.cookieSecretPinned ?? false);
        }
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
    // Only touch agentInstructions when the admin actually edited the textarea — an unrelated save
    // must leave the stored override alone. When edited: store an override unless it's empty or equals
    // the default (then send null → revert), so we never persist the whole default as an override.
    if (agentInstructions !== initialInstructionsRef.current) {
      const trimmedInstructions = agentInstructions.trim();
      input.agentInstructions =
        trimmedInstructions === '' || trimmedInstructions === DEFAULT_AGENT_INSTRUCTIONS.trim() ? null : agentInstructions;
    }
    // Only touch the session cap when changed: clamp to the valid range, then the default value
    // sends null (revert) and any other value sends the number.
    const clampedHours = clampSessionHours(agentSessionHours);
    if (clampedHours !== initialSessionHoursRef.current) {
      input.agentSessionHours = clampedHours === DEFAULT_AGENT_SESSION_HOURS ? null : clampedHours;
    }
    // Revisions: coalesce (seconds→ms) + retention (days). Default value sends null (revert), else the number.
    const clampedCoalesce = clampCoalesceSeconds(coalesceSeconds);
    if (clampedCoalesce !== initialCoalesceSecondsRef.current) {
      input.revisionCoalesceMs = clampedCoalesce === DEFAULT_COALESCE_SECONDS ? null : clampedCoalesce * 1000;
    }
    const clampedRetention = clampRetentionDays(retentionDays);
    if (clampedRetention !== initialRetentionDaysRef.current) {
      input.revisionRetentionDays = clampedRetention === DEFAULT_REVISION_RETENTION_DAYS ? null : clampedRetention;
    }
    // Failed-login throttle threshold: default sends null (revert), else the clamped number (1..10000).
    const clampedMaxFail = Math.min(10_000, Math.max(1, Math.round(authMaxFailures) || DEFAULT_AUTH_MAX_FAILURES));
    if (clampedMaxFail !== initialAuthMaxFailuresRef.current) {
      input.authMaxFailures = clampedMaxFail === DEFAULT_AUTH_MAX_FAILURES ? null : clampedMaxFail;
    }
    // Default locale for new projects: only touch it when changed; the built-in default sends
    // null (revert), any other tag sends the value.
    if (newProjectLocale !== initialLocaleRef.current) {
      input.defaultLocale = newProjectLocale === DEFAULT_NEW_PROJECT_LOCALE ? null : newProjectLocale;
    }
    // OIDC providers (replace-semantics; the server preserves each secret by id when omitted). Drop
    // fully-blank "Add" rows; a secret is sent only when freshly typed.
    input.oidcProviders = oidcProviders
      .filter((p) => p.id.trim() || p.label.trim() || p.issuer.trim() || p.clientId.trim())
      .map((p) => ({
        id: p.id.trim(),
        label: p.label.trim(),
        issuer: p.issuer.trim(),
        clientId: p.clientId.trim(),
        ...(p.scopes.trim() ? { scopes: p.scopes.trim().split(/[\s,]+/).filter(Boolean) } : {}),
        enabled: p.enabled,
        usePkce: p.usePkce,
        ...(p.secret ? { clientSecret: p.secret } : {}),
      }));
    // Branding (white-label). Name/colors are sent only when changed: the built-in default sends null
    // (revert), any other value sends it. The logo sends its draft (`{mime,data}` to set, `null` to
    // remove, `undefined` to leave unchanged).
    if (platformName.trim() !== initialNameRef.current) {
      input.platformName = platformName.trim() === '' || platformName.trim() === DEFAULT_PLATFORM_NAME ? null : platformName.trim();
    }
    if (brandPrimary !== initialPrimaryRef.current) {
      input.brandPrimary = brandPrimary === DEFAULT_BRAND_PRIMARY ? null : brandPrimary;
    }
    if (brandSecondary !== initialSecondaryRef.current) {
      input.brandSecondary = brandSecondary === DEFAULT_BRAND_SECONDARY ? null : brandSecondary;
    }
    if (logoDraft !== undefined) input.platformLogo = logoDraft; // {mime,data} to set, null to remove
    try {
      const res = await api.putInstanceSettings(input);
      hydrate(res.settings);
      // Re-skin the live chrome immediately so the admin sees the change without a reload.
      const bust = logoBust + 1;
      setLogoBust(bust);
      applyBranding({
        name: res.settings.platformName ?? DEFAULT_PLATFORM_NAME,
        primary: res.settings.brandPrimary ?? DEFAULT_BRAND_PRIMARY,
        secondary: res.settings.brandSecondary ?? DEFAULT_BRAND_SECONDARY,
        logoUrl: res.settings.hasLogo ? `/branding/logo?v=${bust}` : null,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save settings');
    }
  }

  // Read a selected logo file → validate type + size → stage it as a base64 `PlatformLogo` draft.
  function onLogoFile(file: File | undefined): void {
    setLogoError(null);
    if (!file) return;
    if (!(LOGO_MIME_TYPES as readonly string[]).includes(file.type)) {
      setLogoError('Logo must be a PNG, JPEG, or WebP image.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.slice(result.indexOf(',') + 1); // strip the `data:<mime>;base64,` prefix
      if (base64.length > MAX_LOGO_BASE64_LEN) {
        setLogoError('Logo is too large (max ~512 KB).');
        return;
      }
      setLogoDraft({ mime: file.type as PlatformLogo['mime'], data: base64 });
    };
    reader.onerror = () => setLogoError('Could not read the file.');
    reader.readAsDataURL(file);
  }

  if (loading) return <SkeletonList rows={5} className="mx-auto max-w-2xl p-8" label="Loading settings…" />;
  if (loadError) return <div className="p-8 text-red-600">{loadError}</div>;

  const field = glassInput;

  const origin = window.location.origin;

  // The logo preview: a freshly-picked upload, the stored logo (cache-busted), or none (removed/unset).
  const logoPreview =
    logoDraft ? `data:${logoDraft.mime};base64,${logoDraft.data}` : logoDraft === undefined && hasLogo ? `/branding/logo?v=${logoBust}` : null;

  return (
    <>
    <form onSubmit={save} className="mx-auto flex max-w-2xl flex-col gap-6 p-6">

      <fieldset className={`${glassCard} p-4`}>
        <legend className="flex items-center gap-1.5 px-1 text-sm font-bold">
          Branding
          <SectionHelp tip="White-label the admin panel — the name, accent gradient, and logo shown across the editor and the sign-in screen." />
        </legend>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Platform name</span>
          <input
            className={field}
            aria-label="Platform name"
            value={platformName}
            maxLength={60}
            placeholder={DEFAULT_PLATFORM_NAME}
            onChange={(e) => setPlatformName(e.target.value)}
          />
        </label>
        <div className="mb-3 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <ColorField value={brandPrimary} onChange={setBrandPrimary} label="Primary color" />
            <span className="text-xs text-slate-600">Primary</span>
          </div>
          <div className="flex items-center gap-2">
            <ColorField value={brandSecondary} onChange={setBrandSecondary} label="Secondary color" />
            <span className="text-xs text-slate-600">Secondary</span>
          </div>
          {/* Live gradient preview (the same `.sw-brand-gradient` surface used across the chrome). */}
          <span
            aria-hidden
            className="h-7 flex-1 rounded-lg shadow-inner"
            style={{ backgroundImage: `linear-gradient(to bottom right, ${brandPrimary}, ${brandSecondary})` }}
          />
        </div>
        <div className="flex items-center gap-3">
          {logoPreview ? (
            <img src={logoPreview} alt="Current logo" className="h-9 w-9 rounded-md object-contain ring-1 ring-slate-200" />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-md text-[10px] text-slate-400 ring-1 ring-slate-200">none</span>
          )}
          <label className="cursor-pointer text-xs font-medium text-indigo-700 hover:underline">
            {/* "Replace" only when a logo is actually present (a pending remove → logoDraft===null → "Upload"). */}
            {logoDraft !== null && (hasLogo || logoDraft) ? 'Replace logo' : 'Upload logo'}
            <input
              type="file"
              accept={LOGO_MIME_TYPES.join(',')}
              aria-label="Upload logo"
              className="sr-only"
              onChange={(e) => onLogoFile(e.target.files?.[0])}
            />
          </label>
          {(hasLogo || logoDraft) && (
            <button type="button" className="text-xs font-medium text-rose-600 hover:underline" onClick={() => setLogoDraft(null)}>
              Remove
            </button>
          )}
          <span className="text-[11px] text-slate-400">PNG, JPEG, or WebP · ≤ ~512 KB</span>
        </div>
        {logoError && <p className="mt-2 text-xs text-rose-600">{logoError}</p>}
      </fieldset>

      <fieldset className={`${glassCard} p-4`}>
        <legend className="flex items-center gap-1.5 px-1 text-sm font-bold">
          Web-form mail modes
          <SectionHelp tip="Choose which delivery modes projects may use for their forms." />
        </legend>
        <div className="flex flex-col gap-2">
          {FORM_MODE_LABELS.map(({ key, label, hint }) => {
            // eslint-disable-next-line security/detect-object-injection -- key is a typed FormModes literal from a constant list
            const checked = modes[key];
            return (
              <label key={key} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className={toggleInput}
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
        <legend className="flex items-center gap-1.5 px-1 text-sm font-bold">
          New projects
          <SectionHelp tip="The language a newly created project starts in. Existing projects are unaffected." />
        </legend>
        <label className="flex flex-col text-xs text-slate-500">
          Default locale for new projects
          <button
            type="button"
            aria-label="Default locale for new projects"
            className={`mt-1 flex items-center gap-2 text-left ${glassInput}`}
            onClick={() => setLocalePickerOpen(true)}
          >
            <span aria-hidden className="text-lg">{localeFlag(newProjectLocale)}</span>
            <span className="font-medium text-slate-800">{localeLabel(newProjectLocale)}</span>
            <span className="font-mono text-xs uppercase text-slate-400">{newProjectLocale}</span>
            <span className="ml-auto text-xs text-indigo-600">Change</span>
          </button>
        </label>
      </fieldset>

      <fieldset className={`${glassCard} p-4`}>
        <legend className="px-1 text-sm font-bold">Global SMTP</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className={toggleInput}
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
              <input type="checkbox" className={toggleInput} aria-label="Use implicit TLS" checked={secure} onChange={(e) => setSecure(e.target.checked)} />
              Use implicit TLS (port 465); otherwise STARTTLS
            </label>
          </div>
        )}
      </fieldset>

      <fieldset className={`${glassCard} p-4`}>
        <legend className="px-1 text-sm font-bold">hCaptcha</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className={toggleInput}
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
        <legend className="flex items-center gap-1.5 px-1 text-sm font-bold">
          Stock image providers
          <SectionHelp tip="Openverse needs no key. Add an Unsplash and/or Pexels API key to enable those providers in the media stock picker. Keys are encrypted at rest and never leave the server." />
        </legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className={toggleInput}
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

      <fieldset className={`${glassCard} p-4`}>
        <legend className="flex items-center gap-1.5 px-1 text-sm font-bold">
          Agent (MCP) instructions
          <SectionHelp tip="The system instructions served to AI agents that connect over MCP. Edit to customize how agents build sites on this instance; Reset to default (or clear) reverts to the built-in instructions." />
        </legend>
        <textarea
          aria-label="Agent instructions"
          className={`${glassInput} h-64 w-full font-mono text-xs`}
          value={agentInstructions}
          onChange={(e) => setAgentInstructions(e.target.value)}
        />
        <button
          type="button"
          className="mt-2 text-xs text-slate-500 underline hover:text-slate-700"
          onClick={() => setAgentInstructions(DEFAULT_AGENT_INSTRUCTIONS)}
        >
          Reset to default
        </button>
      </fieldset>

      <fieldset className={`${glassCard} p-4`}>
        <legend className="flex items-center gap-1.5 px-1 text-sm font-bold">
          Agent session length
          <SectionHelp
            tip={`How long an agent connection (MCP / OAuth) stays valid before the user must re-approve — the absolute refresh-token cap. Default ${DEFAULT_AGENT_SESSION_HOURS}h. Raise it for agents that work across days; lower it to tighten the window. Refresh tokens still rotate and are theft-detected regardless.`}
          />
        </legend>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Session length (hours)
          <input
            type="number"
            min={1}
            max={720}
            aria-label="Agent session hours"
            className={`${glassInput} w-28`}
            value={agentSessionHours}
            // Accept what's typed (including transient values mid-edit); save() clamps to [1, 720].
            // An empty/non-numeric field keeps the current value rather than snapping to the default.
            onChange={(e) => {
              const n = e.target.valueAsNumber;
              if (!Number.isNaN(n)) setAgentSessionHours(n);
            }}
            onBlur={() => setAgentSessionHours((h) => clampSessionHours(h))}
          />
        </label>
      </fieldset>

      <fieldset className={`${glassCard} p-4`}>
        <legend className="flex items-center gap-1.5 px-1 text-sm font-bold">
          Revision history
          <SectionHelp
            tip={`Every content save is versioned. "Coalesce window" merges a rapid burst of edits by the same person to one item into a single revision — 0 (the default) keeps every save as its own revision. "Keep for" is how long history is retained before old revisions are swept. Applies to new saves; existing history is unaffected.`}
          />
        </legend>
        <div className="flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Coalesce window (seconds)
            <input
              type="number"
              min={0}
              max={86400}
              aria-label="Revision coalesce window in seconds"
              className={`${glassInput} w-28`}
              value={coalesceSeconds}
              onChange={(e) => {
                const n = e.target.valueAsNumber;
                if (!Number.isNaN(n)) setCoalesceSeconds(n);
              }}
              onBlur={() => setCoalesceSeconds((s) => clampCoalesceSeconds(s))}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Keep history for (days)
            <input
              type="number"
              min={1}
              max={3650}
              aria-label="Revision retention in days"
              className={`${glassInput} w-28`}
              value={retentionDays}
              onChange={(e) => {
                const n = e.target.valueAsNumber;
                if (!Number.isNaN(n)) setRetentionDays(n);
              }}
              onBlur={() => setRetentionDays((d) => clampRetentionDays(d))}
            />
          </label>
        </div>
      </fieldset>

      <fieldset className={`${glassCard} p-4`}>
        <legend className="px-1 text-sm font-bold">Accounts</legend>
        <p className="mb-3 text-xs text-slate-500">
          Registration is invite-only — new users join by accepting an invitation. There is no public
          self-registration.
        </p>
        <label className="block text-sm">
          <span className="font-medium">Failed sign-in attempts before throttling</span>
          <span className="mb-1 block text-xs text-slate-500">
            Per IP per minute. After this many FAILED login or 2FA attempts, further tries from that IP are
            blocked for a minute (a successful sign-in never counts). Default {DEFAULT_AUTH_MAX_FAILURES}.
          </span>
          <input
            type="number"
            min={1}
            max={10000}
            className={`${glassInput} w-28`}
            aria-label="Failed sign-in attempts before throttling"
            value={authMaxFailures}
            onChange={(e) => {
              const n = e.target.valueAsNumber;
              if (!Number.isNaN(n)) setAuthMaxFailures(n);
            }}
            onBlur={() => setAuthMaxFailures((v) => Math.min(10000, Math.max(1, Math.round(v) || DEFAULT_AUTH_MAX_FAILURES)))}
          />
        </label>
      </fieldset>

      <fieldset className={`${glassCard} p-4`}>
        <legend className="px-1 text-sm font-bold">Security</legend>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <span className="font-medium">Session signing key</span>
            <span className="block text-xs text-slate-500">
              {cookieSecretPinned
                ? 'Pinned via the COOKIE_SECRET environment variable — rotate it there.'
                : 'Rotate to invalidate every active session (e.g. after a suspected leak). Everyone, including you, is signed out and must log in again.'}
            </span>
          </div>
          <button
            type="button"
            className={`${glassCard} px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50`}
            disabled={cookieSecretPinned || rotating}
            onClick={() => void rotateSessionKey()}
          >
            {rotating ? 'Rotating…' : 'Rotate session key'}
          </button>
        </div>
        {rotateMsg && <p className="mt-2 text-sm text-rose-600">{rotateMsg}</p>}
      </fieldset>

      <fieldset className={`${glassCard} p-4`}>
        <legend className="flex items-center gap-1.5 px-1 text-sm font-bold">
          Single sign-on (OIDC)
          <SectionHelp
            tip={`Let users sign in via an external identity provider. Register this app at each provider with the redirect URL ${origin}/auth/oidc/<id>/callback. Only users who already exist or hold a pending invite can sign in; the client secret is stored encrypted.`}
          />
        </legend>
        <OidcProvidersField providers={oidcProviders} onChange={setOidcProviders} />
      </fieldset>

      <div className="flex items-center gap-3">
        <button type="submit" className={primaryButton}>
          Save settings
        </button>
        {saved && <span className="text-sm text-green-600">Saved.</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </form>

    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 pb-10">
      <section className={`${glassCard} p-4`}>
        <h2 className="flex items-center gap-1.5 text-sm font-bold">
          MCP endpoints
          <SectionHelp tip="Tools the MCP bridge exposes to a connected agent. Each is gated by the connection’s capabilities — a connection that lacks a tool’s capability can still see it listed, but calling it returns a clear “needs <capability>” error (the API enforces it server-side). Deletes require the separate content:delete capability, so an agent can create and edit without the power to remove." />
        </h2>
        <ul className="flex flex-col gap-1.5 text-sm">
          {MCP_TOOL_CATALOG.map((t) => (
            <li key={t.name} className="flex flex-wrap items-baseline gap-2">
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px] font-bold">{t.name}</code>
              <span className="text-xs text-slate-500">{t.description}</span>
              <span className="ml-auto rounded-full border border-white/60 bg-white/60 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                {t.capability ?? 'always'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className={`${glassCard} p-4`}>
        <h2 className="flex items-center gap-1.5 text-sm font-bold">
          Connect an agent
          <SectionHelp tip="Point any MCP-capable agent at this instance over the local stdio bridge. No up-front login — the agent connects on demand and shows you a link to approve." />
        </h2>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-slate-600">
          <li>
            Install the CLI: <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">npm i -g @sitewright/cli</code>
          </li>
          <li>
            Register this as a stdio MCP server in your agent — no login step needed first:{' '}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">sitewright mcp --url {origin}</code>
          </li>
          <li>
            When the agent calls its <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">login</code> tool it gets a
            link + code (device flow, OAuth 2.1 + PKCE). Open it, pick the project, approve — and keep that tab open to
            watch the agent’s changes live. Use <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">switch_project</code> to
            move it to another project.
          </li>
          <li>
            Prefer to sign in ahead of time? Run{' '}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">sitewright login --url {origin}</code> (add{' '}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">--device</code> for headless/SSH).
          </li>
        </ol>
      </section>
    </div>
    {localePickerOpen && (
      <LocalePickerModal
        title="Default locale for new projects"
        description="Pick the language new projects start in. This sets a new project's default locale and its first language."
        actionLabel="Use this locale"
        busy={false}
        onPick={(locale) => {
          setNewProjectLocale(locale);
          setLocalePickerOpen(false);
        }}
        onClose={() => setLocalePickerOpen(false)}
      />
    )}
    </>
  );
}
