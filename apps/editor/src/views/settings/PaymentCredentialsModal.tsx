import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, Loader2 } from 'lucide-react';
import { toPublicGateway, type CredentialField, type PaymentBindingPublic, type PaymentGatewayPublic, type PaymentGatewayStored } from '@sitewright/schema';
import { Modal } from '../ui/Modal';
import { SubLabel } from './ui';
import { api, type ShippedGateway } from '../../api';
import { glassInput, fieldLabel, ghostButton, primaryButton, toggleInput } from '../../theme';

/**
 * A project's PAYMENT CREDENTIALS.
 *
 * ★★ EVERY CONTROL HERE IS RENDERED FROM THE GATEWAY'S OWN DECLARATION. There is no per-gateway code
 * in this file and there must never be: an instance admin adding a gateway should get a correct,
 * labelled, validated form in every project without anyone touching the editor. That is the whole
 * point of `credentialFields` being data.
 *
 * ★ Secrets are never fetched. The server returns which fields HAVE a value, per mode, and a shape
 * hint — so an empty box means "unchanged", not "blank". Saving an untouched field keeps what is
 * stored; clearing one explicitly removes it.
 *
 * A project may hold keys for SEVERAL providers — each checkout channel picks the one it charges
 * through — so the provider picker selects which one's keys are edited, and each has its own test/live
 * mode, proof and webhook URL. Saving one provider's keys never touches another's.
 */
type ProviderBinding = PaymentBindingPublic & { webhookUrl?: string };
/** A definition as the admin listing returns it; `shipped` is what the platform ships for a built-in id. */
type Definition = PaymentGatewayStored & { builtin?: boolean; shipped?: ShippedGateway };
export function PaymentCredentialsModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [gateways, setGateways] = useState<PaymentGatewayPublic[]>([]);
  const [bindings, setBindings] = useState<ProviderBinding[]>([]);
  const [gatewayId, setGatewayId] = useState('');
  const [mode, setMode] = useState<'test' | 'live'>('test');
  /** Only what the operator actually typed this session — an untouched field is never sent. */
  const [edits, setEdits] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  /** The dry run's outcome: the provider's own hosted page, or its refusal. */
  const [proof, setProof] = useState<{ ok: boolean; url?: string; message?: string } | null>(null);
  /** The full definitions — an instance admin's view only (null for anyone else). */
  const [definitions, setDefinitions] = useState<ReadonlyMap<string, Definition> | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [g, b, d] = await Promise.all([
        api.projectPaymentGateways(projectId).catch(() => ({ gateways: [] })),
        api.getProjectPayment(projectId).catch(() => ({ bindings: [] as ProviderBinding[] })),
        // 403 for anyone but an instance admin, which simply means "no admin view".
        api.listGatewayDefinitions().catch(() => null),
      ]);
      if (!live) return;
      const defs = d ? new Map(d.gateways.map((x) => [x.id, x])) : null;
      setDefinitions(defs);
      // ★ An instance admin also gets the providers that are enabled but NOT proven yet. Proving one
      // needs test keys in a project first, and without this the only way to enter them was a raw API
      // call — which left a provider an agent had written with no way to be proven in the editor.
      const offered = new Set(g.gateways.map((x) => x.id));
      const unproven = [...(defs?.values() ?? [])].filter((x) => x.enabled && !x.verified && !offered.has(x.id)).map(toPublicGateway);
      const pickable = [...g.gateways, ...unproven];
      setGateways(pickable);
      const all = b.bindings ?? [];
      setBindings(all);
      // Open on a provider that is already set up, else the first one offered.
      const first = all[0];
      if (first) {
        setGatewayId(first.gatewayId);
        setMode(first.mode);
      } else if (pickable[0]) {
        setGatewayId(pickable[0].id);
      }
    })();
    return () => {
      live = false;
    };
  }, [projectId]);

  const gateway = gateways.find((g) => g.id === gatewayId);
  const definition = definitions?.get(gatewayId);
  const fields: CredentialField[] = gateway?.credentialFields ?? [];
  /** The keys stored for the provider being edited — each provider has its own. */
  const binding = bindings.find((b) => b.gatewayId === gatewayId) ?? null;
  const webhookUrl = binding?.webhookUrl ?? '';
  const stored = binding?.fields[mode];
  const has = (key: string): boolean => stored?.find((f) => f.key === key)?.hasValue === true;
  const hint = (key: string): string | undefined => stored?.find((f) => f.key === key)?.display;

  const save = async (): Promise<void> => {
    setBusy(true);
    setError([]);
    setSaved(false);
    try {
      await api.putProjectPayment(projectId, { gatewayId, mode, values: edits });
      // Saved — so the typed values go and "Saved" shows even if re-reading the masks then fails.
      setEdits({});
      setSaved(true);
      await reload().catch(() => undefined);
    } catch (e) {
      const details = (e as { details?: unknown }).details;
      setError(Array.isArray(details) ? (details as string[]) : [(e as Error).message]);
    } finally {
      setBusy(false);
    }
  };

  /** Re-reads every provider's stored keys (masks only) — after a save, a mode switch or a removal. */
  const reload = async (): Promise<ProviderBinding[]> => {
    const b = await api.getProjectPayment(projectId);
    const all = b.bindings ?? [];
    setBindings(all);
    return all;
  };

  /** Removes the keys of the provider being edited. The server refuses while a checkout channel uses it. */
  const remove = async (): Promise<void> => {
    if (!binding || !window.confirm(`Remove the ${gateway?.name ?? gatewayId} keys from this project?`)) return;
    setBusy(true);
    setError([]);
    try {
      await api.deleteProjectPayment(projectId, gatewayId);
      setEdits({});
      setMode('test');
      setProof(null);
      setSaved(false);
      await reload().catch(() => undefined);
    } catch (e) {
      setError([(e as Error).message]);
    } finally {
      setBusy(false);
    }
  };

  const goLive = async (): Promise<void> => {
    setBusy(true);
    setError([]);
    try {
      await api.putProjectPaymentMode(projectId, activeMode === 'live' ? 'test' : 'live', gatewayId);
      const fresh = await reload();
      const now = fresh.find((b) => b.gatewayId === gatewayId);
      if (now) setMode(now.mode);
    } catch (e) {
      const missing = (e as { details?: { missing?: string[] } }).details?.missing;
      setError(missing?.length ? [`Fill in the live values first: ${missing.join(', ')}`] : [(e as Error).message]);
    } finally {
      setBusy(false);
    }
  };

  /**
   * The dry run.
   *
   * ★ A REAL test-mode checkout, because a gateway template can be syntactically perfect and still
   * produce a request the provider rejects — and until one has succeeded the gateway cannot take
   * live money. What it returns is the provider's own hosted page: the proof that matters is
   * visual, not a 200 from our own API, so the link is offered rather than a green tick.
   */
  const prove = async (): Promise<void> => {
    setBusy(true);
    setError([]);
    setProof(null);
    try {
      const r = await api.verifyProjectPayment(projectId, gatewayId);
      setProof({ ok: r.verified === true, ...(r.redirectUrl ? { url: r.redirectUrl } : {}) });
    } catch (e) {
      const d = e as { details?: { message?: string; error?: string; missing?: string[] } };
      const missing = d.details?.missing;
      setProof({
        ok: false,
        message: missing?.length
          ? `Fill in the test values first: ${missing.join(', ')}`
          : d.details?.message ?? d.details?.error ?? (e as Error).message,
      });
    } finally {
      setBusy(false);
    }
  };

  const activeMode = binding?.mode ?? 'test';

  return (
    <Modal title="Payments" size="2xl" onClose={onClose}>
      <div className="flex flex-col gap-4 p-5">
        {gateways.length === 0 && (
          <div className="rounded-lg border border-amber-200/70 dark:border-amber-500/20 bg-amber-50/60 dark:bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
            No payment gateway is available yet. An instance admin enables one and proves it with a test
            payment; until then this project cannot take money, and a checkout button would have nothing
            behind it.
          </div>
        )}

        {gateways.length > 0 && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={fieldLabel}>Provider</span>
                <select
                  className={glassInput}
                  value={gatewayId}
                  onChange={(e) => {
                    const next = e.target.value;
                    setGatewayId(next);
                    setMode(bindings.find((b) => b.gatewayId === next)?.mode ?? 'test');
                    setEdits({});
                    setProof(null);
                    setSaved(false);
                  }}
                >
                  {gateways.map((g) => {
                    const b = bindings.find((x) => x.gatewayId === g.id);
                    const unproven = definitions?.get(g.id)?.verified === false;
                    return (
                      <option key={g.id} value={g.id}>
                        {g.name}
                        {unproven ? ' (not proven yet)' : ''} — {b ? `set up (${b.mode})` : 'not set up'}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="block">
                <span className={fieldLabel}>Editing which keys</span>
                <select className={glassInput} value={mode} onChange={(e) => { setMode(e.target.value as 'test' | 'live'); setEdits({}); }}>
                  <option value="test">Test keys</option>
                  <option value="live">Live keys</option>
                </select>
              </label>
            </div>
            {gateway?.description && <p className="text-[11px] text-slate-500 dark:text-slate-400">{gateway.description}</p>}
            {definition && definitions && <GatewayDestinations definition={definition} all={definitions} />}
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              A shop can use several providers — each checkout channel names the one it charges through. Keys,
              test/live mode and the webhook URL are per provider.
            </p>

            {/* ★ The whole form, from the gateway's own declaration. No per-gateway code. */}
            <div className="flex flex-col gap-3">
              {fields.map((f) => (
                <label key={f.key} className="block">
                  <span className={fieldLabel}>
                    {f.label}
                    {f.required ? ' *' : ''}
                    {has(f.key) && <span className="ml-2 text-[11px] font-normal text-emerald-600 dark:text-emerald-400">saved {hint(f.key)}</span>}
                  </span>
                  {f.kind === 'bool' ? (
                    <input
                      type="checkbox"
                      className={toggleInput}
                      checked={typeof edits[f.key] === 'boolean' ? (edits[f.key] as boolean) : has(f.key)}
                      onChange={(e) => setEdits({ ...edits, [f.key]: e.target.checked })}
                    />
                  ) : f.kind === 'choice' ? (
                    <select
                      className={glassInput}
                      value={typeof edits[f.key] === 'string' ? (edits[f.key] as string) : (hint(f.key) ?? '')}
                      onChange={(e) => setEdits({ ...edits, [f.key]: e.target.value })}
                    >
                      <option value="">Choose…</option>
                      {(f.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className={glassInput}
                      // Secrets are write-only: there is nothing to pre-fill, because the server has
                      // never sent one. Blank means "leave it alone".
                      type={f.kind === 'secret' ? 'password' : 'text'}
                      autoComplete="off"
                      value={typeof edits[f.key] === 'string' ? (edits[f.key] as string) : f.kind === 'secret' ? '' : (hint(f.key) ?? '')}
                      placeholder={has(f.key) ? 'Leave blank to keep the saved value' : (f.modePrefix?.[mode] ?? '')}
                      onChange={(e) => setEdits({ ...edits, [f.key]: e.target.value })}
                    />
                  )}
                  {f.hint && <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">{f.hint}</span>}
                  {f.docsUrl && (
                    <a className="mt-0.5 block text-[11px] text-indigo-600 dark:text-indigo-400 underline" href={f.docsUrl} target="_blank" rel="noreferrer noopener">
                      Where to find this
                    </a>
                  )}
                </label>
              ))}
            </div>

            {error.length > 0 && (
              <ul className="rounded-md bg-red-50 dark:bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                {error.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
            {saved && (
              <p className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5" /> Saved.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={primaryButton} disabled={busy} onClick={() => void save()}>
                {busy && <Loader2 className="mr-1 inline h-4 w-4 animate-spin" />}
                Save {mode} keys
              </button>
              <button type="button" className={ghostButton} disabled={busy} onClick={() => void goLive()}>
                {activeMode === 'live' ? 'Switch back to test mode' : 'Go live'}
              </button>
              {/* ★ Only offered in test mode: proving a gateway must never mean taking a real payment. */}
              {activeMode === 'test' && gatewayId && (
                <button type="button" className={ghostButton} disabled={busy} onClick={() => void prove()}>
                  Prove it works
                </button>
              )}
              {binding && (
                <button type="button" className={ghostButton} disabled={busy} onClick={() => void remove()}>
                  Remove these keys
                </button>
              )}
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {binding ? (
                  <>
                    {gateway?.name ?? gatewayId} is in <strong>{activeMode}</strong> mode.
                  </>
                ) : (
                  <>{gateway?.name ?? gatewayId} is not set up for this project yet.</>
                )}
              </span>
            </div>

            {proof && (
              <div
                className={`rounded-lg border p-3 text-xs ${
                  proof.ok
                    ? 'border-emerald-200/70 dark:border-emerald-500/20 bg-emerald-50/60 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                    : 'border-amber-200/70 dark:border-amber-500/20 bg-amber-50/60 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300'
                }`}
              >
                {proof.ok ? (
                  <span>
                    <strong>The provider accepted a test checkout.</strong>{' '}
                    {proof.url && (
                      <a href={proof.url} target="_blank" rel="noreferrer noopener" className="underline">
                        Open their page to see it
                      </a>
                    )}
                    {proof.url && ' — that page is the proof, not this message.'}
                  </span>
                ) : (
                  <span>
                    <strong>The provider refused it.</strong> {proof.message ?? 'The attempt failed.'}
                  </span>
                )}
              </div>
            )}

            {/* ★ Live mode is a different kind of thing, and the UI should feel like it. */}
            {activeMode === 'live' && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200/70 dark:border-red-500/20 bg-red-50/60 dark:bg-red-500/10 p-3 text-xs text-red-800 dark:text-red-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <strong>This shop takes real payments.</strong> Orders placed here charge real cards and
                  appear in your provider's dashboard.
                </span>
              </div>
            )}

            {webhookUrl && (
              <div>
                <SubLabel>Webhook URL</SubLabel>
                <p className="mb-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Paste this into your provider's dashboard. Without it, a payment can still succeed but your
                  shop will not hear about it until the platform asks — so orders arrive late.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-1.5 text-[11px]">{webhookUrl}</code>
                  <button
                    type="button"
                    className={ghostButton}
                    onClick={() => {
                      void navigator.clipboard?.writeText(webhookUrl);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}

            {binding && binding.orphaned.length > 0 && (
              <p className="rounded-md bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300">
                Stored values this gateway no longer asks for: <strong>{binding.orphaned.join(', ')}</strong>. They
                are kept, unused, in case the gateway changes back.
              </p>
            )}
            {binding && binding.missing.length > 0 && (
              <p className="rounded-md bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300">
                Still needed for <strong>{binding.mode}</strong> mode: {binding.missing.join(', ')}. Checkout will
                refuse until these are filled in.
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/** The origin of a URL, or the URL itself when it does not parse. */
function originOf(url: string | undefined): string {
  if (!url) return '—';
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/** Every address a definition reaches — its API bases and its allowed origins — as one comparable string. */
function addressesOf(g: Pick<PaymentGatewayStored, 'apiBase' | 'allowedOrigins'>): string {
  const all = [originOf(g.apiBase.test), originOf(g.apiBase.live), ...g.allowedOrigins].map((o) => o.toLowerCase().replace(/\/$/, ''));
  return [...new Set(all)].sort().join(', ');
}

/** The provider events and status-check states a definition treats as PAID. */
function paidSignals(g: PaymentGatewayStored): string[] {
  const out = Object.entries(g.events.types ?? {})
    .filter(([, kind]) => kind === 'paid')
    .map(([type]) => `webhook "${type}"`);
  if (g.events.defaultKind === 'paid' && !g.events.typePath) out.push('every verified webhook');
  for (const [state, kind] of Object.entries(g.status?.states ?? {})) if (kind === 'paid') out.push(`status "${state}"`);
  return out;
}

/**
 * Where a provider's definition sends this project's keys and its buyers, and what it counts as paid —
 * an INSTANCE ADMIN'S view.
 *
 * ★ "Prove it works" sends the project's test keys to the definition's API, and its success is what
 * lets the definition take live money for every project. A definition can be written by an agent, so
 * the person proving it has to see what they are approving — and agent-written text cannot vouch for
 * itself: a definition NAMED "Stripe" on other addresses is exactly the trick. So it is compared with
 * the built-in it was forked from (or shares a name with), and a difference is said in red.
 */
function GatewayDestinations({ definition, all }: { definition: Definition; all: ReadonlyMap<string, Definition> }) {
  const unproven = !definition.verified;
  // ★ Only what the PLATFORM ships is a reference — `shipped`, from the server's own built-in list. Not
  // the stored record at a built-in id (a proof rewrites it), and not whatever `forkedFrom` names (the
  // author sets that): either could be the very author whose definition is being checked.
  const shipped = [...all.values()].flatMap((g) => (g.shipped ? [{ id: g.id, ...g.shipped }] : []));
  const byId = (id: string | undefined) => shipped.find((r) => r.id === id);
  // A name borrowing a built-in's brand word ("Stripe EU" against "Stripe Checkout") is the lookalike.
  const words = (n: string) => n.trim().toLowerCase().split(/[\s\-_()]+/).filter(Boolean);
  const brand = (n: string) => words(n)[0] ?? '';
  const reference =
    byId(definition.id) ??
    byId(definition.forkedFrom) ??
    shipped.find((r) => brand(r.name).length >= 4 && words(definition.name).includes(brand(r.name)));
  const differs = reference !== undefined && addressesOf(reference) !== addressesOf(definition);
  const paid = paidSignals(definition);
  return (
    <div
      className={`rounded-md border p-2 text-[11px] ${
        unproven
          ? 'border-amber-200/70 dark:border-amber-500/20 bg-amber-50/60 dark:bg-amber-500/10 text-amber-900 dark:text-amber-200'
          : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300'
      }`}
    >
      {unproven && (
        <p className="mb-1 font-medium">
          Not proven yet: save TEST keys, then press Prove it works. It takes no live money until that succeeds.
        </p>
      )}
      <p>Check these are the provider&rsquo;s own addresses{unproven ? ' before you prove it' : ''}:</p>
      <ul className="mt-1 list-disc pl-4">
        <li>
          Test keys are sent to <code>{originOf(definition.apiBase.test)}</code>, live keys to <code>{originOf(definition.apiBase.live)}</code>.
        </li>
        <li>
          Buyers may be sent to <code>{definition.allowedOrigins.join(', ') || '—'}</code>.
        </li>
        <li>
          An order counts as paid on: <code>{paid.join(', ') || 'nothing'}</code>.
        </li>
      </ul>
      {differs && (
        <p role="alert" className="mt-1 font-medium text-red-700 dark:text-red-300">
          These addresses differ from {reference.name} ({reference.id}): <code>{addressesOf(reference)}</code>. Prove it only if you know why.
        </p>
      )}
      <p className="mt-1 text-slate-500 dark:text-slate-400">Shown to instance admins only.</p>
    </div>
  );
}
