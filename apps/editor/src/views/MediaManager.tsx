import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { MediaAsset } from '@sitewright/schema';
import { api, type Org, type Project } from '../api';

export function MediaManager({ org, project }: { org: Org; project: Project }) {
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function load(isActive: () => boolean = () => true) {
    try {
      const res = await api.listMedia(org.id, project.id);
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
  }, [org.id, project.id]);

  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await api.uploadMedia(org.id, project.id, file);
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
      await api.deleteMedia(org.id, project.id, id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to delete media');
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-4">
        <label htmlFor="media-upload" className="text-xs font-medium text-slate-500">
          Upload image
        </label>
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

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
        {media.map((m) => (
          <figure key={m.id} className="rounded-lg border border-slate-200 bg-white p-2">
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
                className="text-[11px] text-red-400 hover:text-red-700"
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
