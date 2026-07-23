import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { FilePicker } from './FilePicker';
import { ACCEPT } from './FileBrowser';

/** The values collected for an inserted `<img>`. `width`/`height` are px strings (empty = unset → intrinsic). */
export interface ImageInsert {
  url: string;
  alt: string;
  width: string;
  height: string;
}

/** Clamp a width/height field to a positive integer string (or '' when empty/invalid). Bounds the attribute
 *  to the same max as the drag-resize (4000px) so a typed value and a subsequent drag never disagree. */
function dim(v: string): string {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? String(Math.min(n, 4000)) : '';
}

/**
 * The rich-text "insert image" dialog: paste/type an image URL (or Browse the media library via the
 * {@link FilePicker}), plus optional alt text and width/height. Used by BOTH the dataset richtext toolbar
 * (RichTextField) and the on-page `data-sw-html` toolbar (via CodePageEditor, which forwards the result to
 * the preview bridge). The caller does the actual insertion; this only collects the fields.
 */
export function ImageDialog({
  projectId,
  initial,
  onInsert,
  onClose,
}: {
  projectId: string;
  /** Pre-filled values → the dialog is EDITING an existing image (double-click), not inserting. */
  initial?: Partial<ImageInsert>;
  onInsert: (img: ImageInsert) => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(initial?.url ?? '');
  const [alt, setAlt] = useState(initial?.alt ?? '');
  const [width, setWidth] = useState(initial?.width ?? '');
  const [height, setHeight] = useState(initial?.height ?? '');
  const [browsing, setBrowsing] = useState(false);
  const editing = Boolean(initial?.url);

  const submit = () => {
    const u = url.trim();
    if (!u) return;
    onInsert({ url: u, alt: alt.trim(), width: dim(width), height: dim(height) });
  };

  const field = 'w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white/70 dark:bg-slate-800/70 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-[var(--sw-brand-1)]';
  const label = 'mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400';

  return (
    <>
      <Modal
        title={editing ? 'Image settings' : 'Insert image'}
        size="md"
        onClose={onClose}
        onSave={submit}
        saveLabel={editing ? 'Apply' : 'Insert'}
        saveDisabled={!url.trim()}
      >
        <div className="flex flex-col gap-3 p-5">
          <div>
            <label className={label} htmlFor="sw-img-url">
              Image URL
            </label>
            <div className="flex gap-2">
              <input
                id="sw-img-url"
                type="text"
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://… or /media/…"
                className={field}
              />
              <button
                type="button"
                className="shrink-0 rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                onClick={() => setBrowsing(true)}
              >
                Browse…
              </button>
            </div>
          </div>
          <div>
            <label className={label} htmlFor="sw-img-alt">
              Alt text <span className="font-normal text-slate-400">(described for screen readers / SEO)</span>
            </label>
            <input id="sw-img-alt" type="text" value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="A short description of the image" className={field} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className={label} htmlFor="sw-img-w">
                Width <span className="font-normal text-slate-400">(px, optional)</span>
              </label>
              <input id="sw-img-w" type="number" min={1} value={width} onChange={(e) => setWidth(e.target.value)} placeholder="auto" className={field} />
            </div>
            <div className="flex-1">
              <label className={label} htmlFor="sw-img-h">
                Height <span className="font-normal text-slate-400">(px, optional)</span>
              </label>
              <input id="sw-img-h" type="number" min={1} value={height} onChange={(e) => setHeight(e.target.value)} placeholder="auto" className={field} />
            </div>
          </div>
          {url.trim() && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-2">
              <p className={label}>Preview</p>
              <img src={url} alt={alt} className="max-h-40 max-w-full rounded object-contain" />
            </div>
          )}
        </div>
      </Modal>
      {browsing && (
        <FilePicker
          projectId={projectId}
          accept={ACCEPT.image}
          title="Choose image"
          onPick={(u) => {
            setUrl(u);
            setBrowsing(false);
          }}
          onClose={() => setBrowsing(false)}
        />
      )}
    </>
  );
}
