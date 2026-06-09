import { useEffect, useState, type FormEvent } from 'react';
import { api, type DeployConfig, type DeployTargetView, type Project } from '../../api';
import { useDialogs } from '../ui/Dialogs';
import { glassInput, primaryButton, ghostButton, dangerButton } from '../../theme';

const PROTOCOLS: ReadonlyArray<{ value: DeployConfig['protocol']; label: string }> = [
  { value: 'ftp', label: 'FTP' },
  { value: 'ftps', label: 'FTPS' },
  { value: 'sftp', label: 'SFTP' },
];

/** Deploy the published site to an external FTP/FTPS/SFTP target (ad-hoc or saved). */
export function DeployForm({ project }: { project: Project }) {
  const [protocol, setProtocol] = useState<DeployConfig['protocol']>('sftp');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [remoteDir, setRemoteDir] = useState('/');
  const [fingerprint, setFingerprint] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targets, setTargets] = useState<DeployTargetView[] | null>(null); // null = feature unavailable
  const { confirm, dialog } = useDialogs();

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
    return {
      protocol,
      host,
      user,
      password,
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
    const config = buildConfig();
    if (!config) return;
    await run(
      () => api.deploy(project.id, config),
      (r) => setResult(`Deployed ${r.deployed.files} files via ${r.deployed.protocol.toUpperCase()}.`),
    );
  }

  async function saveTarget() {
    const config = buildConfig();
    if (!config) return;
    if (!name.trim()) {
      setError('Give the target a name to save it');
      return;
    }
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
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Saved targets</h4>
          <ul className="flex flex-col gap-1">
            {targets.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-sm">
                <span className="font-medium text-slate-800">{t.name}</span>
                <span className="text-xs text-slate-400">
                  {t.protocol.toUpperCase()}@{t.host}
                </span>
                <button
                  className={`ml-auto ${ghostButton} px-2 py-0.5 text-xs`}
                  disabled={busy}
                  aria-label={`Deploy to ${t.name}`}
                  onClick={() =>
                    run(
                      () => api.deployToTarget(project.id, t.id),
                      (r) => setResult(`Deployed ${r.deployed.files} files to ${t.name}.`),
                    )
                  }
                >
                  Deploy
                </button>
                <button
                  className={`${dangerButton} px-1.5 py-0.5 text-xs`}
                  aria-label={`Delete target ${t.name}`}
                  onClick={async () => {
                    const ok = await confirm({
                      title: 'Delete deploy target',
                      message: `Delete the saved deploy target "${t.name}" (${t.protocol.toUpperCase()}@${t.host})? This cannot be undone.`,
                      confirmLabel: 'Delete',
                    });
                    if (!ok) return;
                    void run(
                      () => api.deleteDeployTarget(project.id, t.id),
                      () => void loadTargets(),
                    );
                  }}
                >
                  ✕
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
            <select aria-label="Deploy protocol" className={field} value={protocol} onChange={(e) => setProtocol(e.target.value as DeployConfig['protocol'])}>
              {PROTOCOLS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
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
          <label className="flex flex-col text-xs text-slate-500">
            Password
            <input aria-label="Deploy password" type="password" className={field} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            Remote dir
            <input aria-label="Deploy remote directory" className={field} value={remoteDir} onChange={(e) => setRemoteDir(e.target.value)} />
          </label>
          <button type="submit" disabled={busy} className={`${primaryButton} disabled:opacity-50`}>
            {busy ? 'Working…' : 'Deploy'}
          </button>
        </div>
        {protocol === 'sftp' && (
          <label className="flex flex-col text-xs text-slate-500">
            Host fingerprint (SHA-256, optional — pins the server to prevent MITM)
            <input aria-label="Deploy host fingerprint" className={field} value={fingerprint} onChange={(e) => setFingerprint(e.target.value)} placeholder="leave blank to trust on first use" />
          </label>
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
        password encrypted at rest.
      </p>
      {result && <p className="text-sm text-emerald-700">{result}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {dialog}
    </div>
  );
}
