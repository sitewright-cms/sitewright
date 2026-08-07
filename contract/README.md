# The contract

**These files are the promise.** Everything in here is generated from the running system and
committed, so that breaking a promised surface shows up as a **diff in code review** rather than as a
sentence in a document nobody re-reads.

This directory exists because the prose version failed. `docs/project-format.md` described a page
model — a block tree with `partialRef` — that the code had abandoned months earlier, and nothing
could notice. Meanwhile `packages/blocks/test/authoring-reference.test.ts` had been asserting the
helper registry against the engine that whole time, and it never drifted once. The difference is
executability, so the rule here is:

> **Never write down a fact a test can assert.**

[`docs/compatibility.md`](../docs/compatibility.md) keeps only what genuinely cannot execute — the
tier assignments, the deprecation policy, the rationale — and links here for the surfaces themselves.

## What's in here

| File | Surface | Guarded by |
|---|---|---|
| `http-routes.json` | Every registered HTTP route (method + path) | `apps/api/test/contract-http.test.ts` |
| `mcp-tools.json` | MCP tool names + their required inputs | `apps/api/test/contract-mcp.test.ts` |
| `content-kinds.json` | The content-kind vocabulary | `apps/api/test/contract-kinds.test.ts` |
| `css-api.json` | `--sw-*` custom properties + `.sw-*` classes author CSS may rely on | `packages/blocks/test/contract-css.test.ts` |
| `golden/content/*.json` | Stored documents that must keep parsing | `packages/schema/test/contract-golden.test.ts` |
| `golden/bundles/*.json` | Export bundles that must keep importing | `packages/schema/test/contract-golden.test.ts` |

## Updating a snapshot

The guards fail with a diff and the command to regenerate:

```bash
pnpm contract:update      # regenerate every snapshot in this directory
```

**Regenerating is a deliberate act, not a reflex.** A snapshot test that people update with `-u`
without reading the diff is decoration. When a guard fails, the question is not "how do I make it
pass" — it is:

1. **Additive?** (new route, new tool, new token) → regenerate, note it in the CHANGELOG. Minor.
2. **A removal, a rename, or a narrowing?** → that is a **breaking change**. Either put it back, or
   take it through the deprecation policy in `docs/compatibility.md` and bump the major.

## Golden fixtures

`golden/` holds real documents and export bundles, each captured from a released version and named
for it. A guard parses every one against the CURRENT schema and fails if any stops validating.

This is the part Zod cannot do for itself. A Zod schema describes the shape *now*; it will happily
tighten and tell you nothing was lost. Only a corpus of documents written by an older version can
answer "does what our users already have still load?".

**Add fixtures; never edit them.** Editing a fixture to make a test pass deletes the only evidence
that the old shape was ever supported. If a fixture legitimately cannot be supported any more, that
is the definition of a breaking change — delete it in the same commit that bumps the major, and say
so in the CHANGELOG.
