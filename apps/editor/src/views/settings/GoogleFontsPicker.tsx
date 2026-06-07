import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { api, type SelfHostedFont } from '../../api';
import { GoogleFontGallery, type GoogleFontMeta } from './GoogleFontGallery';

/**
 * A searchable, previewable Google-Fonts picker for one typography slot. Picking a weight calls
 * `POST /fonts/select` which downloads + self-hosts that font; the resulting record + weight come
 * back via `onSelected` — the published site + the live preview then use the LOCAL copy, never
 * Google.
 */
export function GoogleFontsPicker({
  projectId,
  slotLabel,
  onSelected,
  onClose,
}: {
  projectId: string;
  slotLabel: string;
  onSelected: (font: SelfHostedFont, weight: number) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(font: GoogleFontMeta, weight: number) {
    setBusy(font.family);
    setError(null);
    try {
      const { font: record } = await api.selectFont(projectId, font.family, [weight]);
      onSelected(record, weight);
      onClose();
    } catch {
      setError(`Couldn't download “${font.family}”. Try another font.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal title={`Choose a ${slotLabel}`} size="full" onClose={onClose}>
      {error && <p className="px-5 pt-3 text-sm text-rose-500">{error}</p>}
      <GoogleFontGallery
        intro="Search Google Fonts. Selecting a weight downloads it to your project — your site preview and published pages then load it locally (never from Google)."
        renderAction={(font) =>
          font.weights.map((w) => (
            <button
              key={w}
              type="button"
              disabled={busy === font.family}
              onClick={() => void pick(font, w)}
              className="waves-effect rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50"
              title={`Use ${font.family} ${w}`}
            >
              {busy === font.family ? '…' : w}
            </button>
          ))
        }
      />
    </Modal>
  );
}
