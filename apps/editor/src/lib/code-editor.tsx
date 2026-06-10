import { useEffect, useRef } from 'react';
import { EditorView, keymap, Decoration, ViewPlugin, MatchDecorator, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting, indentUnit } from '@codemirror/language';
import { indentWithTab, indentSelection } from '@codemirror/commands';
import { tags as t } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';

export type CodeLanguage = 'html' | 'css';

/** A validation failure to mark in the gutter, at a 1-based line/column. */
export interface CodeEditorError {
  line: number;
  column: number;
  message: string;
}

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  /** Syntax mode — `html` (HTML + Handlebars, the default) or `css` (e.g. critical CSS). */
  language?: CodeLanguage;
  /** When set, draw a red gutter marker (message on hover) at this position; null clears it. */
  error?: CodeEditorError | null;
}

/** The editor accent — gutter border, cursor, selection, active-line gutter. */
const ACCENT = '#818cf8'; // indigo-400

/**
 * The Sitewright code-editor look: a black canvas with the indigo accent for chrome
 * (gutter border, cursor, selection) and a MULTI-COLOUR syntax palette so HTML tags,
 * attributes, values, and Handlebars expressions each read distinctly. Added AFTER
 * `basicSetup` so it wins the theme + highlight facets.
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
      color: '#71717a', // lighter line numbers (was #3f3f46 — too dark)
      border: 'none',
      borderRight: `2px solid ${ACCENT}`,
    },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.035)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#e4e4e7' },
    '.cm-lineNumbers .cm-gutterElement': { color: '#71717a' },
    '.cm-foldPlaceholder': { backgroundColor: '#27272a', color: '#a1a1aa', border: 'none' },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'rgba(129,140,248,0.25)',
      color: 'inherit',
      outline: `1px solid ${ACCENT}`,
    },
    // Handlebars expressions ({{ … }}) — decorated separately from the HTML grammar.
    '.cm-handlebars': { color: '#f0abfc', fontWeight: '500' }, // fuchsia-300
  },
  { dark: true },
);

/**
 * A readable multi-colour palette on the near-black canvas: tags, attribute names,
 * attribute/string values, comments, numbers, and keywords each get their own hue.
 */
const richHighlight = HighlightStyle.define([
  { tag: [t.tagName, t.standard(t.tagName)], color: '#7dd3fc' }, // sky-300 — HTML tags
  { tag: [t.angleBracket, t.bracket, t.punctuation, t.separator], color: '#6b7280' }, // gray-500
  { tag: [t.attributeName, t.propertyName], color: '#fcd34d' }, // amber-300 — attributes
  { tag: [t.attributeValue, t.string, t.special(t.string), t.regexp], color: '#86efac' }, // green-300 — values (incl. class="…")
  { tag: [t.keyword, t.operatorKeyword, t.moduleKeyword, t.controlKeyword], color: '#c4b5fd' }, // violet-300
  { tag: [t.comment, t.lineComment, t.blockComment, t.meta], color: '#6b7280', fontStyle: 'italic' },
  { tag: [t.number, t.bool, t.atom, t.null, t.unit], color: '#fdba74' }, // orange-300
  { tag: [t.heading, t.strong], color: '#f4f4f5', fontWeight: 'bold' },
  { tag: t.link, color: ACCENT, textDecoration: 'underline' },
  { tag: t.variableName, color: '#e4e4e7' },
]);

/**
 * Decorates `{{ … }}` / `{{{ … }}}` Handlebars expressions with the `cm-handlebars`
 * mark — `@codemirror/lang-html` treats them as plain text, so this overlay gives
 * template expressions their own colour without a bespoke language grammar.
 */
const handlebarsMatcher = new MatchDecorator({
  regexp: /\{\{\{?[^{}]*\}?\}\}/g,
  decoration: Decoration.mark({ class: 'cm-handlebars' }),
});
const handlebarsHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = handlebarsMatcher.createDeco(view);
    }
    update(u: ViewUpdate) {
      this.decorations = handlebarsMatcher.updateDeco(u, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

/** Language extensions per mode (HTML carries the Handlebars overlay; CSS does not). */
function languageExtensions(language: CodeLanguage): Extension[] {
  return language === 'css' ? [css()] : [html(), handlebarsHighlight];
}

/**
 * A thin CodeMirror 6 wrapper for authoring HTML + Handlebars template source (or CSS).
 *
 * Bundled, not CDN-loaded: the editor SPA is served under `default-src 'self'`, so a
 * runtime CDN editor (e.g. Monaco's default loader) is blocked — CodeMirror ships in the
 * app bundle and stays self-contained for the single-container deployment.
 *
 * It is intentionally NOT a controlled component: `value` only seeds the initial document
 * and applies *external* resets. Echoes of the user's own edits (which flow back in via
 * `onChange` → parent state → `value`) are ignored, so fast typing is never reverted.
 *
 * Tab indents the selection (`indentWithTab`); Shift-Tab auto-indents it (`indentSelection`,
 * syntax-aware re-flow). The indent unit is two spaces.
 */
export function CodeEditor({ value, onChange, ariaLabel, language = 'html', error = null }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // The last document we emitted upward — used to distinguish our own echo from a genuine
  // external `value` change (the classic controlled-CodeMirror revert-on-typing guard).
  const lastEmitted = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Mode is fixed at mount (CodeMirror owns the document thereafter). Callers never change
  // `language` on a live instance; if that's ever needed, remount via a React `key`.
  const languageRef = useRef(language);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          ...languageExtensions(languageRef.current),
          indentUnit.of('  '),
          // Tab indents the current line/selection; Shift-Tab AUTO-INDENTS it — re-flowing
          // each selected line to the indentation its syntax implies (`indentSelection`),
          // not a plain dedent. The explicit binding precedes `indentWithTab` so it wins
          // over that keymap's Shift-Tab=dedent; Tab still falls through to `indentWithTab`.
          keymap.of([{ key: 'Shift-Tab', run: indentSelection }, indentWithTab]),
          lintGutter(),
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            const doc = u.state.doc.toString();
            lastEmitted.current = doc;
            onChangeRef.current(doc);
          }),
          // Added after basicSetup so the black theme + rich highlight win.
          blackTheme,
          syntaxHighlighting(richHighlight),
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

  // Mirror the validation error into a CodeMirror lint diagnostic → a red gutter marker at the
  // offending line/column (its message shows on hover). Clears when `error` is null.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const diagnostics: Diagnostic[] = [];
    if (error && error.line >= 1 && error.line <= view.state.doc.lines) {
      const ln = view.state.doc.line(error.line);
      // Clamp to at most the line's last char so the marker is a non-empty 1-char range (a
      // zero-width range can render no gutter dot); an empty line marks the (empty) line itself.
      const from = Math.min(ln.from + Math.max(0, error.column - 1), Math.max(ln.from, ln.to - 1));
      diagnostics.push({ from, to: Math.min(ln.to, from + 1), severity: 'error', message: error.message });
    }
    view.dispatch(setDiagnostics(view.state, diagnostics));
  }, [error?.line, error?.column, error?.message]);

  return <div ref={hostRef} className="h-full overflow-hidden" data-testid="code-editor" />;
}
