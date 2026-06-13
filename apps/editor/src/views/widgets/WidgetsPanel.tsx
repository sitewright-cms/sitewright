import { useEffect, useState } from 'react';
import { Blocks, Check } from 'lucide-react';
import { SidePanel } from '../ui/SidePanel';
import { useCopy } from '../ui/useCopy';
import { api, type WidgetCatalogEntry } from '../../api';
import { glassPanel, ghostButton } from '../../theme';

/** Stacked-blocks glyph for the Widgets bottom-rail tab. */
function WidgetsIcon() {
  return <Blocks aria-hidden className="h-4 w-4" />;
}

/**
 * The WIDGETS rail — a read-only gallery of the platform's system Widgets (managed, data-backed
 * drop-ins like the hero slider). Unlike Snippets (which are user-editable records), Widgets are a
 * curated system catalog: you BROWSE and INSERT them as `{{> name}}`. Dropping one onto a page and
 * saving provisions its config dataset, which you then edit in the Datasets rail. No create/edit/
 * delete here by design — the body is system-owned.
 */
function WidgetGallery() {
  const [widgets, setWidgets] = useState<WidgetCatalogEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [copiedId, copy] = useCopy();

  useEffect(() => {
    let alive = true;
    api
      .listWidgets()
      .then((r) => alive && setWidgets(r.widgets))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <p className="p-4 text-sm text-slate-500">Couldn’t load the widget catalog.</p>;
  if (!widgets) return <p className="p-4 text-sm text-slate-400">Loading widgets…</p>;
  if (widgets.length === 0) return <p className="p-4 text-sm text-slate-500">No widgets are available.</p>;

  return (
    <div className="p-3">
      <p className="mb-3 px-1 text-xs leading-relaxed text-slate-500">
        Managed, data-backed blocks. Insert one with <code className="font-mono">{'{{> name}}'}</code>, then edit its
        content in the <span className="font-medium">Datasets</span> rail after saving.
      </p>
      <ul className="grid gap-2">
        {widgets.map((w) => {
          const ref = `{{> ${w.name}}}`;
          return (
            <li key={w.name} className={`${glassPanel} flex flex-col gap-1.5 rounded-xl px-3 py-2.5`}>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700" title={w.label}>
                  {w.label}
                </span>
                <button
                  className={`${ghostButton} px-2 py-1 font-mono text-[11px]`}
                  aria-label={`Copy ${ref}`}
                  title={`Copy ${ref}`}
                  onClick={() => copy(ref, w.name)}
                >
                  {copiedId === w.name ? <Check className="h-3.5 w-3.5" /> : '{{>}}'}
                </button>
              </div>
              <p className="text-xs leading-relaxed text-slate-500">{w.description}</p>
              {w.datasets.length > 0 && (
                <p className="text-[11px] text-slate-400">
                  Editable data:{' '}
                  {w.datasets.map((d, i) => (
                    <span key={d.slug}>
                      {i > 0 && ', '}
                      <span className="font-medium text-slate-500">{d.name}</span>
                    </span>
                  ))}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The Widgets bottom-rail panel — paired with Snippets at centre (Snippets center-left, Widgets
 *  center-right). The catalog is instance-wide; `projectId` only keys the panel per project. */
export function WidgetsPanel({ projectId }: { projectId: string }) {
  return (
    <SidePanel side="bottom" align="center-right" label="Widgets" icon={<WidgetsIcon />}>
      <WidgetGallery key={projectId} />
    </SidePanel>
  );
}
