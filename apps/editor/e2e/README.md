# The browser E2E suite

Playwright, driving the real editor SPA against a real deployed container. It is out of `pnpm verify`
and out of CI **on purpose** — the specs are serial and target the shared DinD host, so running them in
the PR pipeline would race across concurrent branches (see `.github/workflows/ci.yml`). The cost of that
is real: nothing noticed when the suite stopped working at all, and it stayed broken long enough for the
UI to move underneath it.

**Run it before cutting a release.** From a clean tree:

```bash
eval "$(scripts/e2e-deploy.sh up)"                    # claims an isolated slot, exports E2E_BASE_URL
pnpm -F @sitewright/api    exec playwright test       # API-only, no browser
pnpm -F @sitewright/editor exec playwright test       # the browser suite, ~10 min
scripts/e2e-deploy.sh down --port "$SW_E2E_PORT"      # always clean up
```

★ **`up` BAKES THE EDITOR SPA INTO THE IMAGE.** The slot serves the bundle built at `up` time, so a
source change made afterwards is not in the browser no matter how many times you re-run Playwright — the
spec fails against the OLD build and reads as "the fix didn't work". After touching `apps/editor` or
`apps/api`, tear the slot down and bring it back up.

Both suites are **re-runnable against the same slot** — that is a property worth keeping. A spec that
writes instance-global state must put it back (see *Instance-global state* below), or the second run
fails on the first run's leftovers and the gate becomes single-shot.

## Reading a failure

Playwright writes `test-results/<spec>/error-context.md` per failure, containing the error **and an
ARIA snapshot of the page at that moment**. That snapshot is the fastest way to find what a control is
called now — faster than grepping the source, and it shows the state the spec actually reached.

## Things about this UI that are not guessable

Each of these cost a debugging round. They are the reason the suite is worth keeping in a readable
state rather than rewriting from scratch.

### Auth and seeding

- **Registration is invitation-only, unconditionally.** There is no `allowSelfRegistration` setting;
  the login screen has no register affordance. Seeding goes through the real operator flow — admin
  invites → invitee registers → accepts — which is what `signUp()` in `helpers.ts` does over
  `page.request` (it shares the browser context's cookie jar, so the page ends up genuinely signed in
  with no bypass).
- **ONE admin session per worker.** Every seed needs an admin to issue the invite and a full run seeds
  ~50 users; `/auth/login` allows 20 per window. The suite used to trip its own 429 and report it as
  "the seeded platform admin must be able to log in" — which reads like a broken slot. `helpers.ts`
  caches the admin context.
- **Creating a project is staff-only** (`requirePlatformStaff`: `admin` | `developer`). An invited
  client has no platform role at all — it is a per-project `member`.
- **The invite landing opens the login form already in set-password mode**, email locked to the invited
  address; there is no register toggle and no "accept" button — accepting is automatic once
  authenticated. It only shows a "choose how to continue" screen first when an OIDC provider exists.

### Publish and deploy

- **The wizard's modal stays OPEN after "Save target"** (it returns to the target list — you may be
  adding several). `PublishDeployModal` bumps the bar's refresh signal *on close*, so until you dismiss
  it the bar still reads plain `Deploy`, i.e. "no target". By design, not a bug — the target is already
  persisted server-side at that point.
- **Pick the type card by ROLE, not text.** `getByText('Local Hosting')` also matches the "already
  configured" note and the saved-target row; clicking those closes the wizard.
- **`Save target` when creating, `Save changes` when editing** — the same form, two labels.
- **A `local` target has NO per-row Deploy button**: local hosting is served by publishing, not by the
  deploy transport. Deploy a REMOTE target from its own row.
- **A published site is not served without a LOCAL deploy target.** `POST /publish` alone is not
  enough — the local target carries the serve options.
- **Local hosting serves at `<slug>.<SW_SITES_DOMAIN>`**, and `/sites/<slug>/` 301s there. The DinD host
  has no wildcard DNS. To READ the site use `fetchLiveSite()` / `liveSiteRequest()` (explicit `Host`
  header); to NAVIGATE to it, `playwright.config.ts` passes
  `--host-resolver-rules=MAP *.<SITES_DOMAIN> <SITES_DOMAIN>` (the port survives the redirect).
- The SPA keeps project selection in STATE, so `page.reload()` drops back to the project list, and a
  target created over the API is invisible to an already-mounted `PublishBar`. Drive the wizard.

### Editor surfaces

- **`Save changes` → `Save` on the SETTINGS surface** (inline `✓ Saved` → a `Settings saved` toast).
  `Save changes` still exists in the code-editor and target-config MODALS — discriminate by locator
  SCOPE.
- **Page settings hides Template / Raw-HTML behind a collapsed "Advanced" disclosure**, which opens by
  itself only when the page already uses one of them.
- **`Page template` is a searchable combobox, not a `<select>`** — `selectOption` fails on it. Click the
  `combobox` role, then the `option` by NAME (`Text page (global)`, `Blog article (global)`).
- **Nav is a set of named MENU SLOTS** (`Nav: Main navigation` / `Footer` / `Mobile menu` / `Custom`); a
  new page joins Main navigation by default. The old single `header` flag and the numeric `Nav order`
  field are gone — ordering is drag/keyboard reorder in the pages list.
- **A pages-list row is labelled by its MENU label**, falling back to the page title.
- **The File Manager has no duplicate-file action** — the row actions are Copy URL, Download, Rename,
  Delete. (`api.copyMedia` still exists for agents/MCP; it has no UI caller.)
- **Side panels are DRAWERS with a backdrop**, and the backdrop covers the preview. A panel that sends
  you into the preview must dismiss itself — the Regions rail does, via `SidePanelClose`.
- **The entry editor stays OPEN after Save** (it resets its baseline in place). Dismiss it with `Escape`
  before clicking anything on the list behind it — asserting the dialog is hidden will just time out.
- **An entry row is named by the dataset's first `text` field** (`entryLabel`), falling back to the
  entry's generated id. A dataset made only of `richtext`/asset fields therefore has rows a spec cannot
  name — add a `text` field to the fixture if you need to reopen a row.
- **A dragged column width clamps to a 32px floor** (`RICH_TABLE_MIN_COL`). A table whose cells hold one
  character starts NARROWER than that, so "drag it thinner" is unreachable and the assertion silently
  measures the clamp. Give fixture tables real column text, or drag to widen.
- **The Library's brand/flag grids page in on scroll**, so a specific logo has to be SEARCHED for.
  Each tab owns its own search box, labelled `Search <tab label>`.
- **The Account modal's header tabs include a button named "Account"**, so the header's account button
  is ambiguous while the modal is open — wait for the modal to be gone, not merely for the button to be
  clickable.
- **The login screen has several "Sign in …" buttons** (password, passkey, each OIDC provider, plus the
  register toggle) — `{ name: 'Sign in', exact: true }`.
- **The preview's rich-text toolbar is SVG icons + `data-tbid`**, and it COLLAPSES trailing groups into
  a "More formatting" overflow when narrow — whether a command is directly present depends on the
  viewport. See `tbClick` in `inplace-wysiwyg.spec.ts`.
- **The field-name badge is a body-level `position:fixed` HUD** (`.sw-ov`), not a host `::before`. It
  hides on a 180ms SCHEDULE and hides the ROW rather than removing nodes — assert VISIBILITY, not count.
- **The lightbox builds ONE overlay PER GALLERY** — a bare `.sw-lightbox` matches them all.

### Environment

- **WebAuthn needs a SECURE CONTEXT.** Over the slot's plain `http://<host>:<port>` the browser does not
  define `window.PublicKeyCredential`, so the editor correctly reports "this browser doesn't support
  passkeys" and disables the button. `--unsafely-treat-insecure-origin-as-secure` does NOT help — the
  bundled `chromium-headless-shell` ignores it. `passkeys.spec.ts` instead reaches the same slot through
  a loopback TCP forwarder so the origin is `localhost`, which is trustworthy by definition. It must be
  a real forwarder, not `--host-resolver-rules`: that maps DNS for the browser only, while
  `page.request` is issued from Node.
- **Instance-global state must be restored.** Agent instructions, OIDC providers, form modes, stock keys
  and hCaptcha are per-INSTANCE. A spec that writes one and leaves it changes screens other specs drive
  (a configured OIDC provider adds a button to the login form and switches the invite landing to its
  choice screen), making the suite order-dependent and single-shot. `oidc.spec.ts` and
  `mcp-admin.spec.ts` both clear to a known state up front AND put it back at the end.

## ★ The recurring failure shape

**A spec pinned an exact string that some legitimate transform later rewrote.** Nine instances so far:

| pinned | rewritten by |
|---|---|
| exact CSP sandbox token list | a deliberately widened sandbox |
| `<script defer src="../_assets/_sw/lazyload.js">` | cache-busting `?v=<hash>` on published assets |
| `h1,…,.sw-h1,…{…}` selector order | the CSS minifier SORTS selector lists |
| a trailing `;` in a declaration block | the minifier drops it |
| `/sites/<slug>/` | subdomain serving |
| `_assets/<uuid>/<name>` | the flat `_assets/<id>-<name>` scheme |
| `/media/<slug>/<id>/<name>` | the same flattening in the media library |
| the ripple on `[data-sw-part="toggle"]` | it moved to the inner `.sw-cart-tab` |
| `1 submission` | a sibling warning line, `1 submission was not emailed` |

Assert the property you actually care about, not the byte sequence that happened to express it. The
minifier one is the sharpest argument for keeping an E2E layer at all: it PASSED the unit test, which
reads the unminified string, and failed only against the real published artifact.
