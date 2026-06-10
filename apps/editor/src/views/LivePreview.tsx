import { useCallback, useEffect, useState } from 'react';
import { api, eventsUrl, previewDocUrl } from '../api';
import type { LiveTarget } from '../lib/live-target';
import { PreviewPane } from './editor/PreviewPane';
import { glassPanel } from '../theme';

const RELOAD_DEBOUNCE_MS = 250;

interface LivePreviewProps {
  target: LiveTarget;
}

/**
 * Standalone, pop-out live preview of a page's SAVED content. Subscribes to the
 * project's change stream and re-renders whenever ANY channel (editor, CLI, MCP,
 * webchat) writes — so an author watching this window sees agent edits appear.
 * The render still goes through the sandboxed preview-doc (this same-origin page
 * just swaps the iframe `src`).
 */
export function LivePreview({ target }: LivePreviewProps) {
  const { projectId, pageId } = target;
  const [preview, setPreview] = useState<{ src: string; loading: boolean; error: string | null }>({
    src: '',
    loading: true,
    error: null,
  });
  const [connected, setConnected] = useState(false);

  // Render the current saved page through the preview-doc pipeline.
  const render = useCallback(async () => {
    setPreview((prev) => ({ ...prev, loading: true }));
    try {
      const { item } = await api.getPage(projectId, pageId);
      const res = await api.preview(projectId, item);
      setPreview({ src: previewDocUrl(res.slug, res.token), loading: false, error: null });
    } catch (err) {
      setPreview((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'failed to load preview',
      }));
    }
  }, [projectId, pageId]);

  useEffect(() => {
    void render();
  }, [render]);

  // Subscribe to the change stream; coalesce bursts of edits into one reload.
  useEffect(() => {
    const source = new EventSource(eventsUrl(projectId), { withCredentials: true });
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    let handle: ReturnType<typeof setTimeout> | undefined;
    source.addEventListener('content', () => {
      if (handle) clearTimeout(handle);
      handle = setTimeout(() => void render(), RELOAD_DEBOUNCE_MS);
    });
    return () => {
      if (handle) clearTimeout(handle);
      source.close();
    };
  }, [projectId, render]);

  return (
    <div className="flex h-screen flex-col">
      <div className={`m-2 mb-0 flex items-center gap-2 px-4 py-2.5 text-xs ${glassPanel}`}>
        <span className="font-bold tracking-tight text-slate-800">Live preview</span>
        <span className={connected ? 'text-emerald-600' : 'text-slate-400'} aria-label="connection status">
          {connected ? '● live' : '○ connecting…'}
        </span>
        <span className="ml-auto text-slate-400">{pageId}</span>
      </div>
      <div className="min-h-0 flex-1 p-2">
        <PreviewPane src={preview.src} loading={preview.loading} error={preview.error} />
      </div>
    </div>
  );
}
