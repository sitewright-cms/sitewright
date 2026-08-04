import { useState } from 'react';
import type { ImageMap, ImageMapObject } from '@sitewright/schema';
import { fieldLabel, glassInput, ghostButton, toggleInput } from '../../../theme';
import { FilePicker } from '../../files/FilePicker';
import type { AcceptFilter } from '../../files/FileBrowser';
import { TYPE_LABELS, objectBounds, round } from './model';
import { TooltipBuilder } from './TooltipBuilder';

/**
 * The selected hotspot's settings: what it is, where it is, how it looks at rest and on hover, what
 * clicking it does, and what its tooltip says.
 *
 * Every style edit writes into the object's own `default_style` / `mouseover_style` bag. Those are
 * passed through by the schema rather than modelled key by key (the runtime deep-extends them
 * against its own defaults), so this panel surfaces the handful an author actually reaches for and
 * leaves the rest of an imported object's styling untouched.
 */

interface ObjectDetailsProps {
  map: ImageMap;
  object: ImageMapObject;
  projectId?: string;
  onChange: (patch: Partial<ImageMapObject>) => void;
  onDelete: () => void;
}

/** FilePicker accept predicates — the picker filters by ASSET, not by a mime string. */
export const ACCEPT_IMAGE: AcceptFilter = (asset) => asset.kind === 'image';
export const ACCEPT_VIDEO: AcceptFilter = (asset) => asset.kind === 'video';

/** Read one key out of a style bag with a fallback, without widening the bag's type. */
function styleValue<T>(bag: Record<string, unknown> | undefined, key: string, fallback: T): T {
  const v = bag?.[key];
  return (v === undefined || v === null ? fallback : v) as T;
}

export function ObjectDetails({ map, object, projectId, onChange, onDelete }: ObjectDetailsProps) {
  const [tab, setTab] = useState<'shape' | 'style' | 'tooltip' | 'action'>('shape');
  const bounds = objectBounds(object);
  const actions = object.actions ?? {};

  const patchStyle = (which: 'default_style' | 'mouseover_style', key: string, value: unknown): void => {
    onChange({ [which]: { ...(object[which] ?? {}), [key]: value } } as Partial<ImageMapObject>);
  };

  const tabBtn = (id: typeof tab, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setTab(id)}
      className={`rounded-lg px-2.5 py-1 text-xs ${
        tab === id
          ? 'bg-white font-bold text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
          : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 p-3 dark:border-slate-700">
        <label className={fieldLabel} htmlFor="imap-title">
          Title
        </label>
        <input
          id="imap-title"
          className={glassInput}
          value={object.title ?? ''}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Reception"
        />
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
          {TYPE_LABELS[object.type ?? 'spot'] ?? object.type} · the name external triggers and the object list use.
        </p>
      </div>

      <div className="flex gap-1 border-b border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800">
        {tabBtn('shape', 'Shape')}
        {tabBtn('style', 'Style')}
        {tabBtn('tooltip', 'Tooltip')}
        {tabBtn('action', 'Action')}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === 'shape' && (
          <div className="space-y-3">
            {object.type === 'poly' && (
              <p className="rounded-lg bg-slate-100 px-2 py-1.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {object.points?.length ?? 0} points. Drag the round handles on the canvas to reshape it; the square
                handles resize the whole polygon, and its points scale with the box.
              </p>
            )}
            {(
              <div className="grid grid-cols-2 gap-2">
                {(['x', 'y', 'width', 'height'] as const).map((key) => (
                  <div key={key}>
                    <label className={fieldLabel} htmlFor={`imap-${key}`}>
                      {key === 'width' ? 'Width' : key === 'height' ? 'Height' : key.toUpperCase()} (%)
                    </label>
                    <input
                      id={`imap-${key}`}
                      className={glassInput}
                      type="number"
                      step="0.1"
                      value={bounds[key]}
                      onChange={(e) => {
                        const n = Number.parseFloat(e.target.value);
                        if (Number.isFinite(n)) onChange({ [key]: round(n) } as Partial<ImageMapObject>);
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Positions are a percentage of the artboard, so the map stays correct at every screen width.
              Arrow keys nudge the selection; hold Shift for bigger steps.
            </p>
            {object.type === 'text' && (
              <div>
                <label className={fieldLabel} htmlFor="imap-text">
                  Text
                </label>
                <input
                  id="imap-text"
                  className={glassInput}
                  value={String((object.text as { text?: unknown } | undefined)?.text ?? '')}
                  onChange={(e) => onChange({ text: { ...(object.text ?? {}), text: e.target.value } })}
                />
              </div>
            )}
          </div>
        )}

        {tab === 'style' && (
          <div className="space-y-4">
            {(
              [
                ['default_style', 'At rest'],
                ['mouseover_style', 'On hover'],
              ] as const
            ).map(([which, label]) => (
              <fieldset key={which} className="rounded-xl border border-slate-200 p-2.5 dark:border-slate-700">
                <legend className="px-1 text-xs font-bold text-slate-700 dark:text-slate-200">{label}</legend>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={fieldLabel} htmlFor={`imap-${which}-color`}>
                      Fill
                    </label>
                    <input
                      id={`imap-${which}-color`}
                      type="color"
                      className="h-9 w-full cursor-pointer rounded-lg border border-slate-300 bg-transparent dark:border-slate-600"
                      value={styleValue(object[which] as Record<string, unknown> | undefined, 'background_color', '#0a7a5a')}
                      onChange={(e) => patchStyle(which, 'background_color', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={fieldLabel} htmlFor={`imap-${which}-opacity`}>
                      Opacity {Math.round(styleValue(object[which] as Record<string, unknown> | undefined, 'background_opacity', 0.35) * 100)}%
                    </label>
                    <input
                      id={`imap-${which}-opacity`}
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      className="w-full accent-[var(--sw-brand-1,#0a7a5a)]"
                      value={styleValue(object[which] as Record<string, unknown> | undefined, 'background_opacity', 0.35)}
                      onChange={(e) => patchStyle(which, 'background_opacity', Number.parseFloat(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className={fieldLabel} htmlFor={`imap-${which}-border`}>
                      Border colour
                    </label>
                    <input
                      id={`imap-${which}-border`}
                      type="color"
                      className="h-9 w-full cursor-pointer rounded-lg border border-slate-300 bg-transparent dark:border-slate-600"
                      value={styleValue(object[which] as Record<string, unknown> | undefined, 'border_color', '#ffffff')}
                      onChange={(e) => patchStyle(which, 'border_color', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={fieldLabel} htmlFor={`imap-${which}-bw`}>
                      Border width
                    </label>
                    <input
                      id={`imap-${which}-bw`}
                      className={glassInput}
                      type="number"
                      min="0"
                      max="20"
                      value={styleValue(object[which] as Record<string, unknown> | undefined, 'border_width', 0)}
                      onChange={(e) => patchStyle(which, 'border_width', Number.parseInt(e.target.value, 10) || 0)}
                    />
                  </div>
                </div>
              </fieldset>
            ))}
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Only the fill and border are edited here; any other styling an imported hotspot carries is kept as-is.
            </p>
          </div>
        )}

        {tab === 'tooltip' && (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                className={toggleInput}
                checked={styleValue(object.tooltip as Record<string, unknown> | undefined, 'enable_tooltip', true)}
                onChange={(e) => onChange({ tooltip: { ...(object.tooltip ?? {}), enable_tooltip: e.target.checked } })}
              />
              Show a tooltip on hover
            </label>
            <TooltipBuilder
              blocks={object.tooltip_content ?? []}
              projectId={projectId}
              onChange={(blocks) => onChange({ tooltip_content: blocks })}
            />
          </div>
        )}

        {tab === 'action' && (
          <div className="space-y-3">
            <div>
              <label className={fieldLabel} htmlFor="imap-click">
                On click
              </label>
              <select
                id="imap-click"
                className={glassInput}
                value={actions.click ?? 'no-action'}
                onChange={(e) => onChange({ actions: { ...actions, click: e.target.value as typeof actions.click } })}
              >
                <option value="no-action">Nothing</option>
                <option value="follow-link">Follow a link</option>
                <option value="change-artboard">Switch to another artboard</option>
              </select>
            </div>
            {actions.click === 'follow-link' && (
              <>
                <div>
                  <label className={fieldLabel} htmlFor="imap-link">
                    Link
                  </label>
                  <input
                    id="imap-link"
                    className={glassInput}
                    value={actions.link ?? ''}
                    onChange={(e) => onChange({ actions: { ...actions, link: e.target.value } })}
                    placeholder="/contact or https://example.com"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    className={toggleInput}
                    checked={actions.open_link_in_new_window ?? true}
                    onChange={(e) => onChange({ actions: { ...actions, open_link_in_new_window: e.target.checked } })}
                  />
                  Open in a new tab
                </label>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Only http, https, mailto and tel links are followed — a hotspot never runs JavaScript.
                </p>
              </>
            )}
            {actions.click === 'change-artboard' && (
              <div>
                <label className={fieldLabel} htmlFor="imap-artboard">
                  Go to
                </label>
                <select
                  id="imap-artboard"
                  className={glassInput}
                  value={actions.artboard ?? ''}
                  onChange={(e) => onChange({ actions: { ...actions, artboard: e.target.value } })}
                >
                  <option value="">Choose an artboard…</option>
                  {map.artboards.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title || a.id}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 p-3 dark:border-slate-700">
        <button type="button" className={`${ghostButton} w-full text-rose-600 dark:text-rose-400`} onClick={onDelete}>
          Delete hotspot
        </button>
      </div>
    </div>
  );
}

/** A URL field with the project's real file picker beside it — never a bare URL box. */
export function AssetField({
  id,
  label,
  value,
  projectId,
  accept,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  projectId?: string;
  accept?: AcceptFilter;
  onChange: (url: string) => void;
  placeholder?: string;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <div>
      <label className={fieldLabel} htmlFor={id}>
        {label}
      </label>
      <div className="flex gap-1.5">
        <input id={id} className={glassInput} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
        {projectId && (
          <button type="button" className={ghostButton} onClick={() => setPicking(true)}>
            Browse…
          </button>
        )}
      </div>
      {picking && projectId && (
        <FilePicker
          projectId={projectId}
          accept={accept}
          title={`Choose ${label.toLowerCase()}`}
          onPick={(url) => onChange(url)}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
