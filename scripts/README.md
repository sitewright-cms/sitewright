# scripts/

Developer / CI helper scripts. Not shipped in the runtime image.

## `e2e-deploy.sh` — isolated DinD slots for parallel E2E

The E2E suites (`apps/api/e2e`, `apps/editor/e2e`) are **serial single-worker** and run
against **one deployed container**, mutating global instance settings. Running two of them
against the same container — which is exactly what happens when several agents / git
worktrees work in parallel — makes them race. The historical recipe also hard-coded the
container name (`sitewright-api`), port (`2003`), and deploy dir (`/tmp/sw-deploy`), so a
second deploy would `docker rm -f` the first, fail on the in-use port, and clobber the dir.

`e2e-deploy.sh` removes those collisions by giving every deploy its **own slot**:

| Resource    | Per-slot value                |
|-------------|-------------------------------|
| Host port   | first free in `2005–2010`     |
| Container   | `sitewright-api-<port>`       |
| Image tag   | `sitewright-api:e2e-<port>`   |
| Deploy dir  | `/tmp/sw-deploy-<port>`       |
| Base URL    | `http://dind.local:<port>`    |

The port claim is **atomic** — `docker run` is the arbiter, so two racing `up`s land on
different ports (the loser retries the next one). The bare `sitewright-api` container/image
(dev/preview + build-worker image) is **never** touched. dind.local only maps `2000–2010`;
`2000–2004` stay reserved for dev/preview, leaving `2005–2010` (6 concurrent slots).

### Use

```bash
# Claim a slot (builds API + editor, deploys, waits for /health), export its coordinates:
eval "$(scripts/e2e-deploy.sh up)"

# Run the suites against the slot you just claimed:
E2E_BASE_URL="$E2E_BASE_URL" pnpm -F @sitewright/api exec playwright test
E2E_BASE_URL="$E2E_BASE_URL" pnpm -F @sitewright/editor exec playwright test

# ALWAYS clean up the slot when done (see worktree-isolation / dev-hygiene rules):
scripts/e2e-deploy.sh down --port "$SW_E2E_PORT"
```

Faster iterations:

```bash
eval "$(scripts/e2e-deploy.sh up --no-build)"                      # reuse compiled dist
eval "$(scripts/e2e-deploy.sh up --image sitewright-api:e2e-2005)" # redeploy an existing image, no build
```

Housekeeping:

```bash
scripts/e2e-deploy.sh list          # show slots + reserved ports
scripts/e2e-deploy.sh free          # advisory: next free pool port
scripts/e2e-deploy.sh down --all    # tear down EVERY e2e slot (never the bare container)
scripts/e2e-deploy.sh selftest      # prove isolation: 2 slots, distinct ports, clean teardown
```

`up` prints progress to **stderr** and only `export …` lines to **stdout**, so
`eval "$(… up)"` is clean. Override behaviour with `SW_E2E_PORT_MIN`/`MAX`, `SW_E2E_HOST`,
`SW_E2E_ADMIN_EMAILS`, `SW_E2E_AUTH_RATE_LIMIT_MAX`, `SW_E2E_HEALTH_TIMEOUT`, `SW_E2E_TMP`.

> Source changes are invisible until the dist is rebuilt — the container runs `node
> dist/server.js`, not `tsx`. `up` (without `--no-build`/`--image`) rebuilds for you.

## `stress/run.sh` — mixed heavy-load stress suite

Runs ONE image under a production-like cgroup (default `--memory 1536m --cpus 6`) and drives it with
phases of concurrent, agent-like work, ramping light → medium → heavy, a quiet window, then extreme:

| Workload    | What one loop does |
|-------------|--------------------|
| `edit`      | an agent editing pages while the author's preview shell reloads (whole-site preview build) |
| `upload`    | uploads 12–24 MP photos, puts them on a gallery page, opens its preview (cold encodes) |
| `cold`      | prunes a project's thumbnails + edits → a whole-site build that re-encodes every variant |
| `shot`      | single-page preview with screenshots (Chromium) |
| `pagespeed` | a Lighthouse audit (mobile + desktop) |
| `publish`   | a minified publish build |
| `exportZip` | the whole-project export zip |
| `list`      | unpaginated page + media list reads |

A `/health` probe every 500 ms measures how long the server takes to answer at all and records the
memory ledger; an in-container sampler records cgroup memory/CPU, the API's **main-thread** CPU, and
private memory by process kind (API, Chromium, render workers); `--trace-gc` logs every full GC.

```bash
# An image to test, e.g. the one an E2E slot built from your tree:
scripts/stress/run.sh --image sitewright-api:e2e-2008 --profile 3-heavy
# → summary.txt (per phase × operation: p50/p90/max + status codes), report.txt (CPU, memory by kind,
#   GC, worst /health stalls, a 10 s timeline), container-state.txt (OOM-killed or not), and with
#   --profile a main-thread .cpuprofile for DevTools.
```

`--env KEY=VALUE` (repeatable) passes a setting to the container — e.g. `--env SW_BUILD_THREADS=0` to
compare builds on the main thread with builds on worker threads — and `plans/small.json` is a short
plan for small boxes (`--cpus 1 --memory 768m`).

Read `container-state.txt` first: `oomKilled=true` means the instance died under the plan. Then
`report.txt`'s quiet phases: CPU and memory must come back down — an instance that stays busy after
the load stops is the failure this suite exists to catch. The container and its throwaway secrets are
removed afterwards unless `--keep`. Plans live in `stress/plans/`; a phase with no workloads is a
quiet window.

## `waf/run.sh` — what a WAF blocks

Puts the official OWASP Core Rule Set image (`owasp/modsecurity-crs`, nginx) in front of ONE Sitewright
image on its own Docker network, drives traffic through it and summarises the WAF's audit log per API
route. It is the measurement behind [docs/waf.md](../docs/waf.md); run it again when routes change, to
see whether `docs/waf/sitewright-before.conf` still covers them.

| Suite    | What goes through the WAF |
|----------|---------------------------|
| `mcp`    | an agent session over `/mcp` on the seeded example project: every page read and written back, entries, CSS, custom head code, uploads (inline and `PUT` to an upload link), an import, a deploy, a full settings save from the editor and from an agent |
| `public` | site pages + assets with campaign query strings, the statistics beacon, form / booking / checkout posts shaped like the page runtimes', Stripe / PayPal / Mollie webhooks, the OAuth flows of local and hosted MCP clients, sign-in with generated-looking passwords |
| `probes` | attacks the WAF must still refuse: scanners, injection on public endpoints, writes to the API and `/mcp` without a credential or with a malformed one |
| `api`, `editor` | the Playwright E2E suites (slow; `editor` needs the SPA in the image) |

```bash
# What a stock rule set would refuse (log only, everything reaches Sitewright):
scripts/waf/run.sh --image ghcr.io/sitewright-cms/sitewright:0.81.0
# The recommended configuration, actually blocking:
scripts/waf/run.sh --image ghcr.io/sitewright-cms/sitewright:0.81.0 --mode block --exclusions --suites mcp,public,probes,api
# → summary.txt: per route, the requests, how many matched a rule, how many a level-1 WAF would refuse,
#   and which rules with a sample of what they matched; probes.txt: one status per attack (403 = refused).
```

The WAF blocks at paranoia level 1 and also LOGS level-2 matches (tagged `PL2` in the summary), so one
run shows both. Sign-in and setup go to the API directly (port + 1000), so only the traffic under test is
measured. Both containers and the throwaway admin are removed afterwards unless `--keep`.
