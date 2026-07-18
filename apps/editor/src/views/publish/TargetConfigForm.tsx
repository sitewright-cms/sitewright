import { useState } from 'react';
import {
  api,
  type Project,
  type DeployTargetView,
  type DeployConfig,
  type GitTargetConfig,
  type LocalTargetConfig,
  type UpdateDeployTargetConfig,
} from '../../api';
import { Field, TextArea } from '../settings/ui';
import { toggleInput, primaryButton, ghostButton, fieldLabel } from '../../theme';

/** The wizard protocols. `ftp` covers the FTP/FTPS family (a TLS toggle picks plain vs FTPS). */
export type WizardProtocol = 'local' | 'ftp' | 'ftps' | 'sftp' | 'git';

const TITLES = new Map<WizardProtocol, string>([
  ['local', 'Local Hosting'],
  ['ftp', 'FTP / FTPS Upload'],
  ['ftps', 'FTP / FTPS Upload'],
  ['sftp', 'SSH / SFTP Upload'],
  ['git', 'Git Deploy'],
]);

const DEFAULT_NAMES = new Map<WizardProtocol, string>([
  ['local', 'Local Hosting'],
  ['ftp', 'FTP server'],
  ['ftps', 'FTPS server'],
  ['sftp', 'SFTP server'],
  ['git', 'Git repository'],
]);
const titleFor = (p: WizardProtocol): string => TITLES.get(p) ?? 'Deploy target';
const defaultNameFor = (p: WizardProtocol): string => DEFAULT_NAMES.get(p) ?? 'Deploy target';

/** A url-safe preview token (≈24 chars, within the schema's 16–64 bound). */
function genToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A boolean switch row (DaisyUI toggle) with a label + optional hint. */
function Toggle({ label, checked, onChange, hint, disabled = false }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-2 py-1">
      <input type="checkbox" className={toggleInput} checked={checked} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm text-slate-700">{label}</span>
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

/**
 * Step 2 of the deploy-target wizard: the protocol-specific configuration form, for CREATE (no
 * `editing`) or EDIT (prefilled, protocol locked, credentials blank = "keep the stored secret").
 */
export function TargetConfigForm({
  project,
  protocol,
  editing,
  onCancel,
  onSaved,
}: {
  project: Project;
  protocol: WizardProtocol;
  editing: DeployTargetView | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!editing;
  const isFtpFamily = protocol === 'ftp' || protocol === 'ftps';

  const [name, setName] = useState(editing?.name ?? defaultNameFor(protocol));
  const [minify, setMinify] = useState(!!editing?.minifyHtml);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // FTP family — a TLS toggle selects ftp vs ftps (locked on edit; protocol is immutable).
  const [tls, setTls] = useState(protocol === 'ftps');
  // Remote transport (ftp/ftps/sftp) shared fields.
  const [host, setHost] = useState(editing?.host ?? '');
  const [port, setPort] = useState(editing?.port ? String(editing.port) : '');
  const [user, setUser] = useState(editing?.user ?? '');
  const [password, setPassword] = useState('');
  const [remoteDir, setRemoteDir] = useState(editing?.remoteDir ?? '/');
  // SFTP key auth.
  const [sftpAuth, setSftpAuth] = useState<'password' | 'key'>('password');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [fingerprint, setFingerprint] = useState(editing?.hostFingerprint ?? '');
  // SFTP-only: rsync-over-SSH transfer (delta + compression) for servers that permit it.
  const [useRsync, setUseRsync] = useState(!!editing?.useRsync);
  // git
  const [repoUrl, setRepoUrl] = useState(editing?.repoUrl ?? '');
  const [branch, setBranch] = useState(editing?.branch ?? 'gh-pages');
  const [gitAuth, setGitAuth] = useState<'token' | 'key'>(editing?.repoUrl && !/^https?:\/\//i.test(editing.repoUrl) ? 'key' : 'token');
  const [gitToken, setGitToken] = useState('');
  // local
  const [unlisted, setUnlisted] = useState(!!editing?.previewToken);
  const [previewToken, setPreviewToken] = useState(editing?.previewToken ?? '');

  const keepHint = isEdit ? 'leave blank to keep the current value' : undefined;

  // Keep the git auth method in lock-step with the URL the user types: an http(s) remote uses a token,
  // an ssh remote (ssh:// or git@host:path) uses a key. Avoids a mismatched credential vs the URL (the
  // server enforces the same rule and would 400 otherwise).
  function onRepoUrlChange(v: string) {
    setRepoUrl(v);
    const t = v.trim();
    if (/^https?:\/\//i.test(t)) setGitAuth('token');
    else if (/^ssh:\/\//i.test(t) || /^[^@\s]+@[^:\s]+:/.test(t)) setGitAuth('key');
  }

  async function submit() {
    if (!name.trim()) {
      setError('Give this target a name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await save();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the target.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const portNum = port.trim() ? Number(port) : undefined;
    if (portNum !== undefined && (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535)) {
      throw new Error('Port must be a whole number between 1 and 65535.');
    }

    // ── Local Hosting ──
    if (protocol === 'local') {
      if (isEdit) {
        const body: UpdateDeployTargetConfig = {
          name: name.trim(),
          minifyHtml: minify,
          ...(unlisted ? (previewToken ? { previewToken } : {}) : { clearPreviewToken: true }),
        };
        await api.updateDeployTarget(project.id, editing!.id, body);
        return;
      }
      const cfg: LocalTargetConfig & { name: string } = {
        name: name.trim(),
        protocol: 'local',
        ...(unlisted && previewToken ? { previewToken } : {}),
        ...(minify ? { minifyHtml: true } : {}),
      };
      await api.createDeployTarget(project.id, cfg);
      return;
    }

    // ── git ──
    if (protocol === 'git') {
      if (!repoUrl.trim() || !branch.trim()) throw new Error('Repository URL and branch are required.');
      if (isEdit) {
        const body: UpdateDeployTargetConfig = {
          name: name.trim(),
          repoUrl: repoUrl.trim(),
          branch: branch.trim(),
          minifyHtml: minify,
          ...(gitAuth === 'token' && gitToken.trim() ? { token: gitToken.trim() } : {}),
          ...(gitAuth === 'key' && privateKey.trim() ? { privateKey: privateKey.trim(), ...(passphrase ? { passphrase } : {}) } : {}),
          ...(gitAuth === 'key' && fingerprint.trim() ? { hostFingerprint: fingerprint.trim() } : {}),
        };
        await api.updateDeployTarget(project.id, editing!.id, body);
        return;
      }
      if (gitAuth === 'token' && !gitToken.trim()) throw new Error('An access token is required for an HTTPS remote.');
      if (gitAuth === 'key' && !privateKey.trim()) throw new Error('Paste your SSH private key (an SSH remote uses key auth).');
      const base = { name: name.trim(), protocol: 'git' as const, repoUrl: repoUrl.trim(), branch: branch.trim(), ...(minify ? { minifyHtml: true } : {}) };
      const cfg: GitTargetConfig & { name: string } =
        gitAuth === 'token'
          ? { ...base, token: gitToken.trim() }
          : { ...base, privateKey: privateKey.trim(), ...(passphrase ? { passphrase } : {}), ...(fingerprint.trim() ? { hostFingerprint: fingerprint.trim() } : {}) };
      await api.createDeployTarget(project.id, cfg);
      return;
    }

    // ── FTP / FTPS / SFTP ──
    if (!host.trim() || !user.trim()) throw new Error('Host and user are required.');
    const useKey = protocol === 'sftp' && sftpAuth === 'key';
    if (isEdit) {
      const body: UpdateDeployTargetConfig = {
        name: name.trim(),
        host: host.trim(),
        user: user.trim(),
        remoteDir: remoteDir || '/',
        minifyHtml: minify,
        ...(portNum !== undefined ? { port: portNum } : {}),
        ...(protocol === 'sftp' && fingerprint.trim() ? { hostFingerprint: fingerprint.trim() } : {}),
        ...(protocol === 'sftp' ? { useRsync } : {}),
        ...(useKey && privateKey.trim() ? { privateKey: privateKey.trim(), ...(passphrase ? { passphrase } : {}) } : {}),
        ...(!useKey && password ? { password } : {}),
      };
      await api.updateDeployTarget(project.id, editing!.id, body);
      return;
    }
    if (useKey ? !privateKey.trim() : !password) {
      throw new Error(useKey ? 'Paste your SSH private key, or switch to password auth.' : 'A password is required.');
    }
    const effectiveProtocol: DeployConfig['protocol'] = isFtpFamily ? (tls ? 'ftps' : 'ftp') : 'sftp';
    const cfg: DeployConfig & { name: string } = {
      name: name.trim(),
      protocol: effectiveProtocol,
      host: host.trim(),
      user: user.trim(),
      ...(useKey ? { privateKey: privateKey.trim(), ...(passphrase ? { passphrase } : {}) } : { password }),
      remoteDir: remoteDir || '/',
      ...(portNum !== undefined ? { port: portNum } : {}),
      ...(protocol === 'sftp' && fingerprint.trim() ? { hostFingerprint: fingerprint.trim() } : {}),
      ...(protocol === 'sftp' && useRsync ? { useRsync: true } : {}),
      ...(minify ? { minifyHtml: true } : {}),
    };
    await api.createDeployTarget(project.id, cfg);
  }

  const siteUrl = `${window.location.origin}/sites/${project.slug}/`;

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-center gap-2">
        <button type="button" className={`${ghostButton} px-2 py-1 text-xs`} onClick={onCancel} aria-label="Back">
          ← Back
        </button>
        <h4 className="text-sm font-bold text-slate-800">
          {isEdit ? 'Edit' : 'Configure'} {titleFor(protocol)}
        </h4>
      </header>

      <Field label="Name" value={name} onChange={setName} placeholder={defaultNameFor(protocol)} required />

      {protocol === 'local' && (
        <>
          <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
            Serves the built site on this platform at <code className="rounded bg-white px-1">{siteUrl}</code>
            {' '}(and at <code className="rounded bg-white px-1">{project.slug}.&lt;your sites domain&gt;</code> when subdomain hosting is enabled). Publish from the header to update it.
          </p>
          <Toggle label="Require a secret link (unlisted)" checked={unlisted} hint="hides the site behind a ?token= link" onChange={(v) => { setUnlisted(v); if (v && !previewToken) setPreviewToken(genToken()); }} />
          {unlisted && previewToken && (
            <p className="break-all rounded-lg bg-slate-50 p-2 text-xs text-slate-500">
              Unlisted link: <code className="rounded bg-white px-1">{siteUrl}?token={previewToken}</code>
            </p>
          )}
        </>
      )}

      {isFtpFamily && (
        <>
          <Toggle label="Use TLS (FTPS)" checked={isEdit ? protocol === 'ftps' : tls} disabled={isEdit} hint={isEdit ? 'protocol is fixed once created' : 'encrypted FTP over TLS'} onChange={setTls} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Host" value={host} onChange={setHost} required />
            <Field label="Port" value={port} onChange={setPort} type="number" placeholder="auto" />
            <Field label="User" value={user} onChange={setUser} required />
            <Field label={`Password${isEdit ? ' (keep blank to keep)' : ''}`} value={password} onChange={setPassword} type="password" />
          </div>
          <Field label="Remote directory" value={remoteDir} onChange={setRemoteDir} placeholder="/" />
        </>
      )}

      {protocol === 'sftp' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Host" value={host} onChange={setHost} required />
            <Field label="Port" value={port} onChange={setPort} type="number" placeholder="22" />
            <Field label="User" value={user} onChange={setUser} required />
            <label className="block">
              <span className={fieldLabel}>Authentication</span>
              <select aria-label="SFTP auth method" className="sw-brand-focus w-full rounded-lg border border-white/60 bg-white/70 px-3 py-2 text-sm text-slate-800 shadow-sm outline-none" value={sftpAuth} onChange={(e) => setSftpAuth(e.target.value as 'password' | 'key')}>
                <option value="password">Password</option>
                <option value="key">Private key</option>
              </select>
            </label>
          </div>
          {sftpAuth === 'password' ? (
            <Field label={`Password${isEdit ? ' (keep blank to keep)' : ''}`} value={password} onChange={setPassword} type="password" />
          ) : (
            <>
              <TextArea label={`Private key (PEM / OpenSSH)${isEdit ? ' — keep blank to keep' : ''}`} value={privateKey} onChange={setPrivateKey} rows={4} mono placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
              <Field label="Key passphrase (optional)" value={passphrase} onChange={setPassphrase} type="password" placeholder="leave blank if the key is unencrypted" />
            </>
          )}
          <Field label="Remote directory" value={remoteDir} onChange={setRemoteDir} placeholder="/" />
          <Field label="Host fingerprint (SHA-256, optional)" value={fingerprint} onChange={setFingerprint} placeholder="leave blank to trust on first use" />
          <Toggle
            label="Transfer with rsync"
            checked={useRsync}
            onChange={setUseRsync}
            hint="Delta + compression over SSH in one connection — much faster for large or repeat deploys. Enable only if your SFTP server permits rsync. Prunes remote files not in the build."
          />
        </>
      )}

      {protocol === 'git' && (
        <>
          <label className="block">
            <span className={fieldLabel}>Authentication</span>
            <select aria-label="Git auth method" className="sw-brand-focus w-full rounded-lg border border-white/60 bg-white/70 px-3 py-2 text-sm text-slate-800 shadow-sm outline-none" value={gitAuth} onChange={(e) => setGitAuth(e.target.value as 'token' | 'key')}>
              <option value="token">Token (HTTPS)</option>
              <option value="key">SSH key</option>
            </select>
          </label>
          <Field label="Repository URL" value={repoUrl} onChange={onRepoUrlChange} placeholder={gitAuth === 'key' ? 'git@github.com:you/repo.git' : 'https://github.com/you/repo.git'} required />
          <Field label="Branch" value={branch} onChange={setBranch} placeholder="gh-pages" required />
          {gitAuth === 'token' ? (
            <Field label={`Access token${isEdit ? ' (keep blank to keep)' : ''}`} value={gitToken} onChange={setGitToken} type="password" placeholder="ghp_… (HTTPS token)" />
          ) : (
            <>
              <TextArea label={`SSH private key${isEdit ? ' — keep blank to keep' : ''}`} value={privateKey} onChange={setPrivateKey} rows={4} mono placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
              <Field label="Key passphrase (optional)" value={passphrase} onChange={setPassphrase} type="password" placeholder="leave blank if unencrypted" />
              <Field label="Host key (optional)" value={fingerprint} onChange={setFingerprint} placeholder="github.com ssh-ed25519 AAAA… — blank to trust on first use" />
            </>
          )}
        </>
      )}

      <Toggle label="Minify HTML" checked={minify} hint="collapse whitespace + drop comments at build" onChange={setMinify} />

      {keepHint && <p className="text-[11px] text-slate-400">Credential fields are blank — {keepHint} (the stored secret is never shown).</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-2 pt-1">
        <button type="button" className={primaryButton} disabled={busy} onClick={submit}>
          {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Save target'}
        </button>
        <button type="button" className={ghostButton} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
