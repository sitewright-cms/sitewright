# E2E drift backlog

The browser suite is out of `pnpm verify` and out of CI on purpose — the specs are serial and target the
shared DinD host, so running them in the PR pipeline would race across concurrent branches (see
`.github/workflows/ci.yml`). The cost of that is real: nothing noticed when the suite stopped working at
all, and it stayed broken long enough for the UI to move underneath it.

**Run it before cutting a release.** From a clean tree:

```bash
eval "$(scripts/e2e-deploy.sh up)"                    # claims an isolated slot, exports E2E_BASE_URL
pnpm -F @sitewright/api    exec playwright test       # API-only, no browser
pnpm -F @sitewright/editor exec playwright test       # the browser suite
scripts/e2e-deploy.sh down --port "$SW_E2E_PORT"      # always clean up
```

## Status

| suite | result |
|---|---|
| `@sitewright/api` | **20 passed, 2 skipped** — and re-runnable against the same slot |
| `@sitewright/editor` | **54 passed, 37 failed, 13 did not run** (was 0 passing: every spec died at sign-up) |

Authentication was the single blocker and is fixed — see `helpers.ts`. What remains is genuine UI drift:
the specs now get far enough to discover that controls have been renamed, moved, or replaced by a
different interaction model. Each entry below needs checking against the current UI; none of them is
known to be a product defect, but that is exactly what working through them will establish.

## Known clusters

- ~~**`Publish` → target-driven deploy**~~ — **DONE.** `deployLocally()` / `fetchLiveSite()` /
  `liveSiteRequest()` in `helpers.ts` encode the current flow. Five things about it are not guessable:
  1. **The wizard's modal stays OPEN after "Save target"** (it returns to the target list — you may be
     adding several). `PublishDeployModal` bumps the bar's refresh signal *on close*, so until you
     dismiss it the bar still reads plain `Deploy`, i.e. "no target". By design, not a bug — the target
     is already persisted server-side at that point.
  2. **Pick the type card by ROLE, not text.** `getByText('Local Hosting')` also matches the
     "already configured" note and the saved-target row; clicking those closes the wizard.
  3. **Local hosting serves on `<slug>.<SW_SITES_DOMAIN>`**, and `/sites/<slug>/` 301s there. The E2E
     slot sets that domain (an API spec covers subdomain serving) but the DinD host has no wildcard
     DNS, so neither a browser navigation nor a redirect-following request can reach the name. Use
     `fetchLiveSite()` / `liveSiteRequest()`, which send an explicit `Host` header.
  4. **`Save target` when creating, `Save changes` when editing** — the same form, two labels.
  5. **A `local` target has NO per-row Deploy button**: local hosting is served by publishing, not by
     the deploy transport. Deploy a REMOTE target from its own row in the wizard, or via the header's
     target picker — the header's split button defaults to the local target.

  The token gate also moved: the old "Publish & deploy options" tab is gone, and "Require a secret link
  (unlisted)" now lives in the LOCAL target's config form, which reveals the link inline.

  Also: the SPA keeps project selection in STATE, so `page.reload()` drops back to the project list; a
  target created over the API is invisible to an already-mounted `PublishBar`. Drive the wizard.
- **`Save changes` → `Save` on the SETTINGS surface** (and its inline `✓ Saved` is now a
  `Settings saved` toast). `Save changes` still exists in the code-editor and target-config MODALS, so
  discriminate by locator SCOPE: `editor.`/`dialog.`-scoped sites are genuine, `page.`-level ones were
  the settings surface.
- **Published assets carry a cache-busting `?v=<hash>`.** Assertions that pin an exact
  `<script defer src="../lazyload.js"></script>` no longer match. Match the src and allow the query.
- **The published CSS is MINIFIED, and the minifier SORTS selector lists.** A rule authored as
  `h1,…,h6,.sw-h1,…,.sw-h6{…}` is emitted as `.sw-h1,…,.sw-h6,h1,…,h6{…}`. Assert the selector's
  MEMBERS, not its literal text — the source-order version passes the unit test (which reads the
  unminified string) and fails only here, against the real published artifact.

★ The recurring shape in all three of the above, and in the API suite's CSP assertion: **a spec pinned
an exact string that some legitimate transform later rewrote** — a widened sandbox, a cache-busting
query, a minifier's selector order. Assert the property you actually care about, not the byte sequence
that happened to express it.
- **The preview iframe's on-page toolbar** (~4 specs, `.sw-tb button` inside `iframe[title="Preview"]`).
- **`Account` dialog** (~2 specs): `Access keys` / `API key name` have moved or been renamed.
- The long tail: `+ Add nav placeholder`, `Page template`, `Nav: header`, `Copy brand-mark.png`,
  `Template reference` search, `1 submission`, `/posts-copy`, `Services (Copy)`, `Discard`, `Save`.

## Full failing list

Regenerate with the commands above. As of the last run:

- `api-keys.spec.ts:8:1 › create, view, and revoke a project API key from the editor`
- `assets-operations.spec.ts:13:1 › assets: image preview modal, rename, copy, delete via modal dialogs`
- `blog-template.spec.ts:8:1 › global:blog-article: enabling the template seeds page.data defaults and renders them`
- `client-source-edit.spec.ts:12:1 › client edits a code page’s bound region (content), template stays immutable`
- `code-page-settings.spec.ts:10:1 › code page settings: stacked modal sets draft + nav, persisted across reopen`
- `components.spec.ts:164:1 › defaults: fade effect with overlay arrows mid-left/right and bottom-center dots`
- `datasets.spec.ts:105:1 › entry editor modal: status toggle + duplicate`
- `datasets.spec.ts:148:1 › duplicate a dataset, then edit an existing entry key`
- `datasets.spec.ts:187:1 › rename a dataset slug migrates its entries; bindings use the new slug`
- `forms-ui.spec.ts:9:1 › author a form in the editor and see a submission in its submissions list`
- `gallery.spec.ts:13:1 › sw-folder gallery: folder images render in the preview`
- `global-snippets.spec.ts:46:1 › an instance admin can create + delete a global snippet from the Snippets rail`
- `inplace-wysiwyg.spec.ts:45:1 › data-sw-html: in-place rich editing (contenteditable + toolbar) persists`
- `inplace-wysiwyg.spec.ts:70:1 › rich-text toolbar: superscript wraps the selection in <sup>`
- `inplace-wysiwyg.spec.ts:85:1 › rich-text </>: HTML source editor round-trips and is sanitized on render`
- `inplace-wysiwyg.spec.ts:118:1 › rich-text </>: discarding dirty HTML source confirms first`
- `inplace-wysiwyg.spec.ts:185:1 › field-name badge: hovering an editable region reveals a ::before label naming its key`
- `libraries.spec.ts:8:1 › library panel: open, search, and copy an example; lazyload + ripple publish`
- `mcp-admin.spec.ts:8:1 › admin: edit agent (MCP) instructions, see the endpoint list + connect guide, and persist`
- `mfa.spec.ts:9:1 › enrol in TOTP, then sign in through the second-factor step`
- `nav-placeholder.spec.ts:9:1 › create nav placeholders (external + dropdown) and round-trip their settings`
- `oauth-consent.spec.ts:12:1 › OAuth consent → code → token, then the access token works`
- `oauth-dcr.spec.ts:10:1 › dynamically-registered client completes the OAuth flow`
- `oidc.spec.ts:10:1 › admin configures an OIDC provider; the login screen offers it`
- `pages-list.spec.ts:10:1 › pages list: auto-home, row actions, list settings, template lock + fork`
- `passkeys.spec.ts:8:1 › register a passkey and sign in with it`
- `regions-panel.spec.ts:7:1 › Regions panel: lists editable regions and reaches a hidden control`
- `settings.spec.ts:14:1 › edit Corporate Identity + Website settings, save, and persist across reload`
- `settings.spec.ts:275:1 › Corporate Identity: Save/Discard gate on unsaved changes and Discard reverts`
- `shop.spec.ts:9:1 › published cart: add-to-cart opens the drawer and builds the WhatsApp order link`
- `shop.spec.ts:110:1 › published cart: the form channel submits the order to the /f submissions inbox`
- `shop.spec.ts:176:1 › published cart: editable note + backdrop/Esc/close-only dismissal + ripple class`
- `template-reference.spec.ts:8:1 › library: template reference — open, search, filter by group`
- `typography.spec.ts:60:1 › google fonts: pick a heading webfont, self-host on select, publish loads it locally`
- `typography.spec.ts:116:1 › custom named font slot: add "boombox", persist, and publish emits its --sw-font-boombox var`
- `typography.spec.ts:146:1 › local font upload: upload a .ttf for the body, self-host on save, publish loads it locally`
- `user-menu.spec.ts:8:1 › user menu: mint an access key, change password, and re-login`
