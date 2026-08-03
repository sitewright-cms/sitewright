# Changelog

All notable changes to Sitewright are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The running version of an instance is reported at `GET /version` (baked into the release image; see
[RELEASING.md](RELEASING.md)). While pre-1.0, minor versions may include breaking changes.

## [Unreleased]

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

[Unreleased]: https://github.com/sitewright-cms/sitewright/compare/v0.12.1...HEAD
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
