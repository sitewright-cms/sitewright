import { useEffect, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { html } from '@codemirror/lang-html';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}

/** The single editor accent — used for the gutter border, cursor, selection, and code tokens. */
const ACCENT = '#818cf8'; // indigo-400

/**
 * The Sitewright code-editor look: a black canvas with ONE accent (indigo). The gutter carries the
 * accent as its right border; the cursor, selection, and active-line gutter pick it up too. Added
 * AFTER `basicSetup` so it wins the theme + highlight facets.
 */
const blackTheme = EditorView.theme(
  {
    '&': { height: '100%', fontSize: '13px', backgroundColor: '#0a0a0f', color: '#e4e4e7' },
    '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: '1.6' },
    '.cm-content': { caretColor: ACCENT },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: ACCENT, borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'rgba(129,140,248,0.28)',
    },
    '.cm-gutters': {
      backgroundColor: '#0a0a0f',
      color: '#3f3f46',
      border: 'none',
      borderRight: `2px solid ${ACCENT}`,
    },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.035)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: ACCENT },
    '.cm-lineNumbers .cm-gutterElement': { color: '#3f3f46' },
    '.cm-foldPlaceholder': { backgroundColor: '#27272a', color: '#a1a1aa', border: 'none' },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'rgba(129,140,248,0.25)',
      color: 'inherit',
      outline: `1px solid ${ACCENT}`,
    },
  },
  { dark: true },
);

/** A single-accent syntax palette: tags/keywords in the accent, everything else a calm light grey. */
const blackHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.tagName, t.operatorKeyword, t.moduleKeyword], color: ACCENT },
  { tag: [t.attributeName, t.propertyName], color: '#c7d2fe' },
  { tag: [t.string, t.special(t.string), t.attributeValue, t.regexp], color: '#a5b4fc' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.meta], color: '#52525b', fontStyle: 'italic' },
  { tag: [t.number, t.bool, t.atom, t.null], color: '#e4e4e7' },
  { tag: [t.bracket, t.angleBracket, t.punctuation, t.separator], color: '#71717a' },
  { tag: [t.heading, t.strong], color: '#f4f4f5', fontWeight: 'bold' },
  { tag: t.link, color: ACCENT, textDecoration: 'underline' },
]);

/**
 * A thin CodeMirror 6 wrapper for authoring HTML + Handlebars template source.
 *
 * Bundled, not CDN-loaded: the editor SPA is served under `default-src 'self'`, so a
 * runtime CDN editor (e.g. Monaco's default loader) is blocked — CodeMirror ships in the
 * app bundle and stays self-contained for the single-container deployment.
 *
 * It is intentionally NOT a controlled component: `value` only seeds the initial document
 * and applies *external* resets. Echoes of the user's own edits (which flow back in via
 * `onChange` → parent state → `value`) are ignored, so fast typing is never reverted.
 */
export function CodeEditor({ value, onChange, ariaLabel }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // The last document we emitted upward — used to distinguish our own echo from a genuine
  // external `value` change (the classic controlled-CodeMirror revert-on-typing guard).
  const lastEmitted = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          html(),
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            const doc = u.state.doc.toString();
            lastEmitted.current = doc;
            onChangeRef.current(doc);
          }),
          // Added after basicSetup so the black theme + single-accent highlight win.
          blackTheme,
          syntaxHighlighting(blackHighlight),
        ],
      }),
    });
    if (ariaLabel) view.contentDOM.setAttribute('aria-label', ariaLabel);
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once: CodeMirror owns its document thereafter; external `value` changes are
    // applied by the sync effect below (so `value` is intentionally not a dependency here).
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (value === lastEmitted.current) return; // our own echo — leave the live doc untouched
    const current = view.state.doc.toString();
    if (value === current) return;
    lastEmitted.current = value;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  return <div ref={hostRef} className="h-full overflow-hidden" data-testid="code-editor" />;
}
