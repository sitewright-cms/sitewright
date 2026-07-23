// DOM helpers for the dataset `richtext` toolbar (RichTextField) — apply the shared toolbar vocabulary to a
// `contentEditable` surface by emitting EXISTING Tailwind utility CLASSES (colour/highlight/size/font on a
// wrapping <span>; alignment/indent on the enclosing block) rather than inline styles, so authored content
// stays consistent with the rest of the codebase and needs no new sanitizer style-allowlist. The pure
// class-list math lives in @sitewright/blocks (`setGroupClass`/`stepIndentClass`); this module is only the
// Selection/Range wrangling. The on-page bridge (preview-bridge.ts) mirrors this same logic in vanilla JS
// for the sandboxed-preview realm — keep the two in step.
import { setGroupClass, stepIndentClass, type RichCmd } from '@sitewright/blocks';
import { safeUrl } from '@sitewright/blocks/url';

/** Focus the editable and run a document.execCommand (marks / lists / headings / hr / clear-format). Marks
 *  emit SEMANTIC tags (`<strong>`/`<em>`/…) — the browser default (styleWithCSS off) — which the site's
 *  typography/normalize CSS already styles, so no class is needed for them. */
export function runExec(editable: HTMLElement, cmd: string, arg?: string): void {
  editable.focus();
  try {
    document.execCommand(cmd, false, arg);
  } catch {
    /* execCommand unsupported (e.g. jsdom) — no-op */
  }
}

/** The current selection Range, but only when it is non-empty AND lives inside `editable`. */
function selectionInside(editable: HTMLElement): Range | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return null;
  if (!editable.contains(range.commonAncestorContainer)) return null;
  return range;
}

/**
 * Toggle an INLINE utility class (text colour / highlight / size / font) on the current selection: wrap the
 * selected content in a `<span class="…">`, first stripping any existing member of the same `group` from
 * spans within the selection (so members never stack). An empty `cls` just strips the group (clear). The
 * caller supplies the mutually-exclusive `group` (e.g. RICH_COLOR_CLASSES ∪ the project's CI colour classes).
 */
export function applyInlineClass(editable: HTMLElement, group: ReadonlySet<string>, cls: string): void {
  const range = selectionInside(editable);
  if (!range) return;
  editable.focus();
  // Fast path: the selection exactly covers the full contents of a single <span> (a prior toolbar wrapper) —
  // RETAG its group class in place instead of nesting a new span inside it (avoids dead, overridden classes).
  const host = range.commonAncestorContainer.nodeType === 1 ? (range.commonAncestorContainer as HTMLElement) : range.commonAncestorContainer.parentElement;
  if (host && host !== editable && host.tagName === 'SPAN' && host.textContent === range.toString()) {
    const retag = setGroupClass(host.getAttribute('class'), group, cls || undefined);
    if (retag) host.setAttribute('class', retag);
    else host.removeAttribute('class');
    return;
  }
  const holder = document.createElement('div');
  holder.appendChild(range.extractContents());
  // Strip any same-group class already on descendant elements of the selection, so a re-colour replaces.
  holder.querySelectorAll<HTMLElement>('[class]').forEach((el) => {
    const cleaned = setGroupClass(el.getAttribute('class'), group);
    if (cleaned) el.setAttribute('class', cleaned);
    else el.removeAttribute('class');
  });
  let inserted: Node;
  if (cls) {
    const span = document.createElement('span');
    span.className = cls;
    while (holder.firstChild) span.appendChild(holder.firstChild);
    inserted = span;
  } else {
    const frag = document.createDocumentFragment();
    while (holder.firstChild) frag.appendChild(holder.firstChild);
    inserted = frag;
  }
  const firstChild = inserted.firstChild;
  const lastChild = inserted.lastChild;
  range.insertNode(inserted);
  // Re-select the inserted content so the user sees what they styled + can keep formatting it.
  const sel = window.getSelection();
  if (sel && firstChild && lastChild) {
    const nr = document.createRange();
    nr.setStartBefore(cls ? (inserted as HTMLElement) : firstChild);
    nr.setEndAfter(cls ? (inserted as HTMLElement) : lastChild);
    sel.removeAllRanges();
    sel.addRange(nr);
  }
}

/** The top-level block elements (direct children of `editable`) that the current selection touches. When the
 *  selection sits directly in `editable` with no block wrapper, one is created (formatBlock 'p') so a class
 *  has somewhere structural to land. Returns [] when there is no usable selection. */
function selectedBlocks(editable: HTMLElement): HTMLElement[] {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return [];
  let range = sel.getRangeAt(0);
  if (!editable.contains(range.commonAncestorContainer)) return [];
  const topBlock = (node: Node): HTMLElement | null => {
    let el: Node | null = node.nodeType === 1 ? node : node.parentNode;
    while (el && el !== editable) {
      if (el.parentNode === editable) return el as HTMLElement;
      el = el.parentNode;
    }
    return null;
  };
  let start = topBlock(range.startContainer);
  if (!start) {
    // No block wrapper (bare text/inline in the editable) — wrap the selection in a <p> so alignment/indent
    // has a block to carry the class, then re-read the selection.
    runExec(editable, 'formatBlock', 'p');
    const s2 = window.getSelection();
    if (!s2 || s2.rangeCount === 0) return [];
    range = s2.getRangeAt(0);
    start = topBlock(range.startContainer);
    if (!start) return [];
  }
  const end = topBlock(range.endContainer) ?? start;
  const out: HTMLElement[] = [];
  for (let el: HTMLElement | null = start; el; el = el.nextElementSibling as HTMLElement | null) {
    out.push(el);
    if (el === end) break;
  }
  return out;
}

/** Set a BLOCK utility class (alignment) on every block the selection touches, replacing any same-group member. */
export function applyBlockClass(editable: HTMLElement, group: ReadonlySet<string>, cls: string): void {
  for (const block of selectedBlocks(editable)) {
    const cleaned = setGroupClass(block.getAttribute('class'), group, cls || undefined);
    if (cleaned) block.setAttribute('class', cleaned);
    else block.removeAttribute('class');
  }
}

/** Step the indent (left padding) of every block the selection touches one level in `dir` (+1 / -1). */
export function stepBlockIndent(editable: HTMLElement, dir: 1 | -1): void {
  for (const block of selectedBlocks(editable)) {
    const cleaned = stepIndentClass(block.getAttribute('class'), dir);
    if (cleaned) block.setAttribute('class', cleaned);
    else block.removeAttribute('class');
  }
}

/** Wrap the current selection in a link (or update the enclosing one) to `url`. The URL is scheme-sanitized
 *  (the same `safeUrl` boundary the `data-sw-href` link editor uses) so a `javascript:`/`data:` URL can never
 *  be written into `href`; an empty/rejected URL unlinks instead. */
export function applyLink(editable: HTMLElement, url: string): void {
  editable.focus();
  const safe = safeUrl(url, '');
  if (!safe) {
    runExec(editable, 'unlink');
    return;
  }
  runExec(editable, 'createLink', safe);
}

/** Insert a starter 2×2 table (a header row + a body row) at the caret. Cells are edited in place. */
export function insertStarterTable(editable: HTMLElement): void {
  editable.focus();
  const table =
    '<table><thead><tr><th>Heading</th><th>Heading</th></tr></thead>' +
    '<tbody><tr><td>Cell</td><td>Cell</td></tr><tr><td>Cell</td><td>Cell</td></tr></tbody></table><p><br></p>';
  try {
    document.execCommand('insertHTML', false, table);
  } catch {
    /* jsdom / unsupported — no-op */
  }
}

/** Convenience: run an `exec`-kind command from the shared manifest. */
export function runCmd(editable: HTMLElement, cmd: RichCmd): void {
  if (cmd.kind === 'exec' && cmd.cmd) runExec(editable, cmd.cmd, cmd.arg);
}
