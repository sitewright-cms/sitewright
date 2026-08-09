# Changelog

All notable changes to Sitewright are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The running version of an instance is reported at `GET /version` (baked into the release image; see
[RELEASING.md](RELEASING.md)). While pre-1.0, minor versions may include breaking changes.

## [Unreleased]

## [0.15.0] — 2026-08-09

### Added




- **`clone_audit` now measures fixed-header clearance, at desktop *and* phone.** The `--sw-header-h`
  token is a hardcoded constant sized for the stock navbar, so it is wrong for essentially every
  imported header — and a census of 45 published sites found it is normally wrong at exactly *one*
  breakpoint, because a single unconditional `:root{--sw-header-h:…}` beats the platform's own
  media-query pair on source order and then applies at every width. Two checks: `header-height-token`
  gates on the token *under*-declaring the measured bar (content behind the header, one honest fix) and
  reports over-declaring without failing, since the strip it paints below the bar is only visible when
  the backgrounds differ; `header-spacer-applies` is advisory and reports the fact an author cannot
  otherwise see — that a `.sw-top-padding` did nothing because a `p-*`/`pt-*`, a custom rule or an
  inline style on the same element beat it on source order (measured on a real page:
  `class="wash sw-top-padding p-4"` computed 16px against a 102.8px token). Screen-reader-only headings
  are excluded from the text-position probe; they sit at the top of nearly every imported page and
  accounted for 5 of 6 candidate findings in the census.

### Changed


- **The form submission endpoint is no longer readable in the published HTML.** It was written straight
  onto the form as `data-sw-endpoint="…/f/<project>/<form>"`, and again inside the cart's
  `data-channels` JSON — a ready-to-POST address a scraper can grep for once and then hit forever,
  without ever loading the page again. The markup now carries only the form's id and the runtime
  assembles the URL from an encoded payload at body end, which holds the parts (base, project, preview
  flag) and no `/f/` path, so decoding it still hands over nothing to post to. `atob` + `JSON.parse`
  only, never `eval` — the published CSP allows no `'unsafe-eval'`, and eval would make it an XSS sink
  besides. This is OBFUSCATION, not a security control: anyone reading the JS can reconstruct the URL.
  It raises the cost for the naive harvester; the real defences are unchanged and server-side (honeypot,
  time-trap, rate limit, captcha, definition-aware validation). Deliberately untouched: `contactPhp`
  posts to a same-origin relative `contact.php` with nothing to harvest and must work in an export with
  no payload at all, and `thirdParty` posts to the author's own external endpoint, which is not ours to
  hide.




- **Muted text across the admin UI moved up one step, in both themes.** The pair used in 286 places
  measured 2.58:1 on the light header and 3.53:1 on the dark one — quiet rather than readable. Page
  paths, section descriptions, keyword labels, inactive tabs, the settings and account icons, drag
  handles and placeholder text all move with it. Measured after: the agent pill 2.58 → 7.35 (light) /
  3.53 → 12.11 (dark), a page row's path 4.55 / 6.85, inactive tabs 7.41 / 8.64, the header icons
  7.37 / 12.01. A pixel-sampling audit of the admin surfaces now reports no text below WCAG AA on any
  of these tokens in either theme.
- **The "Connect an agent" pill has a border** in both themes — all three states do. It floats on the
  frosted header, whose own surface sits close to each state's fill, so an unbordered pill read as
  loose text rather than a control.
- **Project icons in the selector sit on white, in both themes.** A favicon is artwork drawn for a
  white page — most are dark marks on transparency — so tinting the tile hid exactly the logos it was
  framing.
- **The five skeleton slots are one section, not five loose cards.** They are a single concept — the
  chrome rendered around every page — and as separate cards in a two-column grid they interleaved with
  the unrelated sections after them, so the group had a heading but no edges.
- **Logos & images comes before Brand colors** in Corporate Identity.
- **`/preview` says what it is waiting for.** Opening a cold project renders every page, re-encodes
  every referenced image size and compiles the stylesheet before the iframe can show anything, and
  that was a blank shell with a skeleton. A pill at the top centre now names the step — "Processing
  images…", "Rendering pages… 12 of 93" — with a spinner, and disappears at the first paint. The
  build reports its phases through a new non-blocking `GET /projects/:projectId/preview-progress`
  (the URL endpoint the shell already calls blocks for the whole build, so it can never narrate it).

### Fixed



- **Published forms could never submit, on any site served from a subdomain.** The publisher bakes an
  ABSOLUTE submission endpoint into every platform-routed form
  (`https://<platform>/f/<project>/<form>`, absolute whenever a public base URL is configured) while
  emitting `connect-src 'self'` — and a published site is served from `<slug>.<sitesDomain>`, a
  DIFFERENT origin. The browser blocked the submit before it left, so there was no request to log and
  no submission to store: SMTP, CORS, the endpoint and every form definition were correct, and the
  visitor got nothing. Measured on a real instance: 66 forms across every published project, none of
  which could ever send. The policy now carries the origin the publisher itself injected. Also fixes
  hCaptcha, blocked by the same policy (`js.hcaptcha.com` under `script-src 'self' 'unsafe-inline'`),
  which meant a captcha form could not even render its widget — `hcaptcha.com` and `*.hcaptcha.com`
  are allowed for `script`/`frame`/`connect`/`style` when, and only when, the page carries a widget.
  Both widenings are scoped per page, so a page without a form or a captcha stays strict. **Existing
  published sites must be republished to pick the new policy up.**



- **CI went red on an exhaustive test that was too slow to finish.** The Tailwind reference's
  "every declaration has a property and a value" sweep called `expect()` once per declaration —
  ~100k matcher invocations across 31,524 declarations. The bookkeeping, not the checking, took 510ms
  on a 20-core box and blew vitest's 5s default on CI's 2-core runner with every other package's suite
  running beside it. Scanning in plain JS and asserting once takes **7ms** for the same coverage, and
  reports every offender instead of stopping at the first.

- **The responsive device switch snapped in one direction and slid off-centre in the other.** "Large
  desktop" was the only target rendered as a differently-shaped box — `w-full`, in flow — while every
  other device was an absolutely-positioned, `translateX(-50%)`-centred one. Neither `position` nor
  `transform` is interpolable, so the transition had nothing to work with across that boundary.
  Measured on the old component: desktop→mobile produced **no mid-flight frames at all**, and
  mobile→desktop tweened its width while the box slid **795px** to the left — it jumped to the left
  edge the instant the centring transform vanished, then expanded from there. Only fixed→fixed
  switches (tablet↔laptop) ever worked, which is why the existing test passed. Fluid now resolves to
  the host's measured width in pixels, so every device renders the identical shape and every switch is
  a plain px→px tween with the centring transform held constant: measured after, all five switches
  glide with **0px** of centre drift. The E2E samples width *and* centre each frame, on both of the
  directions that involve fluid.


- **Dataset rows were laid out differently in the editor preview than on the published page.** To make
  a row click-to-edit, the dataset-aware `{{#each}}` (and `{{#sw-pick-entry}}`) wrapped every iteration
  in an injected `<div data-sw-entry>`. That wrapper exists only in the preview, so the editor showed a
  layout the live site would never have: `gap` and `grid-template-columns` spaced the wrappers instead
  of the cards, Tailwind's `space-x-*`/`divide-*` (`> * + *`) and every `:nth-child` rule stopped
  matching, and a carousel picked the wrappers as its slides. A loop rendering `<tr>` was worse than
  mis-styled — a `<div>` is not allowed inside a `<table>`, so the parser hoisted it out and the table
  came apart. The markers now go onto the row's own root element(s), located with htmlparser2 and
  spliced in by position (no parse/serialize round-trip, which would have renormalized quoting,
  boolean attributes and entities and reintroduced the same class of divergence). Stripping the two
  attributes from a preview render now reproduces the publish render byte for byte, and a row that has
  no element of its own to carry them — bare text, or text mixed with elements — still gets the
  wrapper, since losing the click affordance entirely would be worse. Click-to-code also got more
  accurate: it no longer has to step past a wrapper that has no counterpart in the source.

- **Fixed backgrounds in the page editor were stuck, not fixed.** The emulation that re-creates
  `background-attachment: fixed` inside the editor's scaled preview identified an already-adopted
  element by its `background-image` — which adoption itself sets to `none`. So the first re-scan (and
  any live page mutates within milliseconds) dropped every adopted element from the tracked list, and
  the clip-path froze at whatever it was measured at during load: measured on a real project, stuck at
  `inset(64px 0px 58.8125px)` through a 288px scroll. Recognising an adopted host by its LAYER fixes
  it. Two more holes closed while in there: the emulation is now REVERSIBLE, so the near-universal
  "no fixed backgrounds under 768px" media query hands the element its own background back instead of
  keeping the desktop treatment at mobile width with a blanked host (the device modes walk into this
  constantly); and a reflow — a late image or webfont settling, a pane drag, a device-mode switch —
  re-measures the clip, which previously only a scroll could do.
- **Self-hosted fonts fell back to a system face in the page-editor preview.** An imported webfont is
  stored as `kind:'file'` (media pulled in by URL is classified by content-type, and a font is neither
  image nor video), and the flat `/media/<slug>/<id>-<name>` route dispatches on that kind — so it
  served the font as `application/octet-stream`, as an attachment, with no CORS headers. The preview
  is a sandboxed opaque origin, where every request is cross-origin, so the font fetch simply failed
  and the text rendered in the fallback family. The published site and the whole-site `/preview` were
  unaffected (they serve their own copies under `_assets/`), which is exactly why it read as "the two
  previews use different fonts". A font is now served as a font whether it is stored as `kind:'font'`
  or as a file with a font extension.
- **Signing an MCP agent in while logged out reloaded the login screen until the rate limiter stopped
  it.** `/oauth/authorize` bounces an unauthenticated agent to `/?next=…`; the editor followed that
  return URL without checking there was now a session, got bounced straight back, and the two chased
  each other — measured at 31 navigations in 6 seconds. The login screen now simply stays up, with
  `next` preserved for after sign-in.
- **Saving a skeleton slot in its code editor now actually saves it.** The chrome slots (and the
  Critical CSS / head / scripts fields beside them) are edited in a modal with its own Save button and
  Ctrl+S, but that only staged the change into the settings form — the author still had to find the
  tab's Save, which reads as "I saved and it didn't save". The modal's save now persists in the same
  gesture. (The subtlety is that a naive save-after-patch persists the value from *before* the edit,
  because the form update is scheduled, not immediate; both now take the same change.)
- **The browser password manager no longer prompts over third-party secrets.** An SMTP password, an AI
  provider key, an OIDC client secret and a deploy target's FTP password are all `type="password"` —
  the only signal a manager gets — so each one offered to save "your password for this site" and to
  autofill an account password into an SMTP box. Those fields now opt out; real credentials (sign-in,
  change-password, MFA confirm) keep their proper autocomplete semantics and still work as before.

## [0.14.0] — 2026-08-07

### Changed

- **The preloader overlay is opaque, so changing pages stops flashing.** It was a 62%-transparent
  frosted pane: the overlay itself never flickered, but the content *behind* it cut hard from the old
  page to the new one on every internal navigation. Covering only the outgoing half would not have
  helped — the swap has two sides, and the arriving document paints its own overlay from first paint,
  so a translucent pane reveals the new page the instant it renders. Solid on both sides is what
  removes it. The blur went with it (a backdrop-filter behind an opaque fill paints nothing and costs
  a compositing layer); the fade itself is unchanged. Measured: with the overlay up over two
  deliberately different pages it renders to an identical pixel, and across a real navigation no
  fully-covered frame carried either page's colour.
- **Custom preloaders can opt in to that backdrop** (`preloaderBackdrop`, a toggle beside the custom
  code). Off by default and deliberately so: custom markup owns its own look, and some overlays are
  meant to be see-through — this is for the author who wants the same flash-free field the nine
  built-in effects get without hand-rolling a full-bleed layer.
- **zod 3 → 4.** Mostly mechanical, but three behaviours changed in ways that were silent rather than
  loud, so they are worth knowing about. `.default(x)` no longer parses `x` — it hands back the
  literal, so a `.default({})` on a schema with inner defaults stops applying them; `.prefault({})` is
  the replacement that keeps the old meaning. `.partial()` no longer strips inner defaults, which
  turned a merge-only settings patch into one that silently rewrote a field the admin had opted into.
  And `z.record` now DROPS a `__proto__` own property instead of rejecting it — not exploitable, since
  the key never reaches the output, but it turned an explicit reject into a quiet discard, so the
  prototype-safe stores now check the raw input before zod can drop anything.
- **MCP `put_content` declares `data` as required.** It always was, in practice — zod 3's JSON Schema
  simply omitted it because `z.unknown()` accepts `undefined`. Any caller this affects was already
  failing at the API. (`put_page` / `patch_page` are unchanged: zod 4 briefly dropped `page` from
  their required list, which is fixed rather than published.)

### Fixed

- **Seven Website settings were unsavable on their own, and revertable from the other tab.** The
  Settings modal splits one form across two independently-saved tabs using a hand-maintained list of
  field names, and the whole `security.txt` block (plus the new backdrop toggle) was missing from it.
  A missing field counts as a *Corporate Identity* field, so: the Website tab never went dirty, its
  Save button stayed disabled — and Identity's Discard silently reverted the edit while Identity's
  Save dropped it and still marked the form clean. Both failure modes were invisible until a reload.
  The split is now checked against where a field *actually* writes, so a future field that lands in
  `website.*` without being listed fails by name rather than silently misfiling itself.
- A custom preloader was emitted **raw** into the render-template canvas — outside the platform
  wrapper, on a surface that ships no preloader runtime, so nothing could ever clear it and it simply
  covered the canvas. That canvas now matches the page-preview route, which had already stopped
  emitting one: a preloader is whole-site chrome, and the whole-site draft preview is where it means
  anything.

- **Nothing you could download from a preview actually downloaded.** The preview response's CSP
  `sandbox` directive and the editor's iframe `sandbox` attribute both omitted `allow-downloads`, and
  the browser INTERSECTS the two lists — so the stricter side won silently, with no console error to
  find. Clicking a brochure link in a preview did nothing at all. Measured before/after on a real
  media-library PDF: blocked → downloads. The two lists were also hand-maintained separately, which is
  how they drifted; they now derive from one definition, with a guard test that fails on a
  reintroduced literal. (`target="_blank"` was reported alongside this and measured *working* on both
  surfaces — what was broken was every download, including the ones authored as `target="_blank"`.)
- **Back-to-top jumped instead of easing, in the whole-site preview.** That surface bridges window
  scroll onto `<body>`, and did it by assigning `body.scrollTop` — always instant, discarding the
  caller's `behavior:'smooth'`. It now forwards to the body's own scroll methods, and the preview body
  carries `scroll-behavior:smooth` to match the published root, so an un-annotated programmatic scroll
  resolves the same way on both surfaces. (The bridge's own position *restores* are explicitly
  instant — a state sync must not animate the page from the top on every reload.)
- **Fixed backgrounds scrolled in the page editor.** A scaled iframe paints
  `background-attachment: fixed` as `scroll` — measured for a wrapper transform, an iframe transform
  and CSS `zoom` alike, so no choice of scaling technique avoids it. The responsive device modes scale;
  `/preview` never does; that was exactly the asymmetry. `position: fixed` *does* still resolve against
  the frame viewport when scaled, so the fixed paint is now re-created with a viewport-filling clipped
  layer. Marker-gated: a page with no fixed background ships nothing.
- **YouTube and Vimeo embeds never played in any preview, and gave no hint why.** Their players need
  first-party storage; a preview is sandboxed without `allow-same-origin` (that opaque origin is the
  boundary keeping author JS away from the editor session), and sandbox flags are inherited by nested
  frames. Proven with a first-party control: no sandbox → player + video; `allow-scripts` alone →
  neither, and `localStorage` throws. `youtube-nocookie` is not a workaround. Preview builds now show a
  placeholder that keeps the embed's box and opens the video in a new tab. **Maps are unaffected** —
  Google Maps and OpenStreetMap both render sandboxed, so they are deliberately left alone.
- **Switching responsive views could strand the preview on a 404** until a manual reload. The two
  device branches rendered different tree shapes, so switching moved the `<iframe>` between depths and
  React remounted it — refetching a preview token that may since have expired. One tree now; the token
  also lives 15 minutes instead of 2, so it outlives an editing session.
- **Removing a Local Hosting target left its built site on disk.** Only the target record was deleted.
  The artifact stayed — served by nothing (so it looked removed), collected by nothing, and re-added
  months later a new local target would put that *stale* build straight back online before any
  republish. Deleting the target now deletes what it was serving. Remote targets are untouched: they
  build into a throwaway directory, and files already delivered to someone else's server are theirs.
- **The project selector's search box was never actually focused.** It carried `autoFocus`, and the
  modal's own mount effect took focus back in the same tick — so typing went nowhere. Fixed for every
  modal, not just this one. Enter now opens the top result.
- **Agent authorization dead-ended when signed out**, telling you to go and sign in elsewhere and come
  back — which for an agent-initiated flow means digging the URL out of a terminal. It round-trips
  through the login and resumes. The return URL is built server-side from the request itself and the
  editor honours it only for that one endpoint.
- The Project settings hint still described the slug as `/sites/<slug>/`, a URL form retired when
  hosting moved to subdomains. It is now "the site's URL-safe identifier".

### Changed

- **Entrance animations travel further.** The `fade-*` offsets were 2rem, which at typical section
  sizes reads as a twitch and is easy to miss on a first scroll-through; they are now 4rem, with
  `zoom-*` widened to match. `slide-*` and `flip-*` are unchanged — a full traverse and a rotation have
  no travel to grow.
- **The mini-shop drawer opens on the first item added.** Until now every add produced only a pulse on
  a floating tab that most first-time shoppers never noticed, so the click looked like it did nothing.
  Adding a second item does not interrupt browsing; emptying the cart re-arms the reveal.
- **Slide captions re-animate every time their slide comes round**, including loop-arounds. A slider
  sits at one scroll position, so the scroll-triggered entrance fired once for the whole track and every
  slide past the first was already revealed before anyone saw it.
- **The lightbox arrows and thumbnail strip ripple**, matching every other control on a published site.
- **A preview that is still loading shows a page-shaped skeleton** instead of blank white — opening a
  project and going straight to the preview can take seconds on a cold project, and picking a project
  now holds the selector, spinner and all, until that project's data has actually landed.
- **The MCP/agent authorization screen is a platform surface**, not an unstyled form: the brand mark, a
  frosted card, light and dark, and the project rendered as the same selectable cards as the editor's
  project selector — it scopes every token the agent receives, so it should read like a choice.
- In the page editor, the code strip no longer stays expanded over the preview once you move the
  pointer down to the page, and a new button under Mobile opens the current page in a new tab.

### Added

- **`{{sw-image url lightbox=true sizes=…}}`** emits the `<a href><img>` pair a Lightbox gallery item
  is made of: the anchor on the largest variant, the `<img>` keeping its own responsive srcset, so a
  grid paints thumbnails and the viewer still opens full detail. This has to happen at render time —
  publish materializes only the `?size=` variants something references, so a runtime "swap the href up
  to xl" would link a file the build never generated. ★ The agent guide had been telling cloners to
  write `size="md"`, a parameter `{{sw-image}}` has never had: it was silently ignored, `sizes` fell
  back to its `100vw` default, and every tile therefore fetched the largest rung — which is why cloned
  galleries shipped full-resolution grids.
- Two additions to the background-texture library: `bark-dark` and `triangles-dark`.


- **RFC 9116 `security.txt`, on both surfaces.** Published sites can opt in to a
  `/.well-known/security.txt` (Website settings → security.txt): the `Contact` entries are *selected*
  from things the project already holds — a page (typically the contact form), the Corporate Identity
  phone, the Corporate Identity email — rather than retyped, so they cannot drift from the site's real
  details. The contact page leads by default because it keeps working for as long as the site does and
  its submissions are stored server-side even when the notification email fails; the `mailto:` is off by
  default because the file is public and machine-read. `Expires` is recomputed from scratch on every
  publish (window selectable: 1, 2 or 5 years, default 5). A selected contact that resolves to nothing —
  a deleted contact page, a phone number with no country code — **fails the publish** naming the source,
  rather than silently shipping a file that promises a channel that isn't there.
  The instance itself now also answers `/.well-known/security.txt`, generated per request so its
  `Expires` is always ~90 days out and can never rot; `SW_SECURITY_CONTACT` points it at the operator.
  Previously that path returned the editor SPA's `index.html` with a 200 — a scanner asking for
  security.txt got a page of HTML.

### Security

- **A brand token could open a CSS comment and delete the rest of the stylesheet.** `/*` needs no
  whitespace, so denying whitespace controls never denied comments — and the value alphabets at the
  schema boundary (`CssStringSchema`, `TokenValueSchema`) and in both emitters (`brand-css.ts`'s `SAFE`,
  `@sitewright/tailwind`'s `renderThemeBlock`) all permitted `/` and `*`. A single
  `typography.fontFamilies` value of `Arial/*` opened a comment that ran past the closing brace of the
  generated `:root{…}` / `@theme{…}` block and on into whatever followed. Measured in a browser: every
  later `--sw-*` token resolved empty **and the next rule in the sheet stopped applying** — on the
  PUBLISHED document, reachable by any `content:write` actor (an invited client, an API key, the agent
  loop), not just the project owner. The check now lives in one place, `containsCssComment`, shared by
  the boundary and both emitters; each keeps its own value alphabet (they legitimately differ on
  parentheses) but none may carry a comment.

### Fixed

- **Most of the WYSIWYG toolbar had no visible effect — on either surface.** Both rich-text toolbars
  emit Tailwind utility CLASSES, and both applied them somewhere the matching rule did not exist, so a
  control captured the selection, wrapped it, set exactly the right class, and changed nothing on
  screen. In the dataset richtext field the editor SPA's stylesheet is compiled from the editor's own
  source, which never sees a class applied at runtime — measured, **14 of the 44 emittable classes had
  no rule at all** (every highlight but four, half the colours, `text-justify`, `pl-12`, `pl-16`), and
  the rest were live only because the editor's own chrome happened to use the same utility somewhere
  else. In the page-editor preview the sheet is compiled from the RENDERED markup, which by definition
  cannot contain a class the author has not picked yet, so every pick waited for a save and a re-render.
  The editor now compiles the toolbar's whole bounded vocabulary via `@source inline(...)` (kept in step
  with `RICH_CONTENT_SAFELIST` by a test that fails on drift), and the preview sheet is seeded with the
  same set plus the project's CI classes.
- **Brand colours and fonts in the dataset richtext field.** `font-heading`/`font-body` resolved to
  nothing at all, and `text-primary` and friends resolved to the editor chrome's own DaisyUI defaults —
  a colour, but the same wrong one in every project. The field now carries the open project's real brand
  (colour tokens, font slots incl. custom named ones, and `@font-face` for self-hosted faces), derived
  from the same `ciRichPalette` that builds the swatches, so the menu cannot offer a choice the sheet
  has no rule for.
- **The size scale collapsed at the bottom.** The editor lifts `--text-xs` to 14px as a UI readability
  floor; that leaked into author content, so the toolbar's "Tiny" and "Small" rendered identically in
  the field while the published page rendered 12px and 14px. Authored content now previews at the site's
  scale.
- **A stranded inline style could permanently beat the toolbar.** Deleting formatted text and typing
  again makes contentEditable carry the old run's "typing style" in as inline CSS, and an inline
  declaration outranks a utility class — so from that point on the size and colour buttons set classes
  that did nothing. Worse for colour: `color`/`background-color` survive the render sanitizer (unlike
  `font-size`), so a stale inline colour would have won on the published page too. Each control now
  clears the inline property it owns, on both surfaces.
- **The active toolbar button was invisible in dark mode.** The pressed state composited to
  rgb(27,33,74) on a rgb(14,22,42) bar — a measured **1.17:1**, so an author could not tell which marks
  were on. It now measures **3.97:1**, clearing the 3:1 an interactive affordance needs. Hovering an
  active button also no longer washes it out (a translucent `hover:` utility outranked the active fill,
  so pointing at a button that was on made it look off).
- **A project you just created comes back OWNED.** `GET /projects` carries the caller's `role`;
  `POST /projects` did not — so a freshly created project reached the editor with `role: undefined`
  and every owner-gated surface read it as *not owned* until something refetched the list. The Account
  modal told the creator "open a project you own to manage its access keys" about the project they had
  just made; a reload made it right, which is why it survived. Both create paths (new + duplicate) now
  return it. The staff-only boundary on `POST /projects` — invited clients are project `member`s and
  must never self-provision — had no test either, and now does.
- **The Regions rail no longer opens a popover you cannot click.** Its whole job is to reach content
  the page hides — a `{{sw-control}}` inside a `display:none` wrapper has no in-place click target —
  but side panels became drawers with a backdrop, and that backdrop covers the preview the rail just
  navigated you into. Activating a row now dismisses the rail (`SidePanelClose`).
- **A copied page no longer duplicates the original's MENU label.** The pages list and the auto-nav
  both label a page by its menu label, falling back to the title. `Copy` suffixed the title but left
  the menu label alone, so the copy appeared as a second identical row *and* a second identical nav
  item, separable only by URL.
- **The E2E suites run again.** They sit outside CI on purpose (serial, shared DinD host), and nothing
  noticed when they stopped working: the browser suite was at **zero passing**. Registration became
  invitation-only — unconditionally, there is no self-registration setting any more — which removed the
  login screen's register affordance, and 47 of 52 specs each carried their own hand-copied copy of that
  dead UI flow, so each waited 30s for a button that is never rendered. `scripts/e2e-deploy.sh` tried to
  compensate by PUTting `allowSelfRegistration` at `/admin/settings`, where nothing reads it — the
  endpoint answers 200 and ignores the key, so the breakage was invisible from both ends. Specs now seed
  users through ONE shared helper doing the real operator flow (admin invites → invitee registers →
  accepts) over `page.request`, which shares the browser's cookie jar; the deploy script verifies the
  seeded admin can actually log in and fails there with that message. **Editor: 0 → 114 passing, 0
  failing.** The API suite is green (20 passed, 2 skipped for want of real stock-provider keys) and
  re-runnable — it previously passed only once per fresh slot, because a spec asserted "no stock key
  configured" after a sibling had configured one, and claimed clearing was impossible when `stock: null`
  has always done it. Re-runnability is now a property of the browser suite too: specs that write
  INSTANCE-global state (OIDC providers, agent instructions) clear it up front and restore it at the
  end, so one spec's leftovers can no longer decide whether another passes. Along the way the specs
  stopped pinning byte sequences that legitimate transforms rewrite — a widened CSP sandbox, cache-
  busting `?v=`, the CSS minifier's sorted selector lists, the flat `_assets/`/`/media/` schemes. The
  suite's own README (`apps/editor/e2e/README.md`) now documents how to run it, how to read a failure,
  and every non-obvious thing about the UI it drives; both suites are a documented pre-release gate.

### Added

- **The rich-text size menu covers the platform's whole type scale.** Ten steps — `text-xs` through
  `text-6xl`, the range the design guide itself uses — behind the ONE existing size button, so the
  toolbar does not grow by a single pixel. Each row now renders its own label at its own size (capped,
  or a 6XL row would be 60px tall), so the menu reads as a scale rather than ten words. Since the
  toolbar emits no `h1`–`h6`, size is how rich content makes a line read as a headline, and the scale
  had to reach that far. Every new size lands in `RICH_CONTENT_SAFELIST` automatically, which is what
  compiles it into the PUBLISHED sheet.

### Fixed

- **A rich-text toolbar menu is no longer clipped by the dialog around it.** The list popovers were
  positioned absolutely inside the toolbar, so the dataset entry modal's own overflow cut them off —
  survivable at five items, but the ten-step size scale lost its last rows with no way to scroll to
  them. They are now portalled to `<body>`, positioned against the trigger, flipped above when there
  is no room below, capped to the space actually available, and layered above the elevated modal.

### Changed

- **The platform injects no heading tags, and rich content no longer carries them.** A heading is a
  structural claim about the PAGE, so only the page's own source should make one — anything else
  quietly rewrites the outline a search engine reads. Audited by rendering: every component showcase
  page was diffed served-HTML vs post-JS DOM, which found two injectors (grep alone had missed the
  second). An image map's tooltip headline and the mini-shop cart drawer's title are now `<div>`s
  carrying exactly the look their `<h3>`/`<h2>` had, and the cart `<dialog>` gained an `aria-label` so
  losing the heading costs it no accessible name. The rich-text toolbars drop their Heading 2/3
  buttons — the size menu now runs up to `text-3xl`/`text-4xl`, so a headline is size + `font-heading`
  + bold — and the render sink rewrites any `h1`–`h6` in a `data-sw-html` / `{{sw-html}}` / richtext
  value to `<p class="sw-h1…6">`, which closes the HTML-source editor as a way back in. Rewritten,
  never discarded, so no existing content loses its words: the six `sw-h*` classes reproduce the UA
  size scale plus the project's heading font/weight, measured identical to the real tags at all six
  levels and inside `.prose`. Headings authored in a page's own source are untouched.

### Fixed

- **A modal stays centred, and its close button stays on the corner, whatever width the author asked
  for.** The runtime splits the author's classes off the `<dialog>` by NAME — `max-w-2xl` is
  recognisably a width, `.bng-modal{max-width:680px}` is not — so a width expressed as a project CSS
  class, an id rule or an inline style sized the CARD while the PANEL that centres it and anchors the
  close kept its 32rem default. Measured on a real site at 1440px: a 680px card in a 512px panel came
  out 84px off-centre with the close sitting 144px inside it. The panel is now MEASURED against the
  card on every open and on resize, and adopts its width. **A modal now also always shrinks to fit a
  narrow screen and keeps a 2rem margin down both sides**, whatever width was asked for and however it
  was spelled: neither box may exceed the container's content box, and `min-width` — which outranks
  `width` and blocks a flex item from shrinking — is released on both, so a `min-w-*` utility or an
  author's inline `min-width` can no longer strand the card, or its close button, off the side of a
  phone. Verified across 13 width configurations (utility, project class, id rule, inline style, and
  all of them at once) at five phone widths. Authoring is unchanged — a width utility on the
  `<dialog>` remains the direct route, and is now spelled out in the component catalog and the agent
  guide.

- **An image map's tooltip can be reached with the mouse.** Every rect the runtime hit-tests against
  the pointer was built as `getBoundingClientRect() + window.scrollY` and compared against
  `event.pageY` — which agree only while the DOCUMENT is the scroller. The draft preview scrolls
  `<body>` and redefines `window.scrollY` to return `body.scrollTop`, while `pageY` keeps using
  `documentElement.scrollTop` (0 there), so on any scrolled page the tooltip's hover bridge sat a
  full scroll-height away from the pointer: the tooltip closed the instant you left the hotspot and a
  tooltip Button could never be pressed. The runtime now measures both in the same space.

### Added

- **An image map is marked like every other editable region.** In content mode it carries the same
  dashed teal outline as a dataset row — both mean "a click opens a dedicated editor" — with an inset
  hover tint (a background tint would be invisible under the map's own image), and it is listed in
  the Regions rail, which opens it too. Only a STORED map is marked; a config inlined in the page has
  no Studio to open, so an outline there would promise an editor that never appears.

### Added

- **Click an image map in the page editor to edit it.** A map placed on a page opens in the Image Map
  Studio, on that map; saving re-renders the page preview so the change is visible without a reload,
  and the Studio stays open. Only a STORED map is clickable — the embed markup now carries the map's
  id in preview (the `{{sw-imagemap}}` embed code the Studio hands out did not, so a map placed the
  intended way could be seen in the editor and never opened from it), and a config inlined in the page
  source has no map entity to open, so the click falls through to the map's own behaviour.

### Fixed

- **A custom preloader no longer covers the page forever.** The runtime that clears the overlay
  shipped only when a BUILT-IN effect was chosen, and `effects.preloaderCode` only applies when the
  effect is `none` — exactly opposite conditions, so the one configuration that emitted an overlay
  was the one with nothing to remove it. Custom markup is now wrapped in the platform's own
  `[data-sw-preloader]` overlay (the author writes the spinner, the platform keeps the show/hide
  contract) and the runtime ships for it. The single-page editor canvas renders no preloader at all
  now, custom or built-in — a preloader is whole-site chrome, previewed in the draft preview.
- **An image map paints the image an artboard names.** `background_type` defaults to `color`, so a
  config carrying `image_url` and nothing else rendered a blank white artboard and ignored the image
  — including every code-first example in the component catalog. The type is inferred from a present
  `image_url` when the config doesn't set one; an explicit choice still wins.
- **A chrome slot says why a snippet does not work in it.** Slots render without partials (by design,
  so the editor's click-to-edit bridge has nothing to drift against), but the error was Handlebars'
  bare "The partial X could not be found" — and in the draft preview the slot was dropped silently,
  so the header simply vanished from every page. The message now names the reason, preview logs it at
  warn and reports it with the render, and the authoring guide says so up front.

### Fixed

- **A deleted page leaves the draft preview.** The preview rebuilt on the newest content timestamp,
  which a delete cannot move — the row is removed, so the maximum stays wherever it already was. A
  deleted page therefore kept serving out of the last build until an unrelated edit happened to bump
  the clock. The version counts rows as well as timestamping them now.
- **One broken page no longer freezes the whole draft preview.** A page that could not render — a
  dangling `{{sw-imagemap}}`/`{{sw-form}}` id, a bad Handlebars source — failed the entire build, so
  every page of the project kept serving its last good output, with a 200 and no signal anywhere: an
  author edited and watched nothing change. A draft build now isolates the failure to the page that
  has it, serving an error document at that page's own route and rebuilding everything else. The
  preview shell names the affected pages, so a failure is visible from a page that is perfectly fine.
  A PUBLISH still fails whole on the first bad page — a broken page must not reach a live site.

### Fixed

- **An image map fits the box the page gave it.** The runtime sized its canvas from the embed's
  PARENT, so any width on the embed itself — `max-width`, a width class, a narrower column — was
  ignored and the map drew straight over whatever sat beside it. Measured on a real page: a 493px
  embed drew a 696px canvas at a 760px viewport. It measures its own content box now (padding and
  border excluded), falling back to the parent when it has no width of its own and never exceeding
  what the parent offers.

- **An icon hotspot is painted in the colour the author picked.** Every icon in the platform's
  library draws with `fill="currentColor"`, and a presentation attribute on the element beats the
  inherited CSS `fill` the runtime was setting — so a marker ignored `icon_fill` and came out in the
  page's body-text colour, while the Studio showed the chosen one. The runtime now sets both
  properties from the same value, at rest and on hover.
- **An icon's ground shadow scales with the marker.** It was sized from the pixel `icon_size` even
  when the icon is sized as a percentage of the map, so it slid out from under the marker at every
  container width but one. It is now expressed against the icon's own box — identical for a pixel
  icon, correct for a percent one — and the Studio draws it too, with a toggle in the Style tab.
- **A pageload animation lands on the hotspot's coordinate.** `fall-down` counted frames while the
  style reset ran off a timer, so the last frame could write its easing value after the reset and
  leave every marker permanently ~1.2px below its own coordinate.

## [0.13.0] — 2026-08-04

Interactive image maps: an image or SVG overlaid with clickable regions that highlight, open rich
tooltips, switch floors and zoom. Built by porting a licensed third-party product into the platform
rather than wrapping it — which meant taking its capabilities apart until only data was left.

### Added

- **`data-sw-component="image-map"` — interactive hotspot maps.** Polygon, rectangle, oval, pin, text
  and imported-SVG regions over an image, each with a rich tooltip, an optional link, and grouping;
  multiple "artboards" (floor plans, map layers) with a switcher; pinch/scroll zoom with a navigator;
  fullscreen; and a searchable object list. Page elements elsewhere drive the map with no JavaScript
  at all, through `data-sw-imap-*` attributes — `data-sw-imap-trigger-object-on-mouseover="Studio A"`
  on a list item highlights that hotspot and opens its tooltip. Degrades to the plain image with JS
  off, or if a config will not parse.
- **Image maps are stored content (`imagemap`) and embedded by reference.** `{{sw-imagemap "id"}}`,
  or `<div data-sw-imagemap="id">` code-first. Both resolve at render into the component wrapper, a
  no-JS fallback image, and the config as a `<script type="application/json">` data block. Version
  history, project export/import and the MCP generic content tools all carry them, so an agent can
  author a map like any other content.
- **The Image Map Studio** (System Library → Image map studio). Pick a background, draw regions over
  it, drag and resize them, edit polygon vertices, give each a tooltip and an action, and arrange
  them across artboards. Every asset field goes through the project's own file picker — there are no
  bare URL boxes — so a published site stays self-contained.
- **Five starter templates**, ported from the vendor's demo set: a real-estate building whose floors
  each open their own plan (10 artboards), a US national-parks vector map (130 regions), a jet-engine
  blueprint, a 401-region anatomical diagram, and an infographic. Creating from one copies its images
  into the project's media library and rewrites the config, so nothing a project references lives on
  the platform.

### Security

- **The runtime executes no tenant code.** The upstream product had four paths that did: a
  `run-script` hotspot action (an `eval`), a `custom_js` block injected as a `<script>`, an
  `onclick="…"` on a tooltip button, and — the one that hides best — an SVG hotspot whose element
  name and attribute names both come from the config, so `tagName: "script"` built an executable SVG
  script element. All four are gone or allowlisted, asserted against the generated bundle so a future
  re-vendor cannot restore them.
- **A map config cannot escape into the page.** Tooltip rich text and embeds are sanitized, at the
  render sink and again at rest; hotspot links are scheme-checked; object titles render as text; and
  every config value reaching CSS is escaped, after a probe found a filter name could close its rule
  and apply arbitrary CSS to the whole page.

### Fixed

- **Nine defects in the ported runtime**, each a real bug in the original: three store actions whose
  promises never settled (one could wedge the action queue that awaits it), a rejected action that
  blocked the queue permanently, attribute bindings installed once per map so two maps fired every
  trigger twice, a tooltip container appended to `document.body` and removed document-wide by an id
  that defaults to `0` — so a second map's init deleted the first map's tooltips — and an object-list
  search that built a `RegExp` from raw visitor input.


## [0.12.4] — 2026-08-03

### Fixed

- **`fidelity_check` was scoring a blank page as a 0% clone.** It returned `coverage: 0` on three of six
  real projects and the clones were fine in every case — the capture was not, and nothing said so.
  `settlePage` scrolls a page top-to-bottom for lazy content and comes back with `window.scrollTo(0, 0)`,
  which is a no-op on a preview page (it scrolls its BODY); the freeze step then removes that overflow so
  a full-page shot isn't clipped, and the document becomes the scroller carrying the offset the body was
  left at. Measured in the container: `documentElement.scrollTop` 4228 with `window.scrollY` reading 0,
  the first heading at `top:-3516`, and 39 extractable elements collapsing to 1 — reported as a clone
  that matched nothing. The reset now runs after the overflow changes and covers whichever element
  actually scrolls. Two projects went 0% → 100%, and chrome coverage came back with them.
- **A failed capture no longer reads as a score.** The element capture swallowed every error into an
  empty result — deliberately, so the gate degrades rather than throwing, but it made a broken render
  indistinguishable from a clone that reproduced nothing. That is what the bug above hid behind for six
  clone runs, and an agent reading `coverage: 0` concluded the tool was structurally incompatible with
  its job and stopped using it. `fidelity_check` now returns a `capture` field naming the side that could
  not be looked at, including the merely empty case, since a real page always yields some heading or
  link. A gate is allowed to fail a page; it is not allowed to say "you scored 0" when it means "I could
  not look".

## [0.12.3] — 2026-08-03

### Fixed

- **The clone-fidelity gate was failing good clones, and it was not the thresholds.** Three defects,
  found by running the gate against finished clones and their live originals rather than by reading the
  reports of agents who had used it. Two of those reports blamed causes that turn out not to exist —
  the body matcher pairs elements by TEXT, not by selector, so renaming classes cannot affect it, and
  the capture has not resized the layout viewport since #516. What was actually wrong: (1) the font
  fingerprint measured a canvas set to the element's FIRST family and skipped any family the browser
  would not confirm, which is exactly a source site whose own `@font-face` 404s — so every clone of one
  reported a font mismatch it could do nothing about, while both sides rendered the identical 2030px of
  glyphs; it now measures the element's whole computed family list, i.e. what it really renders. (2) The
  element inventory found buttons by tag or by a `btn` in the class name, so a CTA authored as
  `<span class="rounded-full border px-4">` was invisible and the original's real `<button>` counted as
  missing CONTENT — one page scored 76% for seven buttons that were all there; buttons are now also
  recognised from appearance, which adds nothing at all to an original and so cannot inflate the score.
  (3) The behaviour leg's font check accepted only the generic keywords, so Verdana, Georgia, Times New
  Roman and every other named system face read as MISSING — the same faces the picker offers, the
  importer writes, and the agent guide recommends. An agent's only escape was a webfont the original
  never had, which (1) then flagged as a mismatch: two gates pushing opposite ways. Measured across
  three pairs: 76%→95% and PASS on one, three of four font diffs gone on another, no change on the
  third. The one diff that survived was a real defect the noise had been hiding.
  `scorePage`'s `maxFontMiss: 0` is deliberately unchanged — loosening it would have hidden that defect.

## [0.12.2] — 2026-08-03

Three things that were quietly broken on every project, found by reviewing cloned sites rather than
by reading the code — each one had been true for a long time and looked like a content problem.

### Fixed

- **The font preview never showed the font.** Corporate Identity's "The quick brown fox jumps" sample
  built its `@font-face` url by cutting the asset url at the last `/`, which drops the `<id>-` prefix
  the FLAT media scheme puts there — `/media/skeleta/TYbf4C-primary-font-400.woff` became
  `/media/skeleta/primary-font-400.woff` and 404'd. So the sample has been rendering in the fallback
  for every project since media went flat, and a person choosing a font was picking blind. Measured
  rather than reasoned: the browser reports `net::ERR_ABORTED`, `document.fonts` marks the face
  `error`, and the "custom" face and a plain fallback measure the same 711px. The prefix now comes
  from stripping the primary face's own file name off the url — the one derivation that is right for
  both the flat and the legacy nested scheme.

- **Every build re-encoded every thumbnail.** The publish/preview build generated each referenced
  image derivative from its original on every single build, with no cache — so any site-wide edit (a
  colour, a nav item, a font) was followed by a full re-encode before the next preview could be
  served. On a 295-image project that was 38 seconds, twice in a row on the same content, and it
  scaled with IMAGES rather than pages: 8 images 0.78s, 61 images 7.5s, 295 images 38s, about 125ms
  each. The build now reads derivatives from the same store the on-demand `/media?size=` route
  already fills, and writes back the ones it does have to encode; a repeat build is a copy, and when
  every variant is cached the original is not even read. The isolated build worker has no writable
  store and simply keeps encoding, which is correct — its whole point is that it shares nothing.

- **External links in previews did nothing.** The preview iframe was sandboxed without
  `allow-popups`, so every `target="_blank"` link on every previewed site silently failed to open —
  correct markup, right href, nothing overlapping it, and no navigation. A clone review spent its
  time looking for the fault in 31 authored IMDb links. The sandbox now carries
  `allow-popups allow-popups-to-escape-sandbox`, on the iframe attribute AND the response CSP, since
  the stricter of the two wins; the escape token matters as much as the popup one, or the new tab
  lands on the target site at an opaque origin and breaks there instead. `allow-same-origin` remains
  out, and a test now says so out loud.

## [0.12.1] — 2026-08-03

### Fixed

- **The submissions inbox reads the author's labels too.** 0.12.0 gave the notification email the
  field's own label; the inbox is the OTHER place a person reads a lead, and it still showed
  `arrival_date` and `rental` in monospace while the author had written "Pickup Date in Windhoek" and
  "Car Rental or Travel Agent" right there in the form. The list route now sends each form's display
  name and its field labels alongside the rows, resolved from the definition as it is NOW rather than
  frozen into the row — renaming a label fixes every lead already sitting in the inbox, not only the
  next one. A field the definition does not declare keeps its own name IN MONOSPACE, because it is the
  raw key and dressing one up as prose would hide which are the author's words and which are the
  wiring; the raw name stays on the `title` either way.

## [0.12.0] — 2026-08-03

Seven platform defects, all found the same way: by using the platform to finish and review a batch of
cloned sites, then asking what the tooling should have told us and didn't. The through-line is the one
this project keeps meeting — the platform knowing something and not saying it.

### Added

- **The audit fails a page that links a file nothing will serve.** Eight publication PDFs shipped on a
  finished clone as eight dead download buttons: the links pointed at the SOURCE site's own tree
  (`/_data/assets/…`), the media library held 522 assets and not one pdf, and every click 404'd while
  the originals served fine. The importer was not the culprit — it already collects and hosts
  `<a href>` documents and `<iframe|embed|object>` sources. The failure is one step later: a page
  AUTHORED from the original's markup carries the original's paths straight through, and nothing ever
  asked whether they resolve. `assets-resolve` now names them. Deliberately narrow: a `{{sw-url …}}` ref
  resolves at render, a page-relative or cross-origin path is not ours to judge, and a path without an
  extension is a route.
- **The audit fails author CSS that redefines a platform class.** A clone redeclared `.sw-container`.
  The platform's rule for it lives in `@layer sw-normalize`, and unlayered author CSS beats any layer
  whatever its specificity — so the platform rule stopped applying and the Website → Content width
  setting was inert on that site, with nothing anywhere saying so. `platform-classes` tests the rule's
  SUBJECT, which is the whole distinction: `html.sw-scrolled .my-header{…}` is exactly how a scroll
  response is meant to be written and stays free, while `.sw-container{…}` is caught.

### Fixed

- **★ A code-first form confirmed nothing, and could be double-posted.** `FORM_JS` reveals
  `[data-sw-part="success"]` on a 2xx, `[data-sw-part="error"]` on a failure, and disables
  `[data-sw-part="submit"]` while the request is in flight. The `{{sw-form}}` helper emits all three;
  the code-first `data-sw-form` path emitted none of them. So a hand-authored form submitted
  successfully and told the visitor nothing, failed silently when delivery broke, and posted the lead
  again on a second click — while the definition's own successMessage and errorMessage were rendered
  nowhere at all. Code-first is the primary authoring model here, so this was the DEFAULT experience.
  Injected only when absent and keyed on the PART, so an author's own status markup keeps its
  placement, wording and classes.
- **★ A form could not be submitted from a preview at all.** The draft preview is served
  `sandbox allow-scripts` with no `allow-forms`, on the reasoning that a shared draft must not fire
  real leads at the merchant. The reasoning is right; the result was that the browser refused the
  submit outright, so the button did nothing, said nothing, and the one feature you could not exercise
  on the surface the entire review workflow runs on was forms. Testing one meant publishing the site.
  Both halves are now handled separately: the previews allow the submit event, and their forms post to
  a new DRY-RUN endpoint — same parse, same bot filters, same definition-aware validation, then nothing
  stored and nothing emailed. All three preview surfaces are covered.
- **A merge patch can now REMOVE a field, and a full write infers its id.** `?merge=1` could only add or
  overwrite, and some fields cannot be overwritten into absence: `template` is `.min(1)`, so
  `template:""` fails validation and `template:null` was stored as a literal null and then failed it
  too. Moving a page off a template ref — the whole "this translation now inherits its parent's code"
  operation — had no expressible form. A patch value of `null` now deletes the key. Separately, a full
  write must carry `id` and the path already says what it is; the failure was a bare
  `{"fieldErrors":{"id":["Required"]}}` naming neither the id nor where it belongs. It is now defaulted
  from the path, and an id that is present and disagrees still conflicts.
- **The notification email reads the author's labels, and a rejection names its cap.** The body was
  keyed by input `name` — wiring. A merchant opening a meal-kit order read `arrival_date:` and
  `rental:` while the author had written "Pickup Date in Windhoek" and "Car Rental or Travel Agent"
  right there in the form definition, which the route already had in hand. Fields with no definition
  entry keep their own name, which is right for what a hand-authored page posts beyond its definition.
  The retry path re-reads the labels from the form as it is NOW, like the recipient beside it. And
  every structural rejection collapsed into one `invalid submission`: a big order form sits close to
  the 60-field cap — a real one measured 44 — and the first time a menu grows past it, every order 400s
  with a message that names neither the limit nor its existence.
- **A media folder delete says what it binned, and can be asked first.** Deleting a folder bins
  everything under it — soft-deleted to the Recycle Bin, not merely unfiled. That is right, and it was
  invisible: the call answered a bare 204 whether it removed an empty folder or five hundred
  photographs, and there was no way to ask first. It now reports the folder, the count, the number of
  folders that disappear and a sample of filenames, and `?dryRun=1` returns the same shape while
  touching nothing. The folder count is the one a PERSON sees rather than the number of folder RECORDS
  — a library only ever uploaded into has records for none of it, and would have reported "0
  subfolders" while removing eleven.

## [0.11.0] — 2026-08-03

### Added

- **Form notifications retry, and a failure is now visible.** Delivery is best-effort by design — the
  submission is stored and the visitor thanked whether or not the mail leaves — which is right for the
  visitor and used to be the end of it. A transient SMTP failure meant the notification simply never
  happened: the lead survived in the inbox, nobody was told it had arrived, and the only trace was one
  line in a server log. Each submission now carries its own delivery state, so a failure leaves something
  the platform can retry and a person can see.
  Retries back off 1m → 5m → 15m → 1h → 6h → 24h and then stop, which covers an outage starting on a
  Friday evening without hammering a provider that is simply refusing. Each attempt re-reads the form as
  it is *now*, so correcting the recipient or the SMTP settings actually clears the backlog rather than
  replaying a snapshot of the mistake. A claimed row carries a short lease, so a process killed
  mid-send leaves work that becomes due again by itself instead of stuck.
  The alert is in-app, because emailing someone about broken email is circular: a banner in the
  submissions inbox with the reason, a warning on the Forms tab, an instance-wide count beside the
  admin's mail settings — shown even when SMTP is switched off, which is when a backlog is most
  likely — and a **Resend** action so a backlog built up during an outage can be cleared once the
  cause is fixed.

### Fixed

- **★ An author's `transition:` shorthand silently deleted a scroll reveal.** The platform declares the
  reveal as `[data-sw-animation]{transition-property:opacity,transform}` at (0,1,0). An author's own
  `.card{transition:outline-color .2s ease}` is ALSO (0,1,0), comes later, and a shorthand REPLACES
  `transition-property` outright — so the reveal had nothing left to animate. Measured on one clone: four
  tiles went 0 → 1 opacity inside 80 ms and their 0/90/180/270 ms stagger was invisible, with the author's
  markup completely correct. The same shorthand appeared on four separate classes in that one site, so it
  is not a slip — it is what people write. The runtime now SELF-HEALS at arm time: it reads the computed
  `transition-property` and re-declares `opacity,transform` inline only when `opacity` / `transform` /
  `all` are all absent. Deliberately not by raising specificity, which would contradict this release
  series' whole direction — the author's own selector wins.
- **The model image clamp covered one path of two.** 0.10.0 clamped `captureUrlShots` after an agent died
  on an over-limit screenshot; the REGION crop behind `inspect_source` / `compare_regions` was never
  covered, and it is worse — it caps the crop at 1500 CSS px of height and captures at deviceScaleFactor
  2, so *every* crop was 3000 physical px, and a full-width crop at the 1440 viewport 2880. Another agent
  died at turn 119 with the identical error. The comment above that cap explains the miss exactly: it
  reasons carefully about bounding the PAYLOAD SIZE and never mentions dimensions. Crops stay lossless
  WebP through the resize — re-encoding a UI crop as JPEG would put ringing on the hairlines a crop exists
  to let an agent judge. The test lesson is the real one: 0.10.0's test asserted the clamp FUNCTION worked
  and passed throughout; what it never asserted was that every image an agent can receive goes through a
  clamp. Coverage of the mechanism is not coverage of the surface.

### Security

- **★ The platform mailer was sending SMTP credentials in the clear.** `globalSmtp` and `userSmtp` build a
  nodemailer transport, and nodemailer's STARTTLS is *opportunistic*: against a server that does not
  advertise the capability it carries on unencrypted and authenticates anyway. So an on-path attacker who
  strips STARTTLS from the EHLO reply — or simply a provider on a plaintext port — harvested the mailbox
  password. Measured against a real socket before the fix: **zero encrypted lines**, `AUTH PLAIN` decoding
  to `\0apikey\0…` on the wire, and the message delivered as if nothing were wrong.
  It survived this long because every existing test injected a recording transport, so nodemailer was
  never constructed and its TLS negotiation was exercised by nothing. Both mailers now follow the same two
  rules the exported `contact.php` client already did — credentials never unencrypted anywhere, messages
  never unencrypted to a remote host, loopback still allowed for the classic `localhost:25` relay — so a
  customer's guarantee no longer depends on which of the two SMTP clients happens to deliver their mail.

## [0.10.0] — 2026-08-02

### Fixed

- **A nav effect no longer outranks the author's own nav CSS.** A scheme selector reaches (0,4,1) —
  `.sw-nav-line-bottom .menu:not([class*="sw-nav-"]) a.active` — which no sensible author selector beats.
  Three clones out of eight shipped an accent-coloured current nav item against a plain-white original,
  and on one the agent had written exactly the right rule, at (0,2,2), and still lost. The schemes now
  ship in `@layer sw-effects`: layered declarations lose to ANY unlayered rule whatever its specificity,
  so the author always wins, while each scheme keeps its INTERNAL specificity and its own
  base → `:hover` → `.active` ordering still resolves as written. `:where()` was the alternative and is
  the wrong tool here — it would flatten those three and leave source order to decide.
- **The rest of the platform's visual defaults are zero-specificity too.** The component catalog has long
  promised that "every default is zero-specificity so utility classes still restyle it"; it was not true,
  and four clones shipped visibly wrong output because of it — a Ken Burns caption keeping a shadow it was
  told to drop, five brand logos at 73×73 against an original's 180×180, three contact fields carrying the
  SAME `w-[60%]` rendering 656/635/620px wide, a tab strip keeping a 16px gap the author had explicitly
  closed. Measured on the emitted stylesheet, rules an author cannot restyle went **56 → 37**; what stays
  firm is listed with a reason (Embla mechanics, the `<dialog>` box, the honeypot, the checkbox exception,
  our overrides of the vendored lightbox, anything expressing a state), and a test now walks the whole
  sheet on every run rather than trusting it.
- **A carousel label no longer costs it every style rule.** The stylesheet keyed on `data-sw-block` while
  the runtime enhanced `data-sw-component`, so `data-sw-block="Hero slider"` — a natural thing to write,
  since the editor uses that attribute as a human-readable label — removed all 78 carousel rules while the
  JS still ran. A blank hero, no error, no console warning. Carousel and lightbox CSS key on the component
  marker now.
- **Lazy images inside a slider actually load.** `loading="lazy"` in a carousel meant never: the browser
  defers until the image nears the SCROLLING viewport, and a slide two places along is translated sideways,
  not below the fold. An image that has not loaded has no intrinsic size either, so in a flex slide it
  collapsed to width 0 — an empty slot, not a placeholder. Measured: 3 of 13 slide images stuck at
  naturalWidth 0, and paging forward four times did not rescue them. The carousel now decides deferral from
  its own track, promoting the selected slide and its neighbours while distant slides stay lazy.
- **An opaque page background no longer buries a fixed background layer.** A `position:fixed; z-index:-1`
  video or image is a negative-z descendant of body, and body's own background paints AFTER it — so a hero
  backdrop was covered while still loading and playing behind it, reported twice as "the video is missing".
  The page colour sits on the root with body transparent, and `body{isolation:isolate}` makes body a
  stacking context so an authored body background cannot bury the layer either.
- **The header content offset is a value you can set, not a class you have to guess.** The only way to
  argue with the automatic offset was the PRESENCE of `.sw-top-padding` inside the wrapper, so that one
  class meant both "pad here" and "hands off, I did it myself". Reserve the space any other way and the
  platform added its own on top — 503px where the original had 251, under two different class names in the
  same clone — and "the bar clearance PLUS my own margin" could not be expressed at all. The amount is now
  `--sw-header-offset`, settable per page (`:root` in that page's `<style>`) or site-wide, defaulting to the
  bar height. `--sw-header-h` keeps its single meaning, so changing the offset no longer moves where
  jump-links land or where ScrollSpy thinks a section starts. The old sentinel still works, so no migration.
- **Content at the bottom of a page reveals.** The scroll-reveal line sits 20% up from the viewport bottom,
  which an element reaches by having content BELOW it to scroll past — the last things on a page have none,
  so they stayed at `opacity:0` permanently. Measured on a clone: three footer elements invisible forever,
  reported as missing content rather than a broken animation.
- **The date picker stays on its field.** Vanilla Calendar Pro positions from `window.scrollY` alone and
  never reads `body.scrollTop`, so on a page whose scroller is not the window — including the platform's own
  preview shell — the popup was placed once and then stranded: field at y=312, popup still painting at y=660.
- **A social icon can carry a weight.** `identity.social[].icon` fed `{{sw-icon}}` but forbade the `:weight`
  suffix that helper takes everywhere else, so a clone of a site with hairline glyphs shipped filled marks —
  its author tried `envelope:light` and got `400: invalid icon name`.
- **The audit's tablet viewport moved off 768px**, the single pixel where `@media (max-width:768px)` and
  Tailwind's `max-[768px]:` disagree — so the tool was rendering exactly where a page's two spellings of the
  same breakpoint describe different layouts.
- **An oversized image no longer kills a session unrecoverably.** An image past the model's 2000px
  many-image limit rejects the whole request; one agent died at 37 minutes and 124 turns with no way to resume.
- **The header content offset no longer assumes a fixed bar sits at the top**, which gave a design resting
  its bar at `calc(100dvh - 79px)` a phantom 79px band above a full-bleed hero.
- **Three untrue statements in the agent guide, two self-contradicting tool descriptions, and an MCP error
  that blamed a missing browser** for a selector that simply matched nothing.
- Six dead constants in the e2e specs that had been failing lint on `main`.


### Added

- **A "Send test message" action for instance and per-project SMTP.** The connection test proves the
  server accepts our login, which is not the same as proving mail arrives: a rejected sender address, a
  refused recipient, or an SPF/DKIM misalignment all pass `verify()` and then silently swallow every lead.
  Only a message that lands in a human's inbox catches those. **Agency staff** (instance admin or
  developer) may address it anywhere, defaulting to their own account email — they are the ones
  diagnosing deliverability, and often need to see how the mail lands somewhere else. **Everyone else gets
  their own account address and nothing else**: a project member is an invited client, and "make this
  server send a message to an address I choose" is not a capability a client should hold. That is enforced
  server-side, not by hiding the field — a hidden field is a suggestion, this is a rule — and the send path
  obeys the same encryption rules as a real submission, so it cannot become a way to push a message out in
  the clear that a form would refuse to send.
- **A "Test connection" button for instance and per-project SMTP.** Form delivery is best-effort by design:
  the submission is stored and the visitor thanked whether or not the mail leaves, which is right for the
  visitor and leaves the operator with no signal at all — the only trace of a broken SMTP was a line in the
  server log. Requiring encryption (above) turns a genuinely insecure server from quietly-working into
  failing, so there had to be somewhere that is visible at the moment someone configures it rather than
  weeks later when a lead goes missing. It opens a real session and authenticates, sending nothing, and
  reports causes an operator can act on ("does not offer STARTTLS … use 587 with STARTTLS, or 465 with
  implicit TLS enabled") without ever echoing the password or the server's banner.

- **`contact.php` can deliver over authenticated SMTP** — a fifth form delivery mode, `contactPhpSmtp`.
  It reuses the exported `contact.php` (same file, same dispatch by the hidden `_form` field) but sends
  through the project's own SMTP credentials instead of the host's `mail()`. The reason is deliverability:
  `mail()` on shared hosting sends from the host's IP with an unaligned envelope, so it routinely fails
  SPF/DKIM and lands in spam — and until now the only authenticated option was platform-routed, which made
  "the site must work without the platform" and "the mail must actually arrive" mutually exclusive.
  The SMTP client is ~90 lines of PHP rather than a vendored PHPMailer, whose thousands of lines and own
  CVE stream would ship into every exported site; it speaks EHLO, STARTTLS, AUTH PLAIN/LOGIN and DATA with
  explicit timeouts, so a black-holed host cannot hang a visitor's request.
  **Credentials never travel in the clear**: if the channel cannot be encrypted the client aborts instead
  of downgrading, TLS peer verification stays on for both the implicit-TLS and the STARTTLS path, and a
  relay with no user configured (nothing to leak) still works in plaintext. **Where the password lives**
  is fenced three ways — it is written only into the transient deploy payload and never into the published
  store (whose archive zip is member-readable on the premise that its bytes are already public, true of
  HTML and false of a credential), never onto a Git target (a password in a commit is permanent and
  replicated to every clone), and never inside the build worker (which runs `--network none` with no
  secrets by design). Every failure fails loud as a 409 rather than shipping a form that silently cannot
  send. Because the mode puts a real password on the destination host, it is a separate admin permission
  that `contactPhp` does not inherit.

### Security

- **The STARTTLS upgrade discards anything the server sent before the handshake** (RFC 3207 §6). PHP does
  not do this for us: `fgets()` over-reads past the `220` into a userland buffer that survives
  `stream_socket_enable_crypto()`, so bytes an on-path attacker appends to that line are read back later
  as though they had arrived *inside* the verified session. Measured against the real interpreter, a
  forged capability list plus an `235` acceptance injected into that buffer was enough to make the client
  complete a login dialogue with itself and report a message queued that no server ever received. TLS
  still protected the password — the attacker cannot read the encrypted stream — but silently losing form
  submissions is precisely the failure this mode exists to fix. A compliant server says nothing between
  the `220` and the handshake, so anything already buffered now aborts the send; data that instead arrives
  after the check is consumed as handshake input and fails it, leaving both orderings closed.
- **Nothing is delivered over an unencrypted session to a remote relay**, not only the credentials. Guarding
  the password alone still allowed the other half of a STARTTLS strip: an on-path attacker forges the EHLO
  reply *without* the STARTTLS capability, the upgrade is never attempted, and an unauthenticated relay then
  carried the visitor's submission — whatever the form collects — in the clear, while reporting success. A
  relay on the loopback interface has no on-path attacker by construction and still works in plaintext,
  which is the configuration that carve-out existed for; anywhere else now aborts. The credential rule is
  unchanged and separate: a password never goes out unencrypted, loopback included.
- **The SMTP credentials file is uploaded with an explicit `0600`** over SFTP. It was written `0600` on the
  build host, but a local mode does not travel — the uploaded file landed under the *remote* umask,
  commonly `644` on exactly the shared hosting this feature targets. (FTP has no permission concept at all;
  there the in-file PHP guard and the `.htaccess` deny rule remain the whole defence, so prefer SFTP.)
- **The deploy manifest is denied alongside the credentials.** It records the name, size and content hash of
  every uploaded file, so serving it announced that a site carries `sw-mail.config.php` and let a stranger
  confirm a guessed copy byte for byte. Denying one filename while another describes it is not a boundary.
- **Deploy protocols that may carry a live credential are an allowlist**, not a `git` blocklist. A blocklist
  only stops what it was told about; a transport added later — or a caller that forgets to pass one — would
  have shipped the password. Unknown protocols now fail closed with a 409.

- **Deploy payloads left behind by a killed process are swept at boot.** The credentials file is the only
  artifact in the system that puts a live password on the platform's own disk. Every deploy path already
  removed its payload in a `finally` — but a `finally` does not run through a SIGKILL, an OOM kill, or a
  host crash, which would leave the password in the OS temp dir indefinitely. The sweep is deliberately
  timid, since deleting a payload out from under a running deploy would break a site rather than protect
  one: only our own `sw-deploy-` prefix, only directly inside the temp dir, only entries older than six
  hours, and it never throws. Boot is the safe moment because this process has no deploy in flight yet.

### Tests

- **Every mail delivery path is now exercised end to end.** Four of the five delivery modes had no proof a
  message ever left the process: the two platform modes only ever saw an injected recording transport, and
  `contactPhp`'s host `mail()` had never once executed successfully anywhere — a test box has no MTA, so
  the only assertion available was the 502. The platform mailers now run against the same scripted SMTP
  server the exported `contact.php` is held to (one shared implementation, so the two cannot drift and the
  weaker one cannot quietly become the guarantee), across implicit TLS, STARTTLS and plaintext, covering
  auth mechanisms, certificate rejection, name resolution, and every misconfiguration that must fail fast
  rather than hang: `secure` on a plaintext port and off a TLS one, a refused connection, a name that does
  not resolve, a rejected password, a rejected recipient. `mail()` is executed for real by pointing PHP's
  `sendmail_path` at a capturing script, which also pins that a CRLF in a submitted field cannot inject a
  header. (`thirdParty` stays uncovered, correctly — the browser posts straight to a third party and the
  platform is not in the delivery path.)

### Fixed

- **The SMTP session has a whole-session deadline, not just a per-operation one.** A timeout on each wait
  does not bound their sum: a session is up to ten round trips, so a server answering just under the limit
  every time could hold a visitor's request for minutes — past the 30-60s `max_execution_time` typical of
  shared hosting, at which point the SAPI kills the script and the visitor gets the host's raw error page
  instead of contact.php's own 502. Each read now re-arms the socket with what is *left* of a 25s budget.
  Measured against a server that greets and then answers nothing: gives up in 3.0s on a 3s budget.
- **A display name containing RFC 5322 specials is quoted.** `sw_smtp_header` only encoded *non-ASCII*
  values, so an ordinary company name like `Acme, Inc.` went into `From:` unquoted — and an unquoted comma
  in a display-name is a mailbox separator, making the header parse as two addresses. Pure ASCII is not the
  same as safe.
- **The hCaptcha toggle no longer offers itself for modes it does nothing for.** The embed pass drops the
  widget for every non-platform-routed mode, but the editor only greyed the control out for `contactPhp` and
  `thirdParty`, so a `contactPhpSmtp` form showed a live switch with no effect.
- **The project SMTP panel appears for `contactPhpSmtp`, not only `userSmtp`.** Both modes send with the
  project's own credentials and read the same record, but the panel was gated on `userSmtp` alone — so an
  instance that enabled only the php mode (deliberately a separate permission) let an author choose it with
  nowhere to type a password, and the publish-time 409 pointed at settings that were not on screen.

## [0.9.0] — 2026-08-02

A ten-site clone run by ten neutral MCP agents. The dominant failure class was again the platform
**describing itself incorrectly** — silent, because the agent then builds on a false belief and the error
only surfaces in the finished clone. This release fixes the nine that cost the most, and repairs an E2E
suite that had rotted against four intentional product changes.

### Fixed

- **`clone_audit`'s clipping check compares against the ORIGINAL.** It measured something real — an
  element cut off by an ancestor's overflow is invisible to `getBoundingClientRect` — but could not tell a
  broken layout from a deliberate bleed, and gating on that ambiguity did real damage. To turn it green,
  agents replaced `<img>` elements with background-image divs (measured: 41 alt texts down to 6 on one
  page, 18 down to 4 on another), swapped an accordion's `max-width:0` slide-open for `display:none`, and
  shrank icons the design intentionally bleeds past a tile edge. Four fidelity regressions, no real defect
  among them; the check had been demoted to advisory as damage control. The missing input was always the
  source: a clip the ORIGINAL also makes is the design being ported. Both sides are now probed and the
  overlap subtracted, pairing on tag + clipped axis because a faithful native port has entirely different
  markup and selectors cannot pair across the two renders. It gates again when a source was probed, and
  stays advisory when there wasn't one — "couldn't look at the original" is not "the original clips
  nothing", and must not produce the same verdict.
- **Flat dataset entry values are folded into `values` instead of being silently stripped.** The guide
  called this "THE #1 MISTAKE", which is an admission that the shape is surprising rather than a defence
  of it. The failure was silent in the worst way: unknown keys were dropped, the row saved as `values:{}`,
  the write reported success, and the loop rendered nothing. `EntrySchema` has a closed envelope, so any
  other top-level key can only be a field value.
- **`list_media_folders` unions the folder records with the paths actually in use.** A folder record
  exists only for a folder someone explicitly created, so this returned almost nothing while the library
  was fully organised — measured on a real project: 1 record against 10 folders holding assets.
- **`POST /preview` renders the STORED page when handed only an id.** It used to render exactly the object
  it was given, so `{ id, path, title }` produced an empty page and an agent asking "show me this page"
  got back just the chrome. The lookup is a fallback, so a stub naming a page that doesn't exist is still
  a 400 rather than escaping as a repo 404.
- **`inspect_source` explains stripped `data-sw-*` attributes** instead of leaving the reader to infer
  their markup was wrong.

### Changed

- **`get_guide` is section-addressable.** The import guide is 54,564 characters — it overflowed the
  tool-output cap, spilled to a file and had to be re-read, at least once per agent. The plain call now
  returns a 2,055-character overview plus a section index, with the detail behind
  `section: pages | chrome | fidelity | verify | cleanup` (or `all`). The split is by extraction, never
  classification: a section claims a block only by matching its opening phrase, so a reworded lead falls
  into the always-returned default rather than vanishing.
- **`list_media` omits inline LQIP data URIs unless `?placeholders=1`.** Measured on a real project:
  28,176 of a 76,287-character response (36%) was base64 placeholder, useful only to a UI painting a
  blur-up thumbnail.
- **A `tabs-vertical` snippet recipe**, plus guide notes on the `:is()` specificity trap and on
  lazy-loading not conflicting with screenshot capture.

### Tests

- **The deployed-instance E2E suite is green again — 19 failures to 0.** Every failure was the suite
  asserting behaviour the platform deliberately stopped having, not a product defect: registration became
  invitation-only (and `e2e-deploy.sh` still flipped a setting that no longer exists, swallowing the
  failure); local hosting is opt-in via a `local` deploy target, so publishing then fetching
  `/sites/<slug>/` 404ed on success; the block-tree renderer was removed in #250, so a `Form` block
  rendered as "Unknown"; media URLs are flat since #708-711 and published assets carry a `?v=` token; and
  the invite peek stopped masking the email on purpose in #465. A new `e2e/helpers.ts` seeds users through
  the real invite → register → accept chain rather than a bypass.

## [0.8.0] — 2026-08-01

A third neutral clone run (advancedtechcc.com) surfaced four defects, three of which were the platform
**misdescribing itself**: the feature worked, the response or the documentation did not. All three failed
SILENTLY — no error, no marker — so the agent shipped a wrong page believing it was right. This release
makes each of them tell the truth.

### Fixed

- **`get_publish_status` advertised a URL it knew was dead.** `url` was returned unconditionally, so a
  project with no deploy target reported a `<slug>.<sitesDomain>` address that 404s — sitting right next
  to `localHosting: false`. The editor gates on that flag; MCP hands the object to an agent verbatim, and
  one duly reported a clone as "published at" an address that had never served anything. `status` is now
  the headline — **`"unpublished"` whenever no deploy target exists**, however many releases were built —
  `url` is non-null ONLY for Local Hosting (the one case where this app is the thing serving), and a
  `reason` says what to do about it.
- **Dataset entries rendered ALPHABETICALLY BY ID.** Entries sort by `order ?? +Infinity`, which is right
  for the editor — drag-reorder stamps every row — but meant rows written over the API all tied at
  infinity and fell back to the id tie-break. Badges came out Advisor→Partner→Silver; nine client logos
  ran a–z. New entries are now numbered in **write order**, a full re-PUT that omits `order` keeps its
  position, and appending to a legacy unordered dataset backfills it first so the new row cannot leapfrog
  its siblings. Drag-and-drop in the editor remains the canonical way to reorder, and still wins.
- **`{{#sw-pick-entry}}` silently rendered NOTHING.** The authoring reference documented
  `{{#sw-pick-entry "dataset" id}}`, but the helper only ever accepted the entries ARRAY — a string is not
  an array, so it fell straight to the `{{else}}` branch with no error and no marker, and two team members
  vanished from a page. The reference is corrected AND the helper now also resolves a bare slug against
  the root dataset map (own-property lookup only), so both forms work.
- **`.loading` killed any authored aspect ratio.** `:is(iframe, img, video, embed, object).loading` is
  specificity **(0,1,1)** — `:is()` takes the specificity of its most specific argument — so it outranked
  every `.aspect-*` utility at (0,1,0). Folding `aspect-ratio: auto` into it (there to undo daisyUI's
  square `.loading`) made an authored `aspect-video` impossible to honour, and a 16/9 lazy embed published
  at the 150px bare-iframe default. The reset now lives in its own rule scoped
  `:not([class*="aspect-"])`, so daisyUI is still neutralised while the author's ratio wins. Measured in a
  browser: 1040×150 → **1040×585 (16 / 9)**, and a `.loading` image with no aspect utility still resets to
  auto.

### Added

- **`previewUrl` on `get_page` and `list_pages`.** There was no way for an agent to SEE a page it had just
  written unless the project happened to have a deploy target. Every page now carries a signed draft
  preview URL that needs no login and no publish. It is composed from `pagePath` — the parent-chain route
  the publisher itself uses — not the page's own last-segment `path`, so a child page resolves to
  `/services/audit` rather than `/audit`; and it is omitted entirely on an instance with no preview root,
  since those routes would not exist there.

## [0.7.0] — 2026-07-31

Cloning a second real site (ost-noack.de) with a neutral, uncoached agent surfaced six new friction
items. This release closes them — and, where the fix could be structural rather than documentary, makes
the failure impossible rather than merely described.

### Changed

- **The sticky-header modes are POSITIONAL only** (`none` / `pinned` / `hide-on-scroll`). The `shrink`
  mode is RETIRED: it condensed `#main-nav .navbar`, so it only ever worked for the stock DaisyUI recipe
  and silently did nothing on a hand-authored header while still appearing to be enabled. The platform
  now ships a scroll effect only when it is STRUCTURE-INDEPENDENT — sliding the whole landmark is,
  condensing is not, because it must know which row collapses. Any visual scroll response is authored
  against `html.sw-scrolled`; the effects guide and editor Library carry a copy-paste recipe, and the
  example project demonstrates it in its own CSS.
  A stored `shrink` STILL PARSES and behaves as `pinned` — removing it from the schema enum would make
  `WebsiteSettingsSchema.parse` reject the whole settings object, not just the header.
- **`html.sw-scrolled` and `--sw-header-h` now ship for EVERY site**, in every mode including a static
  header. The hook used to exist only for the two modes the platform styled itself, so the authors who
  most needed it — anyone with a custom header — were the ones who could not reach it. The spacer,
  anchor offset and fixed positioning stay mode-gated (a static header must not gain a phantom offset).
- **The anchor-rest sync is generic**, no longer gated on one mode: it measures the SCROLLED bar and pins
  `scroll-padding-top` to it, so a hand-authored collapse lands in-page anchors correctly too.
- **Verification tools are ordered rather than presented as peers** — `clone_audit` is step 1,
  `visual_audit` is step 2 and the terminator; `compare_to_source` / `fidelity_check` / `compare_regions`
  are marked SPECIALISED with the condition that justifies each. A real agent had used two of the five
  and ignored the others across 23+ documentation mentions.

### Added

- **`data-sw-text` / `-html` / `-href` / `-src` / `-bg` can bind `website.data.<path>`** — the site-wide
  store — and those leaves are click-to-edit in the preview. Chrome slots (mainNav / footer / bottom) are
  not a page and so had NO editable rich leaf at all: the only non-page store was `data-sw-translate`,
  which is plain text. A clone needing one editable block in a global modal had to shred it into six
  translate keys. Scoped deliberately to `website.data`, so a directive can never address
  `identity.colors` or a deploy secret.
- **`clone_audit` fails on visually CLIPPED elements**, naming the clipper and the percentage lost. This
  is the defect class every natural measurement misses: `getBoundingClientRect` returns the layout box
  whether or not an ancestor clips it, so a half-visible logo reports full size — and when the clipper is
  injected by a component runtime it is absent from the authored source too.

### Fixed

- **DaisyUI's `modal` and `tab` components are no longer shipped** in rendered-site CSS. They collided
  with the platform's own `data-sw-component="modal"` / `"tabs"` primitives, and the collision failed
  SILENTLY: the modal runtime moves the author's classes onto the body it builds, so a DaisyUI `.modal`
  landed there and is `visibility:hidden` without `.modal-open` — which the platform never adds. The
  dialog opened full-viewport with every child invisible and no console error. Excluding the components
  makes those class names inert rather than harmful. The exclusion is surgical: `table` survives.
- **The agent guide no longer claims the runtime measures `--sw-header-h`.** It does not — the token is a
  hardcoded constant sized for the stock recipe. That one false sentence produced the same
  content-behind-the-header bug twice; both author surfaces now say it must be overridden for a taller
  custom header.
- **The carousel's injected `[data-sw-part="container"]` and the edge-arrow `::before` hover overlay are
  documented** in the component catalog — both are invisible in the authored source, so restyling the
  element an author would reach for has no effect.

## [0.6.0] — 2026-07-31

Everything in this release came from one exercise: cloning a real site (business.na) end to end and
logging every place the platform fought back. Twenty-one items were recorded; twenty are fixed here and
in 0.5.0, and one was declined on purpose.

### Added

- **`inspect_source`** — measure the LIVE original: real computed styles, rects and settled markup for the
  selectors you name. The only tool that returns NUMBERS for the source, and the only way to read chrome a
  site builds in JavaScript (the stored import has none). `side:"build"` measures your clone the same way.
- **`patch_page`** and `?merge=1` for pages — send only the fields you are changing. A page write was a
  total replace, so relabelling a nav entry silently wiped `source`, `status`, `order`, `parent` and the
  `data.swImport` marker every fidelity tool depends on.
- **`delete_content_bulk({ kind, ids })`** — up to 200 ids in one call, with a per-id result, so clearing
  up after an import is not one request (and one rate-limit slot) per row.
- **Asynchronous website import.** `import_website` now returns a job id immediately and the crawl runs in
  the background; poll the new **`import_status`** tool. A real crawl takes minutes, so the call used to
  time out client-side while the import went on to succeed on the server — leaving no job id, no progress
  and no safe way to retry.
- **`renderMode: "always"`** on import — render every page, not only one that looks client-rendered. A
  server-rendered site that assembles its header or footer in JavaScript was stored pre-JS, so that chrome
  was simply missing from the import with nothing reporting it.
- **`identity.cssTokens`** — free-form CSS custom properties (`--sw-<key>`) for the values the colour,
  spacing and radius records cannot express: a gradient, an elevation ramp, a shared easing curve. Editable
  in Corporate Identity → CSS tokens, with inline validation.
- **`{{sw-stagger @index [step] [max]}}`** — the per-item reveal delay for a loop. The effects guide has
  always recommended staggering a list, and templates have no arithmetic, so the recipe could not actually
  be written. Capped by default, because a long grid whose last card waits seconds reads as a stuck page.
- **`website.cspOrigins`** — allow-list a third-party origin (a captcha, a font host, a map) without
  enabling the consent manager or planting a decoy tag.
- **`?summary=1`** on content lists — metadata only, with the omitted bodies described. A 22-page site's
  page list was 337 KB, past the tool-output ceiling, which made the first call of a clone impossible.

### Changed

- **Writes answer with a receipt** (`{ kind, id, bytes, created, changed }`) instead of echoing the stored
  entity. A settings write returned ~9 KB every time, including a one-field patch. `changed` is a real
  diff, so an empty list tells you the write was a no-op — something the echo never made obvious.
- **Author `criticalCss` now wins a specificity tie** against the platform component sheets, instead of
  silently losing every one.
- **The scroll-reveal trigger** no longer gates on a fraction of the element, so a tall section reveals on
  time; new `data-sw-offset` moves the line.
- **A named system font is honoured.** A slot set to `Verdana`/`Georgia` was silently dropped to the
  default sans — including slots the importer itself writes, so an imported site's body font came out wrong.
- **`clone_audit`** counts editable directives across the template-resolved source and every composed
  snippet, so a template- or snippet-driven page can pass the gate at all.
- **The site CSP is enforced only where the platform is at risk.** It was baked into every exported page,
  where it protects nobody the platform owns and breaks fonts, analytics and maps.
- **Dataset inference is off by default.** Guessing collections from markup shape produced junk more often
  than real datasets; an agent reading the page authors them far better. Still available behind a flag.
- **`nav.order` is retired.** One page-tree `order` governs the pages list and every menu. The editor's two
  number inputs are gone — they wrote a field that `order` always beat, so typing in them did nothing. A
  legacy value is promoted on the next save, so nothing moves.
- **The importer no longer forces a back-to-top control on.** It is enabled only when the source actually
  had one — otherwise a clone gained a control the original never had, invisible to any screenshot.
- **The imported preloader style is read from the loader itself**, not from the whole site, so a spinning
  ring is no longer imported as a progress bar.
- **The foundation import carries the source's `:root` custom properties** into `criticalCss` under their
  original names, so a declaration copied from the original still resolves.

### Fixed

- **An unknown helper is rejected at save**, naming it and its position. Rendering stays lenient, but the
  marker it emits is invisible inside an attribute — where the missing-arithmetic case landed — so nothing
  reported it.
- **The icon reference contradicted the engine**: it described a bare name as a Lucide line glyph when the
  engine resolves a filled Phosphor glyph, so following the reference got the weight wrong every time.
- **A named font slot, `page.data.swImport`, and omitted settings slots** survive the writes that used to
  drop them.

### Security

- **`identity.cssTokens` values pass a deliberately narrow gate.** Function syntax is permitted so a
  gradient can be a token at all, while anything that could leave the declaration (`;{}<>`, backslash,
  control characters, comment markers, unbalanced parentheses) or fetch a resource (`url()`, `src()`,
  `image-set()`, `element()`, `expression()`, `@import`, vendor prefixes included) is refused. Invisible
  format characters are refused too. One shared predicate backs the schema, the renderer and the importer.
- **Import jobs are readable only within their own project.** Job ids are short and sequential, so the id
  alone is never sufficient, and the polled view is built field by field so internals cannot leak.
- **A bulk delete reports only domain errors.** Anything unexpected is logged and reported generically, so
  a driver message cannot ride out through a per-id result.

## [0.5.0] — 2026-07-28

### Added

- **Animated platform background** — an admin can set a WebGL shader background that renders behind the
  whole editor **and** the login screen (served pre-auth from `GET /auth/config`, so the sign-in page is
  skinned too). The picker keeps its Speed / Intensity / interactive / overlay controls, and a new **AUTO**
  colour token makes a background track the active light/dark theme surface instead of pinning one colour.
- **Project favicon in the editor header** — the top-nav brand mark becomes the open project's favicon
  (with a generic-globe fallback), and the project selector drops the slug and is sized like the tabs. The
  selector list gained the favicon, the live URL, sorting, and more width; a clone now prefills its
  production URL.
- **Smooth in-page scrolling by default**, and the agent reference now enumerates all 15 dataset field
  types so an MCP client can pick the right one without guessing.

### Changed

- **Back-to-top moves to the bottom-right corner**, and a modal's auto-close gained the waves ripple.
- The Clone-with-AI modal was removed — clones run through the MCP `import_website` → `clone_site` tools.

### Fixed

- **A concurrent import retry no longer kills the server** — a double-send in an async route raised
  `ERR_HTTP_HEADERS_SENT` and took the process down.
- **Scroll behaviour, platform-wide** — back-to-top was dead in the preview; scrollspy missed its own
  anchor target and let a nav link pointing at a `<dialog>` or hidden element hijack the active state;
  anchors now rest flush under the shrink header.
- **Lazy `data-src` embeds keep their CSP + consent gating**, and the authoring guides now mandate the
  platform lazy attribute for iframes.

### Security

Findings from a full security review of the platform ([#754]).

- **SSRF with data exfiltration via `media/import-url`** (also reachable as the `import_image` MCP tool).
  The route's guard was a string-level check that never resolved DNS, so any hostname with a private A
  record passed — and the response was stored as a retrievable media asset, making it a read of internal
  services rather than a blind request. It now uses the connect-pinned fetcher (resolve once, reject
  private, connect to the pinned IP, re-guard every redirect hop) that the rest of the codebase already
  used. Refusal reasons are deliberately collapsed so the response can't be an internal-DNS oracle.
- **Rich-text values are sanitized before they reach the editor DOM.** A dataset value can be written by a
  lower-privileged actor (an invited client, an API key, the agent loop) and was loaded into the editor
  with the viewing admin's session; the published-site allowlist now runs there too. The editor CSP had
  been the only barrier.
- **The private-address guard now judges IPv6 forms that embed an IPv4** — NAT64, IPv4-compatible and
  6to4 could smuggle a private v4 past it.
- **Login brute-force protection gained a per-account budget** on top of the per-IP one, bounding a
  rotating-IP attack on a single account. Deliberately loose, so it is a backstop rather than a lockout an
  attacker could weaponise; failed sign-ins remain indistinguishable for known and unknown addresses.
- **Dependencies: 11 advisories (2 high) → 2 (0 high)**, with the audit exemption list emptied — all three
  entries were stale or were plain HIGHs that were simply fixable. Fixes are pinned in `pnpm.overrides` so
  the audit keeps telling the truth; the two remaining are documented with why they are unreachable.

## [0.4.0] — 2026-07-25

### Added

- **Background textures** — a new **Textures** card in the System Library opens a picker over ~396
  transparent, tileable overlay textures. Pick a background colour (a CI token or custom) and a texture,
  then copy the CSS (`background-color: var(--sw-color-*); background-image: url(...)`) onto any element,
  a page `<style>`, or the site-wide critical CSS. Because the textures are transparent, the colour shows
  through, so one asset re-tints with the brand + light/dark theme. The URL resolves in the editor
  previews **and** in exported/deployed static sites (the publish build rewrites it to a self-contained
  `_assets/_textures/` copy and materialises only the referenced textures). MCP agents can find textures
  and get the ready-to-paste CSS via a new **search_textures** tool.

## [0.3.0] — 2026-07-24

### Added

- **Copy media URLs + smarter file icons** — the File Manager now has a one-click **Copy URL** on every
  asset and, for images, a panel of copyable delivery URLs (original + responsive sizes); file rows show
  type-aware icons keyed off the real stored file kind (PDF, font, CSS, JS, video, …), independent of the
  display name. A rename doubles as the image's default **alt** text. Long filenames truncate instead of
  overflowing, and the recycle bin gained an **Empty** action.
- **Version in System Settings** — the System Settings modal header now shows the running instance version
  (from `GET /version`), with a subtle "update available" link to the release notes when a newer version
  exists.
- **Dark mode** — the editor now has a full dark theme with a **light / dark / auto** (follow-OS) switcher
  in the account (person-icon) menu. The choice is remembered per browser and applied before first paint,
  so there's no light flash on load. Every editor surface — the shell, header, panels, drawers, modals,
  forms, inputs, menus, the page/settings/dataset editors, the library, and the page-audit report — was
  given a dark treatment; the configurable brand accent colours, the code editor, and the site previews
  are unchanged. Several low-contrast labels and hints were also darkened in **light** mode for legibility.
- **Upgrade-path guard** — the app stamps the data-migration generation it has applied (in SQLite's
  `PRAGMA user_version`) and, on boot, refuses to start if the instance is *older* than the oldest
  one-time data migration this build still ships (i.e. a required migration was removed in a newer
  release and jumping straight here would silently skip it). Instead of half-migrating, it leaves the
  data untouched and serves a clear maintenance page — in the container logs (`[sitewright/upgrade]`)
  **and** in the browser (a 503 page explaining the stepped-upgrade path). No-op today (nothing has
  been removed); it only ever engages once an old migration is pruned in a future release.

### Changed

- **Short media IDs + single-folder `/media` layout** — a newly-uploaded media asset now gets a short
  6-character id and is stored/served FLAT: `/media/<slug>/<id>-<name>` in the URL and
  `<slug>/<id>-<name>` on disk, so all of a project's assets share one folder instead of one folder per
  asset, and IDs are compact. Raw non-image uploads (a `.js`, `.svg`, `.html`, etc.) are still served
  download-only; only genuine imported scripts/stylesheets/SVGs serve inline (the delivery route now
  dispatches on the asset's stored kind, not its file extension). A one-time boot migration converts
  every EXISTING asset to the flat short-id scheme — moving its on-disk binaries, re-keying its record
  (soft-deleted/recycle-bin state preserved), and rewriting every reference across live content **and**
  revision history — so a project's media is single-folder + short-id everywhere with no mixed shapes.
  The migration is idempotent, snapshots the DB before its first rewrite, and runs before the server
  accepts requests; the first boot after upgrading logs its progress under `[sitewright/migrate]`.
- **Flat exported media layout** — a published/deployed site now bundles every media asset into a
  single flat `_assets/` directory (`_assets/<alias>-<name>-<size>.<ext>`) instead of one folder per
  asset (`_assets/<id>/…`). SFTP/FTP deploys create one directory instead of one-per-asset, which
  removes a per-asset `mkdir`/`ensureDir` round-trip and speeds up uploads. The `<alias>` is a short,
  stable prefix derived from the asset id, so incremental deploys stay stable after the first publish.
  **Note:** the first publish/deploy after upgrading re-uploads every media file once (their paths
  change) and prunes the old `_assets/<id>/…` files; subsequent deploys are incremental again.
- **Simpler, more robust SFTP deploys** — the SFTP uploader now always uses the direct per-file path
  (concurrent `fastPut`). The SSH capability probe and the tar-over-SSH fast path were removed: the
  flat `_assets/` layout erased the per-directory savings the tar path existed for, and the probe
  added a round trip and could hang on servers that mis-advertise SSH exec. The connection handshake
  timeout was also raised (15s → 60s) so a slow or distant server isn't dropped before the transfer
  starts.
- **System Library drawer** — the code-first Library reference was consolidated from a long flat list of
  17 entries into 9 icon-led cards across three labelled groups (Reference · Assets · Builders & Studios),
  with one consistent accent colour per group. The Icons, Brand-icon and Flag galleries are now one tabbed
  "Icons & flags" browser; the effect-directive galleries fold into the SiteWright Components reference. The
  animated-background picker no longer scrolls horizontally and its controls were tidied.

### Security

- **Patched HIGH dependency advisories** — bumped or overrode dependencies flagged with HIGH-severity
  path-traversal or denial-of-service advisories: `@fastify/static` → v10 (route-guard bypass via `..`),
  plus `postcss`, `find-my-way`, `brace-expansion`, `shell-quote`, `js-yaml`, and `fast-uri`.

## [0.2.0] — 2026-07-21

An editor UX + authoring-polish pass across the settings, forms, and page-editing surfaces.

### Added

- **Page Audit tab** — the Lighthouse speed + SEO audit moved out of the right-rail side-panel into the
  page editor as a third mode of the Code/Content toggle. It shows the page's SEO head fields, a
  Desktop/Mobile run control, and a PageSpeed-style report: circular category gauges, Core Web Vitals
  metrics with explanatory tooltips, and ranked findings with colour-coded tags + actionable-advice
  tooltips. (Audit findings now also carry Lighthouse's how-to-fix description.)
- **Preview split button** — the Preview button gained a dropdown (like Deploy) with "Preview share
  links", which now open in a dedicated modal.

### Changed

- **Tabbed modals** — the Project Settings modal (General / AI Assistant — per-project AI config moved
  here from Website Settings) and the enlarged System Settings modal (General / Integrations / AI /
  Security / Ops / Agents) are now organized into tabs.
- **Settings menu** — grouped into ADMINISTRATION (admins) and PROJECT sections; **Team → Administrators**
  and **Clients → Project Members** for clarity.
- **Editor polish** — Corporate Identity + Website Settings section headers now read as emphasized
  uppercase bands; Forms rows are fully clickable with the standard gradient-hover + ripple; keyed
  translations in Website Settings are listed alphabetically.
- **Native cart-checkout validation** — the mini-shop order/channel forms use the browser's native
  required/format validation (consistent with the Form component), backed by the server-side check.
- **Example project i18n** — footer/cookie translation keys are grouped by dot-namespacing
  (`footer_studio` → `footer.studio`).

### Removed

- The standalone **Speed & SEO** side-panel (superseded by the Page Audit tab).

## [0.1.0] — 2026-07-20

First tagged release + the production-readiness work.

### Added

- **Release pipeline** — pushing a `vX.Y.Z` tag builds the runtime image and publishes it to GHCR
  (`ghcr.io/sitewright-cms/sitewright:X.Y.Z` + `:latest`), then creates a GitHub Release. The image version
  is baked in and reported at `GET /version`.
- **Liveness + readiness probes** — `GET /health` (process up) and `GET /ready` (DB reachable → 503 on
  failure), plus a Dockerfile `HEALTHCHECK`.
- **Opt-in HSTS** — an admin instance setting (default off) with `includeSubDomains` / `preload` /
  apply-to-served-sites controls.
- **WAL-safe pre-migration DB snapshots** — before applying a pending migration the app snapshots the SQLite
  DB to `<data>/backups/*.pre-migration.bak` so a bad migration can be rolled back; retention is admin-set.
- **Admin ops settings** — server log level (live-applied) and DB backup management (storage sizes + purge).

### Changed

- **Hardened-by-default posture** — `NODE_ENV` defaults to `production` when unset; Secure cookies + the
  `__Host-` prefix + the WebAuthn relying-party are derived from `SW_PUBLIC_URL`.
- **Simplified environment** — one validated config resolver; `SW_DATA_DIR` and `SW_PUBLIC_URL` are the two
  primary knobs (the per-root `MEDIA_ROOT` / `PUBLISH_ROOT` / `PREVIEW_ROOT` / `SOURCE_REF_ROOT` overrides were
  retired).
- **Slow-loris mitigation** — a request-receive timeout on the HTTP server.

[Unreleased]: https://github.com/sitewright-cms/sitewright/compare/v0.15.0...HEAD
[0.15.0]: https://github.com/sitewright-cms/sitewright/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/sitewright-cms/sitewright/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/sitewright-cms/sitewright/compare/v0.12.4...v0.13.0
[0.12.4]: https://github.com/sitewright-cms/sitewright/compare/v0.12.3...v0.12.4
[0.12.3]: https://github.com/sitewright-cms/sitewright/compare/v0.12.2...v0.12.3
[0.12.2]: https://github.com/sitewright-cms/sitewright/compare/v0.12.1...v0.12.2
[0.12.1]: https://github.com/sitewright-cms/sitewright/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/sitewright-cms/sitewright/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/sitewright-cms/sitewright/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/sitewright-cms/sitewright/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/sitewright-cms/sitewright/compare/v0.8.0...v0.9.0
[#754]: https://github.com/sitewright-cms/sitewright/pull/754
[0.8.0]: https://github.com/sitewright-cms/sitewright/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/sitewright-cms/sitewright/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/sitewright-cms/sitewright/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/sitewright-cms/sitewright/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/sitewright-cms/sitewright/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/sitewright-cms/sitewright/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/sitewright-cms/sitewright/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/sitewright-cms/sitewright/releases/tag/v0.1.0
