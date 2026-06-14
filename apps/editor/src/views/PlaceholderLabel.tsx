import { useEffect, useState } from 'react';

/** Strip HTML tags + {{handlebars}} helpers to a readable text fallback (shown until the rich renderer
 *  loads, and for any label that renders to no visible text). */
function plainText(name: string): string {
  return name
    .replace(/\{\{\{?[^}]*\}\}\}?/g, ' ') // drop handlebars helpers (incl. {{{…}}}) — no stray brace left
    .replace(/<[^>]*>/g, ' ') // drop HTML tags
    .replace(/&(?:[a-z]+|#\d+);/gi, ' ') // drop entities
    .replace(/\s+/g, ' ')
    .trim();
}

// Lazy singleton: the rich renderer pulls Handlebars + the icon/flag data (a large chunk), so load it
// on demand rather than baking it into the editor's main bundle.
let rendererP: Promise<(label: string) => string> | null = null;
function loadRenderer(): Promise<(label: string) => string> {
  if (!rendererP) {
    rendererP = import('@sitewright/blocks').then((m) => m.renderNavLabel);
    // A transient chunk-load failure shouldn't stick the fallback forever — clear the singleton so a
    // later mount retries. (The caller's own .catch handles the rejection for this attempt.)
    rendererP.catch(() => {
      rendererP = null;
    });
  }
  return rendererP;
}

/**
 * Previews a nav placeholder's rich NAME (basic HTML + `{{sw-icon}}`/`{{sw-flag}}`) in the Pages list
 * the way it renders in the MENU — the icon/flag + text — instead of dumping the raw template markup.
 * Shows a readable text fallback synchronously, then swaps in the engine-rendered HTML once the lazy
 * renderer loads. The HTML comes from `renderNavLabel` (the same validated `renderTemplate` path the
 * published nav uses — scripts / `on*` handlers / `{{{` are rejected), so it is no less safe than the
 * live menu; for a label that produces no visible text it falls back to the stripped text.
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
