# Brief: writing pages for the Sitewright website

You are writing pages of the new **Sitewright website**: the product's pitch AND its documentation, built WITH Sitewright
on the test instance (`http://dind.local:2003`, project `sitewright`, id `eEb21YIuV4qF`). Sitewright is the open-source
(Apache 2.0), self-hosted website platform in the repo `/workspace/sitewright` (read-only for you: never edit, commit or
push anything in any repo). Audience: web developers and agencies. Voice: plain, direct, concrete, confident, no hype
words ("revolutionary", "seamless", "next-gen", "powerful"), short sentences, US English. Every claim must be TRUE today.

## Files and tools (all under SITE=/tmp/claude-1000/-workspace-sitewright/ec7958e0-e951-4975-95e7-a51a6bdd4286/scratchpad/site)
- A page is `$SITE/pages/<id>.hbs`. Line 1 is a META comment, the rest is the page source (Handlebars + HTML + Tailwind v4 + daisyUI 5):
  `{{!-- META {"path":"<segment>","title":"…","description":"…","parent":"<parent id>","order":<n>,"data":{…}} --}}`
  `path` is the page's OWN segment (the route is built from the parent chain). `description` doubles as the SEO
  description AND the lead under the title (one or two sentences). Do NOT add `nav` (the docs menu comes from the group
  pages, which exist already). `order` sets the position among siblings (1, 2, 3…).
- Push ONE page: `cd $SITE && node push.mjs page <id>` (several ids allowed). NEVER run `node push.mjs pages`,
  `settings` or `snippets` (other writers share them). A 400 names the line and the problem; fix and push again.
- Screenshot: `cd $SITE && unset PLAYWRIGHT_BROWSERS_PATH && node shoot.mjs <route> shots/<id> --desktop-only` (route
  e.g. `features/editor` or `docs/guides/forms`; light + dark at 1440px; prints page errors). Open the JPG with Read to
  LOOK at it (crop with sharp from `/workspace/sitewright/packages/image-pipeline` if it is tall:
  `node -e "require('sharp')(in).extract({left:0,top:Y,width:1440,height:H}).resize(900).toFile(out)"`).
  Drop `--desktop-only` once per page to check mobile too. Fix what looks wrong. Zero page errors is required.
- Media placeholders: add entries for your slots to `$SITE/datasets/media_slots-<your group>.json` (create it as a copy of
  the `dataset` block of `datasets/media_slots.json` plus your own `entries`), then `node push.mjs datasets`. Entry ids
  are snake_case and unique (prefix with your group: `feat_`, `doc_`, `sc_`). Values: `label` (what it will show, one
  line), `kind` image|video, `ratio` 16x10|16x9|4x3|3x2|1x1|9x16|3x4|21x9, `alt`, `capture` (instructions for the person
  who will record it: screen, state, length). Use a slot wherever a screenshot or a short screen video would explain the
  feature better than words: roughly 1–3 per feature page, 0–2 per doc page, none where a live demo is the point.

## Design system (read `pages/home.hbs`, `pages/f-publishing.hbs`, `pages/d-install.hbs`, `chrome/critical.css` and `snippets/*.hbs` first and match them)
- Inner page header: `{{> page-hero parent=page.parent}}` (title from `page.data.headline` or the title; lead from the
  description; `page.data.eyebrow` optional). ALWAYS pass `parent=page.parent` (the renderer builds page.parent only when
  the page's own text names it).
- Media: `{{> ws-media slot="feat_x"}}`, inside a `ws-browser` frame (`<div class="ws-browser"><div class="ws-browser-bar"><i></i><i></i><i></i><span class="ws-browser-url">…</span></div>{{> ws-media slot="…" class="rounded-none"}}</div>`) or a `ws-device` bezel.
- Feature pages end with `{{> feature-next features=pages.features._attributes.children}}`.
- Docs pages: `{{> page-hero parent=page.parent}}` then `<div class="ws-docs">{{> docs-nav}}<article class="ws-article">…</article></div>`.
  Inside `.ws-article` plain h2/h3/p/ul/ol/table are styled; give each h2 an `id`. Callouts: `<div class="ws-callout">` (or
  `ws-callout ws-callout-warn`) with `<p class="!mt-0">`.
- Code: the dark window `<div class="ws-window overflow-hidden rounded-2xl"><div class="ws-dots …"><i></i><i></i><i></i><span …>file</span></div><pre class="overflow-x-auto"><code>…</code></pre></div>`
  with token spans `tk-tag tk-attr tk-str tk-hb tk-kw tk-com tk-ok tk-dim` (see home.hbs). Escape `<` `>` `&` as entities,
  and write every literal Handlebars mustache in a sample as `\{{…}}` (a backslash before the opening braces) or it EXECUTES.
- Utilities only from the theme tokens (`bg-base-100/200/300`, `text-base-content/70`, `border-base-content/10`, `bg-primary`,
  `text-accent`, `bg-neutral text-white` for dark bands). Never fixed palette colours for surfaces or text (they break dark
  mode). Small indigo TEXT or ICONS on the page background use the class `ws-ink`, not `text-primary`.
  Headings: `ws-display` for big display type, `font-heading` otherwise; `ws-index` for small mono eyebrows; `ws-numeral`
  for oversized numbers; `ws-tile` for hoverable cards; `sw-border-beam` on at most one featured card per page.
- Motion, sparingly: `data-sw-animation="fade-up"` (+ `data-sw-delay="80"`) on section heads and card groups;
  `data-sw-parallax-translate="40,-40"` on at most one media frame per section. `ul` in custom layouts needs `list-none p-0`.
- Icons: `{{sw-icon "<phosphor name>" "h-5 w-5 ws-ink"}}`, brand logos `"brand:github"`. Check a name exists by pushing and
  screenshotting (an unknown icon renders nothing).
- FORBIDDEN in markup (the validator refuses them): `<nav>`, `<aside>`, `<header>`, `<footer>`, `<main>`, `<script>`;
  inline `style="…"` (use classes); a `(` inside a string argument of a helper. No `<h1>` (the hero has it).
- Editable text: put `data-sw-text="<unique_key>"` on headings and lead paragraphs you write in the page body (keys unique
  per page). Not on code, lists or docs articles.

## Accuracy (most important)
- Verify every fact, name, number, default, limit, route, attribute and env var in the repo before you write it: `docs/*.md`,
  `README.md`, `CHANGELOG.md`, `packages/schema/src/*` (authoring-reference.ts = helpers + directives; agent.ts = the agent
  guides; dataset.ts, form.ts, deploy-target.ts, website.ts, booking.ts, payments.ts), `packages/blocks/src/*`, `apps/api/src/*`.
  Prefer quoting behaviour the code shows over the README when they disagree. Numbers already checked: 82 MCP tools (88 with a
  member token), 57 `sw-*` helpers, 18 dataset field types, 10 components, 31 shader presets.
- NEVER claim: collection pages (removed), Postgres/Redis/S3 or multiple replicas (not built), a stable API or
  compatibility promise (pre-1.0), the stdio MCP bridge or `publish_project` (deprecated), "never unsafe-inline" CSP. AI
  clone is BETA. No invented customers, testimonials, benchmarks or percentages. Say what something does, not how fast.
- If you cannot verify something, leave it out and list it in your report.

## When you are done
Report back: the pages you wrote (id → route), the media slots you added, anything you left out or could not verify, and
any problem with the shared snippets/CSS you could not fix inside your own pages (do not edit shared files; describe the
change you need). Keep the report short.
