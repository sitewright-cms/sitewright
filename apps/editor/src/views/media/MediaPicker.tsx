import type { MediaAsset } from '@sitewright/schema';

interface MediaPickerProps {
  media: MediaAsset[];
  onPick: (url: string) => void;
}

/** A compact thumbnail grid for choosing an uploaded image (sets a block's src). */
export function MediaPicker({ media, onPick }: MediaPickerProps) {
  if (media.length === 0) {
    return <p className="text-xs text-slate-400">No media yet — upload some in the Media tab.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {media.map((m) => (
        <button
          key={m.id}
          type="button"
          aria-label={`Use ${m.filename}`}
          title={m.filename}
          onClick={() => onPick(m.url)}
          className="rounded border border-slate-300 p-0.5 hover:border-slate-900"
        >
          <img src={m.url} alt="" className="h-12 w-12 rounded object-cover" loading="lazy" />
        </button>
      ))}
    </div>
  );
}
