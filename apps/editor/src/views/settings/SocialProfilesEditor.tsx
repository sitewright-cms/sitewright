import { useState } from 'react';
import { detectSocial } from '@sitewright/schema';
import { glassInput, ghostButton } from '../../theme';
import { newSocial, type KeyedSocial } from './model';

/**
 * Sortable list of social profiles. Each row is a link + display name + icon; entering a URL
 * AUTO-FILLS the name + icon from the host (e.g. a wa.me link → "WhatsApp" / "brand:whatsapp"),
 * but only when those fields are still empty — an author's own value is never overwritten. Drag a
 * row by its handle to reorder; order is preserved as `company.social` for `{{#each}}` in templates.
 */
export function SocialProfilesEditor({ rows, onChange }: { rows: KeyedSocial[]; onChange: (rows: KeyedSocial[]) => void }) {
  const [dragId, setDragId] = useState<string | null>(null);

  const setRow = (id: string, patch: Partial<KeyedSocial>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  // Editing the URL fills name/icon from the host when they're blank (clear a field to re-detect).
  const onLinkChange = (id: string, link: string) => {
    const r = rows.find((x) => x.id === id);
    const patch: Partial<KeyedSocial> = { link };
    if (r && (!r.name.trim() || !r.icon.trim())) {
      const detected = detectSocial(link);
      if (!r.name.trim() && detected.name) patch.name = detected.name;
      if (!r.icon.trim() && detected.icon) patch.icon = detected.icon;
    }
    setRow(id, patch);
  };

  const reorder = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const from = rows.findIndex((r) => r.id === sourceId);
    const to = rows.findIndex((r) => r.id === targetId);
    if (from < 0 || to < 0) return;
    const next = rows.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      {rows.map((r, i) => (
        <div
          key={r.id}
          draggable
          onDragStart={() => setDragId(r.id)}
          onDragEnd={() => setDragId(null)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragId) reorder(dragId, r.id);
            setDragId(null);
          }}
          className={`flex items-center gap-2 rounded-lg ${dragId === r.id ? 'opacity-50' : ''}`}
        >
          <span aria-hidden className="cursor-grab select-none px-1 text-slate-400" title="Drag to reorder">
            ⠿
          </span>
          <input
            aria-label={`Social URL ${i + 1}`}
            className={glassInput}
            value={r.link}
            placeholder="https://wa.me/…"
            onChange={(e) => onLinkChange(r.id, e.target.value)}
          />
          <input
            aria-label={`Social name ${i + 1}`}
            className={`${glassInput} max-w-[26%]`}
            value={r.name}
            placeholder="Name"
            onChange={(e) => setRow(r.id, { name: e.target.value })}
          />
          <input
            aria-label={`Social icon ${i + 1}`}
            className={`${glassInput} max-w-[30%]`}
            value={r.icon}
            placeholder="brand:whatsapp"
            onChange={(e) => setRow(r.id, { icon: e.target.value })}
          />
          <button
            type="button"
            aria-label={`Remove social ${i + 1}`}
            onClick={() => onChange(rows.filter((x) => x.id !== r.id))}
            className="shrink-0 rounded-md px-2 py-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, newSocial()])} className={`${ghostButton} self-start`}>
        + Add profile
      </button>
    </div>
  );
}
