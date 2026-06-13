import { SidePanel } from '../ui/SidePanel';
import { CodeRecordManager, type CodeRecord, type MakeId, type RecordAdapters } from './CodeRecordManager';
import { api, snippetPreviewUrl } from '../../api';

/** Code glyph (`</>`) for the bottom rail tabs. */
function CodeIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m8 6-6 6 6 6" />
      <path d="m16 6 6 6-6 6" />
    </svg>
  );
}

const IDENT = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/** Narrow a Snippet/Template (structurally a CodeRecord) to exactly the fields the manager edits. */
const toRecord = ({ id, name, source }: CodeRecord): CodeRecord => ({ id, name, source });

/** Snippet ids ARE their name (a Handlebars partial identifier); SnippetSchema caps the name at 100. */
const snippetId: MakeId = (name, existing) => {
  const n = name.trim();
  if (!IDENT.test(n) || n.length > 100) {
    return { error: 'Use letters, digits, _ or - (start with a letter, ≤100 chars) — it becomes {{> name}}.' };
  }
  if (existing.some((r) => r.id === n)) return { error: 'A snippet with that name already exists.' };
  return { id: n };
};

/** Templates have a free-text name; derive a slug id (≤120 so a `-N` suffix stays within IdSchema's
 *  128) and de-dupe it against existing ids. */
const templateId: MakeId = (name, existing) => {
  const base = (name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'template').slice(0, 120);
  const ids = new Set(existing.map((r) => r.id));
  let id = base;
  for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
  return { id };
};

// Module-level (stable-identity) storage adapters — passing inline arrows would give the manager's
// load effect a new `load` every parent render and re-fetch on every render. The global adapters
// ignore the projectId (the library is instance-wide).
const snippets: RecordAdapters = {
  load: (p) => api.listSnippets(p).then((r) => r.items.map(toRecord)),
  save: (p, rec) => api.putSnippet(p, rec),
  remove: (p, id) => api.deleteSnippet(p, id),
};
const globalSnippets: RecordAdapters = {
  load: () => api.listGlobalSnippets().then((r) => r.items.map(toRecord)),
  save: (_p, rec) => api.putGlobalSnippet(rec),
  remove: (_p, id) => api.deleteGlobalSnippet(id),
};
const templates: RecordAdapters = {
  load: (p) => api.listTemplates(p).then((r) => r.items.map(toRecord)),
  save: (p, rec) => api.putTemplate(p, rec),
  remove: (p, id) => api.deleteTemplate(p, id),
};
const globalTemplates: RecordAdapters = {
  load: () => api.listGlobalTemplates().then((r) => r.items.map(toRecord)),
  save: (_p, rec) => api.putGlobalTemplate(rec),
  remove: (_p, id) => api.deleteGlobalTemplate(id),
};

/**
 * The bottom CODE RAILS — reusable Handlebars source records, each in its own {@link SidePanel}:
 *   - Snippets  → `{{> name}}` partials a page/template can include.
 *   - Templates → page layouts a page renders via its `template` reference.
 * Each lists the shared GLOBAL library (read-only, or editable when `isAdmin`) above the project's own.
 */
export function SnippetsPanel({ projectId, isAdmin }: { projectId: string; isAdmin?: boolean }) {
  return (
    <SidePanel side="bottom" align="center-left" label="Snippets" icon={<CodeIcon />}>
      <CodeRecordManager
        projectId={projectId}
        noun="snippet"
        load={snippets.load}
        save={snippets.save}
        remove={snippets.remove}
        makeId={snippetId}
        globalAdapters={globalSnippets}
        isAdmin={isAdmin}
        includeRef={(r) => `{{> ${r.name}}}`}
        previewUrl={(r, scope) => snippetPreviewUrl(projectId, r.id, scope)}
        renamable
        nameHint="referenced as {{> name}}"
        hint="A reusable Handlebars partial (HTML + Tailwind + {{ }}). Include it in a page or template with {{> name}}."
      />
    </SidePanel>
  );
}

export function TemplatesPanel({ projectId, isAdmin }: { projectId: string; isAdmin?: boolean }) {
  return (
    <SidePanel side="bottom" align="end" label="Templates" icon={<CodeIcon />}>
      <CodeRecordManager
        projectId={projectId}
        noun="template"
        load={templates.load}
        save={templates.save}
        remove={templates.remove}
        makeId={templateId}
        globalAdapters={globalTemplates}
        isAdmin={isAdmin}
        gridClassName="grid gap-1.5 sm:grid-cols-2"
        editableName
        hint="A page layout. A page that sets this template renders its source and contributes only its editable data-sw-* regions (stored in page.data)."
      />
    </SidePanel>
  );
}
