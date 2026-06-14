import { useEffect, useState } from 'react';

/** Stripped plain-text fallback (shown until the icon renderer chunk loads, and for a label with no
 *  visible text). Drops handlebars helpers (incl. `{{{…}}}`, no stray brace), HTML tags, and entities. */
function plainText(name: string): string {
  return name
    .replace(/\{\{\{?[^}]*\}\}\}?/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:[a-z]+|#\d+);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Lazy singleton: the icon renderer pulls the large icon/flag data (a separate chunk shared with the
// Library gallery), so load it on demand rather than into the editor's main bundle. The dynamic import
// targets a module that STATICALLY imports only the icon functions — vite tree-shakes it to the icon
// subgraph (NOT the Node-only renderTemplate, which breaks in the browser). A transient failure clears
// the singleton so a later mount retries.
let rendererP: Promise<(name: string) => string> | null = null;
function loadRenderer(): Promise<(name: string) => string> {
  if (!rendererP) {
    rendererP = import('./placeholder-render').then((m) => m.renderPlaceholderHtml);
    rendererP.catch(() => {
      rendererP = null;
    });
  }
  return rendererP;
}

/**
 * Previews a nav placeholder's rich NAME (basic HTML + `{{sw-icon}}`/`{{sw-flag}}`) in the Pages list
 * the way it renders in the MENU — the icon/flag + text — instead of dumping the raw template markup.
 * Shows a readable text fallback synchronously, then swaps in the icon-rendered HTML once the lazy
 * renderer chunk loads.
 */
export function PlaceholderLabel({ name }: { name: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    loadRenderer()
      .then((render) => {
        if (active) setHtml(render(name));
      })
      .catch(() => {
        /* renderer chunk failed to load — keep the text fallback */
      });
    return () => {
      active = false;
    };
  }, [name]);

  if (html === null || html.trim() === '') return <>{plainText(name) || name}</>;
  return <span className="sw-ph-label" dangerouslySetInnerHTML={{ __html: html }} />;
}
