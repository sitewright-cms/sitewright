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
  DEFAULT_HSTS,
  LOGO_MIME_TYPES,
  MAX_LOGO_BASE64_LEN,
  MCP_TOOL_CATALOG,
  type PlatformLogo,
  type AiProviderKind,
} from '@sitewright/schema';
import { api, type InstanceSettingsInput, type InstanceSettingsPublic, type AiTestResult } from '../api';
import { modelPlaceholder } from './AiConfig';
import { glassCard, glassInput, primaryButton, ghostButton, toggleInput } from '../theme';
import { DeletedProjectsCard } from './DeletedProjectsCard';
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
// HSTS max-age shown/entered in seconds; server caps at 2 years. 0 clears the policy.
const clampHstsMaxAge = (n: number): number => Math.max(0, Math.min(63_072_000, Math.round(n) || 0));

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
  // Site-wide default image delivery format for {{sw-image}} (projects can override).
  const [defaultImageFormat, setDefaultImageFormat] = useState<'webp' | 'avif'>('webp');
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

  // Platform-wide AI assistant config (the key is write-only; a presence flag comes back).
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiProvider, setAiProvider] = useState<AiProviderKind>('anthropic');
  const [aiModel, setAiModel] = useState('');
  const [aiBaseUrl, setAiBaseUrl] = useState('');
  const [aiKey, setAiKey] = useState('');
  const [aiHasKey, setAiHasKey] = useState(false);
  const [aiProjectLimit, setAiProjectLimit] = useState('');
  const [aiMaxTokens, setAiMaxTokens] = useState('');
  const [aiAdminsUnlimited, setAiAdminsUnlimited] = useState(true);
  const [aiTest, setAiTest] = useState<AiTestResult | null>(null);
  const [aiTesting, setAiTesting] = useState(false);
  const [unsplashTest, setUnsplashTest] = useState<{ ok: boolean; error?: string } | null>(null);
  const [pexelsTest, setPexelsTest] = useState<{ ok: boolean; error?: string } | null>(null);
  const [stockTesting, setStockTesting] = useState<'unsplash' | 'pexels' | null>(null);

  // HSTS (HTTP Strict-Transport-Security) — admin opt-in, OFF by default (sticky + dangerous, so gated).
  const [hstsEnabled, setHstsEnabled] = useState(false);
  const [hstsMaxAge, setHstsMaxAge] = useState(DEFAULT_HSTS.maxAgeSeconds);
  const [hstsIncludeSub, setHstsIncludeSub] = useState(false);
  const [hstsPreload, setHstsPreload] = useState(false);
  const [hstsApplySites, setHstsApplySites] = useState(false);

  async function testAi() {
    setAiTesting(true);
    setAiTest(null);
    try {
      setAiTest(
        await api.testInstanceAi({
          provider: aiProvider,
          ...(aiModel.trim() ? { model: aiModel.trim() } : {}),
          ...(aiProvider === 'openai' && aiBaseUrl.trim() ? { baseUrl: aiBaseUrl.trim() } : {}),
          ...(aiKey ? { apiKey: aiKey } : {}),
        }),
      );
    } catch (e) {
      setAiTest({ ok: false, model: aiModel.trim(), error: e instanceof Error ? e.message : 'test failed' });
    } finally {
      setAiTesting(false);
    }
  }

  async function testStock(provider: 'unsplash' | 'pexels', key: string) {
    const set = provider === 'unsplash' ? setUnsplashTest : setPexelsTest;
    setStockTesting(provider);
    set(null);
    try {
      set(await api.testStockKey({ provider, ...(key ? { key } : {}) }));
    } catch (e) {
      set({ ok: false, error: e instanceof Error ? e.message : 'test failed' });
    } finally {
      setStockTesting(null);
    }
  }

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
    setAiEnabled(s.ai?.enabled ?? false);
    setAiProvider(s.ai?.provider ?? 'anthropic');
    setAiModel(s.ai?.model ?? '');
    setAiBaseUrl(s.ai?.baseUrl ?? '');
    setAiHasKey(s.ai?.hasApiKey ?? false);
    setAiKey('');
    setAiProjectLimit(s.ai?.defaultProjectMonthlyTokens != null ? String(s.ai.defaultProjectMonthlyTokens) : '');
    setAiMaxTokens(s.ai?.maxOutputTokens != null ? String(s.ai.maxOutputTokens) : '');
    setAiAdminsUnlimited(s.ai?.adminsUnlimited ?? true);
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
    setDefaultImageFormat(s.defaultImageFormat ?? 'webp');
    setHstsEnabled(s.hsts?.enabled ?? false);
    setHstsMaxAge(s.hsts?.maxAgeSeconds ?? DEFAULT_HSTS.maxAgeSeconds);
    setHstsIncludeSub(s.hsts?.includeSubDomains ?? false);
    setHstsPreload(s.hsts?.preload ?? false);
    setHstsApplySites(s.hsts?.applyToServedSites ?? false);
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
    // Validate the AI output-token cap inline (mirrors the per-project form) so an out-of-range
    // value shows a clear message instead of a generic server 400.
    if (aiEnabled && aiMaxTokens.trim() !== '') {
      const n = Number(aiMaxTokens);
      if (!Number.isInteger(n) || n < 1024 || n > 32000) {
        setError('Max output tokens must be a whole number between 1024 and 32000.');
        return;
      }
    }
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
    input.ai = aiEnabled
      ? {
          enabled: true,
          provider: aiProvider,
          adminsUnlimited: aiAdminsUnlimited,
          ...(aiModel.trim() ? { model: aiModel.trim() } : {}),
          ...(aiProvider === 'openai' && aiBaseUrl.trim() ? { baseUrl: aiBaseUrl.trim() } : {}),
          ...(aiKey ? { apiKey: aiKey } : {}), // blank = keep current
          ...(aiProjectLimit.trim() !== '' ? { defaultProjectMonthlyTokens: Number(aiProjectLimit) } : {}),
          ...(aiMaxTokens.trim() !== '' ? { maxOutputTokens: Number(aiMaxTokens) } : {}),
        }
      : null; // disabling clears the platform assistant (and its key)
    // HSTS: send the full policy (no secrets). enabled=false stores an OFF policy (preserves the other
    // fields for when it's re-enabled) rather than clearing the section.
    input.hsts = {
      enabled: hstsEnabled,
      maxAgeSeconds: clampHstsMaxAge(hstsMaxAge),
      includeSubDomains: hstsIncludeSub,
      preload: hstsPreload,
      applyToServedSites: hstsApplySites,
    };
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
    // Default image delivery format: 'webp' (the built-in default) sends null; 'avif' sets it.
    input.defaultImageFormat = defaultImageFormat === 'webp' ? null : 'avif';
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
        <label className="mt-3 flex flex-col text-xs text-slate-500">
          Default image delivery format ({'{{sw-image}}'})
          <select
            aria-label="Default image delivery format"
            className={`mt-1 ${glassInput}`}
            value={defaultImageFormat}
            onChange={(e) => setDefaultImageFormat(e.target.value as 'webp' | 'avif')}
          >
            <option value="webp">WebP</option>
            <option value="avif">AVIF + WebP</option>
          </select>
          <span className="mt-1 text-[11px] text-slate-400">
            AVIF is smaller on supporting browsers, at ~2× the generated files. Projects can override this in Website settings.
          </span>
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
              <span className="mt-1 flex items-center gap-2">
                <button type="button" className={`${ghostButton} px-2 py-1 text-xs`} onClick={() => void testStock('unsplash', unsplashKey)} disabled={stockTesting === 'unsplash' || (!unsplashKey && !hasUnsplash)}>
                  {stockTesting === 'unsplash' ? 'Testing…' : 'Test'}
                </button>
                {unsplashTest && (unsplashTest.ok ? <span className="text-xs text-green-600">✓ Connected</span> : <span className="text-xs text-red-600" title={unsplashTest.error}>✗ {unsplashTest.error}</span>)}
              </span>
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
              <span className="mt-1 flex items-center gap-2">
                <button type="button" className={`${ghostButton} px-2 py-1 text-xs`} onClick={() => void testStock('pexels', pexelsKey)} disabled={stockTesting === 'pexels' || (!pexelsKey && !hasPexels)}>
                  {stockTesting === 'pexels' ? 'Testing…' : 'Test'}
                </button>
                {pexelsTest && (pexelsTest.ok ? <span className="text-xs text-green-600">✓ Connected</span> : <span className="text-xs text-red-600" title={pexelsTest.error}>✗ {pexelsTest.error}</span>)}
              </span>
            </label>
          </div>
        )}
      </fieldset>

      <fieldset className={`${glassCard} p-4`}>
        <legend className="flex items-center gap-1.5 px-1 text-sm font-bold">
          AI Assistant
          <SectionHelp tip="The on-page AI assistant edits sites on request. Set a provider + API key to enable it platform-wide; projects can override with their own key (Website settings → AI Assistant). The key is encrypted at rest and never leaves the server." />
        </legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className={toggleInput}
            aria-label="Enable the AI assistant platform-wide"
            checked={aiEnabled}
            onChange={(e) => setAiEnabled(e.target.checked)}
          />
          Enable the AI assistant platform-wide
        </label>
        {aiEnabled && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="flex flex-col text-xs text-slate-500">
              Provider
              <select className={field} aria-label="AI provider" value={aiProvider} onChange={(e) => setAiProvider(e.target.value as AiProviderKind)}>
                <option value="anthropic">Anthropic</option>
                <option value="openrouter">OpenRouter</option>
                <option value="openai">OpenAI-compatible (custom endpoint)</option>
              </select>
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Model
              <input className={field} aria-label="AI model" value={aiModel} onChange={(e) => setAiModel(e.target.value)} placeholder={modelPlaceholder(aiProvider)} />
            </label>
            {aiProvider === 'openrouter' && (
              <p className="col-span-2 -mt-1 text-[11px] text-slate-400">
                Uses openrouter.ai — pick a model that supports tool/function calling (and vision if you want the agent to see screenshots).
              </p>
            )}
            {aiProvider === 'openai' && (
              <label className="col-span-2 flex flex-col text-xs text-slate-500">
                Base URL <span className="text-slate-400">(public host only; use SW_AI_BASE_URL env for a local endpoint)</span>
                <input className={field} aria-label="AI base URL" type="url" value={aiBaseUrl} onChange={(e) => setAiBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
              </label>
            )}
            <label className="flex flex-col text-xs text-slate-500">
              API key
              <input className={field} aria-label="AI API key" type="password" value={aiKey} placeholder={aiHasKey ? '•••••• (leave blank to keep)' : ''} onChange={(e) => setAiKey(e.target.value)} />
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Default per-project monthly token cap <span className="text-slate-400">(0 = unlimited)</span>
              <input className={field} aria-label="Default per-project monthly token cap" type="number" min={0} value={aiProjectLimit} onChange={(e) => setAiProjectLimit(e.target.value)} />
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Max output tokens / reply <span className="text-slate-400">(blank = default 8192)</span>
              <input
                className={field}
                aria-label="Max output tokens per reply"
                type="number"
                min={1024}
                max={32000}
                value={aiMaxTokens}
                onChange={(e) => setAiMaxTokens(e.target.value)}
                placeholder="8192"
              />
            </label>
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" className={toggleInput} aria-label="Admins bypass token caps" checked={aiAdminsUnlimited} onChange={(e) => setAiAdminsUnlimited(e.target.checked)} />
              Platform admins bypass token caps
            </label>
            <div className="col-span-2 flex flex-wrap items-center gap-3">
              <button type="button" className={ghostButton} onClick={() => void testAi()} disabled={aiTesting}>
                {aiTesting ? 'Testing…' : 'Test connection'}
              </button>
              {aiTest &&
                (aiTest.ok ? (
                  <span className="text-sm text-green-600">✓ Connected{aiTest.model ? ` (${aiTest.model})` : ''}</span>
                ) : (
                  <span className="text-sm text-red-600" title={aiTest.error}>✗ {aiTest.error}</span>
                ))}
            </div>
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
          HTTP Strict Transport Security (HSTS)
          <SectionHelp tip="Tells browsers to only ever reach this platform origin over HTTPS. Only has effect when the instance is actually served over TLS. HSTS is STICKY — once a browser has seen it, it refuses plain HTTP for the whole max-age — so enable it only when you're sure the origin stays on HTTPS." />
        </legend>
        <p className="mb-3 text-xs text-slate-500">
          Off by default. Sends the{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5">Strict-Transport-Security</code> header on platform
          responses. Locally-hosted client sites (<code className="rounded bg-slate-100 px-1 py-0.5">&lt;slug&gt;.your-domain</code>{' '}
          / <code className="rounded bg-slate-100 px-1 py-0.5">/sites/…</code>) are excluded unless you opt in below.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className={toggleInput}
            aria-label="Enable HSTS"
            checked={hstsEnabled}
            onChange={(e) => setHstsEnabled(e.target.checked)}
          />
          <span className="font-medium">Send Strict-Transport-Security on platform responses</span>
        </label>
        {hstsEnabled && (
          <div className="mt-3 flex flex-col gap-3">
            <label className="block text-sm">
              <span className="font-medium">max-age (seconds)</span>
              <span className="mb-1 block text-xs text-slate-500">
                How long browsers keep enforcing HTTPS after each visit. Common: 31536000 (1 year). 0 clears the policy.
              </span>
              <input
                type="number"
                min={0}
                max={63_072_000}
                className={`${glassInput} w-40`}
                aria-label="HSTS max-age seconds"
                value={hstsMaxAge}
                onChange={(e) => {
                  const n = e.target.valueAsNumber;
                  if (!Number.isNaN(n)) setHstsMaxAge(n);
                }}
                onBlur={() => setHstsMaxAge((v) => clampHstsMaxAge(v))}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className={toggleInput}
                aria-label="includeSubDomains"
                checked={hstsIncludeSub}
                onChange={(e) => setHstsIncludeSub(e.target.checked)}
              />
              <span>
                includeSubDomains
                <span className="ml-2 text-xs text-amber-600">only if EVERY subdomain is served over HTTPS</span>
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className={toggleInput}
                aria-label="preload"
                checked={hstsPreload}
                onChange={(e) => setHstsPreload(e.target.checked)}
              />
              <span>
                preload
                <span className="ml-2 text-xs text-amber-600">near-irreversible; needs includeSubDomains + a 1-year+ max-age</span>
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className={toggleInput}
                aria-label="Apply to served client sites"
                checked={hstsApplySites}
                onChange={(e) => setHstsApplySites(e.target.checked)}
              />
              <span>
                Also apply to served client sites
                <span className="ml-2 text-xs text-amber-600">only with a valid (e.g. wildcard) cert for your site subdomains</span>
              </span>
            </label>
          </div>
        )}
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
      <DeletedProjectsCard />
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
