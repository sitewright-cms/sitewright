// The TailwindCSS Reference modal: browse by category → topic → class, or search across all three.
//
// Three levels, and only the middle one needed inventing. Categories are the familiar shelves;
// classes come straight from the installed Tailwind; TOPICS are derived from the CSS properties a
// class generates, which is what makes "font size" find the font-size utilities without anyone
// maintaining a synonym list. See tailwind-search.ts.
//
// Every class row carries its GENERATED CSS — the exact declarations Tailwind emits — plus a copy
// button and an insert-at-cursor button. Clicking the row itself copies, matching every other
// Library gallery.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ClipboardCopy, CornerDownLeft } from 'lucide-react';
import type { Category, ReferenceTopic, TailwindReference } from '@sitewright/tailwind-reference/meta';
import { CATEGORY_LABELS, formatDecl } from '@sitewright/tailwind-reference/meta';
import { Modal } from '../ui/Modal';
import { SearchField } from '../ui/SearchField';
import { useToast } from '../ui/Toast';
import { useCopy } from '../ui/useCopy';
import { Tooltip } from '../ui/Tooltip';
import { glassPanel } from '../../theme';
import { useScrollPaging } from '../../lib/useScrollPaging';
import { hasCodeInsertSink, insertIntoCode, subscribeCodeInsertSink } from '../../lib/code-insert-sink';
import { TailwindPreview } from './TailwindPreview';
import { useTailwindReference } from './tailwind-reference-data';
import { bestMatch, byCategory, searchReference, type ClassHit } from './tailwind-search';

function navBtn(active: boolean): string {
  return `w-full rounded-lg px-3 py-1.5 text-left text-xs font-medium transition ${
    active
      ? 'bg-slate-900 text-white shadow-sm'
      : 'text-slate-500 dark:text-slate-400 hover:bg-white dark:hover:bg-white/10 hover:text-slate-800 dark:hover:text-slate-100'
  }`;
}

/** Whether a code editor is open, as reactive state — drives the Insert button's enabled-ness. */
function useCanInsert(): boolean {
  return useSyncExternalStore(subscribeCodeInsertSink, hasCodeInsertSink, () => false);
}

/** One utility class: preview, name, generated declarations, and the copy / insert actions. */
function ClassRow({
  topic,
  index,
  highlighted,
  onCopy,
  copied,
  canInsert,
  onInsert,
}: {
  topic: ReferenceTopic;
  index: number;
  highlighted: boolean;
  onCopy: () => void;
  copied: boolean;
  canInsert: boolean;
  onInsert: () => void;
}) {
  const entry = topic.classes[index];
  const rowRef = useRef<HTMLLIElement>(null);
  // A search that resolves to one exact class scrolls that row into view — the same "show me where
  // this lives" move the preview's click-to-code makes in the source editor.
  useEffect(() => {
    if (highlighted) rowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlighted]);
  if (!entry) return null;
  const [name, decls, modifiers] = entry;

  return (
    <li
      ref={rowRef}
      data-class-name={name}
      className={`flex items-center gap-3 rounded-lg px-2 py-1.5 transition ${
        highlighted
          ? 'bg-indigo-50 ring-1 ring-indigo-300 dark:bg-indigo-400/10 dark:ring-indigo-400/40'
          : 'hover:bg-white dark:hover:bg-white/5'
      }`}
    >
      <TailwindPreview kind={topic.preview} decls={decls} name={name} />
      <button
        type="button"
        onClick={onCopy}
        title={`Copy ${name}`}
        className="min-w-0 flex-1 text-left"
      >
        <code className="block truncate font-mono text-[12.5px] font-semibold text-indigo-700 dark:text-indigo-300">
          {copied ? 'Copied!' : name}
          {modifiers === 1 && (
            <span className="ml-1 font-normal text-slate-400 dark:text-slate-500" title="Accepts a modifier, e.g. text-sm/relaxed">
              /…
            </span>
          )}
        </code>
        {/* The class's OWN declarations, not the topic's deduped `props` zipped against them — a
            `container` row has 6 declarations under a 2-property signature, and the zip showed 2. */}
        <span className="block truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
          {decls.map(formatDecl).join('; ')}
        </span>
      </button>
      <span className="flex shrink-0 items-center gap-0.5">
        <Tooltip tip="Copy class name" side="left">
          <button
            type="button"
            onClick={onCopy}
            aria-label={`Copy ${name}`}
            className="rounded-md p-1.5 text-slate-400 transition hover:bg-white hover:text-indigo-600 dark:hover:bg-white/10 dark:hover:text-indigo-300"
          >
            <ClipboardCopy className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        {/* The tooltip's own wrapper carries the hover, so the tip still shows while the button is
            disabled — which is exactly when the author most needs to be told why. */}
        <Tooltip tip={canInsert ? 'Insert at cursor' : 'Open a page in code mode to insert'} side="left">
          <button
            type="button"
            onClick={onInsert}
            disabled={!canInsert}
            aria-label={`Insert ${name} at cursor`}
            className="rounded-md p-1.5 text-slate-400 transition enabled:hover:bg-white enabled:hover:text-indigo-600 disabled:opacity-30 dark:enabled:hover:bg-white/10 dark:enabled:hover:text-indigo-300"
          >
            <CornerDownLeft className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </span>
    </li>
  );
}

/** One topic: its title, prose, the CSS properties it sets, and its classes (paged in on scroll). */
function TopicSection({
  topic,
  highlightClass,
  copiedId,
  onCopy,
  canInsert,
}: {
  topic: ReferenceTopic;
  highlightClass: string | null;
  copiedId: string | null;
  onCopy: (name: string, id: string) => void;
  canInsert: boolean;
}) {
  const toast = useToast();
  // Colour topics carry ~300 classes and the mask topics thousands; page them in rather than
  // rendering every row (and every shadow-root preview) the moment a category opens.
  const { visible, onScroll, ref } = useScrollPaging(topic.classes.length);
  // A highlighted class deep in a long list must be rendered before it can be scrolled to.
  const highlightIndex = highlightClass
    ? topic.classes.findIndex(([name]) => name === highlightClass)
    : -1;
  const count = Math.max(visible, highlightIndex + 1);
  const shown = Math.min(count, topic.classes.length);
  const overflow = topic.classes.length - shown;

  return (
    <section className="mb-6">
      <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">{topic.title}</h3>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{topic.description}</p>
      <p className="mb-2 mt-1 font-mono text-[11px] text-slate-400 dark:text-slate-500">
        {topic.props.join(' · ')}
      </p>
      <div ref={ref} onScroll={onScroll} className="max-h-[60vh] overflow-auto">
        <ul>
          {topic.classes.slice(0, shown).map(([name], i) => (
            <ClassRow
              key={name}
              topic={topic}
              index={i}
              highlighted={name === highlightClass}
              copied={copiedId === `${topic.id}:${name}`}
              onCopy={() => onCopy(name, `${topic.id}:${name}`)}
              canInsert={canInsert}
              onInsert={() => {
                if (insertIntoCode(name)) toast.show(`Inserted ${name}`);
              }}
            />
          ))}
        </ul>
      </div>
      {overflow > 0 && (
        <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
          showing {shown} of {topic.classes.length} — scroll the list for more
        </p>
      )}
    </section>
  );
}

/** The search result view: matching categories, topics, then individual classes. */
function SearchResultsView({
  reference,
  query,
  onOpenTopic,
  onOpenCategory,
}: {
  reference: TailwindReference;
  query: string;
  onOpenTopic: (topic: ReferenceTopic, className?: string) => void;
  onOpenCategory: (category: Category) => void;
}) {
  const results = useMemo(() => searchReference(reference, query), [reference, query]);
  const total = results.categories.length + results.topics.length + results.classes.length;
  if (total === 0) {
    return <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">No matches.</p>;
  }
  return (
    <div className="flex flex-col gap-5">
      {results.categories.length > 0 && (
        <section>
          <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Categories</h4>
          <div className="flex flex-wrap gap-2">
            {results.categories.map((c) => (
              <button
                key={c}
                onClick={() => onOpenCategory(c)}
                className={`${glassPanel} rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:text-indigo-700 dark:text-slate-300 dark:hover:text-indigo-300`}
              >
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
        </section>
      )}
      {results.topics.length > 0 && (
        <section>
          <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
            Topics ({results.topics.length})
          </h4>
          <ul className="flex flex-col gap-1.5">
            {results.topics.map((topic) => (
              <li key={topic.id}>
                <button
                  onClick={() => onOpenTopic(topic)}
                  className={`${glassPanel} w-full rounded-lg px-3 py-2 text-left transition hover:bg-white dark:hover:bg-white/10`}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{topic.title}</span>
                    <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      {CATEGORY_LABELS[topic.category]}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
                      {topic.classes.length} classes
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                    {topic.description}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {results.classes.length > 0 && (
        <section>
          <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
            Classes ({results.classTotal})
          </h4>
          <ul className="flex flex-col gap-1">
            {results.classes.map((hit: ClassHit) => (
              <li key={`${hit.topic.id}:${hit.name}`}>
                <button
                  onClick={() => onOpenTopic(hit.topic, hit.name)}
                  className="flex w-full items-baseline gap-2 rounded-lg px-2 py-1 text-left transition hover:bg-white dark:hover:bg-white/5"
                >
                  <code className="font-mono text-[12.5px] font-semibold text-indigo-700 dark:text-indigo-300">{hit.name}</code>
                  <span className="truncate text-[11px] text-slate-500 dark:text-slate-400">{hit.topic.title}</span>
                </button>
              </li>
            ))}
          </ul>
          {results.classTotal > results.classes.length && (
            <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
              showing the {results.classes.length} closest of {results.classTotal} matches — narrow the search to see more
            </p>
          )}
        </section>
      )}
    </div>
  );
}

/**
 * The reference modal. Left nav picks a category; the pane shows that category's topics, or — while
 * a query is present — the search results across all three levels.
 */
export function TailwindReferenceModal({ onClose }: { onClose: () => void }) {
  const { reference, loading, error } = useTailwindReference();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category | null>(null);
  /** An explicitly CHOSEN topic — set by clicking a result or a category, never by typing. */
  const [pinned, setPinned] = useState<{ id: string; className: string | null } | null>(null);
  const toast = useToast();
  const [copiedId, copy] = useCopy(() => toast.show('Copied to clipboard'));
  const canInsert = useCanInsert();

  const categories = useMemo(() => (reference ? [...byCategory(reference.topics).keys()] : []), [reference]);

  // A query that resolves unambiguously — an exact class name, or a single matching topic — jumps
  // straight to it: typing `text-sm` SHOWS the font-size utilities with that row picked out, rather
  // than handing back a result list to click through.
  //
  // ★ This is DERIVED, never stored. It used to be a `useEffect` on `query` that wrote state, which
  // quietly broke every click on a search result: `openTopic` clears the search box, the effect saw
  // `query` go empty, read that as "the user cleared it", and wiped the focus the click had just
  // set — one tick later the view fell back to the whole category with the highlight gone. An effect
  // keyed on a value that other handlers also write cannot tell "the user typed" from "code reset
  // it". Deriving removes the question: while a query is present the query decides, and the moment
  // it is empty the explicit pin decides.
  const focusTopic = useMemo(() => {
    if (!reference || !query.trim()) return pinned;
    const match = bestMatch(searchReference(reference, query), query);
    if (!match) return null;
    return 'name' in match ? { id: match.topic.id, className: match.name } : { id: match.id, className: null };
  }, [reference, query, pinned]);

  const openTopic = (topic: ReferenceTopic, className?: string) => {
    setCategory(topic.category);
    setPinned({ id: topic.id, className: className ?? null });
    setQuery('');
  };

  const openCategory = (next: Category) => {
    setCategory(next);
    setPinned(null);
    setQuery('');
  };

  const focused = useMemo(
    () => (focusTopic ? (reference?.topics.find((t) => t.id === focusTopic.id) ?? null) : null),
    [reference, focusTopic],
  );

  const shownTopics = useMemo(() => {
    if (!reference) return [];
    if (focused) return [focused];
    if (query.trim() || !category) return [];
    return reference.topics.filter((t) => t.category === category);
  }, [reference, category, focused, query]);

  // The nav follows a search that jumped somewhere, so the highlighted shelf always matches what is
  // on screen — without a state write that would race the derivation above.
  const activeCategory = focused ? focused.category : category;
  const searching = query.trim().length > 0 && !focusTopic;

  return (
    <Modal title="TailwindCSS Reference" size="full" onClose={onClose}>
      <div className="flex h-full min-h-0 gap-4 p-5">
        <nav className="hidden w-44 shrink-0 flex-col gap-1 overflow-auto sm:flex">
          {categories.map((c) => (
            <button key={c} onClick={() => openCategory(c)} className={navBtn(activeCategory === c && !searching)}>
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <SearchField
            ariaLabel="Search the Tailwind reference"
            autoFocus
            placeholder="Search a class or a property — “text-sm”, “font size”, “shadow”…"
            value={query}
            onChange={setQuery}
          />
          <div className="min-h-0 flex-1 overflow-auto pr-1">
            {loading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="skeleton h-8 w-full rounded-lg" />
                ))}
              </div>
            ) : error || !reference ? (
              <p className="py-8 text-center text-sm text-rose-500 dark:text-rose-300">
                Couldn’t load the Tailwind reference. Close and reopen to retry.
              </p>
            ) : searching ? (
              <SearchResultsView reference={reference} query={query} onOpenTopic={openTopic} onOpenCategory={openCategory} />
            ) : shownTopics.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                Pick a category, or search for a class or a CSS property.
              </p>
            ) : (
              shownTopics.map((topic) => (
                <TopicSection
                  key={topic.id}
                  topic={topic}
                  highlightClass={focusTopic?.id === topic.id ? focusTopic.className : null}
                  copiedId={copiedId}
                  onCopy={(name, id) => copy(name, id)}
                  canInsert={canInsert}
                />
              ))
            )}
          </div>
          <p className="shrink-0 text-[11px] text-slate-500 dark:text-slate-400">
            {reference ? `Tailwind CSS ${reference.tailwindVersion} · ${reference.classCount.toLocaleString()} utilities` : 'Loading…'}
            {' · click a class to copy it'}
            {canInsert ? ' · or insert it at the cursor' : ''}
          </p>
        </div>
      </div>
    </Modal>
  );
}
