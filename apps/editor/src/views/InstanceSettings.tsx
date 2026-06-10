import { useEffect, useRef, useState, type FormEvent } from 'react';
import { DEFAULT_AGENT_INSTRUCTIONS, DEFAULT_AGENT_SESSION_HOURS, MCP_TOOL_CATALOG } from '@sitewright/schema';
import { api, type InstanceSettingsInput, type InstanceSettingsPublic } from '../api';
import { glassCard, glassInput, primaryButton } from '../theme';
import { SkeletonList } from './ui/Skeleton';

const FORM_MODE_LABELS: Array<{ key: keyof InstanceSettingsPublic['formModes']; label: string; hint: string }> = [
  { key: 'globalSmtp', label: 'Global SMTP', hint: 'Platform sends form mail via the SMTP configured below.' },
  { key: 'userSmtp', label: 'Project SMTP', hint: 'Each project supplies its own SMTP, sent by the Sitewright mailer.' },
  { key: 'contactPhp', label: 'contact.php', hint: 'Export a PHP contact.php that uses the host’s mail() function.' },
  { key: 'thirdParty', label: 'Third-party', hint: 'Forms post directly to an external endpoint URL.' },
];

const EMPTY_MODES = { globalSmtp: false, userSmtp: false, contactPhp: false, thirdParty: false };

/** Coerce the agent-session field to the server-accepted integer range [1, 720] (hours). */
const clampSessionHours = (n: number): number => Math.max(1, Math.min(720, Math.round(n)));

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
    const instr = s.agentInstructions ?? DEFAULT_AGENT_INSTRUCTIONS;
    setAgentInstructions(instr);
    initialInstructionsRef.current = instr;
    const hours = s.agentSessionHours ?? DEFAULT_AGENT_SESSION_HOURS;
    setAgentSessionHours(hours);
    initialSessionHoursRef.current = hours;
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
    try {
      const res = await api.putInstanceSettings(input);
      hydrate(res.settings);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save settings');
    }
  }

  if (loading) return <SkeletonList rows={5} className="mx-auto max-w-2xl p-8" label="Loading settings…" />;
  if (loadError) return <div className="p-8 text-red-600">{loadError}</div>;

  const field = glassInput;

  const origin = window.location.origin;

  return (
    <>
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

      <fieldset className={`${glassCard} p-4`}>
        <legend className="px-1 text-sm font-semibold">Agent (MCP) instructions</legend>
        <p className="mb-3 text-xs text-slate-500">
          The system instructions served to AI agents that connect over MCP. Edit to customize how agents
          build sites on this instance; <strong>Reset to default</strong> (or clear) reverts to the built-in
          instructions.
        </p>
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
        <legend className="px-1 text-sm font-semibold">Agent session length</legend>
        <p className="mb-3 text-xs text-slate-500">
          How long an agent connection (MCP / OAuth) stays valid before the user must re-approve — the absolute
          refresh-token cap. Default {DEFAULT_AGENT_SESSION_HOURS}h. Raise it for agents that work across days;
          lower it to tighten the window. Refresh tokens still rotate and are theft-detected regardless.
        </p>
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
        <h2 className="text-sm font-semibold">MCP endpoints</h2>
        <p className="mb-3 text-xs text-slate-500">
          Tools the MCP bridge exposes to a connected agent. Each is gated by the connection’s capabilities — a
          read-only connection can list a write tool but calling it returns a clear “needs content:write” error
          (the API enforces it server-side).
        </p>
        <ul className="flex flex-col gap-1.5 text-sm">
          {MCP_TOOL_CATALOG.map((t) => (
            <li key={t.name} className="flex flex-wrap items-baseline gap-2">
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px] font-semibold">{t.name}</code>
              <span className="text-xs text-slate-500">{t.description}</span>
              <span className="ml-auto rounded-full border border-white/60 bg-white/60 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                {t.capability ?? 'always'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className={`${glassCard} p-4`}>
        <h2 className="text-sm font-semibold">Connect an agent</h2>
        <p className="mb-3 text-xs text-slate-500">
          Point any MCP-capable agent at this instance over the local stdio bridge. No up-front login —
          the agent connects on demand and shows you a link to approve:
        </p>
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
    </>
  );
}
