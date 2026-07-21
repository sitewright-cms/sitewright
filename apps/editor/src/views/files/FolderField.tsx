import { useState } from 'react';
import { FolderIcon } from '../media/file-icons';
import { FolderPicker } from './FolderPicker';
import { fieldLabel, glassInput, ghostButton } from '../../theme';

/**
 * A folder-valued field: a text input holding a media-library folder PATH (e.g. `gallery/team`, ''
 * = root), a **Browse** button that opens the {@link FolderPicker}, and Clear. The folder sibling of
 * {@link AssetField}; the field still accepts a hand-typed path — the picker is an assist.
 */
export function FolderField({
  label,
  value,
  onChange,
  projectId,
  placeholder = 'gallery/team',
  hideLabel = false,
  inputId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  projectId: string;
  placeholder?: string;
  /** Suppress the built-in label (when a parent already renders one, e.g. the dataset entry form). */
  hideLabel?: boolean;
  /** Optional id for the input, so an external `<label htmlFor>` can target it. */
  inputId?: string;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <div className="block">
      {!hideLabel && <span className={fieldLabel}>{label}</span>}
      <div className="flex items-center gap-2">
        {value !== '' && <FolderIcon className="h-6 w-6 shrink-0 text-indigo-400" />}
        <input
          id={inputId}
          // A parent <label htmlFor={inputId}> IS the accessible name; a duplicate aria-label would
          // override it. Only the standalone (span-labelled) case needs its own aria-label.
          aria-label={inputId ? undefined : label}
          className={glassInput}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          aria-label={`Browse for ${label}`}
          className={`${ghostButton} shrink-0 whitespace-nowrap px-2.5 py-1 text-xs`}
          onClick={() => setPicking(true)}
        >
          Browse
        </button>
        {value && (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            className="shrink-0 px-1 text-xs text-slate-400 dark:text-slate-500 transition hover:text-rose-600 dark:hover:text-rose-400"
            onClick={() => onChange('')}
          >
            Clear
          </button>
        )}
      </div>
      {picking && (
        <FolderPicker
          projectId={projectId}
          title={`Choose ${label.toLowerCase()} folder`}
          onPick={onChange}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
