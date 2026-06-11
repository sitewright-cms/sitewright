import { useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { api } from '../api';
import { PasskeysSection } from './PasskeysSection';
import { useToast } from './ui/Toast';
import { fieldLabel, ghostButton, glassCard, glassInput, primaryButton } from '../theme';

interface SecurityTabProps {
  /** Whether the signed-in user currently has a confirmed TOTP factor (from /me). */
  totpEnabled: boolean;
  /** Unused recovery codes remaining (from /me) — shown alongside the enabled state. */
  recoveryCodesRemaining: number;
  /** Called after enabling/disabling TOTP so the app can refresh its cached `totpEnabled`. */
  onChanged: () => void;
}

function errMsg(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Read-once panel listing fresh recovery codes with a copy-all action. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const toast = useToast();
  return (
    <div className="rounded-2xl border border-amber-300/70 bg-amber-50/80 p-4 shadow-lg shadow-amber-500/10">
      <p className="text-sm font-bold text-amber-900">Save these recovery codes — they won’t be shown again.</p>
      <p className="mt-0.5 text-xs text-amber-800">Each code works once if you lose your authenticator app.</p>
      <ul className="mt-3 grid grid-cols-2 gap-1.5" aria-label="Recovery codes">
        {codes.map((c) => (
          <li key={c} className="rounded-lg border border-amber-200/70 bg-white/80 px-3 py-1.5 text-center font-mono text-sm tracking-wide">{c}</li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className={ghostButton}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(codes.join('\n'));
              toast.show('Recovery codes copied', 'success');
            } catch {
              toast.show('Could not copy — select and copy manually', 'error');
            }
          }}
        >
          Copy all
        </button>
        <button type="button" className={primaryButton} onClick={onDone}>I’ve saved them</button>
      </div>
    </div>
  );
}

/**
 * The user menu's Security tab: enrol in TOTP two-factor (QR + confirm → recovery codes), and once
 * enabled, regenerate recovery codes or disable it (both password-confirmed). The TOTP secret never
 * touches the client beyond the one-time enrolment QR/string.
 */
export function SecurityTab({ totpEnabled, recoveryCodesRemaining, onChanged }: SecurityTabProps) {
  const toast = useToast();
  const [enrol, setEnrol] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [pwAction, setPwAction] = useState<'disable' | 'regenerate' | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Render the otpauth URI to a QR data-URL whenever a new enrolment starts.
  useEffect(() => {
    if (!enrol) {
      setQr('');
      return;
    }
    let active = true;
    QRCode.toDataURL(enrol.otpauthUri, { margin: 1, width: 196 })
      .then((url) => {
        if (active) setQr(url);
      })
      .catch(() => {
        /* fall back to the manual key */
      });
    return () => {
      active = false;
    };
  }, [enrol]);

  async function startSetup() {
    setError(null);
    setBusy(true);
    try {
      setEnrol(await api.mfaSetupTotp());
      setCode('');
    } catch (err) {
      setError(errMsg(err, 'could not start two-factor setup'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { recoveryCodes: codes } = await api.mfaConfirmTotp(code.trim());
      setEnrol(null);
      setCode('');
      setRecoveryCodes(codes);
      onChanged();
      toast.show('Two-factor authentication enabled', 'success');
    } catch (err) {
      setError(errMsg(err, 'that code is not valid'));
    } finally {
      setBusy(false);
    }
  }

  async function runPwAction(e: FormEvent) {
    e.preventDefault();
    if (!pwAction) return;
    setError(null);
    setBusy(true);
    try {
      if (pwAction === 'disable') {
        await api.mfaDisableTotp(password);
        onChanged();
        toast.show('Two-factor authentication disabled', 'success');
      } else {
        const { recoveryCodes: codes } = await api.mfaRegenerateRecoveryCodes(password);
        setRecoveryCodes(codes);
        toast.show('New recovery codes generated', 'success');
      }
      setPwAction(null);
      setPassword('');
    } catch (err) {
      setError(errMsg(err, 'something went wrong'));
    } finally {
      setBusy(false);
    }
  }

  // After showing one-time recovery codes, that panel owns the view until dismissed.
  if (recoveryCodes) {
    return (
      <div className={`${glassCard} p-5`}>
        <RecoveryCodes codes={recoveryCodes} onDone={() => setRecoveryCodes(null)} />
      </div>
    );
  }

  // Enrolment in progress: QR + manual key + confirm.
  if (enrol) {
    return (
      <form onSubmit={confirmSetup} className={`flex flex-col gap-4 ${glassCard} p-5`}>
        <div>
          <h3 className="text-sm font-bold text-slate-800">Set up your authenticator app</h3>
          <p className="mt-0.5 text-xs text-slate-500">Scan the QR code (or enter the key), then type the 6-digit code to confirm.</p>
        </div>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          {qr ? (
            <img src={qr} alt="TOTP QR code" className="h-44 w-44 rounded-lg border border-white/60 bg-white p-1" />
          ) : (
            <div className="flex h-44 w-44 items-center justify-center rounded-lg border border-white/60 bg-white/60 text-xs text-slate-400">Generating…</div>
          )}
          <div className="min-w-0 flex-1">
            <label className={fieldLabel}>Manual key</label>
            <code className="block break-all rounded-lg border border-white/60 bg-white/70 px-3 py-2 text-xs" aria-label="TOTP secret key">{enrol.secret}</code>
            <label className={`${fieldLabel} mt-3`} htmlFor="totp-confirm-code">Code from app</label>
            <input
              id="totp-confirm-code"
              aria-label="Authentication code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              className={glassInput}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </div>
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" className={primaryButton} disabled={busy || code.trim().length === 0}>
            {busy ? 'Confirming…' : 'Enable two-factor'}
          </button>
          <button type="button" className={ghostButton} onClick={() => { setEnrol(null); setError(null); }}>Cancel</button>
        </div>
      </form>
    );
  }

  // Password-confirm step for disable / regenerate.
  if (pwAction) {
    return (
      <form onSubmit={runPwAction} className={`flex flex-col gap-4 ${glassCard} p-5`}>
        <div>
          <h3 className="text-sm font-bold text-slate-800">{pwAction === 'disable' ? 'Disable two-factor' : 'Regenerate recovery codes'}</h3>
          <p className="mt-0.5 text-xs text-slate-500">Confirm your password to continue.</p>
        </div>
        <div>
          <label className={fieldLabel} htmlFor="mfa-pw">Current password</label>
          <input id="mfa-pw" aria-label="Current password" type="password" autoComplete="current-password" className={glassInput} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" className={primaryButton} disabled={busy || password.length === 0}>
            {pwAction === 'disable' ? 'Disable' : 'Regenerate codes'}
          </button>
          <button type="button" className={ghostButton} onClick={() => { setPwAction(null); setPassword(''); setError(null); }}>Cancel</button>
        </div>
      </form>
    );
  }

  // Resting state: the TOTP card (enrol CTA or enabled controls) + the passkeys section.
  return (
    <div className="flex flex-col gap-4">
      <div className={`flex flex-col gap-4 ${glassCard} p-5`}>
        <div>
          <h3 className="text-sm font-bold text-slate-800">Two-factor authentication</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            {totpEnabled
              ? 'Your account is protected by an authenticator app. You’ll enter a code when you sign in.'
              : 'Add a second step at sign-in with an authenticator app (TOTP) like 1Password, Authy, or Google Authenticator.'}
          </p>
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {totpEnabled ? (
          <>
            <p className={`text-xs ${recoveryCodesRemaining <= 3 ? 'text-amber-600' : 'text-slate-500'}`}>
              {recoveryCodesRemaining === 0
                ? 'No recovery codes left — regenerate a set so you can still get in if you lose your authenticator.'
                : `${recoveryCodesRemaining} recovery ${recoveryCodesRemaining === 1 ? 'code' : 'codes'} remaining${recoveryCodesRemaining <= 3 ? ' — consider regenerating.' : '.'}`}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={ghostButton} onClick={() => { setPwAction('regenerate'); setError(null); }}>Regenerate recovery codes</button>
              <button type="button" className={ghostButton} onClick={() => { setPwAction('disable'); setError(null); }}>Disable two-factor</button>
            </div>
          </>
        ) : (
          <div>
            <button type="button" className={primaryButton} onClick={startSetup} disabled={busy}>
              {busy ? 'Starting…' : 'Set up two-factor'}
            </button>
          </div>
        )}
      </div>
      <PasskeysSection />
    </div>
  );
}
