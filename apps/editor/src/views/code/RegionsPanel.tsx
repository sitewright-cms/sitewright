import { useMemo, type ReactNode } from 'react';
import { Type, Pilcrow, Link2, Image as ImageIcon, Settings2, Rows3, LayoutList } from 'lucide-react';
import { SidePanel } from '../ui/SidePanel';

type EditMode = 'source' | 'content';

/** One editable region in the page, as enumerated by the preview bridge (rendered DOM). */
export interface RegionItem {
  rid: number;
  kind: 'text' | 'html' | 'href' | 'image' | 'bg' | 'control' | 'entry';
  label: string;
  /** entry only */
  dataset?: string;
  id?: string;
}

const KIND_ICON: Record<RegionItem['kind'], ReactNode> = {
  text: <Type className="h-3.5 w-3.5" />,
  html: <Pilcrow className="h-3.5 w-3.5" />,
  href: <Link2 className="h-3.5 w-3.5" />,
  image: <ImageIcon className="h-3.5 w-3.5" />,
  bg: <ImageIcon className="h-3.5 w-3.5" />,
  control: <Settings2 className="h-3.5 w-3.5" />,
  entry: <Rows3 className="h-3.5 w-3.5" />,
};

function RegionsIcon() {
  return <LayoutList className="h-4 w-4" aria-hidden />;
}

function Row({ item, onEdit }: { item: RegionItem; onEdit: (rid: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onEdit(item.rid)}
      title={`Edit ${item.label}`}
      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-slate-700 transition hover:bg-indigo-50 hover:text-indigo-700"
    >
      <span className="shrink-0 text-slate-400">{KIND_ICON[item.kind] ?? <Type className="h-3.5 w-3.5" />}</span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
    </button>
  );
}

/**
 * The "Regions" rail — a deterministic, always-reliable index of every editable thing on the page
 * (populated by the preview bridge in content mode). Page text/links/images/controls are grouped under
 * "Page content"; dataset rows are grouped per dataset and shown by their TITLE, so repeated content
 * (slides/cards) is individually addressable. Clicking a row scrolls the preview to it + opens its
 * editor — reaching content that is occluded, hidden, or off-screen, with no canvas overlays.
 */
export function RegionsPanel({
  regions,
  mode,
  onEdit,
}: {
  regions: RegionItem[];
  mode: EditMode;
  onEdit: (rid: number) => void;
}) {
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
    <SidePanel side="left" align="start" label="Regions" icon={<RegionsIcon />} size="w-[22rem]">
      <div className="flex flex-col gap-3 p-2">
        {mode !== 'content' ? (
          <p className="px-2 py-6 text-center text-sm text-slate-500">
            Switch to the <span className="font-semibold">Content Editor</span> to list the page&apos;s editable regions.
          </p>
        ) : regions.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-slate-500">No editable regions on this page.</p>
        ) : (
          <>
            {pageItems.length > 0 && (
              <section>
                <h3 className="px-2 pb-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">Page content</h3>
                <div className="flex flex-col">
                  {pageItems.map((r) => (
                    <Row key={r.rid} item={r} onEdit={onEdit} />
                  ))}
                </div>
              </section>
            )}
            {datasets.map(([name, items]) => (
              <section key={name}>
                <h3 className="px-2 pb-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  {name} <span className="text-slate-300">· {items.length}</span>
                </h3>
                <div className="flex flex-col">
                  {items.map((r) => (
                    <Row key={r.rid} item={r} onEdit={onEdit} />
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
