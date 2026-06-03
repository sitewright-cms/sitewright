import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { MediaAsset } from '@sitewright/schema';
import { api, type Project } from '../api';
import { StockPicker } from './media/StockPicker';
import { Modal } from './ui/Modal';
import { glassCard, fieldLabel, dangerButton, ghostButton } from '../theme';

export function MediaManager({ project }: { project: Project }) {
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [stockOpen, setStockOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function load(isActive: () => boolean = () => true) {
    try {
      const res = await api.listMedia(project.id);
      if (isActive()) setMedia(res.items);
    } catch (err) {
      if (isActive()) setError(err instanceof Error ? err.message : 'failed to load media');
    }
  }

  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [project.id]);

  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await api.uploadMedia(project.id, file);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api.deleteMedia(project.id, id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to delete media');
    }
  }

  return (
    <div>
      <div className={`mb-4 flex flex-col gap-1 ${glassCard} p-4`}>
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="media-upload" className={fieldLabel}>
            Upload image
          </label>
          <button type="button" onClick={() => setStockOpen(true)} className={ghostButton}>
            Search stock images
          </button>
        </div>
        <input
          id="media-upload"
          ref={fileInput}
          aria-label="Upload image"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
          disabled={uploading}
          onChange={onUpload}
          className="text-sm"
        />
        {uploading && <span className="text-xs text-slate-400">optimizing…</span>}
        <p className="text-[11px] text-slate-400">
          Images are optimized to AVIF/WebP with a JPEG fallback. SVG is not accepted.
        </p>
      </div>

      {stockOpen && (
        <Modal title="Search stock images" size="xl" onClose={() => setStockOpen(false)}>
          <div className="p-4">
            <StockPicker projectId={project.id} onImported={() => load()} bare />
          </div>
        </Modal>
      )}

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
        {media.map((m) => (
          <figure key={m.id} className={`${glassCard} p-2`}>
            <img
              src={m.url}
              alt={m.alt ?? m.filename}
              className="h-24 w-full rounded object-cover"
              loading="lazy"
            />
            <figcaption className="mt-1 flex items-center justify-between gap-1">
              <span className="truncate text-[11px] text-slate-500" title={m.filename}>
                {m.filename}
              </span>
              <button
                aria-label={`Delete ${m.filename}`}
                className={`${dangerButton} px-1.5 py-0.5 text-[11px]`}
                onClick={() => remove(m.id)}
              >
                ✕
              </button>
            </figcaption>
          </figure>
        ))}
        {media.length === 0 && <p className="text-sm text-slate-400">No media yet.</p>}
      </div>
    </div>
  );
}
