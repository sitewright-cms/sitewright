import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PageSchema } from '@sitewright/schema';
import { SitewrightApiError, type Capability, type Scope, type SitewrightClient } from './client.js';

/** Content kinds reachable via the generic content tools (media/deploy_target are excluded). */
const GENERIC_KIND = z.enum([
  'settings',
  'page',
  'partial',
  'template',
  'pattern',
  'translation',
  'dataset',
  'entry',
  'form',
]);

const INSTRUCTIONS = `This server exposes ONE Sitewright project over MCP for building a
CODE-FIRST static website. You'll work with these content kinds (kind, id): settings, page,
dataset, entry, form. Call get_scope first to see what this token may do.

AUTHOR PAGES IN CODE. A page renders from its Handlebars \`source\` (HTML + Tailwind CSS +
DaisyUI v5 component classes). The \`root\` field is a legacy placeholder — set a minimal
root ({"id":"root","type":"Section"}) and put the real design in \`source\`.

In \`source\`:
- Use DaisyUI components for UI (btn / btn-primary, card, navbar, hero, badge, footer,
  menu, alert…) plus Tailwind utilities for layout. Components are brand-themed
  automatically — name the brand's main color \`primary\`.
- Bind data: {{ company.* }} exposes the Corporate Identity you set (e.g. {{ company.name }}
  and any contact/address fields on \`identity\`); {{ page.title }}; {{ website.siteUrl }}; and
  {{#each data.<dataset>}}…{{/each}} for collections.
- Mark text a CLIENT may later edit with {{edit "key" "Default text"}}.
- NO JavaScript: no <script>, no on* handlers, no {{{triple-stache}}}. For interactivity use
  DaisyUI's CSS-only patterns (<details>, the popover attribute, checkbox). Put URLs in
  href/src as literal paths or via the {{url …}} helper.

ANIMATIONS (scroll-reveal): use the standard AOS attributes directly on elements —
data-aos="fade-up" plus optional data-aos-delay="200" / data-aos-duration="600" (ms, max 5000),
data-aos-once="false" to replay on every re-entry, data-aos-easing="ease-out"
(linear|ease|ease-in|ease-out|ease-in-out). Effects: fade, fade-up/-down/-left/-right,
zoom-in, zoom-out, slide-up/-down/-left/-right, flip-up/-down/-left/-right. The platform
detects data-aos and ships its own tiny runtime automatically — do NOT add the aos
package, CDN links, or any script (they'd be rejected anyway). Content stays visible
without JS and motion respects prefers-reduced-motion. Stagger lists by increasing
data-aos-delay per item (e.g. 0/100/200).

LAZY-LOAD images: native loading="lazy" works on a plain <img>. For BACKGROUND images use
data-bg="<url>" on any element (it becomes the background on scroll-in, with a blur-up fade);
for an opt-in <img> swap use class="lazyload" with data-src / data-srcset. The platform ships
its own tiny runtime when it sees data-bg / lazyload — never add a lazy-load library.

RIPPLE (Material "waves") click effect: add class="waves-effect" to a button/link, plus
"waves-light" for a white ripple on dark/colored buttons (e.g. class="btn btn-primary
waves-effect waves-light"). The platform ships its own ripple runtime when it sees
waves-effect — never add Waves.js. Respects prefers-reduced-motion.

ICONS: inline a built-in Lucide icon with {{icon "name" "h-5 w-5"}} (the 2nd arg is the CSS
class). Names include: menu, x, search, chevron-down/-up/-left/-right, arrow-right/-left/-up-right,
check, mail, phone, map-pin, external-link, calendar, clock, star. Unknown names render nothing.

SET THE BRAND with put_content("settings","settings",{ identity:{ name, colors:{ primary:"#…" } },
settings:{ defaultLocale:"en", locales:["en"] } }).
PAGE SETTINGS live on the page: title, path, status ("draft"|"published"),
seo { description, ogImage }, parent (a parent page's id — makes this a sub-page), nav
{ slots:["header"|"footer"|"mobile"], order, title, dropdown }. \`path\` is the page's OWN
SLUG SEGMENT — one lowercase token, NO slashes (e.g. "about", "web-design"); the full URL
is computed from the parent chain ({root}/{parent slugs}/{slug}). The HOME page is the
page-tree ROOT: its slug is the EMPTY string "" (→ "/"), and every OTHER page sets "parent"
to a page's id (defaulting to "home") — its route is /<…parent slugs>/<slug>. So a German
home is { path:"de", parent:"home" } (→ /de) and a sub-page under it is
{ path:"leistungen", parent:"home-de" } (→ /de/leistungen). With dropdown:true a page's
CHILD pages (parent = its id) nest under its nav item — a nav slot template renders them
via {{#if children}}…{{#each children}} (DaisyUI <details> submenu; children need no own
nav slots). Every new project already has the empty-slug "home" page.
TEMPLATES: set page.template to "global:landing", "global:text", or a project template id
(kind "template": { id, name, source }) — the page then renders the TEMPLATE's source and
contributes ONLY its {{edit}} \`content\`; leave page.source unset.

MULTILINGUAL (document-level i18n): each language variant is ITS OWN page, not a field
overlay. First declare the languages in settings: settings:{ defaultLocale:"en",
locales:["en","de"] }. Then for a translated page create a sibling page that:
- sets \`locale\` to its language ("de"); the default-locale page leaves \`locale\` unset.
- shares a \`translationGroup\` (any stable id, e.g. the primary page's id) with all its
  variants — this links them for the <link rel="alternate" hreflang> tags and any
  language switcher, and is what {{#each page.translations}} iterates.
- nests under that locale's HOME so its route is "/<locale>/…": create a locale-home page
  first ({ path:"<locale>", parent:"home" } → /<locale>, the localized home), then parent the
  locale's other pages under it ({ path:"about", parent:"<locale>-home-id" } → /<locale>/about).
  Each locale's nav lists only its own pages.
SHARE STRUCTURE by giving the variants the SAME \`template\` (or copy the \`source\`); each
supplies only its own translated {{edit}} text and \`title\`/\`seo\`. For a one-off layout
difference, just give that variant its own \`source\`.
LOCALIZED DATA: duplicate a dataset per locale as "<name>-<locale>" (lowercased), e.g.
"services" + "services-de". A page with locale "de" auto-resolves {{#each data.services}}
to "services-de" when it exists (else it falls back to "services"); address a specific
variant explicitly with {{#each data.services-de}}. In source, expose the page's language
as {{page.locale}} and its alternates as {{#each page.translations}} (each has \`locale\`,
\`path\`, \`title\`). The "translation" content kind is legacy — do NOT use it; model
languages as locale-variant pages instead.
IMAGES: search_stock_images then import_stock_image (self-hosted + attributed); reference the
returned media url in \`source\`.

Typical flow: get_scope → set the Corporate Identity → put_page(s) with \`source\` →
preview_page (returns { html, … } — read \`html\` to check the render) → publish_project. All writes are validated
server-side (schema + no-JS template safety); you cannot exceed the token's role/capabilities.`;

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function ok(value: unknown): ToolResult {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }] };
}

/** Runs a tool body, turning an API error into an MCP tool error rather than throwing. */
async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    if (err instanceof SitewrightApiError) {
      return { content: [{ type: 'text', text: `Error ${err.status}: ${err.message}` }], isError: true };
    }
    const message = err instanceof Error ? err.message : 'unknown error';
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
  }
}

/**
 * Builds an MCP server exposing the project's content operations as tools. Tools
 * are registered according to the token's capabilities — a read-only token gets
 * no write/publish tools — so the advertised toolset never exceeds what the
 * server would actually allow.
 */
export function createSitewrightMcpServer(client: SitewrightClient, scope: Scope): McpServer {
  const server = new McpServer(
    { name: 'sitewright', version: '0.0.0' },
    { instructions: INSTRUCTIONS },
  );
  const can = (cap: Capability): boolean => scope.capabilities.includes(cap);

  // --- always available (orientation + reads) ---
  server.registerTool(
    'get_scope',
    { description: 'Show which project this token addresses, its role, and its capabilities.' },
    async () => ok(scope),
  );

  server.registerTool(
    'list_pages',
    { description: 'List the project’s pages.' },
    async () => run(() => client.listContent('page')),
  );

  server.registerTool(
    'get_page',
    {
      description:
        'Get one page by id. For code-first pages the design is in the `source` field; `root` is a legacy placeholder.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => run(() => client.getContent('page', id)),
  );

  server.registerTool(
    'list_content',
    {
      description: 'List all entities of a content kind.',
      inputSchema: { kind: GENERIC_KIND },
    },
    async ({ kind }) => run(() => client.listContent(kind)),
  );

  server.registerTool(
    'get_content',
    {
      description: 'Get one content entity by kind + id.',
      inputSchema: { kind: GENERIC_KIND, id: z.string() },
    },
    async ({ kind, id }) => run(() => client.getContent(kind, id)),
  );

  server.registerTool(
    'preview_page',
    {
      description:
        'Render a (possibly unsaved) page to a full HTML document and return it, so you can check your work. Does not save.',
      inputSchema: { page: PageSchema },
    },
    async ({ page }) => run(() => client.preview(page)),
  );

  server.registerTool(
    'get_publish_status',
    { description: 'Read the project’s latest published release (or null if never published).' },
    async () => run(() => client.publishStatus()),
  );

  // Submissions carry visitor PII; only advertise the tool to read-capable tokens
  // (the API also enforces content:read, so this keeps the toolset honest).
  if (can('content:read')) {
    server.registerTool(
      'list_submissions',
      {
        description:
          'List form submissions for the project, newest first. Optionally filter by formId and paginate with limit/offset.',
        inputSchema: {
          formId: z.string().optional(),
          limit: z.number().int().min(1).max(200).optional(),
          offset: z.number().int().min(0).optional(),
        },
      },
      async ({ formId, limit, offset }) => run(() => client.listSubmissions({ formId, limit, offset })),
    );

    server.registerTool(
      'list_stock_providers',
      {
        description:
          'List the configured stock-image providers and whether each is available (openverse needs no key; unsplash/pexels need an instance-admin key).',
      },
      async () => run(() => client.stockProviders()),
    );

    server.registerTool(
      'search_stock_images',
      {
        description:
          'Search a stock-image provider for photos. Returns provider-hosted thumbnails to preview; use import_stock_image to bring one into the project.',
        inputSchema: {
          provider: z.enum(['openverse', 'unsplash', 'pexels']),
          query: z.string().min(1).max(200),
          page: z.number().int().min(1).max(100).optional(),
        },
      },
      async ({ provider, query, page }) => run(() => client.stockSearch(provider, query, page ?? 1)),
    );
  }

  // --- writes (only when the token may write) ---
  if (can('content:write')) {
    server.registerTool(
      'put_page',
      {
        description: 'Create or replace a page. The page id is taken from page.id.',
        inputSchema: { page: PageSchema },
      },
      async ({ page }) => run(() => client.putContent('page', page.id, page)),
    );

    server.registerTool(
      'delete_page',
      { description: 'Delete a page by id.', inputSchema: { id: z.string() } },
      async ({ id }) => run(() => client.deleteContent('page', id).then(() => ({ deleted: id }))),
    );

    server.registerTool(
      'put_content',
      {
        description: 'Create or replace a content entity of the given kind. `data` must match that kind’s schema.',
        inputSchema: { kind: GENERIC_KIND, id: z.string(), data: z.unknown() },
      },
      async ({ kind, id, data }) => run(() => client.putContent(kind, id, data)),
    );

    server.registerTool(
      'delete_content',
      {
        description: 'Delete a content entity by kind + id.',
        inputSchema: { kind: GENERIC_KIND, id: z.string() },
      },
      async ({ kind, id }) => run(() => client.deleteContent(kind, id).then(() => ({ deleted: `${kind}/${id}` }))),
    );

    server.registerTool(
      'import_stock_image',
      {
        description:
          'Import a stock photo (by provider + id from search_stock_images) into the project. The server downloads, optimizes, and self-hosts it as a media asset with attribution — never a hotlink.',
        inputSchema: {
          provider: z.enum(['openverse', 'unsplash', 'pexels']),
          id: z.string().min(1).max(256),
          alt: z.string().max(500).optional(),
        },
      },
      async ({ provider, id, alt }) => run(() => client.importStock(provider, id, alt)),
    );
  }

  // --- publish (only when the token may publish) ---
  // NB: `deploy` is intentionally NOT exposed as a tool — pushing to a customer's
  // external webspace (FTP/SFTP credentials) from an autonomous agent is out of
  // scope for the bridge; deploy stays a deliberate, human-driven action.
  if (can('publish')) {
    server.registerTool(
      'publish_project',
      { description: 'Build the project’s static site from current saved content.' },
      async () => run(() => client.publish()),
    );
  }

  return server;
}
