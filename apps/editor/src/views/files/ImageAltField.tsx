import { useId, useState, type FormEvent } from 'react';
import type { MediaAsset } from '@sitewright/schema';
import { api } from '../../api';
import { ghostButton, glassInput } from '../../theme';

/** The server's bound on an alt text (`MediaAltSchema`), so the field cannot accept what the save refuses. */
const ALT_MAX = 500;

/**
 * An image's ALT TEXT, edited beside the picture it describes.
 *
 * `{{sw-image}}` falls back to it and every `{{#sw-folder}}` gallery binds it straight off the asset, but
 * only an MCP agent could set it — so a gallery built by hand shipped `alt=""` on every photo. Saved
 * through the same media PATCH as a rename; an EMPTY field clears it, returning the image to "not
 * described" (`{{sw-image}}` then uses the file name). Decorative is a property of a USE, not of the
 * picture, so it stays on the tag (`alt=""` in the markup) rather than being stored here.
 *
 * Mount it with `key={asset.id}`: stepping to another image must show THAT image's alt, not a draft
 * typed for the previous one.
 */
export function ImageAltField({
  projectId,
  asset,
  onSaved,
}: {
  projectId: string;
  asset: MediaAsset & { kind: 'image' };
  /** The asset as the server stored it, so the caller can refresh what it shows. */
  onSaved: (item: MediaAsset) => void;
}) {
  const id = useId();
  const stored = asset.alt ?? '';
  const [value, setValue] = useState(stored);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const next = value.trim();
  const changed = next !== stored;

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!changed || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const { item } = await api.patchMedia(projectId, asset.id, { alt: next });
      setValue(item.alt ?? '');
      setSaved(true);
      onSaved(item);
    } catch (err) {
      // Keep what was typed: a refusal must not cost the author the description they wrote.
      setError(err instanceof Error ? err.message : 'the alt text could not be saved');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="flex w-full flex-col gap-1" onSubmit={(e) => void save(e)}>
      <label htmlFor={`${id}-alt`} className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Alt text
      </label>
      <div className="flex items-center gap-2">
        <input
          id={`${id}-alt`}
          type="text"
          value={value}
          maxLength={ALT_MAX}
          placeholder="e.g. A red bicycle leaning against a white wall"
          aria-describedby={`${id}-hint`}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          className={`${glassInput} min-w-0 flex-1 py-1.5 text-sm`}
        />
        <button type="submit" disabled={!changed || saving} className={`${ghostButton} shrink-0 px-3 py-1`}>
          {saving ? 'Saving…' : 'Save alt text'}
        </button>
      </div>
      <p id={`${id}-hint`} className="text-[11px] text-slate-500 dark:text-slate-400">
        Describes the image for screen readers and search engines; galleries use it. Leave it empty to fall back to the file
        name.
      </p>
      {saved && (
        <p role="status" className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
          Saved
        </p>
      )}
      {error && (
        <p role="alert" className="text-[11px] text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </form>
  );
}
