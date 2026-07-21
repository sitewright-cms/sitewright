import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { FileBrowser, type AcceptFilter } from './FileBrowser';
import { api } from '../../api';
import { glassInput } from '../../theme';

/**
 * A modal picker that returns a URL for a field: browse + select (or upload) a library file filtered
 * by `accept`, OR paste a URL — used as-is, or **imported** (downloaded + self-hosted into the
 * library so the published export stays self-contained). Wraps the shared {@link FileBrowser} in
 * pick mode (which hides destructive CRUD); the Assets drawer remains the place for full management.
 */
export function FilePicker({
  projectId,
  accept,
  title = 'Choose a file',
  onPick,
  onClose,
}: {
  projectId: string;
  accept?: AcceptFilter;
  title?: string;
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'library' | 'url'>('library');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function choose(url: string) {
    onPick(url);
    onClose();
  }
  async function importUrl() {
    const u = url.trim();
    if (!u) return;
    setBusy(true);
    setError(null);
    try {
      const { item } = await api.importMediaUrl(projectId, u);
      choose(item.url); // calls onClose() → this picker unmounts; don't touch state after
      return;
    } catch {
      setError('Could not import that URL. Use a public https URL, or “Use URL as-is”.');
    } finally {
      setBusy(false); // only the error path reaches here (component still mounted)
    }
  }
  const switchTab = (id: 'library' | 'url') => {
    setTab(id);
    setError(null);
  };

  const tabBtn = (id: 'library' | 'url') =>
    `rounded-lg px-3 py-1 text-xs ${tab === id ? 'bg-white dark:bg-slate-900 font-bold text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100'}`;

  return (
    <Modal
      title={title}
      size="full"
      onClose={onClose}
      headerExtra={
        <div className="flex overflow-hidden rounded-xl border border-white/60 dark:border-white/10 bg-white/40 dark:bg-white/5 p-0.5">
          <button type="button" className={tabBtn('library')} onClick={() => switchTab('library')}>
            Library
          </button>
          <button type="button" className={tabBtn('url')} onClick={() => switchTab('url')}>
            URL
          </button>
        </div>
      }
    >
      {tab === 'library' ? (
        <div className="p-5">
          <FileBrowser
            projectId={projectId}
            mode="pick"
            accept={accept}
            onPick={(asset) => choose(asset.url)}
            intro="Pick a file (or upload one), or switch to the URL tab to paste/import a link."
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-5">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Paste a URL. <strong>Use as-is</strong> keeps the link (it won’t be self-hosted);{' '}
            <strong>Import</strong> downloads it into your library so the published site stays self-contained.
          </p>
          <input
            aria-label="URL"
            className={glassInput}
            placeholder="https://example.com/image.jpg"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          {error && <p className="text-sm text-rose-500 dark:text-rose-300">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!url.trim()}
              onClick={() => choose(url.trim())}
              className="waves-effect rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 transition hover:border-slate-300 dark:hover:border-slate-600 disabled:opacity-50"
            >
              Use URL as-is
            </button>
            <button
              type="button"
              disabled={!url.trim() || busy}
              onClick={() => void importUrl()}
              className="waves-effect rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-bold text-white transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {busy ? 'Importing…' : 'Import to library'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
