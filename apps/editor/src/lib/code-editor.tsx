import { useEffect, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { html } from '@codemirror/lang-html';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}

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
          EditorView.theme({
            '&': { height: '100%', fontSize: '13px' },
            '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
          }),
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
