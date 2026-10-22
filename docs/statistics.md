# Built-in statistics

Sitewright can count a site's visits itself — no third-party tool, no cookie, no consent-manager entry. Agency
staff (an admin or a developer) switch it on per site in **Website Settings → Analytics**
(`website.statistics.enabled`); anyone who can edit the settings can switch it off. Every route that writes the
settings holds to that: a settings save, a revision restore, and an import — a project bundle or a website import
by anyone else leaves the setting as it was. The numbers are in the project's **Statistics** tab and, for agents,
the `get_site_stats` MCP tool. It works for every deploy target: local hosting, and sites uploaded by FTP, SFTP
or git.

## What it counts

| | |
|---|---|
| **Human vs bot** | A *human* (organic) pageview is a real browser that ran the page's script. Bots are split by kind — search engines, AI crawlers and assistants, SEO tools, uptime monitors, link previews, other — using [`isbot`](https://github.com/omrilotan/isbot) and the tagged [crawler-user-agents](https://github.com/monperrus/crawler-user-agents) list. An automated browser (`navigator.webdriver`) counts as a bot even with a normal user agent. |
| **Device** | Desktop, mobile or tablet, from the browser's own mobile hint and its user agent (iPads asking for the desktop site are recognised by their touch screen). |
| **Country** | From the visitor's IP address, looked up in the bundled [DB-IP Country Lite](https://db-ip.com/db/download/ip-to-country-lite) database. |
| **Visitors** | One per person per day — see [Privacy](#privacy). |
| **Pages, sources, goals** | Human and bot views per page; where each day's visitors came from (direct, search, social, AI assistant, referral, or a `utm_source` / `ref` campaign); and form submissions per form. |

### Filtering by device and country

Device and country are counted together, so the Statistics tab can filter by either or both ("mobile visitors
from Germany"): click a device, a country or the map. A filter applies to every tile that was counted with it,
and each of those tiles shows the filter's pill (clearing any pill clears the filter everywhere):

| Tile | Device filter | Country filter |
|---|---|---|
| Visitors, Pageviews, Pageviews per day (human bars) | yes | yes |
| Devices | its own selection | yes |
| Countries, Map | yes | their own selection |
| Top pages, Sources, Goals | yes | yes |
| Bots, Bot pageviews, the chart's bot bars | no — "Any device": a bot has no device | yes |

**Pages, sources and goals by device and country** come from a separate breakdown (`page_dims`, `source_dims`,
`goal_dims` in `analytics.db`) beside the exact lists, which stay as they were. Under a filter:

- Pages are listed by **human** pageviews (no bot column).
- The breakdown exists only from the day this version first ran (`dims_since`). Earlier days are not broken down,
  and neither is a busy site's traffic past the daily caps (see [Cost](#cost)). A filtered list therefore ends
  with a **Not broken down** row (pageviews or visitors in the filter that the list cannot place), worked out from
  the exact totals, and a line saying why, rather than showing those visits as missing. Goals that are not broken
  down belong to no filter; the Goals tile counts them in a note, and the conversion rate is shown only when every
  goal of the period is placed.
- A goal's device and country are the submitting request's (its user agent and mobile hint; a form does not send
  the page's own hints, so an iPad asking for the desktop site counts as desktop there).

### Sites on other hosts need a public URL

A page uploaded to another host can only report visits to an absolute address, so the instance needs
`SW_PUBLIC_URL`. Without it, builds for remote targets (and the downloadable site zip) ship **no** counter —
a counter pointing at the customer's own host would count nothing and say nothing — and the Statistics tab
explains that only locally hosted visits are counted.

### Bots on remote deployments

Most crawlers never run a page's script. On **local hosting** the platform serves the pages, so it counts every
page it serves to a bot as it serves it. A site uploaded elsewhere is served by another web server, so only the
bots that run JavaScript (some headless browsers) can be seen there.

## How it works

1. **Publishing** adds a small script (`_assets/_sw/stats.js`, under 1 KB) to every page, with the page's route
   **signed** by a per-project key. The draft preview and the page-speed audit never get it.
2. **On each pageview** the script sends one `text/plain` beacon (no CORS preflight) to
   `<SW_PUBLIC_URL>/a/<projectId>` — root-relative when no public URL is set, like the form endpoint. A
   prerendered page is counted only when it is actually shown.
3. **The collector** checks the route signature (so nobody can invent pages), that the site counts visits, and —
   when the site has a site URL — that the page runs on the site's own host. It always answers `204`, so it is no
   oracle for which sites count. It then classifies the visit and adds it to **in-memory counters**.
4. **Once a minute** the counters are written to daily totals as one transaction, together with the visitor ids
   first seen since the last write. Nothing is written per visit; a crash loses at most the last minute.

The route signatures derive from `SW_ENCRYPTION_KEY` when it is set (it is required for remote deploy targets), so
they outlive the statistics file. Without the key a random secret is kept in `analytics.db`; losing that file then
means republishing before pages count again.

## Privacy

- No cookie, no `localStorage`, nothing stored on the visitor's device.
- The IP address and user agent are **never stored** — not in the statistics, and not in the request log either
  (the collector logs only warnings). A visitor id is the truncated (30-bit) SHA-256 of a salt that rotates at
  midnight UTC, the site, the IP and the user agent; only today's ids are kept, and the salt is deleted after two
  days. A visitor cannot be followed from one day to the next — so visitors over a range are
  the sum of daily visitors.
- Only **daily totals** are kept, for **25 months** (the CNIL audience-measurement ceiling). There are no
  per-visit records.
- Global Privacy Control and Do Not Track are not consulted: nothing personal is kept to opt out of.

Whether visitors must be told about or asked for this depends on where they are; the site's privacy policy
should mention it either way.

## Limits of a public counter

The collector is a public endpoint and every published page carries a valid beacon, so anyone can replay one —
inflating a real page's count, or filling the day's list of named referrers and campaigns with junk (the rest
are then counted under their kind alone). It is rate-limited per IP address, it cannot be made to invent pages
(routes are signed), and every structure it fills is capped per site and in all — the device × country breakdown
too — so one site under attack never costs another site its accuracy, and an attack on many sites never costs
unbounded memory or disk. It is a visit counter, not an audit log.

## Cost

| | |
|---|---|
| **Per pageview** | A few microseconds of CPU: one bot pattern test, a device check, a country lookup (~0.6 µs), one hash. Bot categories are only looked up for traffic already flagged as a bot, and cached per user agent. |
| **Memory** | The country database (~16 MB) loads on the first counted visit, so an instance whose sites never count pays nothing. Today's visitor ids take ~30 bytes each, capped at 250,000 per site and one million in all; pending counters are capped per site and in all. The breakdown's caps are kept as one ~16-byte fingerprint per row, at most 300,000 in all (~5 MB). |
| **Disk** | Daily totals in their own SQLite file, `<SW_DATA_DIR>/analytics.db` — a few dozen rows per site per day, ~60–70 bytes each. The device × country breakdown of pages, sources and goals adds at most **1,000 page rows, 500 source rows and 200 goal rows per site per day** (one row per page, device and country seen that day); past a cap a visit still counts everywhere else. Measured on a site with ~150 visitors a day: ~200 extra rows (~13 KB) a day, ~10 MB over the 25 months. Deleting the file resets the statistics (and the route-signing key: republish remote sites afterwards). |

## Operating it

- **Behind a reverse proxy, set `TRUST_PROXY`.** Otherwise every visitor arrives from the proxy's address: one
  visitor, one country, one rate-limit bucket. The collector logs a warning the first time it sees visits from a
  private address without it.

- `SW_GEOIP_DB` swaps the country database for any MaxMind-format country file (see
  [environment.md](environment.md)). The bundled DB-IP data is licensed CC BY 4.0, and the Statistics tab carries
  the attribution link the licence requires.
- The Statistics tab and `GET /projects/:id/stats.csv?table=traffic|pages|sources|goals` export the daily totals.
- **Lifecycle.**
  - Switching statistics off stops the counting at once, and keeps the numbers so switching back on loses
    nothing.
  - A soft-deleted project stops counting too, even if a copy of its pages on another host still beacons,
    and keeps its numbers for a restore.
  - The permanent delete removes them, even when one of its other steps fails. Before it deletes anything it
    records the project in `analytics.db` (in memory when the file cannot be written), and an hourly sweep, alongside the other maintenance sweeps, deletes the statistics of
    every recorded project; the record goes once a sweep finds nothing left. So a delete whose own cleanup
    failed, or a beacon that landed just after it, is finished by the next sweep, however many projects were
    deleted at once. A recorded project that exists again (a main database restored from before the delete)
    keeps its statistics.
  - The same sweep removes statistics that no existing project owns and no delete recorded. It refuses to
    delete most of those sites at once and logs instead: statistics live in their own file, and a main
    database restored from an old backup would otherwise make every newer site look deleted.
  - Everything older than 25 months is pruned daily, along with the previous days' salts and visitor ids.
  - Freed space goes back to the filesystem: the file uses incremental auto-vacuum, run in small steps after
    every prune and delete. An older file converts once at startup if it is small; a large one keeps working
    without shrinking, and the startup log says so.
