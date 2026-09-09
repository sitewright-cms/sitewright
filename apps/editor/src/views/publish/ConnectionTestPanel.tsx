import { useState } from 'react';
import { Check, X, Minus, ShieldCheck, ShieldAlert, ShieldOff, Lock } from 'lucide-react';
import type { DeploySecurity, DeployTestResult, DeployTestStep, OfferedCertificate } from '../../api';
import { ghostButton } from '../../theme';

/**
 * The result of a deploy-target connection test.
 *
 * ★ Reports the STEPS, not just a verdict. "It didn't work" is what the deploy already said; which
 * step it got to is the diagnosis — connected-but-not-signed-in is a password, signed-in-but-not-
 * written is a permission, and a TLS step that failed with a certificate attached is the shared-
 * hosting case that this panel can actually resolve, by offering to pin what the server presented.
 */

/** Plain-language label for how the connection ended up protected. */
function securityLabel(security: DeploySecurity | undefined): { text: string; tone: 'good' | 'warn' | 'bad'; Icon: typeof ShieldCheck } {
  switch (security) {
    case 'ssh':
      return { text: 'Encrypted over SSH', tone: 'good', Icon: ShieldCheck };
    case 'https':
      return { text: 'Encrypted over HTTPS', tone: 'good', Icon: ShieldCheck };
    case 'explicit':
      return { text: 'Encrypted — explicit TLS (AUTH TLS)', tone: 'good', Icon: ShieldCheck };
    case 'implicit':
      return { text: 'Encrypted — implicit TLS', tone: 'good', Icon: ShieldCheck };
    case 'opportunistic':
      // Worth its own tone: encrypted against a passive observer, but the certificate was not checked,
      // so it is not protection against an active one. Saying "encrypted" flat would overstate it.
      return { text: 'Encrypted opportunistically — certificate not verified', tone: 'warn', Icon: ShieldAlert };
    default:
      return { text: 'NOT encrypted — the password and every file crossed the network in clear text', tone: 'bad', Icon: ShieldOff };
  }
}

const TONE = {
  good: 'text-emerald-700 dark:text-emerald-300',
  warn: 'text-amber-700 dark:text-amber-300',
  bad: 'text-red-700 dark:text-red-300',
} as const;

function StepRow({ step }: { step: DeployTestStep }) {
  const Icon = step.status === 'ok' ? Check : step.status === 'failed' ? X : Minus;
  const tone = step.status === 'ok' ? TONE.good : step.status === 'failed' ? TONE.bad : 'text-slate-400 dark:text-slate-500';
  return (
    <li className="flex items-start gap-2 py-0.5">
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone}`} aria-hidden />
      <span className="min-w-0">
        <span className={`text-xs ${step.status === 'failed' ? 'font-bold' : ''} text-slate-700 dark:text-slate-200`}>{step.label}</span>
        {step.detail && <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">— {step.detail}</span>}
        {step.ms !== undefined && step.ms > 250 && <span className="ml-1 text-[11px] text-slate-400">({(step.ms / 1000).toFixed(1)}s)</span>}
      </span>
    </li>
  );
}

/** The certificate a server offered, with everything needed to decide whether to trust it.
 *  Exported because a FAILED DEPLOY has to offer the same review-and-pin as a failed test — a
 *  certificate that rotated is discovered by whichever of the two the operator reaches first. */
export function CertificateCard({
  cert,
  onPin,
  pinned,
}: {
  cert: OfferedCertificate;
  onPin?: (fingerprint: string) => void;
  pinned: boolean;
}) {
  const row = (label: string, value: string) => (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="min-w-0 break-all text-slate-700 dark:text-slate-200">{value || '—'}</dd>
    </div>
  );
  return (
    <div className="mt-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-slate-900/40 p-2">
      <p className="mb-1 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
        <Lock className="h-3.5 w-3.5" aria-hidden /> Certificate this server presented
      </p>
      <dl className="space-y-0.5 text-[11px]">
        {row('Issued to', cert.subject)}
        {row('Issued by', cert.issuer)}
        {row('Valid', `${cert.validFrom} → ${cert.validTo}${cert.expired ? '  (EXPIRED)' : ''}`)}
        {cert.altNames.length > 0 && row('Valid for', cert.altNames.join(', '))}
        {row('SHA-256', cert.fingerprint256)}
      </dl>
      {(cert.expired || cert.selfSigned) && (
        <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
          {cert.expired && 'This certificate is outside its validity window. '}
          {cert.selfSigned && 'It is self-signed (its own issuer).'}
        </p>
      )}
      {onPin && (
        <div className="mt-2 flex items-center gap-2">
          <button type="button" className={`${ghostButton} px-2 py-1 text-xs`} disabled={pinned} onClick={() => onPin(cert.fingerprint256)}>
            {pinned ? 'Pinned — save the target to apply' : 'Trust this certificate'}
          </button>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Accepts exactly this certificate for this target. If it ever changes, the deploy stops and asks again.
          </span>
        </div>
      )}
    </div>
  );
}

export function ConnectionTestPanel({
  result,
  onPin,
  pinnedFingerprint,
}: {
  result: DeployTestResult;
  /** Offered only where pinning is meaningful (FTPS). Omit to show the certificate read-only. */
  onPin?: (fingerprint: string) => void;
  pinnedFingerprint?: string;
}) {
  const [showTranscript, setShowTranscript] = useState(false);
  const security = securityLabel(result.security);
  // The certificate to show: the one that FAILED verification, or the one in use on a good connection.
  const cert = result.offeredCertificate ?? result.failure?.certificate ?? result.tls?.certificate;
  const canPin = !!onPin && !!cert && cert.fingerprint256 !== pinnedFingerprint;

  return (
    <div
      role="status"
      className={`rounded-lg border p-3 ${
        result.ok
          ? 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10'
          : 'border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/10'
      }`}
    >
      <p className={`text-sm font-bold ${result.ok ? TONE.good : TONE.bad}`}>
        {result.ok ? `Connection OK — ${result.host}:${result.port}` : (result.failure?.message ?? 'The connection failed.')}
      </p>

      {result.ok && (
        <p className={`mt-1 flex items-center gap-1.5 text-xs font-medium ${TONE[security.tone]}`}>
          <security.Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {security.text}
        </p>
      )}

      {/* The server offers encryption and this target is not using it — actionable, so say it. */}
      {result.ok && result.security === 'none' && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
          Switch this target to FTPS if your host supports it, or use SFTP.
        </p>
      )}

      <ul className="mt-2">
        {result.steps.map((s, i) => (
          <StepRow key={`${s.key}-${i}`} step={s} />
        ))}
      </ul>

      {result.failure?.hint && <p className="mt-2 text-xs text-slate-700 dark:text-slate-200">{result.failure.hint}</p>}

      {result.failure?.detail && (
        <p className="mt-2 break-all rounded bg-white/70 dark:bg-slate-900/50 px-2 py-1 font-mono text-[11px] text-slate-600 dark:text-slate-300">
          {result.failure.detail}
        </p>
      )}

      {cert && (
        // `canPin` already encodes that a pin handler exists and that this is not the pinned cert.
        <CertificateCard cert={cert} {...(canPin ? { onPin } : {})} pinned={!!pinnedFingerprint && cert.fingerprint256 === pinnedFingerprint} />
      )}

      {result.hostKeyLine && (
        <div className="mt-2">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Host key this server presented — paste it into “Host key” to pin it:
          </p>
          <pre className="mt-1 max-h-24 overflow-auto rounded bg-slate-900 p-2 font-mono text-[11px] break-all whitespace-pre-wrap text-slate-200">
            {result.hostKeyLine}
          </pre>
        </div>
      )}

      {result.hostKeyFingerprint && (
        <p className="mt-2 break-all text-[11px] text-slate-500 dark:text-slate-400">
          SSH host key (SHA-256): <span className="font-mono">{result.hostKeyFingerprint}</span>
        </p>
      )}

      {result.transcript && result.transcript.length > 0 && (
        <div className="mt-2">
          <button type="button" className={`${ghostButton} px-2 py-1 text-xs`} onClick={() => setShowTranscript((v) => !v)}>
            {showTranscript ? 'Hide' : 'Show'} server conversation ({result.transcript.length} lines)
          </button>
          {showTranscript && (
            // The raw control channel — the artefact that answers "why did it drop?" when nothing else
            // does, because the server's refusal is a reply line no other layer preserves. Passwords
            // are redacted server-side before this is ever sent.
            <pre className="mt-1 max-h-56 overflow-auto rounded bg-slate-900 p-2 font-mono text-[11px] leading-relaxed text-slate-200">
              {result.transcript.join('\n')}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
