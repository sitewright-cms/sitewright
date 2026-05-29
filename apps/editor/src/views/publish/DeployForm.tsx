import { useState, type FormEvent } from 'react';
import { api, type DeployConfig, type Org, type Project } from '../../api';

const PROTOCOLS: ReadonlyArray<{ value: DeployConfig['protocol']; label: string }> = [
  { value: 'ftp', label: 'FTP' },
  { value: 'ftps', label: 'FTPS' },
  { value: 'sftp', label: 'SFTP' },
];

/** Deploy the published site to an external FTP/FTPS/SFTP target. */
export function DeployForm({ org, project }: { org: Org; project: Project }) {
  const [protocol, setProtocol] = useState<DeployConfig['protocol']>('sftp');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [remoteDir, setRemoteDir] = useState('/');
  const [fingerprint, setFingerprint] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setResult(null);
    setError(null);
    let portNum: number | undefined;
    if (port.trim() !== '') {
      portNum = Number(port);
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        setError('Port must be a whole number between 1 and 65535');
        return;
      }
    }
    setBusy(true);
    const config: DeployConfig = {
      protocol,
      host,
      user,
      password,
      remoteDir: remoteDir || '/',
      ...(portNum !== undefined ? { port: portNum } : {}),
      ...(protocol === 'sftp' && fingerprint.trim() ? { hostFingerprint: fingerprint.trim() } : {}),
    };
    try {
      const res = await api.deploy(org.id, project.id, config);
      setResult(`Deployed ${res.deployed.files} files via ${res.deployed.protocol.toUpperCase()}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'deploy failed');
    } finally {
      setBusy(false);
    }
  }

  const field = 'rounded-md border border-slate-300 px-2 py-1.5 text-sm';

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-slate-500">
          Protocol
          <select
            aria-label="Deploy protocol"
            className={field}
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as DeployConfig['protocol'])}
          >
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
          <input
            aria-label="Deploy port"
            type="number"
            min={1}
            max={65535}
            className={field}
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="auto"
          />
        </label>
        <label className="flex flex-col text-xs text-slate-500">
          User
          <input aria-label="Deploy user" className={field} value={user} onChange={(e) => setUser(e.target.value)} required />
        </label>
        <label className="flex flex-col text-xs text-slate-500">
          Password
          <input
            aria-label="Deploy password"
            type="password"
            className={field}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col text-xs text-slate-500">
          Remote dir
          <input aria-label="Deploy remote directory" className={field} value={remoteDir} onChange={(e) => setRemoteDir(e.target.value)} />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Deploying…' : 'Deploy'}
        </button>
      </div>
      {protocol === 'sftp' && (
        <label className="flex flex-col text-xs text-slate-500">
          Host fingerprint (SHA-256, optional — pins the server to prevent MITM)
          <input
            aria-label="Deploy host fingerprint"
            className={field}
            value={fingerprint}
            onChange={(e) => setFingerprint(e.target.value)}
            placeholder="leave blank to trust on first use"
          />
        </label>
      )}
      <p className="text-[11px] text-slate-400">
        Credentials are used only for this deploy and are never stored.
      </p>
      {result && <p className="text-sm text-emerald-700">{result}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
