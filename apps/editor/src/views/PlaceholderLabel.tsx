import { useEffect, useState } from 'react';
import { plainText } from './plain-text';

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

/** A label is RICH (worth the icon renderer) only if it carries HTML or a `{{…}}` helper. A plain
 *  page/menu title has neither — render it as text with NO lazy import (the common case). */
function isRich(name: string): boolean {
  return name.includes('<') || name.includes('{{');
}

/**
 * Previews a page/placeholder's MENU label in the Pages list the way it renders in the menu. A plain
 * title renders as text directly; a RICH label (basic HTML + `{{sw-icon}}`/`{{sw-flag}}`) shows a
 * readable text fallback synchronously, then swaps in the icon-rendered HTML once the lazy renderer
 * chunk loads — instead of dumping the raw template markup.
 */
export function PlaceholderLabel({ name }: { name: string }) {
  const rich = isRich(name);
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    setHtml(null); // clear any prior render so a name change shows the NEW fallback, never stale HTML
    if (!rich) return; // plain title → no renderer needed
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
  }, [name, rich]);

  if (!rich) return <>{name}</>;
  if (html === null || html.trim() === '') return <>{plainText(name) || name}</>;
  return <span className="sw-ph-label" dangerouslySetInnerHTML={{ __html: html }} />;
}
