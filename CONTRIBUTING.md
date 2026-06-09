# Contributing to Sitewright

Thanks for helping build Sitewright. This project holds a strict quality bar — these are
enforced, not aspirational.

## Workflow

1. **Plan** — for any non-trivial change, agree on the approach before coding.
2. **TDD** — write a failing test first, implement the minimum to pass, then refactor. Target
   **80%+ coverage** (unit + integration; E2E for user-facing flows).
3. **Review** — every change gets a full **code review** and **security review** before merge.
4. **CI must be green** — lint, typecheck, tests, coverage gate, and build all pass.

## Testing layers

- **Unit** — pure logic and schemas (Vitest).
- **Integration** — each major featureset ships a reusable integration **test harness**, not
  just ad-hoc tests.
- **E2E** — every user-facing flow is covered (Playwright). Run E2E in the local
  Docker-in-Docker environment on an **isolated per-agent slot** via
  [`scripts/e2e-deploy.sh`](scripts/e2e-deploy.sh) (ports `2005–2010`), never by hand
  against the shared `2003` container — see _Parallel / multi-agent work_ below.

## Parallel / multi-agent work

Multiple contributors (human or agent) often work at once. To keep parallel work from
colliding, two rules are **mandatory**:

1. **One git worktree per task.** Never edit the shared checkout directly — give each task
   its own branch + working directory so concurrent edits, indexes, and `HEAD`s can't stomp
   each other. Clean it up when the work merges or is abandoned:

   ```bash
   git worktree add ../sw-<task> -b <type>/<task> main   # isolate
   #   …work, build, test inside ../sw-<task>…
   git worktree remove ../sw-<task>                       # clean up after (then prune)
   ```

2. **One DinD E2E slot per task.** The Playwright suites are serial and mutate global
   instance settings, so they must each own a dedicated container. Use
   [`scripts/e2e-deploy.sh`](scripts/e2e-deploy.sh), which atomically claims a free port in
   `2005–2010` with a per-slot container/image/deploy-dir — `2000–2004` stay reserved for
   dev/preview, and the script never touches the shared `sitewright-api` container:

   ```bash
   eval "$(scripts/e2e-deploy.sh up)"                          # claim + deploy a slot
   pnpm -F @sitewright/api exec playwright test                # uses the exported E2E_BASE_URL
   scripts/e2e-deploy.sh down --port "$SW_E2E_PORT"            # ALWAYS clean up after
   ```

   See [`scripts/README.md`](scripts/README.md) for the full interface. Always tear down
   slots, temp deploy dirs, and test artifacts so the host's disk doesn't grow unbounded.

CI itself is collision-safe by construction: each GitHub Actions run gets a hermetic,
ephemeral runner and a per-ref concurrency group. E2E is deliberately excluded from CI
because it targets the shared DinD host — run it locally on a slot as above.

## Commits

Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`.

## Local setup

```bash
corepack enable           # provides pnpm
pnpm install
pnpm verify               # typecheck + lint + test + build
```

Requires Node >= 22 (see `.nvmrc`).
