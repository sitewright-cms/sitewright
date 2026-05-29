import type { Binding, PageNode } from '@sitewright/schema';
import { descriptorFor } from '@sitewright/blocks';
import { governingBinding } from '../../lib/tree-ops';
import { readValue } from '../../lib/entry-form';
import type { Dataset } from '@sitewright/schema';

interface BindingFormProps {
  node: PageNode;
  /** The full page tree, so this form can resolve the governing (inherited) binding itself. */
  root: PageNode;
  /** All project datasets (for the dataset picker + field options). */
  datasets: Dataset[];
  onSetBinding: (binding: Binding | undefined) => void;
  onBindField: (propKey: string, fieldName: string | undefined) => void;
}

const BINDABLE_INPUTS = new Set(['text', 'textarea', 'url']);

/** Connects a block to CMS data: a dataset binding plus per-prop field bindings. */
export function BindingForm({ node, root, datasets, onSetBinding, onBindField }: BindingFormProps) {
  const descriptor = descriptorFor(node.type);
  const props = node.props ?? {};
  const bindableFields = (descriptor?.fields ?? []).filter((f) => BINDABLE_INPUTS.has(f.input));

  // The dataset whose fields are in scope for THIS node — its own binding or the
  // nearest ancestor's. Computed here (not threaded as a prop) so it is always
  // correct for the node being rendered.
  const binding = governingBinding(root, node.id);
  const contextDataset = binding ? datasets.find((d) => d.slug === binding.dataset) : undefined;

  return (
    <div className="mt-3 border-t border-slate-200 pt-3">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Data</h4>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-slate-500">Bind block to dataset</label>
        <select
          aria-label="Bind to dataset"
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={node.binding?.dataset ?? ''}
          onChange={(e) =>
            onSetBinding(
              e.target.value === ''
                ? undefined
                : { dataset: e.target.value, mode: node.binding?.mode ?? 'single' },
            )
          }
        >
          <option value="">— none —</option>
          {datasets.map((d) => (
            <option key={d.id} value={d.slug}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      {node.binding && (
        <div className="mt-2 flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">Mode</label>
          <select
            aria-label="Binding mode"
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={node.binding.mode}
            onChange={(e) =>
              onSetBinding({
                ...node.binding,
                dataset: node.binding?.dataset ?? '',
                mode: e.target.value === 'list' ? 'list' : 'single',
              })
            }
          >
            <option value="single">Single (one entry)</option>
            <option value="list">List (repeat per entry)</option>
          </select>
        </div>
      )}

      {contextDataset && bindableFields.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          <span className="text-xs text-slate-400">
            Bind fields to <span className="font-medium">{contextDataset.name}</span>
          </span>
          {bindableFields.map((field) => {
            const current = readValue(props, `${field.key}Field`);
            return (
              <div key={field.key} className="flex items-center gap-2">
                <span className="w-20 text-xs text-slate-500">{field.label}</span>
                <select
                  aria-label={`Bind ${field.label}`}
                  className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
                  value={typeof current === 'string' ? current : ''}
                  onChange={(e) => onBindField(field.key, e.target.value || undefined)}
                >
                  <option value="">— static —</option>
                  {contextDataset.fields.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
