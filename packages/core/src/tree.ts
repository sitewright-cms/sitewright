import { assertWithinTreeDepth, type PageNode } from '@sitewright/schema';
import { NodeNotFoundError, TreeOperationError } from './errors.js';

/**
 * Block-tree operations. Every mutating function is **immutable**: it returns a
 * new tree and never modifies its input. Unchanged subtrees are shared by
 * reference, so only the path from the root to the changed node is rebuilt.
 *
 * These functions recurse over the tree. The public entry points first call
 * `assertWithinTreeDepth`, so they reject pathologically deep input (which would
 * otherwise overflow the call stack) even when invoked on data that did not pass
 * through `PageNodeSchema.parse`.
 */

/** Depth-first pre-order traversal. `ancestors` lists nodes from root down to (not including) `node`. */
export function walk(
  root: PageNode,
  visit: (node: PageNode, ancestors: readonly PageNode[]) => void,
): void {
  assertWithinTreeDepth(root);
  const recur = (node: PageNode, ancestors: PageNode[]): void => {
    visit(node, ancestors);
    if (node.children) {
      const next = [...ancestors, node];
      for (const child of node.children) recur(child, next);
    }
  };
  recur(root, []);
}

/** Finds the first node with the given id, or `undefined`. */
export function findNode(root: PageNode, id: string): PageNode | undefined {
  let found: PageNode | undefined;
  walk(root, (node) => {
    if (found === undefined && node.id === id) found = node;
  });
  return found;
}

/** Returns the ancestors of `id` (root first), or `undefined` if the id is absent. */
export function getAncestors(root: PageNode, id: string): PageNode[] | undefined {
  let result: PageNode[] | undefined;
  walk(root, (node, ancestors) => {
    if (result === undefined && node.id === id) result = [...ancestors];
  });
  return result;
}

/** All node ids in document order (may contain duplicates if the tree is malformed). */
export function collectIds(root: PageNode): string[] {
  const ids: string[] = [];
  walk(root, (node) => ids.push(node.id));
  return ids;
}

/**
 * Every author utility-class list in the tree (one entry per node that sets
 * `className`), in document order. The Tailwind pipeline scans these to compile
 * a minimal stylesheet — collecting them from the tree (rather than the rendered
 * HTML) avoids false positives from skeleton CSS or raw custom head/footer.
 */
export function collectClassNames(root: PageNode): string[] {
  const classNames: string[] = [];
  walk(root, (node) => {
    if (node.className) classNames.push(node.className);
  });
  return classNames;
}

/** A client-editable region declared in a code-first template via `{{edit "key" "default"}}`. */
export interface EditRegion {
  key: string;
  /** The developer's default text, shown until a client overrides it (via `page.content`). */
  default: string;
}

// Matches `{{edit "key" "default"}}` with double- OR single-quoted args (Handlebars accepts
// both), default optional. Key: group 1|2. Default: group 3|4.
const EDIT_REGION_RE =
  /\{\{\s*edit\s+(?:"([^"]*)"|'([^']*)')(?:\s+(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'))?\s*\}\}/g;

/**
 * The client-editable regions declared in a code-first template source — one entry per
 * distinct `{{edit "key" "default"}}` (first occurrence wins; a repeated key is the same
 * region). Lets the client editor build a content form from the marked regions WITHOUT
 * exposing the template structure as something the client may change. Both quote styles are
 * recognized. Note: only the page's OWN source is scanned — `{{edit}}` inside an included
 * `{{> partial}}` renders correctly but is not (yet) surfaced as a client field.
 */
export function extractEditRegions(source: string): EditRegion[] {
  const out: EditRegion[] = [];
  const seen = new Set<string>();
  for (const m of source.matchAll(EDIT_REGION_RE)) {
    const key = m[1] ?? m[2] ?? '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, default: (m[3] ?? m[4] ?? '').replace(/\\(['"])/g, '$1') });
  }
  return out;
}

/** The kind of editable region, which drives the editor widget + the binding's render sink. */
export type RegionKind = 'text' | 'rich' | 'link' | 'image' | 'bg';

/** A client-editable region: a legacy `{{edit}}` helper OR a `data-sw-*` leaf directive. */
export interface EditableRegion extends EditRegion {
  kind: RegionKind;
}

// A `data-sw-text`/`data-sw-html` leaf directive WITH its authored default inner content:
// `<tag … data-sw-(text|html)="key" …>DEFAULT</tag>`. Group 1: tag (back-referenced to find the
// close); 2: kind; 3|4: key; 5: inner default. Best-effort — `[^>]` stops at the first `>` so an
// attribute value containing `>` (rare) just yields no match, and nested SAME-tag content may
// truncate the captured default (the render is still correct; only the editor's seed is affected).
const ELEMENT_DIRECTIVE_RE =
  /<([a-zA-Z][\w-]*)\b[^>]*?\bdata-sw-(text|html)\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/\1>/g;
// URL-valued directives — key only (the editable value is a URL: a link href, an image src, or a
// background-image). Captured per attribute so the side panel can offer the right widget.
const HREF_DIRECTIVE_RE = /\bdata-sw-href\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const SRC_DIRECTIVE_RE = /\bdata-sw-src\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const BG_DIRECTIVE_RE = /\bdata-sw-bg\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * All client-editable regions declared in a code-first source — legacy `{{edit "key" "default"}}`
 * helpers AND `data-sw-text`/`data-sw-html` leaf directives — deduped by key (first occurrence
 * wins), each tagged with its {@link RegionKind} so the editor can pick the right widget and seed
 * its default. Only the page's OWN source is scanned (regions inside an included `{{> partial}}`
 * render but aren't surfaced as fields). Editable singletons should live OUTSIDE loops — a directive
 * key repeated by `{{#each}}` collapses to one field.
 */
export function extractRegions(source: string): EditableRegion[] {
  const out: EditableRegion[] = [];
  const seen = new Set<string>();
  const add = (key: string, def: string, kind: RegionKind): void => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ key, default: def, kind });
  };
  for (const m of source.matchAll(EDIT_REGION_RE)) add(m[1] ?? m[2] ?? '', (m[3] ?? m[4] ?? '').replace(/\\(['"])/g, '$1'), 'text');
  for (const m of source.matchAll(ELEMENT_DIRECTIVE_RE)) {
    const kind: RegionKind = m[2] === 'html' ? 'rich' : 'text';
    add(m[3] ?? m[4] ?? '', (m[5] ?? '').trim(), kind);
  }
  for (const m of source.matchAll(HREF_DIRECTIVE_RE)) add(m[1] ?? m[2] ?? '', '', 'link');
  for (const m of source.matchAll(SRC_DIRECTIVE_RE)) add(m[1] ?? m[2] ?? '', '', 'image');
  for (const m of source.matchAll(BG_DIRECTIVE_RE)) add(m[1] ?? m[2] ?? '', '', 'bg');
  return out;
}

/** Upper bound on distinct class tokens extracted from one HTML/source string. */
export const MAX_EXTRACTED_CLASS_TOKENS = 2048;

/**
 * Extract the literal CSS class tokens from `class="…"` / `class='…'` attributes in an HTML
 * string or a Handlebars template source — the Tailwind JIT compiler's candidate set for
 * code-first pages (the analogue of {@link collectClassNames} for raw markup rather than a
 * block tree). Used by both the publish build and the editor's live-preview endpoint, so the
 * extraction stays identical across the two paths.
 *
 * Handlebars `{{ … }}` expressions inside a class value are stripped first — a dynamic class
 * value can't be precompiled, so it must not leak a half-token into the candidate set. The
 * result is deduplicated and capped at `max` tokens: a rendered body can be up to ~1 MiB of
 * attacker-authored markup, and an uncapped synthetic class list would let an owner/admin
 * spike Tailwind's compiler. Real pages use far fewer than the cap.
 */
export function extractClassNames(html: string, max: number = MAX_EXTRACTED_CLASS_TOKENS): string[] {
  const re = /class\s*=\s*"([^"]*)"|class\s*=\s*'([^']*)'/g;
  const tokens = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const value = (m[1] ?? m[2] ?? '').replace(/\{\{[^}]*\}\}/g, ' ');
    for (const token of value.split(/\s+/)) {
      if (!token) continue;
      tokens.add(token);
      if (tokens.size >= max) return [...tokens];
    }
  }
  return [...tokens];
}

/**
 * Deep-clones a subtree, assigning every node a FRESH id from `idGen`. This is the
 * "fork on insert" primitive for the Patterns library: inserting a pattern (or the
 * same pattern twice) yields independent nodes with no id collisions and no link
 * back to the source. Immutable — the input is not mutated.
 */
export function reIdTree(node: PageNode, idGen: () => string): PageNode {
  assertWithinTreeDepth(node);
  const recur = (n: PageNode): PageNode => ({
    ...n,
    id: idGen(),
    children: n.children?.map(recur),
  });
  return recur(node);
}

/** Ids that appear more than once in the tree. */
export function findDuplicateIds(root: PageNode): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  walk(root, (node) => {
    if (seen.has(node.id)) duplicates.add(node.id);
    else seen.add(node.id);
  });
  return [...duplicates];
}

interface ApplyResult {
  node: PageNode;
  found: boolean;
}

function applyUpdate(
  node: PageNode,
  id: string,
  updater: (node: PageNode) => PageNode,
): ApplyResult {
  if (node.id === id) return { node: updater(node), found: true };
  if (!node.children) return { node, found: false };

  let found = false;
  const children = node.children.map((child) => {
    if (found) return child;
    const result = applyUpdate(child, id, updater);
    if (result.found) found = true;
    return result.node;
  });

  return found ? { node: { ...node, children }, found } : { node, found };
}

/** Returns a new tree with `id`'s node replaced by `updater(node)`. Throws if absent. */
export function updateNode(
  root: PageNode,
  id: string,
  updater: (node: PageNode) => PageNode,
): PageNode {
  assertWithinTreeDepth(root);
  const { node, found } = applyUpdate(root, id, updater);
  if (!found) throw new NodeNotFoundError(id);
  return node;
}

/** Returns a new tree with `id`'s node replaced by `replacement`. Throws if absent. */
export function replaceNode(root: PageNode, id: string, replacement: PageNode): PageNode {
  return updateNode(root, id, () => replacement);
}

function removeFrom(node: PageNode, id: string): ApplyResult {
  if (!node.children) return { node, found: false };

  let found = false;
  const children: PageNode[] = [];
  for (const child of node.children) {
    if (!found && child.id === id) {
      found = true;
      continue;
    }
    if (found) {
      children.push(child);
      continue;
    }
    const result = removeFrom(child, id);
    if (result.found) found = true;
    children.push(result.node);
  }

  return found ? { node: { ...node, children }, found } : { node, found };
}

/** Returns a new tree with `id`'s node removed. Throws if absent or if `id` is the root. */
export function removeNode(root: PageNode, id: string): PageNode {
  if (root.id === id) throw new TreeOperationError('cannot remove the root node');
  assertWithinTreeDepth(root);
  const { node, found } = removeFrom(root, id);
  if (!found) throw new NodeNotFoundError(id);
  return node;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Returns a new tree with `child` inserted into `parentId`'s children at
 * `index` (appended if `index` is omitted; clamped to a valid position).
 */
export function insertChild(
  root: PageNode,
  parentId: string,
  child: PageNode,
  index?: number,
): PageNode {
  return updateNode(root, parentId, (parent) => {
    const base = parent.children ?? [];
    const at = index === undefined ? base.length : clamp(index, 0, base.length);
    const children = [...base.slice(0, at), child, ...base.slice(at)];
    return { ...parent, children };
  });
}

/**
 * Moves `id` to be a child of `newParentId` at `index`. Throws if either node is
 * absent, if moving the root, or if moving a node into its own subtree.
 */
export function moveNode(
  root: PageNode,
  id: string,
  newParentId: string,
  index?: number,
): PageNode {
  if (id === newParentId) throw new TreeOperationError('cannot move a node into itself');

  const node = findNode(root, id);
  if (node === undefined) throw new NodeNotFoundError(id);
  if (findNode(node, newParentId) !== undefined) {
    throw new TreeOperationError('cannot move a node into its own subtree');
  }

  const without = removeNode(root, id);
  return insertChild(without, newParentId, node, index);
}
