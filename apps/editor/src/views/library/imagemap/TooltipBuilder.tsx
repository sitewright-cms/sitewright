import { useState } from 'react';
import type { ImageMapTooltipBlock } from '@sitewright/schema';
import { fieldLabel, ghostButton, glassInput, toggleInput } from '../../../theme';
import { ACCEPT_IMAGE, ACCEPT_VIDEO, AssetField } from './ObjectDetails';
import { blockLabel, newTooltipBlock } from './model';

/**
 * The tooltip content builder: an ordered list of blocks (heading, text, image, button, video,
 * embed) that becomes the hotspot's tooltip.
 *
 * A block's `text` is rich HTML by design and its `embedCode` is an iframe — both are sanitized
 * server-side at the render sink, so this editor can stay a plain field rather than shipping a
 * sanitizer to the browser and pretending the client is the boundary.
 */

const BLOCK_TYPES: ReadonlyArray<{ type: ImageMapTooltipBlock['type']; label: string }> = [
  { type: 'Heading', label: 'Heading' },
  { type: 'Paragraph', label: 'Text' },
  { type: 'Image', label: 'Image' },
  { type: 'Button', label: 'Button' },
  { type: 'Video', label: 'Video' },
  { type: 'YouTube', label: 'Embed' },
];

interface TooltipBuilderProps {
  blocks: readonly ImageMapTooltipBlock[];
  projectId?: string;
  onChange: (blocks: ImageMapTooltipBlock[]) => void;
}

export function TooltipBuilder({ blocks, projectId, onChange }: TooltipBuilderProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(blocks.length === 1 ? 0 : null);

  const replace = (index: number, block: ImageMapTooltipBlock): void =>
    onChange(blocks.map((b, i) => (i === index ? block : b)));
  const remove = (index: number): void => {
    onChange(blocks.filter((_, i) => i !== index));
    setOpenIndex(null);
  };
  const move = (index: number, by: number): void => {
    const to = index + by;
    if (to < 0 || to >= blocks.length) return;
    const next = [...blocks];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved!);
    onChange(next);
    setOpenIndex(to);
  };

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        {blocks.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-600 dark:text-slate-400">
            No tooltip content yet — add a block below.
          </p>
        )}
        {blocks.map((block, index) => (
          <div key={index} className="rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-1 px-2 py-1.5">
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-xs"
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
                aria-expanded={openIndex === index}
              >
                <span className="mr-1.5 rounded bg-slate-100 px-1 py-0.5 text-[10px] font-bold uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  {block.type}
                </span>
                <span className="text-slate-700 dark:text-slate-200">{blockLabel(block)}</span>
              </button>
              <button type="button" aria-label="Move up" className="px-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 dark:hover:text-slate-100" disabled={index === 0} onClick={() => move(index, -1)}>
                ↑
              </button>
              <button type="button" aria-label="Move down" className="px-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 dark:hover:text-slate-100" disabled={index === blocks.length - 1} onClick={() => move(index, 1)}>
                ↓
              </button>
              <button type="button" aria-label="Remove block" className="px-1 text-slate-400 hover:text-rose-600" onClick={() => remove(index)}>
                ×
              </button>
            </div>
            {openIndex === index && (
              <div className="space-y-2 border-t border-slate-200 p-2 dark:border-slate-700">
                <BlockFields block={block} index={index} projectId={projectId} onChange={(b) => replace(index, b)} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1">
        {BLOCK_TYPES.map(({ type, label }) => (
          <button
            key={type}
            type="button"
            className={`${ghostButton} px-2 py-1 text-[11px]`}
            onClick={() => {
              onChange([...blocks, newTooltipBlock(type)]);
              setOpenIndex(blocks.length);
            }}
          >
            + {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function BlockFields({
  block,
  index,
  projectId,
  onChange,
}: {
  block: ImageMapTooltipBlock;
  index: number;
  projectId?: string;
  onChange: (block: ImageMapTooltipBlock) => void;
}) {
  switch (block.type) {
    case 'Heading':
      return (
        <>
          <div>
            <label className={fieldLabel} htmlFor={`tt-${index}-text`}>
              Heading
            </label>
            <input id={`tt-${index}-text`} className={glassInput} value={block.text ?? ''} onChange={(e) => onChange({ ...block, text: e.target.value })} />
          </div>
          <div>
            <label className={fieldLabel} htmlFor={`tt-${index}-tag`}>
              Level
            </label>
            <select id={`tt-${index}-tag`} className={glassInput} value={block.heading ?? 'h3'} onChange={(e) => onChange({ ...block, heading: e.target.value as typeof block.heading })}>
              {['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div'].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </>
      );

    case 'Paragraph':
      return (
        <div>
          <label className={fieldLabel} htmlFor={`tt-${index}-text`}>
            Text
          </label>
          <textarea
            id={`tt-${index}-text`}
            className={`${glassInput} min-h-[5rem]`}
            value={block.text ?? ''}
            onChange={(e) => onChange({ ...block, text: e.target.value })}
          />
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Basic HTML is allowed (bold, links); anything unsafe is stripped when the page renders.
          </p>
        </div>
      );

    case 'Button':
      return (
        <>
          <div>
            <label className={fieldLabel} htmlFor={`tt-${index}-label`}>
              Label
            </label>
            <input id={`tt-${index}-label`} className={glassInput} value={block.text ?? ''} onChange={(e) => onChange({ ...block, text: e.target.value })} />
          </div>
          <div>
            <label className={fieldLabel} htmlFor={`tt-${index}-url`}>
              Link
            </label>
            <input id={`tt-${index}-url`} className={glassInput} value={block.url ?? ''} onChange={(e) => onChange({ ...block, url: e.target.value })} placeholder="/contact" />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
            <input type="checkbox" className={toggleInput} checked={block.newTab ?? false} onChange={(e) => onChange({ ...block, newTab: e.target.checked })} />
            Open in a new tab
          </label>
        </>
      );

    case 'Image':
      return (
        <>
          <AssetField
            id={`tt-${index}-img`}
            label="Image"
            accept={ACCEPT_IMAGE}
            projectId={projectId}
            value={block.url ?? ''}
            onChange={(url) => onChange({ ...block, url })}
          />
          <div>
            <label className={fieldLabel} htmlFor={`tt-${index}-link`}>
              Links to (optional)
            </label>
            <input id={`tt-${index}-link`} className={glassInput} value={block.linkUrl ?? ''} onChange={(e) => onChange({ ...block, linkUrl: e.target.value })} />
          </div>
        </>
      );

    case 'Video':
      return (
        <>
          <AssetField
            id={`tt-${index}-mp4`}
            label="Video (MP4)"
            accept={ACCEPT_VIDEO}
            projectId={projectId}
            value={block.src?.mp4 ?? ''}
            onChange={(url) => onChange({ ...block, src: { ...(block.src ?? {}), mp4: url } })}
          />
          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
            <input type="checkbox" className={toggleInput} checked={block.controls ?? true} onChange={(e) => onChange({ ...block, controls: e.target.checked })} />
            Show playback controls
          </label>
        </>
      );

    case 'YouTube':
      return (
        <div>
          <label className={fieldLabel} htmlFor={`tt-${index}-embed`}>
            Embed code
          </label>
          <textarea
            id={`tt-${index}-embed`}
            className={`${glassInput} min-h-[5rem] font-mono text-[11px]`}
            value={block.embedCode ?? ''}
            onChange={(e) => onChange({ ...block, embedCode: e.target.value })}
            placeholder='<iframe src="https://www.youtube.com/embed/…"></iframe>'
          />
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Paste the provider’s iframe. Only https embeds survive, and they are sandboxed when the page renders.
          </p>
        </div>
      );
  }
}
