import { useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { api, type SelfHostedFont } from '../../api';
import { ghostButton, glassInput } from '../../theme';

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const FALLBACKS: Array<{ value: string; label: string }> = [
  { value: 'sans-serif', label: 'Sans-serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'monospace', label: 'Monospace' },
  { value: 'cursive', label: 'Cursive' },
];

/**
 * Uploads a local font file (.woff2/.woff/.ttf/.otf) for one slot. The server validates it by magic
 * bytes, self-hosts it PROJECT-scoped, and returns the bundleable record; the preview + published
 * pages then load the LOCAL copy. The caller wires the returned record into the slot.
 */
export function LocalFontUploader({
  projectId,
  slotLabel,
  defaultWeight,
  onSelected,
  onClose,
}: {
  projectId: string;
  slotLabel: string;
  defaultWeight: number;
  onSelected: (font: SelfHostedFont, weight: number) => void;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [family, setFamily] = useState('');
  const [weight, setWeight] = useState(defaultWeight);
  const [style, setStyle] = useState<'normal' | 'italic'>('normal');
  const [fallback, setFallback] = useState('sans-serif');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const file = fileRef.current?.files?.[0];
    if (!file) return setError('Choose a font file first.');
    if (!family.trim()) return setError('Give the font a name.');
    setBusy(true);
    setError(null);
    try {
      const { font } = await api.uploadFont(projectId, file, { family: family.trim(), weight, style, fallback });
      onSelected(font, weight);
      onClose();
    } catch {
      setError('Upload failed. Use a .woff2/.woff/.ttf/.otf file under 5 MB.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Upload a ${slotLabel} font`} size="md" onClose={onClose}>
      <div className="flex flex-col gap-3 p-5">
        <p className="text-sm text-slate-500">
          Upload a font file you have a license to use. It’s stored with your project and served locally — your
          preview and published pages never call a font CDN.
        </p>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Font file</span>
          <input ref={fileRef} type="file" accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf" className="block w-full text-sm" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Family name</span>
          <input className={glassInput} placeholder="Boombox" value={family} onChange={(e) => setFamily(e.target.value)} />
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Weight</span>
            <select className={`${glassInput} cursor-pointer`} value={weight} onChange={(e) => setWeight(Number(e.target.value))}>
              {WEIGHTS.map((w) => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Style</span>
            <select className={`${glassInput} cursor-pointer`} value={style} onChange={(e) => setStyle(e.target.value as 'normal' | 'italic')}>
              <option value="normal">Normal</option>
              <option value="italic">Italic</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Fallback</span>
            <select className={`${glassInput} cursor-pointer`} value={fallback} onChange={(e) => setFallback(e.target.value)}>
              {FALLBACKS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </label>
        </div>
        {error && <p className="text-sm text-rose-500">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={`${ghostButton} px-3 py-1.5 text-sm`} onClick={onClose}>Cancel</button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="waves-effect rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? 'Uploading…' : 'Upload + use'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
