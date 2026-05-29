import type { PageNode } from '@sitewright/schema';
import { descriptorFor } from '@sitewright/blocks';
import { PropsForm } from './PropsForm';

export interface BlockTreeProps {
  node: PageNode;
  rootId: string;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, dir: 'up' | 'down') => void;
  onRemove: (id: string) => void;
  onChangeProp: (id: string, key: string, value: unknown) => void;
  onDragStart: (id: string) => void;
  onDropOn: (targetId: string) => void;
}

/** Recursive block-tree outline with selection, reordering, removal and drag/drop. */
export function BlockTree(props: BlockTreeProps) {
  const { node, rootId, depth, selectedId, onSelect, onMove, onRemove, onChangeProp } = props;
  const descriptor = descriptorFor(node.type);
  const isRoot = node.id === rootId;
  const selected = node.id === selectedId;

  return (
    <div>
      <div
        data-block-id={node.id}
        draggable={!isRoot}
        onDragStart={(e) => {
          e.stopPropagation();
          props.onDragStart(node.id);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          props.onDropOn(node.id);
        }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(node.id);
        }}
        className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm ${
          selected ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white hover:border-slate-300'
        }`}
        style={{ marginLeft: depth * 16 }}
      >
        {!isRoot && (
          <span className="cursor-grab select-none text-slate-300" aria-hidden="true">
            ⠿
          </span>
        )}
        <span className="font-medium text-slate-700">{descriptor?.label ?? node.type}</span>
        <div className="ml-auto flex items-center gap-1">
          {!isRoot && (
            <>
              <button
                aria-label={`Move ${node.type} up`}
                className="rounded px-1 text-slate-400 hover:text-slate-900"
                onClick={(e) => {
                  e.stopPropagation();
                  onMove(node.id, 'up');
                }}
              >
                ↑
              </button>
              <button
                aria-label={`Move ${node.type} down`}
                className="rounded px-1 text-slate-400 hover:text-slate-900"
                onClick={(e) => {
                  e.stopPropagation();
                  onMove(node.id, 'down');
                }}
              >
                ↓
              </button>
              <button
                aria-label={`Remove ${node.type}`}
                className="rounded px-1 text-red-400 hover:text-red-700"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(node.id);
                }}
              >
                ✕
              </button>
            </>
          )}
        </div>
      </div>

      {selected && (
        <div
          className="mb-2 mt-1 rounded-md border border-slate-200 bg-slate-50 p-3"
          style={{ marginLeft: depth * 16 }}
        >
          <PropsForm node={node} onChange={(key, value) => onChangeProp(node.id, key, value)} />
        </div>
      )}

      {(node.children ?? []).map((child) => (
        <BlockTree key={child.id} {...props} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}
