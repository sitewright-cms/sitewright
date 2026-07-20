# Releasing Sitewright

Sitewright ships as a single self-contained Docker image. A release is **a git tag** — pushing
`vX.Y.Z` triggers [`.github/workflows/release.yml`](.github/workflows/release.yml), which builds the
runtime image, publishes it to the GitHub Container Registry, and creates a GitHub Release.

Versioning follows [SemVer](https://semver.org/). While pre-1.0, a minor bump may carry breaking changes.
Nothing is published to npm — the workspace packages are internal — so the **image tag is the version of
record**, reported at `GET /version`.

## Cutting a release

1. **Pick the version** (`X.Y.Z`) and make sure `main` is green.
2. **Bump the workspace versions** (keeps `package.json`s in step with the tag — cosmetic, the image version
   comes from the tag):
   ```bash
   node scripts/set-version.mjs X.Y.Z      # or: pnpm set-version X.Y.Z
   ```
3. **Update `CHANGELOG.md`** — move the `## [Unreleased]` items under a new `## [X.Y.Z] — <date>` heading.
4. **Commit** on a branch, open a PR, get it reviewed + merged (CI green).
5. **Tag `main`** at the merge commit and push the tag:
   ```bash
   git checkout main && git pull
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
6. The **Release** workflow then:
   - builds the image with `--build-arg SW_VERSION=X.Y.Z`,
   - pushes `ghcr.io/sitewright-cms/sitewright:X.Y.Z` (and `:latest` for a stable tag),
   - smokes the image (renders a screenshot inside it),
   - creates a GitHub Release with auto-generated notes.

**Pre-releases:** tag `vX.Y.Z-rc1` — the workflow marks the GitHub Release as a pre-release and does **not**
move `:latest`.

## Deploying a released image

```bash
docker pull ghcr.io/sitewright-cms/sitewright:X.Y.Z
docker run -d --name sitewright \
  -p 80:80 \
  -v sw-data:/app/data \
  -e SW_PUBLIC_URL=https://your.domain \
  ghcr.io/sitewright-cms/sitewright:X.Y.Z
```

Migrations run automatically on start, and (when a migration is pending) a WAL-safe DB snapshot is written to
`<SW_DATA_DIR>/backups/` first, so an upgrade can be rolled back — see the `apps/api/Dockerfile` header and the
System Settings → **Storage & backups** panel.

## Verifying

- `GET /version` reports `{ "current": "X.Y.Z", ... }`.
- `GET /ready` returns `{ "ok": true }` once the DB is reachable + migrated.
