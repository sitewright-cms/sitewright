import { useCallback, useEffect, useState } from 'react';
import { api, eventsUrl, previewDocUrl } from '../api';
import type { LiveTarget } from '../lib/live-target';
import { PreviewPane } from './editor/PreviewPane';

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
  const { orgId, projectId, pageId } = target;
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
      const { item } = await api.getPage(orgId, projectId, pageId);
      const res = await api.preview(orgId, projectId, item);
      setPreview({ src: previewDocUrl(orgId, projectId, res.token), loading: false, error: null });
    } catch (err) {
      setPreview((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'failed to load preview',
      }));
    }
  }, [orgId, projectId, pageId]);

  useEffect(() => {
    void render();
  }, [render]);

  // Subscribe to the change stream; coalesce bursts of edits into one reload.
  useEffect(() => {
    const source = new EventSource(eventsUrl(orgId, projectId), { withCredentials: true });
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
  }, [orgId, projectId, render]);

  return (
    <div className="flex h-screen flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 text-xs">
        <span className="font-semibold tracking-tight">Live preview</span>
        <span className={connected ? 'text-green-600' : 'text-slate-400'} aria-label="connection status">
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
