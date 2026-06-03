import { useEffect, useState, type FormEvent } from 'react';
import { api, type ApiKeyCapability, type ApiKeyView, type Project, type ProjectRole } from '../api';

const ALL_CAPABILITIES: ApiKeyCapability[] = ['content:read', 'content:write', 'publish', 'deploy'];

interface ApiKeysManagerProps {
  project: Project;
}

/**
 * Project settings → API keys: create / list / revoke the long-lived bearer
 * tokens (PATs) used by CI and headless tools. The raw token is shown exactly
 * once on creation; thereafter only its prefix is visible.
 */
export function ApiKeysManager({ project }: ApiKeysManagerProps) {
  const [keys, setKeys] = useState<ApiKeyView[]>([]);
  const [name, setName] = useState('');
  const [role, setRole] = useState<ProjectRole>('owner');
  const [caps, setCaps] = useState<ApiKeyCapability[]>(['content:read', 'content:write']);
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [issued, setIssued] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(isActive: () => boolean = () => true) {
    try {
      // The list endpoint returns active keys only (revoked rows are retained
      // server-side for audit but excluded from list()).
      const items = (await api.listApiKeys(project.id)).items;
      if (!isActive()) return; // a tab switch may have unmounted us mid-fetch
      setKeys(items);
    } catch (err) {
      if (isActive()) setError(err instanceof Error ? err.message : 'failed to load API keys');
    }
  }
  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [project.id]);

  function toggleCap(cap: ApiKeyCapability) {
    setCaps((prev) => (prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]));
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIssued(null);
    try {
      const res = await api.createApiKey(project.id, { name, role, capabilities: caps, expiresInDays });
      setIssued(res.token); // shown ONCE
      setName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create API key');
    }
  }

  async function revoke(id: string) {
    if (!window.confirm('Revoke this API key? Any client using it will stop working immediately.')) return;
    try {
      await api.deleteApiKey(project.id, id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to revoke API key');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {issued && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-amber-900">Copy your new token now — it won’t be shown again.</p>
            <button
              aria-label="Dismiss token"
              className="text-amber-700 hover:text-amber-900"
              onClick={() => setIssued(null)}
            >
              ✕
            </button>
          </div>
          <code className="mt-2 block break-all rounded bg-white px-3 py-2 text-xs" aria-label="New API token">
            {issued}
          </code>
        </div>
      )}

      <form onSubmit={create} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-col">
          <label className="text-xs text-slate-500" htmlFor="key-name">Name</label>
          <input
            id="key-name"
            aria-label="API key name"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="CI deploy"
            required
          />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-slate-500" htmlFor="key-role">Role</label>
          <select
            id="key-role"
            aria-label="API key role"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={role}
            onChange={(e) => setRole(e.target.value as ProjectRole)}
          >
            <option value="owner">owner</option>
            <option value="member">member (read-only)</option>
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-slate-500" htmlFor="key-ttl">Expires (days)</label>
          <input
            id="key-ttl"
            aria-label="API key expiry in days"
            type="number"
            min={1}
            max={365}
            className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={expiresInDays}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!Number.isNaN(v) && v >= 1 && v <= 365) setExpiresInDays(v);
            }}
          />
        </div>
        <fieldset className="flex flex-col">
          <legend className="text-xs text-slate-500">Capabilities</legend>
          <div className="flex flex-wrap gap-2 pt-1">
            {ALL_CAPABILITIES.map((cap) => (
              <label key={cap} className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={caps.includes(cap)} onChange={() => toggleCap(cap)} /> {cap}
              </label>
            ))}
          </div>
        </fieldset>
        <button
          type="submit"
          disabled={caps.length === 0}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Create key
        </button>
      </form>

      <ul className="flex flex-col gap-2">
        {keys.map((k) => (
          <li
            key={k.id}
            className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm"
          >
            <span className="font-medium">{k.name}</span>
            <code className="text-xs text-slate-400">{k.tokenPrefix}…</code>
            <span className="text-xs text-slate-500">{k.capabilities.join(', ')}</span>
            <button
              aria-label={`Revoke ${k.name}`}
              className="ml-auto rounded px-2 py-0.5 text-xs text-red-500 hover:bg-red-50"
              onClick={() => revoke(k.id)}
            >
              Revoke
            </button>
          </li>
        ))}
        {keys.length === 0 && (
          <li className="text-sm text-slate-400">
            No API keys yet. Create one for CI, or run <code>sitewright login</code> for interactive access.
          </li>
        )}
      </ul>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
