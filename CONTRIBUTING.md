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
  Docker-in-Docker environment; expose operator-previewable ports in `2000–2010`.

## Commits

Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`.

## Local setup

```bash
corepack enable           # provides pnpm
pnpm install
pnpm verify               # typecheck + lint + test + build
```

Requires Node >= 22 (see `.nvmrc`).
