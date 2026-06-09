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
