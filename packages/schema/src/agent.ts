import { z } from 'zod';
// Agent (MCP) defaults shared across packages: the bridge's fallback instructions, the API's
// effective-instructions resolution, and the admin panel's editor + endpoint list all read from here.
export const DEFAULT_AGENT_INSTRUCTIONS = `This server exposes ONE Sitewright project over MCP for building a
CODE-FIRST static website. You'll work with these content kinds (kind, id): settings, page,
dataset, entry, form. Call get_scope first. If it returns authenticated:false, call the \`login\`
tool and relay its URL + code to the user to approve in their browser (ask them to keep that tab
open to watch your changes live), then call get_scope again to confirm before continuing. Use
\`switch_project\` to connect to a different project.

AUTHOR PAGES IN CODE. A page renders from its Handlebars \`source\` (HTML + Tailwind CSS +
DaisyUI v5 component classes). The \`root\` field is a legacy placeholder — set a minimal
root ({"id":"root","type":"Section"}) and put the real design in \`source\`.

In \`source\`:
- Use DaisyUI components for UI (btn / btn-primary, card, navbar, hero, badge, footer,
  menu, alert…) plus Tailwind utilities for layout. DaisyUI is OPTIONAL — plain Tailwind works too.
- COLORS: six brand tokens always exist as theme colors — \`primary\`, \`secondary\`, \`accent\`,
  \`neutral\`, \`base-100\` (page background), \`base-content\` (body text). Use them as ordinary
  utilities (\`bg-primary\`, \`text-base-content\`, \`border-neutral\`); if you use DaisyUI, its
  components (\`btn-primary\`, \`bg-base-100\`, \`alert-…\`) read the SAME tokens and are themed
  automatically. For text on a colored surface use the auto-derived \`*-content\`
  (\`bg-primary text-primary-content\`). Prefer these tokens over hardcoded hex; stock Tailwind
  palette (\`bg-slate-900\`) is fine for non-brand neutrals.
- Bind data: {{ company.* }} exposes the Corporate Identity you set (e.g. {{ company.name }}
  and any contact/address fields on \`identity\`). {{ company.mapUrl }} is a Google Maps embed URL
  for an <iframe src>. {{#each company.social}} yields { link, name, icon } per profile — render a
  social bar with {{#each company.social}}<a href="{{sw-url link}}">{{sw-icon icon}} {{name}}</a>{{/each}}.
  Page bindings: {{ page.title }}, {{ page.path }} (full route),
  {{ page.slug }} (own segment); {{ parentPage.path }} / {{ parentPage.data.<key> }} for the page's
  parent (absent at the tree root); {{ website.siteUrl }}; and {{#each data.<dataset>}}…{{/each}}
  for collections. Inside the loop an entry's fields are read
  DIRECTLY by name — {{title}}, {{price}} (no \`values.\` prefix) — and each row is click-to-edit
  in the editor. The entry's id/dataset are on {{@entry.id}} / {{@entry.dataset}}.
- Mark text a CLIENT may later edit by adding data-sw-text="key" to a real element, e.g.
  <h1 data-sw-text="headline">Default text</h1> (rich text: data-sw-html; image: data-sw-src;
  link: data-sw-href; background: data-sw-bg). The override is stored on the page as page.data.<key>.
- NO JavaScript: no <script>, no on* handlers, no {{{triple-stache}}}. For interactivity use
  DaisyUI's CSS-only patterns (<details>, the popover attribute, checkbox). Put URLs in
  href/src as literal paths or via the {{sw-url …}} helper.
- NO SEMANTIC LANDMARK ELEMENTS: the page SKELETON already wraps every page body in
  <main id="page-content"> and each skeleton slot in its own landmark — <nav id="top-nav">,
  <nav id="mobile-nav">, <footer id="footer">, <aside id="sidebar-left">/<aside id="sidebar-right">.
  So a page \`source\` (and any snippet/template/slot HTML) must NOT use <nav>, <main>, <footer>, or
  <aside> — the validator rejects them to keep each landmark unique. Use neutral <div>/<section>/<ul>
  (DaisyUI's .navbar/.footer/.menu classes style any element).

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

ICONS: inline an icon with {{sw-icon "name" "h-5 w-5"}} (the 2nd arg is the CSS class). "name"
is ANY Lucide icon name (the full ~1865-icon set, kebab-case — e.g. menu, x, search,
arrow-right, chevron-down, mail, phone, map-pin, calendar, star, home, user, heart,
shopping-cart, rocket, sparkles). Brand/social logos use the "brand:" prefix — there are ~270
of them (simple-icons): {{sw-icon "brand:github"}}, brand:x, brand:youtube, brand:instagram,
brand:facebook, brand:whatsapp, brand:tiktok, brand:linkedin (falls back to a line glyph),
brand:figma, brand:spotify, brand:discord, brand:telegram, brand:bluesky, etc. Unknown names
render nothing. (Note: bare "x" is the ✕ close glyph; "brand:x" is the X/Twitter logo.)

FLAGS: country flags are FULL-COLOR, so they use a SEPARATE helper — {{sw-flag "de" "h-4"}}.
The code is ISO 3166-1 alpha-2 (de, us, gb, fr, jp, br…); add "-circle" for the round variant
({{sw-flag "de-circle"}}). All ~250 countries are built in. Flags are a poor proxy for
LANGUAGES (Spanish ≠ Spain) — use them for country/region selectors; for a language switcher
prefer text language names, or pass an explicit country code per locale.

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
via {{#if children}}…{{#each children}}. Prefer a CSS-only hover dropdown whose PARENT stays a
real link: <li class="dropdown dropdown-hover"><a href="{{sw-url path}}">{{label}}</a><ul
class="dropdown-content menu …">{{#each children}}…{{/each}}</ul></li> (avoid <details>/<summary>,
which makes the parent a toggle, not navigable). Children need no own nav slots. Every new
project already has the empty-slug "home" page.
TEMPLATES: set page.template to "global:landing", "global:text", or a project template id
(kind "template": { id, name, source }) — the page then renders the TEMPLATE's source and
contributes ONLY its editable \`data\` (page.data) overrides; leave page.source unset.

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
SHARE STRUCTURE by INHERITANCE: leave a translated variant's \`source\` AND \`template\` UNSET —
it then automatically follows the DEFAULT-LOCALE page's code (edit that one page's layout and
every language updates, no copying). Each variant supplies only its own translated \`data\`
(data-sw-text values) and \`title\`/\`seo\`. For a one-off layout difference, give that variant its
own \`source\` (fork) or set its \`template\`; a variant that carries its own code stops following
the main page.
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

/** Max length of an admin-overridden agent-instructions string. */
export const AGENT_INSTRUCTIONS_MAX = 32_000;

/**
 * Bounded agent-instructions override string (the admin-editable system prompt). `.min(1)` so a
 * stored override is never empty — clearing the override is done with `null` (revert to default),
 * not an empty string, which would otherwise serve agents a blank prompt.
 */
export const AgentInstructionsSchema = z.string().min(1).max(AGENT_INSTRUCTIONS_MAX);

/** Capability a tool requires (absent = always available, even for a read-only token). */
export type McpToolCapability = 'content:read' | 'content:write' | 'publish';

/** Display metadata for one MCP tool the bridge exposes. */
export interface McpToolMeta {
  name: string;
  description: string;
  capability?: McpToolCapability;
}

/**
 * The catalog of MCP tools the bridge registers, capability-gated. This is the source of truth for
 * the admin panel's endpoint list; packages/mcp registers EXACTLY these names (asserted by a test
 * in that package, so the list can't drift from what the server actually exposes).
 */
export const MCP_TOOL_CATALOG: readonly McpToolMeta[] = [
  { name: 'get_scope', description: "Show whether the agent is connected and, if so, the project, role, and capabilities." },
  { name: 'login', description: "Connect the agent to a project — returns a URL + code for the user to approve in their browser." },
  { name: 'switch_project', description: "Re-authenticate to connect to a DIFFERENT project (scope is fixed per connection)." },
  { name: 'list_pages', description: "List the project's pages." },
  { name: 'get_page', description: "Get one page by id (code-first design is in the `source` field)." },
  { name: 'list_content', description: "List all entities of a content kind." },
  { name: 'get_content', description: "Get one content entity by kind + id." },
  { name: 'preview_page', description: "Render a (possibly unsaved) page to a full HTML document, without saving." },
  { name: 'get_publish_status', description: "Read the project's latest published release (or null)." },
  { name: 'list_submissions', description: "List form submissions (newest first; optional formId + pagination).", capability: 'content:read' },
  { name: 'list_stock_providers', description: "List configured stock-image providers and whether each is available.", capability: 'content:read' },
  { name: 'search_stock_images', description: "Search a stock-image provider for photos.", capability: 'content:read' },
  { name: 'put_page', description: "Create or replace a page (id taken from page.id).", capability: 'content:write' },
  { name: 'delete_page', description: "Delete a page by id.", capability: 'content:write' },
  { name: 'put_content', description: "Create or replace a content entity of the given kind.", capability: 'content:write' },
  { name: 'delete_content', description: "Delete a content entity by kind + id.", capability: 'content:write' },
  { name: 'import_stock_image', description: "Import a stock photo into the project (downloaded, optimized, self-hosted with attribution).", capability: 'content:write' },
  { name: 'publish_project', description: "Build the project's static site from current saved content.", capability: 'publish' },
];
