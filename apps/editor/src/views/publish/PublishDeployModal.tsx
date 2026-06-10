import { useEffect, useState } from 'react';
import { api, type Project, type SettingsBundle } from '../../api';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { useCopy } from '../ui/useCopy';
import { primaryButton, ghostButton } from '../../theme';
import { DeployForm } from './DeployForm';

type Tab = 'publish' | 'deploy';

/** A url-safe random preview token (base64url, 24 chars — satisfies the schema's 16–64 + `[A-Za-z0-9_-]`). */
function generateToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A small Tailwind toggle switch (no DaisyUI dependency). */
function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${checked ? 'bg-indigo-600' : 'bg-slate-300'}`}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </label>
  );
}

/**
 * The "PUBLISH & DEPLOY OPTIONS" modal (opened from the header overflow menu). Two tabs:
 *  - PUBLISH — local hosting at `/sites/<slug>/`: enable/disable, an optional preview-token gate, and
 *    HTML minification. Saved to the project's website settings.
 *  - DEPLOY SETTINGS — upload the built site to an external server (the existing {@link DeployForm}).
 */
export function PublishDeployModal({
  project,
  initialTab = 'publish',
  onClose,
  onSaved,
}: {
  project: Project;
  initialTab?: Tab;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const toast = useToast();
  const [, copy] = useCopy(() => toast.show('Copied to clipboard'));
  const [tab, setTab] = useState<Tab>(initialTab);
  const [bundle, setBundle] = useState<SettingsBundle | null>(null);
  const [localPublish, setLocalPublish] = useState(true);
  const [previewToken, setPreviewToken] = useState<string | undefined>(undefined);
  const [minifyHtml, setMinifyHtml] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getSettings(project.id)
      .then(({ item }) => {
        if (!alive) return;
        setBundle(item);
        setLocalPublish(item.website?.localPublish !== false); // absent → enabled
        setPreviewToken(item.website?.previewToken);
        setMinifyHtml(!!item.website?.minifyHtml);
        setLoading(false);
      })
      .catch(() => alive && (setError('Couldn’t load publish settings.'), setLoading(false)));
    return () => {
      alive = false;
    };
  }, [project.id]);

  const tokenUrl = previewToken ? `${window.location.origin}/sites/${project.slug}/?token=${previewToken}` : '';

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // Mutate a copy of the website settings, OMITTING defaulted/cleared keys (absent = the default)
      // so settings stay lean and we never assign `undefined` to an optional field.
      const web: NonNullable<SettingsBundle['website']> = bundle?.website ? { ...bundle.website } : {};
      if (localPublish) delete web.localPublish;
      else web.localPublish = false;
      if (previewToken) web.previewToken = previewToken;
      else delete web.previewToken;
      if (minifyHtml) web.minifyHtml = true;
      else delete web.minifyHtml;
      // Cast: spreading optional-bearing objects widens props to `T | undefined` under
      // exactOptionalPropertyTypes; the runtime shape is a valid SettingsBundle.
      const next = { ...(bundle ?? {}), website: web } as SettingsBundle;
      const { item } = await api.putSettings(project.id, next);
      setBundle(item);
      toast.show('Publish settings saved');
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save publish settings.');
    } finally {
      setSaving(false);
    }
  }

  const tabBtn = (key: Tab, label: string) => (
    <button
      role="tab"
      aria-selected={tab === key}
      onClick={() => setTab(key)}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
        tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
      }`}
    >
      {label}
    </button>
  );

  return (
    <Modal
      title="Publish & deploy options"
      size="lg"
      onClose={onClose}
      headerExtra={
        <div role="tablist" aria-label="Publish & deploy sections" className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
          {tabBtn('publish', 'Local Publish')}
          {tabBtn('deploy', 'Deploy settings')}
        </div>
      }
    >
      {/* Padded body so neither tab (the Local Publish toggles, the Deploy settings form) sits flush. */}
      <div className="p-5">
      {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}

      {tab === 'publish' ? (
        loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <div className="space-y-4">
            <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              <strong className="font-bold text-slate-700">Publish</strong> hosts your site locally on this server at{' '}
              <code className="rounded bg-white px-1">/sites/{project.slug}/</code> — the “Preview / View site” link. Use the{' '}
              <strong>Deploy settings</strong> tab to also upload the built site to your own external server.
            </p>

            <div className="divide-y divide-slate-100">
              <Toggle
                label="Enable local publish"
                hint={`Serve the published site at /sites/${project.slug}/. When off, publishing still builds the site (for deploy) but it isn’t hosted here.`}
                checked={localPublish}
                onChange={setLocalPublish}
              />

              <Toggle
                label="Require a preview token"
                hint="Locally published pages require a secret ?token= in the URL — useful for sharing an unlisted preview before launch."
                checked={!!previewToken}
                onChange={(on) => setPreviewToken(on ? previewToken ?? generateToken() : undefined)}
              />
              {previewToken && (
                <div className="space-y-2 py-3">
                  <p className="text-xs text-slate-500">Share this tokenized URL — the Preview button uses it too:</p>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={tokenUrl}
                      onFocus={(e) => e.currentTarget.select()}
                      className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-700"
                    />
                    <button className={`${ghostButton} px-2 py-1.5 text-xs`} onClick={() => copy(tokenUrl, 'url')}>
                      Copy
                    </button>
                    <a className={`${ghostButton} px-2 py-1.5 text-xs`} href={tokenUrl} target="_blank" rel="noreferrer">
                      Open ↗
                    </a>
                    <button className={`${ghostButton} px-2 py-1.5 text-xs`} onClick={() => setPreviewToken(generateToken())}>
                      Regenerate
                    </button>
                  </div>
                </div>
              )}

              <Toggle
                label="Enable HTML minification"
                hint="Collapse whitespace and drop comments from each published page. Smaller files; the source stays readable in the editor."
                checked={minifyHtml}
                onChange={setMinifyHtml}
              />
            </div>

            <div className="flex justify-end pt-1">
              <button className={`${primaryButton} px-4 py-2 text-sm`} onClick={() => void save()} disabled={saving}>
                {saving ? 'Saving…' : 'Save publish options'}
              </button>
            </div>
          </div>
        )
      ) : (
        <DeployForm project={project} />
      )}
      </div>
    </Modal>
  );
}
