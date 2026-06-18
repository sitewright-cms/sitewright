import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { api, type DeployConfig, type DeployTargetView, type Project } from '../../api';
import { useDialogs } from '../ui/Dialogs';
import { glassInput, primaryButton, ghostButton, dangerButton } from '../../theme';
import { DeployModal } from './DeployModal';

/** The transports the form can configure — `git` commits the built site to a branch of a repo. */
type FormProtocol = 'ftp' | 'ftps' | 'sftp' | 'git';
const PROTOCOLS: ReadonlyArray<{ value: FormProtocol; label: string }> = [
  { value: 'ftp', label: 'FTP' },
  { value: 'ftps', label: 'FTPS' },
  { value: 'sftp', label: 'SFTP' },
  { value: 'git', label: 'Git (push to a branch)' },
];

/** Configure an external deploy target: FTP/FTPS/SFTP (ad-hoc or saved) or a git push (saved). */
export function DeployForm({ project }: { project: Project }) {
  const [protocol, setProtocol] = useState<FormProtocol>('sftp');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [authMethod, setAuthMethod] = useState<'password' | 'key'>('password');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [remoteDir, setRemoteDir] = useState('/');
  const [fingerprint, setFingerprint] = useState('');
  // git fields
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('gh-pages');
  const [gitToken, setGitToken] = useState('');
  const [gitAuth, setGitAuth] = useState<'token' | 'key'>('token'); // token = https remote, key = ssh remote
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targets, setTargets] = useState<DeployTargetView[] | null>(null); // null = feature unavailable
  const [deploying, setDeploying] = useState<DeployTargetView | null>(null); // → the streaming DeployModal
  const { confirm, dialog } = useDialogs();
  // SFTP key auth is only offered for SFTP; FTP/FTPS are password-only.
  const useKey = protocol === 'sftp' && authMethod === 'key';
  const isGit = protocol === 'git';

  async function loadTargets() {
    try {
      const res = await api.listDeployTargets(project.id);
      setTargets(res.items);
    } catch {
      setTargets(null); // saved targets disabled (no encryption key configured)
    }
  }
  useEffect(() => {
    let active = true;
    api
      .listDeployTargets(project.id)
      .then((res) => {
        if (active) setTargets(res.items);
      })
      .catch(() => {
        if (active) setTargets(null);
      });
    return () => {
      active = false;
    };
  }, [project.id]);

  function buildConfig(): DeployConfig | null {
    let portNum: number | undefined;
    if (port.trim() !== '') {
      portNum = Number(port);
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        setError('Port must be a whole number between 1 and 65535');
        return null;
      }
    }
    if (useKey && !privateKey.trim()) {
      setError('Paste your SSH private key, or switch to password auth');
      return null;
    }
    return {
      protocol: protocol as DeployConfig['protocol'], // buildConfig is only called for FTP/FTPS/SFTP
      host,
      user,
      // Either password auth, or SFTP private-key auth (key contents + optional passphrase).
      ...(useKey ? { privateKey: privateKey.trim() } : { password }),
      ...(useKey && passphrase ? { passphrase } : {}),
      remoteDir: remoteDir || '/',
      ...(portNum !== undefined ? { port: portNum } : {}),
      ...(protocol === 'sftp' && fingerprint.trim() ? { hostFingerprint: fingerprint.trim() } : {}),
    };
  }

  async function run<T>(fn: () => Promise<T>, onOk: (r: T) => void) {
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      onOk(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed');
    } finally {
      setBusy(false);
    }
  }

  async function deployNow(e: FormEvent) {
    e.preventDefault();
    if (isGit) return; // git has no ad-hoc deploy — it is saved, then deployed from the header
    const config = buildConfig();
    if (!config) return;
    await run(
      () => api.deploy(project.id, config),
      (r) => setResult(`Deployed ${r.deployed.files} files via ${r.deployed.protocol.toUpperCase()}.`),
    );
  }

  async function saveTarget() {
    if (!name.trim()) {
      setError('Give the target a name to save it');
      return;
    }
    if (isGit) {
      if (!repoUrl.trim() || !branch.trim()) {
        setError('Repository URL and branch are required for a git target');
        return;
      }
      const onSaved = () => {
        setResult('Git target saved — deploy it from the header.');
        setName('');
        setGitToken('');
        setPrivateKey('');
        setPassphrase('');
        setFingerprint('');
        void loadTargets();
      };
      if (gitAuth === 'key') {
        if (!privateKey.trim()) {
          setError('Paste your SSH private key (an ssh remote uses key auth)');
          return;
        }
        await run(
          () =>
            api.createDeployTarget(project.id, {
              name: name.trim(),
              protocol: 'git',
              repoUrl: repoUrl.trim(),
              branch: branch.trim(),
              privateKey: privateKey.trim(),
              ...(passphrase ? { passphrase } : {}),
              ...(fingerprint.trim() ? { hostFingerprint: fingerprint.trim() } : {}),
            }),
          onSaved,
        );
        return;
      }
      if (!gitToken.trim()) {
        setError('An access token is required for an https remote');
        return;
      }
      await run(
        () =>
          api.createDeployTarget(project.id, {
            name: name.trim(),
            protocol: 'git',
            repoUrl: repoUrl.trim(),
            branch: branch.trim(),
            token: gitToken.trim(),
          }),
        onSaved,
      );
      return;
    }
    const config = buildConfig();
    if (!config) return;
    await run(
      () => api.createDeployTarget(project.id, { ...config, name: name.trim() }),
      () => {
        setResult('Target saved.');
        setName('');
        void loadTargets();
      },
    );
  }

  const field = `mt-1 ${glassInput}`;

  return (
    <div className="mt-3 border-t border-white/40 pt-3">
      {targets && targets.length > 0 && (
        <div className="mb-3">
          <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">Saved targets</h4>
          <ul className="flex flex-col gap-1">
            {targets.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-sm">
                <span className="font-medium text-slate-800">{t.name}</span>
                <span className="text-xs text-slate-400">
                  {t.protocol === 'local' ? 'Local Hosting' : t.protocol === 'git' ? `Git · ${t.branch ?? ''}` : `${t.protocol.toUpperCase()}@${t.host ?? ''}`}
                </span>
                {/* A `local` target is published via the header's Publish action, not the deploy transport. */}
                {t.protocol !== 'local' && (
                  <button
                    className={`ml-auto ${ghostButton} px-2 py-0.5 text-xs`}
                    disabled={busy}
                    aria-label={`Deploy to ${t.name}`}
                    onClick={() => setDeploying(t)}
                  >
                    Deploy
                  </button>
                )}
                <button
                  className={`${t.protocol === 'local' ? 'ml-auto ' : ''}${dangerButton} px-1.5 py-0.5 text-xs`}
                  aria-label={`Delete target ${t.name}`}
                  onClick={async () => {
                    const where =
                      t.protocol === 'local' ? 'Local Hosting' : t.protocol === 'git' ? `Git · ${t.branch ?? ''}` : `${t.protocol.toUpperCase()}@${t.host ?? ''}`;
                    const ok = await confirm({
                      title: 'Delete deploy target',
                      message: `Delete the saved deploy target "${t.name}" (${where})? This cannot be undone.`,
                      confirmLabel: 'Delete',
                    });
                    if (!ok) return;
                    void run(
                      () => api.deleteDeployTarget(project.id, t.id),
                      () => void loadTargets(),
                    );
                  }}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={deployNow} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-xs text-slate-500">
            Protocol
            <select
              aria-label="Deploy protocol"
              className={field}
              value={protocol}
              onChange={(e) => {
                setProtocol(e.target.value as FormProtocol);
                // The key/passphrase/host-key fields are shared with SFTP — clear them on a protocol
                // switch so a value typed for one transport can't be silently submitted to another.
                setPrivateKey('');
                setPassphrase('');
                setFingerprint('');
              }}
            >
              {PROTOCOLS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {isGit ? (
            <>
              <label className="flex flex-col text-xs text-slate-500">
                Auth
                <select aria-label="Git auth method" className={field} value={gitAuth} onChange={(e) => setGitAuth(e.target.value as 'token' | 'key')}>
                  <option value="token">Token (HTTPS)</option>
                  <option value="key">SSH key</option>
                </select>
              </label>
              <label className="flex flex-col text-xs text-slate-500">
                Repository URL
                <input
                  aria-label="Git repository URL"
                  className={field}
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder={gitAuth === 'key' ? 'git@github.com:you/repo.git' : 'https://github.com/you/repo.git'}
                />
              </label>
              <label className="flex w-32 flex-col text-xs text-slate-500">
                Branch
                <input aria-label="Git branch" className={field} value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="gh-pages" />
              </label>
              {gitAuth === 'token' ? (
                <label className="flex flex-col text-xs text-slate-500">
                  Access token
                  <input aria-label="Git access token" type="password" className={field} value={gitToken} onChange={(e) => setGitToken(e.target.value)} placeholder="ghp_… (HTTPS token)" />
                </label>
              ) : (
                <>
                  <label className="flex w-full flex-col text-xs text-slate-500">
                    SSH private key
                    <textarea aria-label="Git SSH private key" className={`${field} font-mono`} rows={3} value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
                  </label>
                  <label className="flex flex-col text-xs text-slate-500">
                    Key passphrase
                    <input aria-label="Git key passphrase" type="password" className={field} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="leave blank if unencrypted" />
                  </label>
                  <label className="flex w-full flex-col text-xs text-slate-500">
                    Host key (optional)
                    <input aria-label="Git host key" className={field} value={fingerprint} onChange={(e) => setFingerprint(e.target.value)} placeholder="github.com ssh-ed25519 AAAA… — leave blank to trust on first use" />
                  </label>
                </>
              )}
            </>
          ) : (
            <>
              <label className="flex flex-col text-xs text-slate-500">
                Host
                <input aria-label="Deploy host" className={field} value={host} onChange={(e) => setHost(e.target.value)} required />
              </label>
              <label className="flex w-20 flex-col text-xs text-slate-500">
                Port
                <input aria-label="Deploy port" type="number" min={1} max={65535} className={field} value={port} onChange={(e) => setPort(e.target.value)} placeholder="auto" />
              </label>
              <label className="flex flex-col text-xs text-slate-500">
                User
                <input aria-label="Deploy user" className={field} value={user} onChange={(e) => setUser(e.target.value)} required />
              </label>
              {!useKey && (
                <label className="flex flex-col text-xs text-slate-500">
                  Password
                  <input aria-label="Deploy password" type="password" className={field} value={password} onChange={(e) => setPassword(e.target.value)} required={!useKey} />
                </label>
              )}
              <label className="flex flex-col text-xs text-slate-500">
                Remote dir
                <input aria-label="Deploy remote directory" className={field} value={remoteDir} onChange={(e) => setRemoteDir(e.target.value)} />
              </label>
              <button type="submit" disabled={busy} className={`${primaryButton} disabled:opacity-50`}>
                {busy ? 'Working…' : 'Deploy'}
              </button>
            </>
          )}
        </div>
        {!isGit && protocol === 'sftp' && (
          <>
            <label className="flex flex-col text-xs text-slate-500">
              Authentication
              <select aria-label="Deploy auth method" className={field} value={authMethod} onChange={(e) => setAuthMethod(e.target.value as 'password' | 'key')}>
                <option value="password">Password</option>
                <option value="key">Private key</option>
              </select>
            </label>
            {useKey && (
              <>
                <label className="flex flex-col text-xs text-slate-500">
                  Private key (PEM / OpenSSH contents)
                  <textarea
                    aria-label="Deploy private key"
                    className={`${field} h-24 font-mono text-[11px]`}
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;…&#10;-----END OPENSSH PRIVATE KEY-----"
                  />
                </label>
                <label className="flex flex-col text-xs text-slate-500">
                  Key passphrase (optional)
                  <input aria-label="Deploy key passphrase" type="password" className={field} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="leave blank if the key is unencrypted" />
                </label>
              </>
            )}
            <label className="flex flex-col text-xs text-slate-500">
              Host fingerprint (SHA-256, optional — pins the server to prevent MITM)
              <input aria-label="Deploy host fingerprint" className={field} value={fingerprint} onChange={(e) => setFingerprint(e.target.value)} placeholder="leave blank to trust on first use" />
            </label>
          </>
        )}
        {targets !== null && (
          <div className="flex items-end gap-2">
            <label className="flex flex-col text-xs text-slate-500">
              Save as target
              <input aria-label="Target name" className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Production" />
            </label>
            <button type="button" disabled={busy} onClick={saveTarget} className={ghostButton}>
              Save target
            </button>
          </div>
        )}
      </form>

      <p className="mt-2 text-[11px] text-slate-400">
        Credentials for an ad-hoc deploy are used once and never stored. Saved targets keep the
        password / private key encrypted at rest. Deploying a saved target shows live progress.
      </p>
      {result && <p className="text-sm text-emerald-700">{result}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {dialog}
      {deploying && <DeployModal project={project} target={deploying} onClose={() => setDeploying(null)} />}
    </div>
  );
}
