import { useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { FileBrowser, ACCEPT } from '../files/FileBrowser';
import { GoogleFontGallery, type GoogleFontMeta } from './GoogleFontGallery';
import { api, type MediaAsset } from '../../api';
import { glassInput, gradientSurface } from '../../theme';

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const FALLBACKS = ['sans-serif', 'serif', 'monospace', 'cursive'];

/**
 * Choose a self-hosted font for a typography slot. Three sources, all of which yield a `kind:'font'`
 * library asset: the **Library** (fonts already in this project), **Google** (download a family's
 * weights — self-hosted on select, never loaded from Google on the site), or **Upload** (your own
 * file). The chosen asset (+ a weight) is returned to the slot.
 */
export function FontPicker({
  projectId,
  slotLabel,
  defaultWeight,
  onPick,
  onClose,
}: {
  projectId: string;
  slotLabel: string;
  defaultWeight: number;
  /** The chosen font asset + the weight to use for this slot. */
  onPick: (asset: MediaAsset, weight: number) => void;
  onClose: () => void;
}) {
  // Google Fonts is the default source — most slots are filled from Google's catalogue.
  const [tab, setTab] = useState<'library' | 'google' | 'upload'>('google');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function choose(asset: MediaAsset, weight: number) {
    onPick(asset, weight);
    onClose();
  }
  /** First available weight of a font asset (so picking from the library sets a sane weight). */
  const firstWeight = (a: MediaAsset) => (a.kind === 'font' ? (a.files.find((f) => f.weight === defaultWeight) ?? a.files[0])!.weight : defaultWeight);

  async function pickGoogle(font: GoogleFontMeta, weight: number) {
    setBusy(`${font.family}:${weight}`);
    setError(null);
    try {
      const { item } = await api.selectFont(projectId, font.family, [weight]);
      choose(item, weight);
    } catch {
      setError(`Couldn't download “${font.family}”. Try another font.`);
    } finally {
      setBusy(null);
    }
  }

  const tabBtn = (id: typeof tab) =>
    `rounded-lg px-3.5 py-1.5 text-sm transition ${tab === id ? `${gradientSurface} font-bold` : 'font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100'}`;

  return (
    <Modal
      title={`Choose a ${slotLabel}`}
      size="full"
      onClose={onClose}
      headerExtra={
        <div className="flex overflow-hidden rounded-xl border border-white/60 dark:border-white/10 bg-white/40 dark:bg-white/5 p-0.5">
          <button type="button" className={tabBtn('google')} onClick={() => { setTab('google'); setError(null); setBusy(null); }}>Google Fonts</button>
          <button type="button" className={tabBtn('library')} onClick={() => { setTab('library'); setError(null); setBusy(null); }}>Library</button>
          <button type="button" className={tabBtn('upload')} onClick={() => { setTab('upload'); setError(null); setBusy(null); }}>Upload</button>
        </div>
      }
    >
      {error && <p className="px-5 pt-3 text-sm text-rose-500 dark:text-rose-300">{error}</p>}
      {tab === 'library' ? (
        <div className="p-5">
          <FileBrowser
            projectId={projectId}
            mode="pick"
            accept={ACCEPT.font}
            onPick={(asset) => choose(asset, firstWeight(asset))}
            intro="Pick a font already in this project, or switch to Google / Upload to add one."
          />
        </div>
      ) : tab === 'google' ? (
        <GoogleFontGallery
          intro="Search Google Fonts. Selecting a weight downloads it into your library — your site loads it locally (never from Google)."
          renderAction={(font) =>
            font.weights.map((w) => (
              <button
                key={w}
                type="button"
                disabled={busy === `${font.family}:${w}`}
                onClick={() => void pickGoogle(font, w)}
                className="waves-effect rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-0.5 text-xs text-slate-600 dark:text-slate-300 transition hover:border-indigo-300 hover:text-indigo-700 dark:hover:text-indigo-400 disabled:opacity-50"
                title={`Use ${font.family} ${w}`}
              >
                {busy === `${font.family}:${w}` ? '…' : w}
              </button>
            ))
          }
        />
      ) : (
        <UploadFontForm projectId={projectId} defaultWeight={defaultWeight} onUploaded={(asset, weight) => choose(asset, weight)} />
      )}
    </Modal>
  );
}

/** The Upload tab: a font file + family/weight/style/fallback → a kind:'font' library asset. */
function UploadFontForm({
  projectId,
  defaultWeight,
  onUploaded,
}: {
  projectId: string;
  defaultWeight: number;
  onUploaded: (asset: MediaAsset, weight: number) => void;
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
      const { item } = await api.uploadFont(projectId, file, { family: family.trim(), weight, style, fallback });
      onUploaded(item, weight);
    } catch {
      setError('Upload failed. Use a .woff2/.woff/.ttf/.otf file under 5 MB.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 p-5">
      <p className="text-sm text-slate-500 dark:text-slate-400">Upload a font you have a license to use. It’s stored in your library and served locally.</p>
      <label className="block">
        <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Font file</span>
        <input ref={fileRef} type="file" accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf" className="block w-full text-sm" />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Family name</span>
        <input aria-label="Family name" className={glassInput} placeholder="Boombox" value={family} onChange={(e) => setFamily(e.target.value)} />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Weight</span>
          <select className={`${glassInput} cursor-pointer`} value={weight} onChange={(e) => setWeight(Number(e.target.value))}>
            {WEIGHTS.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Style</span>
          <select className={`${glassInput} cursor-pointer`} value={style} onChange={(e) => setStyle(e.target.value as 'normal' | 'italic')}>
            <option value="normal">Normal</option>
            <option value="italic">Italic</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Fallback</span>
          <select className={`${glassInput} cursor-pointer`} value={fallback} onChange={(e) => setFallback(e.target.value)}>
            {FALLBACKS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
      </div>
      {error && <p className="text-sm text-rose-500 dark:text-rose-300">{error}</p>}
      <div className="flex justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="waves-effect rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-bold text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? 'Uploading…' : 'Upload + use'}
        </button>
      </div>
    </div>
  );
}
