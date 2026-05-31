import { useEffect, useMemo, useState } from 'react';
import type {
  Binding,
  Dataset,
  MediaAsset,
  Page,
  PageNode,
  PageTranslation,
  Pattern,
} from '@sitewright/schema';
import { BLOCK_DESCRIPTORS, isContainerType, type BlockCategory } from '@sitewright/blocks';
import { reIdTree } from '@sitewright/core';
import { api, previewDocUrl, type Org, type Project } from '../api';
import { createBlock, genId } from '../lib/node-factory';
import { localeDraft, toTranslation } from '../lib/translation-draft';
import {
  appendChild,
  findNode,
  insertChild,
  moveNode,
  moveWithinParent,
  parentInfo,
  removeNode,
  setProps,
  updateNode,
} from '../lib/tree-ops';
import { BlockTree } from './editor/BlockTree';
import { PreviewPane } from './editor/PreviewPane';

interface PageEditorProps {
  org: Org;
  project: Project;
  page: Page;
  onClose: () => void;
}

const CATEGORIES: ReadonlyArray<{ key: BlockCategory; label: string }> = [
  { key: 'layout', label: 'Layout' },
  { key: 'content', label: 'Content' },
  { key: 'component', label: 'Components' },
  { key: 'nav', label: 'Navigation' },
];

const PREVIEW_DEBOUNCE_MS = 400;

export function PageEditor({ org, project, page, onClose }: PageEditorProps) {
  const [title, setTitle] = useState(page.title);
  const [root, setRoot] = useState<PageNode>(page.root);
  const [selectedId, setSelectedId] = useState<string | null>(page.root.id);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [preview, setPreview] = useState<{ src: string; loading: boolean; error: string | null }>({
    src: '',
    loading: true,
    error: null,
  });
  // Multilingual: the project's configured locales and the currently-edited one.
  // `locale === ''` (or the default locale) means we are editing the page itself;
  // any other locale edits that locale's PageTranslation.
  const [settings, setSettings] = useState<{ locales: string[]; defaultLocale: string } | null>(
    null,
  );
  const [locale, setLocale] = useState('');
  const [translations, setTranslations] = useState<PageTranslation[]>([]);
  const [localeIsNew, setLocaleIsNew] = useState(false);
  // The last loaded/saved content for the current locale — used to detect unsaved
  // edits before switching locales (tree-ops return new node references on edit).
  const [baseline, setBaseline] = useState<{ title: string; root: PageNode }>({
    title: page.title,
    root: page.root,
  });

  const defaultLocale = settings?.defaultLocale ?? '';
  const isDefaultLocale = locale === '' || locale === defaultLocale;

  // Project datasets + media power the binding UI and the image picker.
  useEffect(() => {
    let cancelled = false;
    api
      .listDatasets(org.id, project.id)
      .then((res) => {
        if (!cancelled) setDatasets(res.items);
      })
      .catch(() => {
        /* binding UI simply offers no datasets if this fails */
      });
    api
      .listMedia(org.id, project.id)
      .then((res) => {
        if (!cancelled) setMedia(res.items);
      })
      .catch(() => {
        /* image picker simply offers no media if this fails */
      });
    api
      .listPatterns(org.id, project.id)
      .then((res) => {
        if (!cancelled) setPatterns(res.items);
      })
      .catch(() => {
        /* the patterns panel simply shows none if this fails */
      });
    api
      .getSettings(org.id, project.id)
      .then((res) => {
        if (cancelled) return;
        const { locales, defaultLocale: def } = res.item.settings;
        setSettings({ locales, defaultLocale: def });
        setLocale(def); // start on the default locale (the page's own content)
      })
      .catch(() => {
        /* no settings singleton yet → single-locale; the switcher stays hidden */
      });
    api
      .listTranslations(org.id, project.id)
      .then((res) => {
        if (!cancelled) setTranslations(res.items.filter((t) => t.pageId === page.id));
      })
      .catch(() => {
        /* no translations available → non-default locales seed from the default */
      });
    return () => {
      cancelled = true;
    };
  }, [org.id, project.id, page.id]);

  // The page as currently edited — drives both save and live preview.
  const draft: Page = useMemo(() => ({ ...page, title, root }), [page, title, root]);

  // Debounced server-side preview render. The loading flag is set inside the
  // timeout so rapidly-superseded keystrokes don't flash the spinner.
  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      setPreview((prev) => ({ ...prev, loading: true }));
      api
        .preview(org.id, project.id, draft)
        .then((res) => {
          if (!cancelled) {
            setPreview({ src: previewDocUrl(org.id, project.id, res.token), loading: false, error: null });
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setPreview((prev) => ({
              ...prev,
              loading: false,
              error: err instanceof Error ? err.message : 'preview failed',
            }));
          }
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [org.id, project.id, draft]);

  // Places a new node inside the selected container, else after the selection,
  // else at the end of the root — then selects it. Shared by Add block + Insert
  // pattern.
  function insertNode(child: PageNode) {
    const selected = selectedId ? findNode(root, selectedId) : undefined;
    let next: PageNode;
    if (selected && isContainerType(selected.type)) {
      next = appendChild(root, selected.id, child);
    } else if (selected && selected.id !== root.id) {
      const info = parentInfo(root, selected.id);
      next = info
        ? insertChild(root, info.parentId, info.index + 1, child)
        : appendChild(root, root.id, child);
    } else {
      next = appendChild(root, root.id, child);
    }
    setRoot(next);
    setSelectedId(child.id);
  }

  function addBlock(type: string) {
    insertNode(createBlock(type));
  }

  // Insert a pattern as a fork: deep-clone its subtree with fresh ids so the
  // inserted copy is independent (and the same pattern can be inserted many times).
  function insertPattern(pattern: Pattern) {
    insertNode(reIdTree(pattern.root, genId));
  }

  // Capture the selected subtree as a reusable, project-scoped pattern.
  async function saveAsPattern() {
    if (!selectedId) return;
    const selected = findNode(root, selectedId);
    if (!selected) return;
    const name = (window.prompt('Pattern name', `Pattern ${patterns.length + 1}`) ?? '').trim();
    if (!name) return;
    const pattern: Pattern = { id: genId(), name, root: selected };
    try {
      await api.putPattern(org.id, project.id, pattern);
      setPatterns((prev) => [...prev, pattern]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save pattern');
    }
  }

  async function deletePattern(id: string) {
    try {
      await api.deletePattern(org.id, project.id, id);
      setPatterns((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to delete pattern');
    }
  }

  function changeProp(id: string, key: string, value: unknown) {
    setRoot(setProps(root, id, { [key]: value }));
  }

  function setBinding(id: string, binding: Binding | undefined) {
    setRoot(
      updateNode(root, id, (node) => {
        if (!binding) {
          const next = { ...node };
          delete next.binding;
          return next;
        }
        return { ...node, binding };
      }),
    );
  }

  function bindField(id: string, key: string, fieldName: string | undefined) {
    const fieldKey = `${key}Field`;
    setRoot(
      updateNode(root, id, (node) => {
        const prev = node.props ?? {};
        // Drop the existing binding key, then re-add it only when a field is chosen.
        const rest = Object.fromEntries(Object.entries(prev).filter(([k]) => k !== fieldKey));
        const props = fieldName ? { ...rest, [fieldKey]: fieldName } : rest;
        return { ...node, props };
      }),
    );
  }

  function remove(id: string) {
    setRoot(removeNode(root, id));
    if (selectedId === id) setSelectedId(null);
  }

  function dropOn(targetId: string) {
    const source = draggingId;
    setDraggingId(null);
    if (!source || source === targetId) return;
    const target = findNode(root, targetId);
    if (!target) return;
    if (isContainerType(target.type)) {
      setRoot(moveNode(root, source, targetId, target.children?.length ?? 0));
    } else {
      const info = parentInfo(root, targetId);
      if (info) setRoot(moveNode(root, source, info.parentId, info.index + 1));
    }
  }

  function localeLabel(loc: string): string {
    return loc === defaultLocale ? `${loc} (default)` : loc;
  }

  // Edits change `root`/`title` references away from the loaded baseline.
  function isDirty(): boolean {
    return title !== baseline.title || root !== baseline.root;
  }

  // Switch the edited locale: load that locale's content (the page for the
  // default; the translation, or a fresh-id copy of the default, otherwise).
  function switchLocale(next: string) {
    if (next === locale) return;
    if (isDirty() && !window.confirm(`Discard unsaved changes to "${localeLabel(locale)}"?`)) {
      return;
    }
    const draftForLocale = localeDraft(page, defaultLocale, next, translations, genId);
    setLocale(next);
    setTitle(draftForLocale.title);
    setRoot(draftForLocale.root);
    setSelectedId(draftForLocale.root.id);
    setLocaleIsNew(draftForLocale.isNew);
    setBaseline({ title: draftForLocale.title, root: draftForLocale.root });
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (isDefaultLocale) {
        await api.putPage(org.id, project.id, draft);
      } else {
        const translation = toTranslation(page, locale, title, root);
        await api.putTranslation(org.id, project.id, translation);
        setTranslations((prev) => [...prev.filter((t) => t.id !== translation.id), translation]);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto flex h-[calc(100vh-3.25rem)] max-w-7xl flex-col px-4 py-3">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button
          aria-label="Back to project"
          className="text-sm text-slate-500 hover:text-slate-900"
          onClick={onClose}
        >
          ← {project.name}
        </button>
        <input
          aria-label="Page title"
          className="w-56 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <span className="text-xs text-slate-400">{page.path}</span>
        {settings && settings.locales.length > 1 && (
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Locale
            <select
              aria-label="Editing locale"
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              value={locale}
              onChange={(e) => switchLocale(e.target.value)}
            >
              {settings.locales.map((loc) => (
                <option key={loc} value={loc}>
                  {localeLabel(loc)}
                </option>
              ))}
            </select>
          </label>
        )}
        {!isDefaultLocale && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            translating {locale}
            {localeIsNew && !isDirty() ? ' · copied from default' : ''}
          </span>
        )}
        <button
          onClick={save}
          disabled={saving}
          className="ml-auto rounded-md bg-slate-900 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : isDefaultLocale ? 'Save page' : 'Save translation'}
        </button>
      </div>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Left: palette + block outline */}
        <section className="flex w-1/2 min-w-0 flex-col gap-3 overflow-auto pr-1">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Add block
            </h3>
            <div className="flex flex-col gap-2">
              {CATEGORIES.map((cat) => (
                <div key={cat.key} className="flex flex-wrap items-center gap-1.5">
                  <span className="w-20 text-xs text-slate-400">{cat.label}</span>
                  {BLOCK_DESCRIPTORS.filter((d) => d.category === cat.key).map((d) => (
                    <button
                      key={d.type}
                      className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs hover:border-slate-500"
                      onClick={() => addBlock(d.type)}
                    >
                      + {d.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              Adds inside the selected container, otherwise after the selection.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Patterns</h3>
              <button
                className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] hover:border-slate-500 disabled:opacity-40"
                onClick={saveAsPattern}
                disabled={!selectedId}
                title="Save the selected block (and its contents) as a reusable pattern"
              >
                + Save selection
              </button>
            </div>
            {patterns.length === 0 ? (
              <p className="text-[11px] text-slate-400">
                Save a selection as a pattern, then insert it (forked) anywhere.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {patterns.map((p) => (
                  <div key={p.id} className="flex items-center gap-1">
                    <button
                      className="flex-1 truncate rounded-md border border-slate-300 bg-white px-2 py-1 text-left text-xs hover:border-slate-500"
                      onClick={() => insertPattern(p)}
                      title="Insert a forked copy into the selection"
                    >
                      {p.name}
                    </button>
                    <button
                      aria-label={`Delete pattern ${p.name}`}
                      className="rounded px-1 text-xs text-red-400 hover:text-red-700"
                      onClick={() => deletePattern(p.id)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <BlockTree
              node={root}
              treeRoot={root}
              rootId={root.id}
              depth={0}
              selectedId={selectedId}
              datasets={datasets}
              media={media}
              onSelect={setSelectedId}
              onMove={(id, dir) => setRoot(moveWithinParent(root, id, dir))}
              onRemove={remove}
              onChangeProp={changeProp}
              onSetBinding={setBinding}
              onBindField={bindField}
              onDragStart={setDraggingId}
              onDropOn={dropOn}
            />
          </div>
        </section>

        {/* Right: live preview */}
        <section className="w-1/2 min-w-0">
          <PreviewPane src={preview.src} loading={preview.loading} error={preview.error} />
        </section>
      </div>
    </main>
  );
}
