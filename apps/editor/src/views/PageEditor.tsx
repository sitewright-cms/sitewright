import { useState } from 'react';
import type { Page, PageNode } from '@sitewright/schema';
import { api, type Org, type Project } from '../api';

interface PageEditorProps {
  org: Org;
  project: Project;
  page: Page;
  onClose: () => void;
}

const BLOCK_TYPES = ['Heading', 'RichText'] as const;

// IdSchema-safe id that also works in insecure contexts (crypto.randomUUID is
// secure-context-only, so it's undefined on plain-HTTP origins like the preview).
function genId(): string {
  return `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function PageEditor({ org, project, page, onClose }: PageEditorProps) {
  const [title, setTitle] = useState(page.title);
  const [blocks, setBlocks] = useState<PageNode[]>(page.root.children ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function addBlock(type: (typeof BLOCK_TYPES)[number]) {
    setBlocks([...blocks, { id: genId(), type, props: { text: '' } }]);
  }
  function setText(id: string, text: string) {
    setBlocks(blocks.map((b) => (b.id === id ? { ...b, props: { ...b.props, text } } : b)));
  }
  function removeBlock(id: string) {
    setBlocks(blocks.filter((b) => b.id !== id));
  }

  async function save() {
    setSaving(true);
    setError(null);
    const updated: Page = { ...page, title, root: { ...page.root, children: blocks } };
    try {
      await api.putPage(org.id, project.id, updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save');
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <button className="mb-4 text-sm text-slate-500 hover:text-slate-900" onClick={onClose}>
        ← {project.name}
      </button>
      <h2 className="mb-4 text-xl font-semibold">
        Editing <span className="text-slate-400">{page.path}</span>
      </h2>

      <label className="mb-1 block text-xs text-slate-500">Title</label>
      <input
        aria-label="Page title"
        className="mb-6 w-full rounded-md border border-slate-300 px-3 py-2"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <div className="flex flex-col gap-3">
        {blocks.map((b) => (
          <div key={b.id} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {b.type}
              </span>
              <button
                aria-label={`Remove ${b.type}`}
                className="text-xs text-red-500 hover:text-red-700"
                onClick={() => removeBlock(b.id)}
              >
                Remove
              </button>
            </div>
            <input
              aria-label={`${b.type} text`}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              value={typeof b.props?.text === 'string' ? b.props.text : ''}
              onChange={(e) => setText(b.id, e.target.value)}
              placeholder="Text…"
            />
          </div>
        ))}
        {blocks.length === 0 && <p className="text-sm text-slate-400">No blocks yet — add one below.</p>}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {BLOCK_TYPES.map((t) => (
          <button
            key={t}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:border-slate-500"
            onClick={() => addBlock(t)}
          >
            + {t}
          </button>
        ))}
        <button
          onClick={save}
          disabled={saving}
          className="ml-auto rounded-md bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save page'}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </main>
  );
}
