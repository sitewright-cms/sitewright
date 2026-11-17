# Running behind a web application firewall (WAF)

Short version:

- **A WAF running the OWASP Core Rule Set (CRS) at its defaults breaks Sitewright.** This applies to
  ModSecurity, Coraza and the many proxies and appliances built on them. Measured, it refuses:
  - every save, delete and settings change;
  - agents writing pages over MCP, and their file uploads;
  - large imports and settings saves, and every upload over 12.5 MB;
  - the statistics beacon;
  - sign-in from the Sitewright CLI and from MCP clients on the user's machine.
- **A WAF in front of Sitewright is not recommended.** The editor and agents send site source code (HTML,
  CSS, JavaScript, `{{ }}` templates) on purpose, in fields of any name. That is exactly what the injection
  rules look for, so no rule set can tell authoring from an attack without being
  [complex and fragile](#why-a-waf-is-not-recommended). On the editor's and agents' API a WAF also adds
  nothing: Sitewright checks the session or access key there before it parses a request body, and checks
  every write itself.
- **If a WAF stays in front of Sitewright, exclude these paths** (the [table](#if-you-keep-a-waf-what-to-exclude),
  or [the ready-made file](waf/sitewright-before.conf) for a CRS-based WAF):
  - the editor's and agents' API, entirely: `/projects`, `/admin`, `/account`, `/invites`, `/mcp`,
    `/media-upload`;
  - one rule each on the statistics beacon, local apps' OAuth sign-in, the password field at sign-in, and
    payment webhooks.

  The WAF then still protects the public surface (site pages, forms, bookings, checkout, sign-in) and
  blocks scanners. On the excluded paths it does nothing, for anyone.
- **With nginx and ModSecurity, route those paths around ModSecurity** rather than excluding them by rule,
  and allow at most 1 MB where ModSecurity stays on (see [Large bodies](#large-bodies-and-memory)).
  ModSecurity holds a whole request body in memory before it decides, even one it then refuses: one
  anonymous 150 MB upload took the WAF from 157 MiB to 493 MiB.
- **Stay at paranoia level 1.** Level 2 refuses ordinary contact messages and webhooks, and signs editors
  out at random.

## What the default rule set blocks

Measured with the official `owasp/modsecurity-crs` nginx image (CRS 4.30.0, libmodsecurity 3.0.17) in front
of Sitewright 0.81.0. The WAF blocked at paranoia level 1 with the default anomaly threshold, and logged
level 2 matches. It ran first in detection-only mode, so every request reached Sitewright and the log showed
what *would* have been refused, and then in blocking mode. Traffic:

- the API end-to-end suite (65 tests);
- the editor end-to-end suite (201 browser tests);
- an agent session over MCP (257 tool calls against the example project: every page read and written back,
  dataset entries, CSS, custom head code, uploads, an import, a deploy);
- public traffic shaped like Sitewright's own page scripts: site pages with campaign query strings, the
  statistics beacon, form posts with real-world messages, bookings, a checkout, Stripe, PayPal and Mollie
  webhooks, the OAuth flows of Claude Code, VS Code and claude.ai, and sign-in.

| Traffic | Requests a default WAF refuses |
|---|---|
| Editor (E2E suite) | 268 of 1,260 writes (21%) |
| API (E2E suite) | 83 of 465 requests; in blocking mode 31 of the 61 runnable tests fail and 20 more cannot run |
| Agent session (MCP) | 34 of 262 requests: 33 of 257 tool calls fail, both file uploads are refused, as is a 90 KB settings save |
| Public traffic | 13 of 64 legitimate requests |

What breaks, and why:

| What breaks | Requests | Rules (level 1) | Cause |
|---|---|---|---|
| Every save, delete and settings change, from the editor and the API | `PUT` / `PATCH` / `DELETE` on `/projects/…`, `/admin/…`, `/account/…`, `/global/…`, `/media-upload/…` (64 routes) | 911100 | The default method policy allows only `GET HEAD POST OPTIONS`. |
| Writing pages, templates, snippets, CSS and custom code; previews of unsaved changes; agent tool calls | `PUT /projects/…/content/…`, `POST /projects/…/preview`, `POST /projects/…/import`, `POST /mcp` | 941100, 941110, 941130, 941160, 941180, 942140, 942151, 942550, 932130, 932230, 932235, 932250, 933135, 934100, 934200 and more | Authored HTML and templates match injection patterns: `<img src=…>`, `<script>`, `{{#each (helper …)}}`, `id="{{page.slug}}"`, `${TXN:reference}` in a payment gateway definition. |
| Large writes: a project import, a multilingual site's settings (about 90 KB, 1,070 values) | `POST /projects/…/import`, `PUT /projects/…/content/settings/settings` | 200002, 200007 | The engine refuses a body without files over 128 KB, or one with more than 1,000 values. |
| Agents' file uploads | `PUT /media-upload/<ticket>` | 911100, 920340, 920420, 920450, 920640 | Raw file bytes, sent as `application/octet-stream`, as an image type, or with no type at all (`curl -T`). Over 1 MB, curl also sends `Expect: 100-continue`, a header the default policy refuses. |
| Every upload over 12.5 MB, from the editor or an agent | see [Large bodies](#large-bodies-and-memory) | (engine limit) | ModSecurity's total body limit. Uploads go up to 200 MB. |
| Statistics | `POST /a/<project>` | 920420 | The beacon is `text/plain`, which the default content-type list omits. |
| Sign-in from the Sitewright CLI and desktop MCP clients | `/oauth/register`, `/oauth/authorize`, `/oauth/token` | 931100, 934110 | Their redirect URI is a loopback address (`http://127.0.0.1:8976/callback`, `http://localhost:53127/callback`). |
| Sign-in for some users | `POST /auth/login` | 941100, 941110, 941160, 932235 | A generated password containing `<script`, or a command in backticks. |
| Webhooks of a payment gateway whose events have a `session_id` field | `POST /pay/…/webhook/…` | 943120 | The session-fixation rule fires on that field name when no `Referer` is sent, and a server-to-server call never sends one. |
| A visitor's message that quotes code | `POST /f/…` | 941100, 941110, 941160, 930120 | An HTML tag or a path like `/etc/os-release` in the message. |

These were **not** affected:

- site pages and their assets, including `utm_*`, `gclid` and `fbclid` query strings;
- `robots.txt` and `sitemap.xml`;
- bookings and the checkout;
- Stripe, PayPal and Mollie webhooks (at level 1);
- the live event streams the editor listens on: through the WAF they arrived in the same millisecond as
  directly;
- responses, since no outbound rule fired on any page Sitewright served.

## Why a WAF is not recommended

**Tuning individual rules does not work.** Writing code is what the authoring API is for. A page's `source`,
a snippet, custom head code, critical CSS and a payment-gateway definition all carry markup, scripts or
template expressions. So do dataset fields and page-data keys, whose **names the author chooses**, so no
list of fields to exempt can be complete. An agent's write arrives wrapped in a JSON-RPC envelope, and a
whole page is sent at once. Which rules fire on `/mcp` changes with every page's content.

**Telling authors from attackers at the WAF is too fragile.** What the WAF cannot know is whether the sender
may write code; Sitewright decides that. A WAF that can condition a rule on a header or a cookie could
exempt only requests carrying a credential in Sitewright's format. That configuration was built and
measured (it shipped with 0.82.0), and it works, but:

- it depends on the exact shape of Sitewright's credentials (the bearer prefixes, the session cookie's name
  and signature length), so a change to either silently breaks the editor behind the WAF;
- it depends on one engine's internals: on ModSecurity v3, skipping the body inspection also skips the
  rule that blocks, so blocking has to be moved earlier, which then needs exceptions of its own;
- it still needs five further exceptions on public paths;
- and it checks only the credential's *format*: a well-formed fake passes it anyway.

**What protects the editor's and agents' API instead** is Sitewright itself:

- a write there needs a valid session or access key, and Sitewright checks it first: without one, the
  request is refused (401) before its body is buffered or parsed;
- agents' upload links are single-use tickets, checked the same way before the upload is stored;
- every write is validated against its schema, and templates against a safety check (an inline `onclick`
  in a template is refused, for instance);
- database queries are parameterized;
- published pages run under a content security policy, isolated from the editor's origin;
- rate limits apply per user, per access key and per address.

## If you keep a WAF: what to exclude

| Path | Methods | Exclude | Why |
|---|---|---|---|
| `/projects/…`, `/admin/…`, `/account/…`, `/invites/…`, `/mcp`, `/media-upload/…` | all | Everything: the WAF does not inspect these paths. With nginx, route them around ModSecurity (see [Large bodies](#large-bodies-and-memory)). | Site source code, `PUT`/`PATCH`/`DELETE`, bodies up to 4 MB (60 MB for a message to the on-page agent) and uploads up to 200 MB. Every write needs a credential, checked before the body. |
| `/a/<project>` | `POST` | The content-type check (920420) | The statistics beacon is `text/plain`. |
| `/oauth/authorize`, `/oauth/token`, `/oauth/register` | `GET POST` | 931100, 931130 and 934110 for the `redirect_uri` parameter (`redirect_uris` on `/oauth/register`), or for the path if the WAF cannot exclude a parameter | Local apps sign in with a loopback redirect URI. |
| `/auth/login`, `/auth/register` | `POST` | Every rule for the `password` field, or for the path if the WAF cannot exclude a field | A generated password is a random string of symbols. |
| `/pay/<project>/webhook/<gateway>` | `POST` | 943120 | A provider's event can carry a `session_id` field. |
| Optional: `/f/<project>/<form>` | `POST` | The XSS, file-access and command-injection groups | Only for sites whose visitors write code in contact messages. |

How to apply it depends on the WAF:

- **nginx with ModSecurity** (including the `owasp/modsecurity-crs` images): route the first row around
  ModSecurity with its own `location` (see [Large bodies](#large-bodies-and-memory)), and load
  [`waf/sitewright-before.conf`](waf/sitewright-before.conf) for the other rows.
- **Another WAF that takes CRS rules** (ModSecurity elsewhere, Coraza, products built on them): load
  [`waf/sitewright-before.conf`](waf/sitewright-before.conf), which does all of the table. It is a CRS 4 plugin
  "before" file with rule ids 10100–10199. In the `owasp/modsecurity-crs` images it goes in
  `/opt/owasp-crs/plugins/`; elsewhere, `Include` it after `crs-setup.conf` and before the CRS
  `rules/*.conf`. Coraza supports the same directives, but the file was only tested with ModSecurity v3.
- **A WAF with only an "exclude this rule on this path" control:** enter the table. Where it cannot switch
  inspection off for a path, exclude every rule the log shows there.

To say it plainly: **this exempts the editor's and agents' API from the WAF.** The WAF still protects the
public surface (site pages, forms, bookings, checkout, sign-in), which is where anonymous attackers are, and
it still blocks scanners. On the excluded paths it no longer blocks anything, for anyone. If your WAF cannot
be configured even this far, do not put the platform behind it: route the platform's own host around the
WAF and keep it in front of the sites' hosts (`*.<SW_SITES_DOMAIN>` and custom domains), which carry only
public traffic. The exceptions for the public paths above still apply there.

Measured in blocking mode, Sitewright 0.82.0 behind CRS 4.30 (libmodsecurity 3.0.17), with the file loaded,
and then with the `location` below added as well:

| Traffic | File only | File and `location` |
|---|---|---|
| API E2E suite | 60 of 61 pass. The one failure expects `/.htaccess` to answer 404; the WAF answers 403. | The same |
| Editor E2E suite | 201 of 201 pass | Not re-run: the `location` only takes inspection off the editor's paths |
| Agent session (MCP) | 257 of 257 tool calls succeed, including uploads and the 90 KB settings save | The same |
| Uploads | Up to 12.5 MB pass; larger ones are refused by the WAF | A 150 MB upload passes |
| Public traffic | The WAF refuses only the contact message that quotes `<script>` and `/etc/os-release` (see the optional rule) | The same |
| Attack probes | Refused: `/.env`, `/.git/config`, prototype pollution and Log4Shell on `/`, XSS and path traversal on site pages and media, SQL injection and XSS in forms, checkout, sign-in and OAuth registration. On the excluded paths Sitewright answers itself: 401 for a script write to a page or an MCP tool call without a valid credential, 404 for an unknown upload link. | The same |

## Large bodies and memory

Uploads go up to 200 MB: media from the editor, agents' upload links, and a website-import archive (up to
50 MB). A project restore (`POST /projects/import/zip`) can be larger. A message to the on-page agent with
attachments can reach 60 MB. ModSecurity's total body limit (`SecRequestBodyLimit`, 12.5 MB by default)
refuses anything bigger, also on the paths the exclusion file leaves alone. The file keeps the engine on so
that it does.

The limit does not protect the WAF's memory, though. ModSecurity's nginx connector holds the whole body in
memory before it decides, so a body it refuses still costs what it weighs. The `owasp/modsecurity-crs` nginx
image sets no `client_max_body_size` at all.

| Request | WAF memory |
|---|---|
| Anonymous 150 MB upload, default limit (refused by the WAF) | 157 MiB → 493 MiB |
| Anonymous 150 MB upload, limit raised to 210 MB (refused by the WAF) | 57 MiB → 1.18 GiB |
| Anonymous 150 MB upload to a path excluded with `ctl:ruleEngine=Off` (the WAF lets it through) | 170 MiB → 506 MiB |
| Anonymous 150 MB upload to an excluded path, through the `location` below (Sitewright answers 401) | 72 MiB → 75 MiB |
| Anonymous 150 MB post to a public form, through the `location` below (nginx answers 413) | 72 MiB → 75 MiB |
| Signed-in 150 MB upload, through the `location` below | 72 MiB → 83 MiB |

So with nginx, give the excluded paths their own `location` without ModSecurity, and allow at most 1 MB
where ModSecurity stays on. No public request to Sitewright is larger: a form submission is at most 96 KB, a
payment webhook 256 KB.

```nginx
# Before the general `location /`. Quote the pattern: nginx reads `{` and `;` in an unquoted one as syntax.
location ~ "^/(?:projects|admin|account|invites|mcp|media-upload)(?:/|$)" {
    modsecurity off;
    client_max_body_size 210m;   # uploads; a larger project restore needs more
    proxy_request_buffering off;
    proxy_pass http://127.0.0.1:8080;
    # … the same proxy settings as the main location (headers, timeouts) …
}

location / {
    client_max_body_size 1m;     # ModSecurity reads the whole body; nothing public is larger
    # … ModSecurity and the proxy settings, as before …
}
```

Each excluded route checks the session, access key or upload link before it parses the body. The
`ctl:ruleEngine=Off` row is why the exclusion file does not switch the engine off for those paths. With the
engine off, ModSecurity stops enforcing its body limit, but the connector still reads the whole body.

## Settings besides the rules

- **Paranoia level: stay at 1.** At level 2 the measured traffic also tripped:
  - nearly every page write;
  - contact messages containing quotes, `--` or a link;
  - a webhook carrying a return URL or an address like `Apt 2; rear`;
  - the OAuth `resource` parameter;
  - the editor's own session cookie: its signature is random base64url, and when it happens to contain
    `--`, rule 942440 matches, so a level-2 WAF signs random editors out.
- **Body size.** A content write can be up to 4 MB, and the uploads above up to 200 MB. The proxy must allow
  that on the excluded paths (`client_max_body_size` in nginx, see
  [Deployment](deployment.md#reverse-proxy-tls)), and at most 1 MB where ModSecurity inspects (see
  [Large bodies](#large-bodies-and-memory)).
- **Long-lived responses.** The editor's live updates and deploy progress are server-sent event streams
  that stay open. Give the proxy a long read timeout and do not buffer `text/event-stream` (the CRS nginx
  image does both by default).
- **The real client IP.** Set `TRUST_PROXY` on Sitewright so rate limits and the sign-in throttle see the
  visitor rather than the WAF (see [Deployment](deployment.md#quick-start-docker-run)).
- **Audit logs hold secrets.** A logged transaction includes request headers (bearer keys, session cookies)
  and the matched data, which at sign-in can be a password. Restrict who can read the WAF's audit log.

## Reading your WAF's log

| You see | It is |
|---|---|
| 911100 on a `PUT`, `PATCH` or `DELETE` to `/projects/…`, `/admin/…`, `/account/…` | The editor or an agent saving. Exclude the path. |
| 941xxx, 942xxx, 932xxx, 933xxx, 934xxx on `/projects/…` or `/mcp` | Authored code being saved. Exclude the path. |
| 200002 or 200007 | A large save or import. Exclude the path. |
| 920420 on `/a/<id>` | Visitors' pageviews. The beacon exception. |
| 911100, 920340, 920420, 920450 or 920640 on `/media-upload/…` | An agent uploading a file. Exclude the path. |
| A request over 12.5 MB refused | An upload. See [Large bodies](#large-bodies-and-memory). |
| 931100 or 934110 on `/oauth/…` | A local app signing in. The OAuth exception. |
| Any rule on `json.password` at `/auth/login` | A user's password. The password exception. |
| 943120 on `/pay/…/webhook/…` | A payment provider's event. The webhook exception. |
| 930130 on `/.env`, `/.git/config`; mixed 93x/94x payloads on `/` | Scanners. Leave them blocked. |

## Reproducing the measurements

`scripts/waf/run.sh` starts a Sitewright image behind the CRS image on a Docker host, drives the traffic
above through it and summarises the WAF's log per route. Run it in detection mode to see what a
configuration would refuse, or in blocking mode with `--exclusions` to check the exclusion file. See
[`scripts/README.md`](../scripts/README.md#wafrunsh--what-a-waf-blocks). Run it again when routes change.
