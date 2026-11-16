# Running behind a web application firewall (WAF)

Short version:

- **A WAF running the OWASP Core Rule Set (CRS) at its defaults breaks Sitewright.** This applies to
  ModSecurity, Coraza and the many proxies and appliances built on them. Measured, it refuses:
  - every save, delete and settings change;
  - agents writing pages over MCP, and their file uploads;
  - large imports and settings saves, and every upload over 12.5 MB;
  - the statistics beacon;
  - sign-in from the Sitewright CLI and from MCP clients on the user's machine.
- **Tuning individual rules does not fix it.** The editor and agents send site source code (HTML, CSS,
  JavaScript, `{{ }}` templates) on purpose, in fields of any name. That is exactly what the injection
  rules look for.
- **Recommended: keep the WAF and load [Sitewright's exclusion file](waf/sitewright-before.conf).**
  - **What it exempts:** writes to the authoring API that carry a credential in Sitewright's exact
    format, plus five narrow spots (the statistics beacon, agents' upload links, local apps' OAuth sign-in,
    passwords, payment webhooks).
  - **What stays inspected:** every request without such a credential (site pages, forms, bookings,
    checkout, webhooks, sign-in, OAuth, scanners) and every read.
  - **What it costs:** the WAF checks the credential's *format*, not whether it is valid. A stranger who
    sends a well-formed fake gets past the body inspection, as far as Sitewright's own sign-in check. Such
    a request is still refused for scanner, protocol and header anomalies.
  - **How it was verified:** with the file loaded in blocking mode, both end-to-end suites, an agent
    session and public traffic pass, and every attack probe is refused.
- **Route uploads around the WAF** (see [Uploads](#uploads)). Their limit should not be raised inside
  ModSecurity: an anonymous 150 MB upload made the WAF use 1.2 GB of memory.
- **If your WAF can only exclude rules by path,** without a condition on a header or cookie, the authoring
  API has to be excluded outright: see [Path-only exclusions](#if-your-waf-can-only-exclude-by-path). The
  WAF then still protects the public surface, but nothing on the authoring paths.
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
| Every upload over 12.5 MB, from the editor or an agent | see [Uploads](#uploads) | (engine limit) | ModSecurity's total body limit. Uploads go up to 200 MB. |
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

## Why tuning individual rules does not work

Writing code is what the authoring API is for. A page's `source`, a snippet, custom head code, critical CSS
and a payment-gateway definition all carry markup, scripts or template expressions. So do dataset fields
and page-data keys, whose **names the author chooses**, so no list of fields to exempt can be complete. An
agent's write arrives wrapped in a JSON-RPC envelope, and a whole page is sent at once. Which rules fire on
`/mcp` changes with every page's content.

What the WAF cannot know is whether the sender may write code. Sitewright decides that: on the authoring
API only a valid session or access key can write anything. What the WAF *can* check is whether a request
carries a credential in Sitewright's exact format, and the exclusion file builds on exactly that.

## Recommended: the exclusion file

[`waf/sitewright-before.conf`](waf/sitewright-before.conf) is a CRS 4 plugin "before" file.

- **The `owasp/modsecurity-crs` images:** put it in `/opt/owasp-crs/plugins/`.
- **Other ModSecurity setups:** `Include` it after `crs-setup.conf` and before the CRS `rules/*.conf`.
- **Coraza:** it supports the same directives (`ctl:requestBodyAccess`, `ctl:ruleRemoveTargetById`), but
  the file was only tested with ModSecurity v3.

It uses rule ids 10100–10199. What it does:

| Section | Applies to | Effect |
|---|---|---|
| 1. Authoring writes | `POST PUT PATCH DELETE` to `/projects`, `/admin`, `/account`, `/global`, `/mcp`, `/invites`, `/me`, `/api-key`, `/ai`, carrying `Authorization: Bearer swk_…`/`swm_…` (64 hex) or the `sw_session` / `__Host-sw_session` cookie in its exact signed format | Allows `PUT PATCH DELETE`. Skips body inspection, and with it the 128 KB and 1,000-value limits. Switches on early blocking for the request. |
| 2. Statistics beacon | `POST /a/<project>` | Skips the content-type check (920420) |
| 2. Agent upload links | `PUT /media-upload/<ticket>` | Allows `PUT` and a missing or non-form content type and `Expect` (920340, 920420, 920450, 920640). Skips body inspection (raw file bytes). Switches on early blocking for the request. |
| 3. OAuth loopback sign-in | `redirect_uri` on `/oauth/authorize` and `/oauth/token`, `redirect_uris[0–4]` on `/oauth/register` | Exempts that one parameter from 931100, 931130 and 934110 |
| 4. Passwords | `password` on `/auth/login` and `/auth/register` | Exempts that one field from every rule (a password is only ever hashed) |
| 5. Payment webhooks | `POST /pay/<project>/webhook/<gateway>` | Removes 943120 (session fixation) |
| Optional, commented out | `POST /f/…` (forms) | Stops checking submissions for XSS, file-access and command patterns, for sites whose visitors write code |

What that means in security terms:

- **The WAF checks a credential's format, not whether it is valid.** Anyone can send a well-formed fake
  `Authorization` header or cookie on a write to the authoring API. Two things follow for such a request:
  - **Its body and query string are not inspected for attacks.** On ModSecurity v3, skipping body
    inspection skips the whole request-body phase, query string included.
  - **It is still refused for anomalies in the request line, headers and user agent:** scanner detection,
    protocol enforcement, restricted headers. These checks run in the first phase, and early blocking
    evaluates them there.

  What the request then meets is Sitewright itself. The route's handler refuses an invalid credential (401)
  before it acts on anything in the request. The body has been read and parsed as JSON by then (within the
  route's size limit), but not used. A genuine author could send anything there anyway, because writing
  JavaScript into a page is a feature. Sitewright's own checks do that work:
  - schema validation of every write;
  - the template safety check (an inline `onclick` in a template is refused, for instance);
  - parameterized database queries;
  - the content security policy and origin isolation of published pages.
- **Reads stay fully inspected,** with or without a credential. Only `GET`, `HEAD` and `OPTIONS` count as
  reads; an agent's read is a `POST` to `/mcp` and is treated as a write.
- **Everything without a credential is inspected as before:**
  - every request to the authoring API without a well-formed credential;
  - site pages and assets, forms, bookings, checkout, webhooks, sign-in, OAuth and the statistics beacon,
    except for the one check each section names.
- **Audit logs hold secrets.** A logged transaction includes request headers (bearer keys, session cookies)
  and the matched data, which at sign-in can be a password. Restrict who can read the WAF's audit log.

To verify credentials at the WAF instead of only their format, the proxy has to ask Sitewright: for
example nginx `auth_request` against `GET /me`, with the exemption keyed on the result rather than on the
header. Sitewright does not ship that configuration.

Verified in blocking mode with the file loaded:

| Traffic | Result |
|---|---|
| API E2E suite | 60 of 61 pass. The one failure expects `/.htaccess` to answer 404; the WAF answers 403. |
| Editor E2E suite | 201 of 201 pass (one mobile layout check passed on a re-run); the WAF refused none of the suite's requests |
| Agent session (MCP) | 257 of 257 tool calls succeed; both uploads and the 90 KB settings save from the editor and from an agent go through |
| Agent uploads | `curl -T` without a content type, at 300 KB and at 5 MB (with `Expect`), and an `image/jpeg` upload all go through |
| Public traffic | All pass, except the contact message that quotes `<script>` and `/etc/os-release` (see the optional section) |
| Attack probes | All refused: `/.env`, `/.git/config`, prototype pollution and Log4Shell on `/`, XSS and path traversal on site pages, SQL injection and XSS in forms, checkout, sign-in and OAuth registration, XSS writes to the API and `/mcp` without a credential or with a malformed one, SQL injection in a credentialed read, a well-formed fake credential sent with a scanner's user agent or a restricted header, a scanner on an upload link. A well-formed fake credential on an otherwise clean write passes the WAF and gets a 401 from Sitewright. |

## Uploads

Uploads go up to 200 MB: media from the editor, agents' upload links, and a website-import archive (up to
50 MB). A project restore (`POST /projects/import/zip`) can be larger than any of these. ModSecurity's total
body limit (`SecRequestBodyLimit`, 12.5 MB by default) refuses anything bigger, **even where the exclusion
file turns body inspection off.**

Do not simply raise that limit. Its nginx connector holds the whole body in memory, and inspecting it costs
more:

| Request | WAF memory, idle → peak |
|---|---|
| Anonymous 150 MB multipart upload, limit raised to 210 MB (refused) | 57 MiB → 1.18 GiB |
| Credentialed 150 MB editor upload, limit raised, body inspection off | 56 MiB → 443 MiB |
| Anonymous 150 MB upload through the location below (Sitewright answers 401) | → 63 MiB |
| Credentialed 150 MB editor upload through the location below | → 67 MiB |

With the limit raised for everything, a few anonymous uploads in parallel can exhaust the WAF, and the WAF
is the front door of every site. Instead, give the upload routes their own proxy location without
ModSecurity, and keep the default limit everywhere else. In nginx:

```nginx
# Before the general `location /`. File bytes are not something a WAF can inspect anyway.
# The pattern must be quoted: nginx reads an unquoted `{36}` as the start of a block.
location ~ "^/(?:projects/[^/]+/media|projects/[^/]+/media/[^/]+/content|media-upload/[0-9a-f-]{36}|projects/import/zip|projects/[^/]+/import/upload/stream)$" {
    modsecurity off;
    client_max_body_size 210m;   # a larger project restore needs more
    proxy_request_buffering off;
    proxy_pass http://127.0.0.1:8080;
    # … the same proxy_set_header lines as the main location …
}
```

Each of these routes checks the session, access key or upload link before it reads the upload. The one
exception is an agent's upload link: it stages the bytes before it looks the link up, and then deletes them.
Measured in the CRS image with this location added (and the exclusion file loaded): both 150 MB uploads
above, while `/.env` and an anonymous script write to a page are still refused.

## If your WAF can only exclude by path

Some WAFs have only an "exclude this rule on this path" control and cannot condition on a header or a
cookie. Managed WAFs and appliances often work this way. Then the authoring API cannot be told apart from
an attack, and these exclusions are needed:

| Path | Methods | Exclude |
|---|---|---|
| `/projects/*`, `/admin/*`, `/account/*`, `/global/*`, `/invites/*`, `/mcp` | `POST PUT PATCH DELETE` | The method policy (911100), request-body inspection (or the attack rule groups 930–944 for the body), and the body size and argument-count limits |
| The upload routes in [Uploads](#uploads) | `POST PUT` | Everything: route them around the WAF |
| `/a/*` | `POST` | The content-type check (920420) |
| `/oauth/authorize`, `/oauth/token`, `/oauth/register` | `GET POST` | 931100 and 934110 (and 931130 at level 2) |
| `/auth/login`, `/auth/register` | `POST` | Every rule, for the `password` field if the WAF can exclude a field, otherwise for the path |
| `/pay/*/webhook/*` | `POST` | 943120 |

To say it plainly: **this exempts the authoring API from the WAF.** It still protects the public surface
(site pages, forms, bookings, checkout, sign-in), which is where anonymous attackers are, and it still
blocks scanners. On the authoring paths it no longer blocks anything, for anyone. Sitewright refuses every
request there without a valid credential before acting on it, so the loss is small. But no WAF rule could
make the authoring API safer than Sitewright's own authorization already does; it can only break it. If
your WAF cannot be configured even this far, do not put the authoring API behind it. Route the platform's
own host around the WAF, and keep it in front of the sites' hosts (`*.<SW_SITES_DOMAIN>` and custom
domains), which carry only public traffic.

## Settings besides the rules

- **Paranoia level: stay at 1.** At level 2 the measured traffic also tripped:
  - nearly every page write;
  - contact messages containing quotes, `--` or a link;
  - a webhook carrying a return URL or an address like `Apt 2; rear`;
  - the OAuth `resource` parameter;
  - the editor's own session cookie: its signature is random base64url, and when it happens to contain
    `--`, rule 942440 matches, so a level-2 WAF signs random editors out.
- **Body size.** A content write can be up to 4 MB, and the uploads above up to 200 MB. The proxy must allow
  that (`client_max_body_size` in nginx, see [Deployment](deployment.md#reverse-proxy-tls)); ModSecurity
  does not have to, once the uploads take their own route (see [Uploads](#uploads)).
- **Long-lived responses.** The editor's live updates and deploy progress are server-sent event streams
  that stay open. Give the proxy a long read timeout and do not buffer `text/event-stream` (the CRS nginx
  image does both by default).
- **The real client IP.** Set `TRUST_PROXY` on Sitewright so rate limits and the sign-in throttle see the
  visitor rather than the WAF (see [Deployment](deployment.md#quick-start-docker-run)).

## Reading your WAF's log

| You see | It is |
|---|---|
| 911100 on a `PUT`, `PATCH` or `DELETE` to `/projects/…`, `/admin/…`, `/account/…` | The editor or an agent saving. Section 1. |
| 941xxx, 942xxx, 932xxx, 933xxx, 934xxx on `/projects/…` or `/mcp` | Authored code being saved. Section 1. |
| 200002 or 200007 | A large save or import. Section 1. |
| 920420 on `/a/<id>` | Visitors' pageviews. Section 2. |
| 911100, 920340, 920420, 920450 or 920640 on `/media-upload/…` | An agent uploading a file. Section 2. |
| A request over 12.5 MB refused | An upload. See [Uploads](#uploads). |
| 931100 or 934110 on `/oauth/…` | A local app signing in. Section 3. |
| Any rule on `json.password` at `/auth/login` | A user's password. Section 4. |
| 943120 on `/pay/…/webhook/…` | A payment provider's event. Section 5. |
| 930130 on `/.env`, `/.git/config`; mixed 93x/94x payloads on `/` | Scanners. Leave them blocked. |

## Reproducing the measurements

`scripts/waf/run.sh` starts a Sitewright image behind the CRS image on a Docker host, drives the traffic
above through it and summarises the WAF's log per route. Run it in detection mode to see what a
configuration would refuse, or in blocking mode with `--exclusions` to check this file. See
[`scripts/README.md`](../scripts/README.md#wafrunsh--what-a-waf-blocks). Run it again when routes change.
