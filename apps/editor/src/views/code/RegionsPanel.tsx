import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Type, Pilcrow, Link2, Image as ImageIcon, Settings2, Rows3, LayoutList, Languages, MapPin } from 'lucide-react';
import type { Dataset, Entry } from '@sitewright/schema';
import { SidePanel, SidePanelClose } from '../ui/SidePanel';
import { api } from '../../api';
import { entryLabel } from '../../lib/entry-form';

/** One editable region in the page, as enumerated by the preview bridge (rendered DOM). */
export interface RegionItem {
  rid: number;
  kind: 'text' | 'translate' | 'html' | 'href' | 'image' | 'bg' | 'control' | 'entry' | 'imagemap';
  label: string;
  /** entry only */
  dataset?: string;
  /** entry: the entry id · imagemap: the stored map's id (what the Studio opens). */
  id?: string;
}

const KIND_ICON: Record<RegionItem['kind'], ReactNode> = {
  text: <Type className="h-3.5 w-3.5" />,
  translate: <Languages className="h-3.5 w-3.5" />,
  html: <Pilcrow className="h-3.5 w-3.5" />,
  href: <Link2 className="h-3.5 w-3.5" />,
  image: <ImageIcon className="h-3.5 w-3.5" />,
  bg: <ImageIcon className="h-3.5 w-3.5" />,
  control: <Settings2 className="h-3.5 w-3.5" />,
  entry: <Rows3 className="h-3.5 w-3.5" />,
  imagemap: <MapPin className="h-3.5 w-3.5" />,
};

function Row({ item, display, onEdit }: { item: RegionItem; display: string; onEdit: (rid: number) => void }) {
  // Activating a row hands you over to the PREVIEW (it focuses the region, or opens a control's
  // popover there), so the rail has to get out of the way: its backdrop covers the preview, and a
  // popover you can't click is worse than no popover at all.
  const closePanel = useContext(SidePanelClose);
  return (
    <button
      type="button"
      onClick={() => {
        onEdit(item.rid);
        closePanel?.();
      }}
      title={`Edit ${display}`}
      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-slate-700 dark:text-slate-200 transition hover:bg-indigo-50 dark:hover:bg-indigo-500/10 hover:text-indigo-700 dark:hover:text-indigo-400"
    >
      <span className="shrink-0 text-slate-500 dark:text-slate-400">{KIND_ICON[item.kind] ?? <Type className="h-3.5 w-3.5" />}</span>
      <span className="min-w-0 flex-1 truncate">{display}</span>
    </button>
  );
}

/**
 * The "Regions" rail — a deterministic, always-reliable index of every editable thing on the page
 * (populated by the preview bridge in content mode). Page text/links/images/controls are grouped under
 * "Page content"; dataset rows are grouped per dataset and shown by their real TITLE (the first text
 * field, resolved from the project's datasets — so image-only slides/cards are still named, not shown
 * by id), so repeated content is individually addressable. Clicking a row scrolls the preview to it +
 * opens its editor — reaching content that is occluded, hidden, or off-screen, with no canvas overlays.
 */
export function RegionsPanel({
  regions,
  projectId,
  onEdit,
  mobile,
}: {
  regions: RegionItem[];
  projectId: string;
  onEdit: (rid: number) => void;
  /** Dock to the bottom edge instead of the left one — see the `side` note below. */
  mobile?: boolean;
}) {
  // Resolve real entry titles (the bridge's label is the rendered row text, which is empty for an
  // image-only entry → its id). Keyed by "<dataset-slug>|<entry-id>" → first-text-field value.
  const [titles, setTitles] = useState<Map<string, string>>(new Map());
  // Only load datasets/entries when the page actually renders dataset rows — most pages don't, and
  // listEntries is project-wide, so this skips the fetch entirely for them (re-runs when entries appear).
  const hasEntries = useMemo(() => regions.some((r) => r.kind === 'entry'), [regions]);
  useEffect(() => {
    if (!hasEntries) {
      setTitles(new Map());
      return;
    }
    let cancelled = false;
    void Promise.all([api.listDatasets(projectId), api.listEntries(projectId)])
      .then(([ds, es]) => {
        if (cancelled) return;
        const bySlug = new Map<string, Dataset>(ds.items.map((d) => [d.id, d]));
        const m = new Map<string, string>();
        for (const e of es.items as Entry[]) {
          const d = bySlug.get(e.dataset);
          if (d) m.set(`${e.dataset}|${e.id}`, entryLabel(d, e));
        }
        setTitles(m);
      })
      .catch(() => {
        /* datasets unavailable → fall back to the bridge labels */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, hasEntries]);

  const titleFor = (r: RegionItem): string =>
    (r.dataset && r.id && titles.get(`${r.dataset}|${r.id}`)) || r.label;

  const { pageItems, datasets } = useMemo(() => {
    const page: RegionItem[] = [];
    const ds = new Map<string, RegionItem[]>();
    for (const r of regions) {
      if (r.kind === 'entry') {
        const key = r.dataset || 'dataset';
        ds.set(key, [...(ds.get(key) ?? []), r]);
      } else {
        page.push(r);
      }
    }
    return { pageItems: page, datasets: [...ds.entries()].sort((a, b) => a[0].localeCompare(b[0])) };
  }, [regions]);

  return (
    // ★ THE ONE RAIL MOBILE KEEPS INSIDE THE PAGE EDITOR, and the only left/right panel that moves
    // rather than disappearing. Every row here is a comfortable, labelled tap target that jumps to and
    // opens one editable region — which is precisely the affordance a phone lacks, where the
    // alternative is precision-tapping a line of body text inside a live preview. It is the same
    // argument that keeps the Datasets rail: a list of fields beats hunting for one by finger.
    // It docks to the BOTTOM on mobile because the screen sides are deliberately clear there (App.tsx),
    // and `size` means height on a bottom panel, so the width moves to `width`. Bottom-CENTRE, not the
    // `start` it uses on the left edge: on mobile the two bottom CORNERS are already spoken for by the
    // Datasets and File Manager rails, which stay mounted and reachable over this modal.
    <SidePanel
      side={mobile ? 'bottom' : 'left'}
      align={mobile ? 'center' : 'start'}
      compact
      label="Regions"
      icon={<LayoutList className="h-3.5 w-3.5" aria-hidden />}
      size={mobile ? 'h-[70dvh]' : 'w-[22rem]'}
      width={mobile ? 'w-[min(28rem,100vw)]' : undefined}
    >
      <div className="flex flex-col gap-3 p-2">
        {regions.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-slate-500 dark:text-slate-400">No editable regions on this page.</p>
        ) : (
          <>
            {pageItems.length > 0 && (
              <section>
                <h3 className="px-2 pb-1 text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Page content</h3>
                <div className="flex flex-col">
                  {pageItems.map((r) => (
                    <Row key={r.rid} item={r} display={r.label} onEdit={onEdit} />
                  ))}
                </div>
              </section>
            )}
            {datasets.map(([name, items]) => (
              <section key={name}>
                <h3 className="px-2 pb-1 text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                  {name} <span className="text-slate-500 dark:text-slate-400">· {items.length}</span>
                </h3>
                <div className="flex flex-col">
                  {items.map((r) => (
                    <Row key={r.rid} item={r} display={titleFor(r)} onEdit={onEdit} />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </SidePanel>
  );
}
