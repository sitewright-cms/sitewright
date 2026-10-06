import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, Loader2 } from 'lucide-react';
import type { CredentialField, PaymentBindingPublic, PaymentGatewayPublic } from '@sitewright/schema';
import { Modal } from '../ui/Modal';
import { SubLabel } from './ui';
import { api } from '../../api';
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
 */
export function PaymentCredentialsModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [gateways, setGateways] = useState<PaymentGatewayPublic[]>([]);
  const [binding, setBinding] = useState<PaymentBindingPublic | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [gatewayId, setGatewayId] = useState('');
  const [mode, setMode] = useState<'test' | 'live'>('test');
  /** Only what the operator actually typed this session — an untouched field is never sent. */
  const [edits, setEdits] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [g, b] = await Promise.all([
        api.projectPaymentGateways(projectId).catch(() => ({ gateways: [] })),
        api.getProjectPayment(projectId).catch(() => ({ binding: null, webhookUrl: '' })),
      ]);
      if (!live) return;
      setGateways(g.gateways);
      setBinding(b.binding);
      setWebhookUrl(b.webhookUrl ?? '');
      if (b.binding) {
        setGatewayId(b.binding.gatewayId);
        setMode(b.binding.mode);
      } else if (g.gateways[0]) {
        setGatewayId(g.gateways[0].id);
      }
    })();
    return () => {
      live = false;
    };
  }, [projectId]);

  const gateway = gateways.find((g) => g.id === gatewayId);
  const fields: CredentialField[] = gateway?.credentialFields ?? [];
  const stored = binding?.gatewayId === gatewayId ? binding.fields[mode] : undefined;
  const has = (key: string): boolean => stored?.find((f) => f.key === key)?.hasValue === true;
  const hint = (key: string): string | undefined => stored?.find((f) => f.key === key)?.display;

  const save = async (): Promise<void> => {
    setBusy(true);
    setError([]);
    setSaved(false);
    try {
      const res = await api.putProjectPayment(projectId, { gatewayId, mode, values: edits });
      setBinding(res.binding);
      setEdits({});
      setSaved(true);
    } catch (e) {
      const details = (e as { details?: unknown }).details;
      setError(Array.isArray(details) ? (details as string[]) : [(e as Error).message]);
    } finally {
      setBusy(false);
    }
  };

  const goLive = async (): Promise<void> => {
    setBusy(true);
    setError([]);
    try {
      await api.putProjectPaymentMode(projectId, mode === 'live' ? 'test' : 'live');
      const b = await api.getProjectPayment(projectId);
      setBinding(b.binding);
      if (b.binding) setMode(b.binding.mode);
    } catch (e) {
      const missing = (e as { details?: { missing?: string[] } }).details?.missing;
      setError(missing?.length ? [`Fill in the live values first: ${missing.join(', ')}`] : [(e as Error).message]);
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
                <span className={fieldLabel}>Gateway</span>
                <select className={glassInput} value={gatewayId} onChange={(e) => { setGatewayId(e.target.value); setEdits({}); }}>
                  {gateways.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
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
              <span className="text-xs text-slate-500 dark:text-slate-400">
                This project is currently in <strong>{activeMode}</strong> mode.
              </span>
            </div>

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
