#!/usr/bin/env bash
#
# e2e-deploy.sh — deploy Sitewright to an ISOLATED DinD slot for parallel E2E.
#
# Each `up` claims a unique host port (2005–2010 by default), a uniquely named
# container (sitewright-api-<port>), a unique image tag (sitewright-api:e2e-<port>),
# and a unique deploy dir (/tmp/sw-deploy-<port>) — so N agents / git worktrees can
# deploy and run the serial Playwright suites CONCURRENTLY without colliding on the
# shared DinD host. The port claim is ATOMIC: `docker run` is the arbiter, so two
# racing `up`s either land on different slots or the loser retries the next port.
#
# Progress and build logs go to STDERR; only `export …` lines go to STDOUT, so the
# common pattern is safe:
#
#   eval "$(scripts/e2e-deploy.sh up)"                 # build + deploy a fresh slot
#   pnpm -F @sitewright/api exec playwright test       # uses the exported E2E_BASE_URL
#   scripts/e2e-deploy.sh down --port "$SW_E2E_PORT"   # always clean up after
#
# Subcommands:
#   up   [--no-build] [--no-editor] [--image <ref>]   claim a slot; export its coordinates
#   down (--port <p> | --container <name> | --all)    tear down slot(s); never touches bare `sitewright-api`
#   list                                              show e2e slots + reserved ports
#   free                                              print the first advisory-free pool port
#   selftest [--image <ref>]                          prove isolation: 2 concurrent slots, distinct ports, clean teardown
#
# Flags:
#   --no-build   reuse the already-compiled dist (skip `pnpm build`); still packages + builds the image
#   --no-editor  do not bundle the editor SPA (API-only slot)
#   --image REF  redeploy an existing local image as-is (skips build + package + docker build)
#
# Env overrides: SW_E2E_PORT_MIN/MAX, SW_E2E_HOST (default dind.local),
#   SW_E2E_ADMIN_EMAILS (admin@e2e.test), SW_E2E_AUTH_RATE_LIMIT_MAX (200),
#   SW_E2E_HEALTH_TIMEOUT (90s), SW_E2E_TMP (/tmp).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/slots.sh
. "$here/lib/slots.sh"

: "${SW_E2E_HOST:=dind.local}"
# The first-boot SEEDED admin identity (SW_ADMIN_EMAIL) — admin is a persisted role now, not an env
# allowlist. The E2E specs log in as this account; the password is set so it's a real (non-default)
# credential (so a forced-password-change on the default never blocks the harness).
: "${SW_E2E_ADMIN_EMAILS:=admin@e2e.test}"
: "${SW_E2E_ADMIN_PASSWORD:=Pw-secret-1}"
: "${SW_E2E_AUTH_RATE_LIMIT_MAX:=200}"
: "${SW_E2E_HEALTH_TIMEOUT:=90}"

log() { printf '\033[36m[e2e-deploy]\033[0m %s\n' "$*" >&2; }

# A deployed instance is invitation-only by default (registration is no longer an env var). The E2E
# specs create throwaway users via /auth/register, so open self-registration once at deploy: log in as
# the SEEDED admin (SW_ADMIN_EMAIL/SW_ADMIN_PASSWORD), then flip the persisted `allowSelfRegistration`.
open_self_registration() {
  local port="$1" base jar rc
  base="http://${SW_E2E_HOST}:${port}"
  jar="$(mktemp)"
  curl -fsS -c "$jar" -X POST "${base}/auth/login" -H 'content-type: application/json' \
    -d "{\"email\":\"${SW_E2E_ADMIN_EMAILS}\",\"password\":\"${SW_E2E_ADMIN_PASSWORD}\"}" >/dev/null 2>&1 \
    || { rm -f "$jar"; return 1; }
  curl -fsS -b "$jar" -X PUT "${base}/admin/settings" -H 'content-type: application/json' \
    -d '{"allowSelfRegistration":true}' >/dev/null 2>&1
  rc=$?; rm -f "$jar"; return $rc
}
err() { printf '\033[31m[e2e-deploy] ERROR:\033[0m %s\n' "$*" >&2; }
die() { err "$*"; exit 1; }

need()      { command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"; }
repo_root() { git -C "$here" rev-parse --show-toplevel; }

secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -base64 32
  else head -c 32 /dev/urandom | base64; fi
}

# ── Input validation ─────────────────────────────────────────────────────────
# Every value below reaches either bash arithmetic `(( ))` (→ expression/command
# injection) or an `export …` line the caller `eval`s (→ a newline injects a
# statement). These are operator knobs, but the `eval "$(… up)"` pattern is the
# documented happy path, so we fail closed: integers must be integers, and tokens
# spliced into output must contain no whitespace/newline/metacharacters.
is_uint()    { [[ "$1" =~ ^[0-9]+$ ]]; }
safe_token() { [[ "$1" =~ ^[A-Za-z0-9._:@/+-]+$ ]]; }

validate_env() {
  is_uint "$SW_E2E_PORT_MIN"       || die "SW_E2E_PORT_MIN must be an integer (got: $SW_E2E_PORT_MIN)"
  is_uint "$SW_E2E_PORT_MAX"       || die "SW_E2E_PORT_MAX must be an integer (got: $SW_E2E_PORT_MAX)"
  is_uint "$SW_E2E_HEALTH_TIMEOUT" || die "SW_E2E_HEALTH_TIMEOUT must be an integer (got: $SW_E2E_HEALTH_TIMEOUT)"
  [ "$SW_E2E_PORT_MIN" -le "$SW_E2E_PORT_MAX" ] || die "SW_E2E_PORT_MIN ($SW_E2E_PORT_MIN) > SW_E2E_PORT_MAX ($SW_E2E_PORT_MAX)"
  safe_token "$SW_E2E_HOST"         || die "SW_E2E_HOST has invalid characters: $SW_E2E_HOST"
  safe_token "$SW_E2E_NAME_PREFIX"  || die "SW_E2E_NAME_PREFIX has invalid characters"
  safe_token "$SW_E2E_IMAGE_PREFIX" || die "SW_E2E_IMAGE_PREFIX has invalid characters"
  case "$SW_E2E_TMP" in
    /*) safe_token "${SW_E2E_TMP//\//_}" || die "SW_E2E_TMP has invalid characters: $SW_E2E_TMP" ;;
    *)  die "SW_E2E_TMP must be an absolute path (got: $SW_E2E_TMP)" ;;
  esac
}

# Wait until the slot's /health returns 2xx, or fail (caller cleans up the container).
wait_healthy() {
  local port="$1" base i
  base="http://${SW_E2E_HOST}:${port}"
  for ((i = 1; i <= SW_E2E_HEALTH_TIMEOUT; i++)); do
    if curl -fsS "${base}/health" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

# Print the exportable coordinates of a claimed slot to STDOUT.
emit_env() {
  local port="$1" container="$2" image="$3" deploy_dir="$4"
  printf 'export SW_E2E_PORT=%s\n'         "$port"
  printf 'export SW_E2E_CONTAINER=%s\n'    "$container"
  printf 'export SW_E2E_IMAGE=%s\n'        "$image"
  printf 'export SW_E2E_DEPLOY_DIR=%s\n'   "$deploy_dir"
  printf 'export E2E_BASE_URL=http://%s:%s\n' "$SW_E2E_HOST" "$port"
}

# EXIT-trap target for cmd_up: drop the per-invocation tmp image/dir if the run
# aborts (e.g. a build/package failure under `set -e`) BEFORE they are normalised
# to port-derived names. Reads cmd_up's run-scoped globals; idempotent and quiet.
_up_cleanup() {
  [ "${_up_built:-0}" = 1 ] && [ "${_up_normalised:-0}" = 0 ] || return 0
  if [ -n "${_up_tmp_image:-}" ]; then docker rmi -f "$_up_tmp_image" >/dev/null 2>&1 || true; fi
  if [ -n "${_up_tmp_dir:-}" ]; then rm -rf "$_up_tmp_dir"; fi
}

cmd_up() {
  need docker; need curl
  local do_build=1 build_editor=1 reuse_image=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --no-build)  do_build=0 ;;
      --no-editor) build_editor=0 ;;
      --image)     reuse_image="${2:?--image needs a value}"; shift ;;
      --image=*)   reuse_image="${1#--image=}" ;;
      *) die "unknown 'up' option: $1" ;;
    esac
    shift
  done
  if [ -n "$reuse_image" ]; then
    safe_token "$reuse_image" || die "--image has invalid characters: $reuse_image"
  fi

  local root; root="$(repo_root)"

  # ── Build + package ONCE into a per-invocation tmp image, retagged to the port
  #    we actually win. ($$ + RANDOM keeps concurrent invocations distinct.) These
  #    are run-scoped GLOBALS (not local) so the EXIT trap can clean them on abort.
  local build_id
  _up_tmp_image=""; _up_tmp_dir=""; _up_built=0; _up_normalised=0
  build_id="$$-${RANDOM}"
  if [ -n "$reuse_image" ]; then
    docker image inspect "$reuse_image" >/dev/null 2>&1 || die "image not found locally: $reuse_image"
    _up_tmp_image="$reuse_image"
    log "Reusing existing image: $reuse_image (no build)"
  else
    _up_tmp_image="sitewright-api:e2e-build-${build_id}"
    _up_tmp_dir="${SW_E2E_TMP%/}/sw-deploy-${build_id}"
    # From here a failure must not leak the tmp dir/image: arm the EXIT trap before
    # the first artifact-producing step.
    trap _up_cleanup EXIT
    if [ "$do_build" = 1 ]; then
      log "Building @sitewright/api (+ workspace deps)…"
      ( cd "$root" && pnpm --filter @sitewright/api... build ) >&2
      if [ "$build_editor" = 1 ]; then
        log "Building @sitewright/editor…"
        ( cd "$root" && pnpm --filter @sitewright/editor build ) >&2
      fi
    else
      log "Skipping compile (--no-build); packaging current dist."
    fi
    log "Packaging deploy dir → $_up_tmp_dir"
    rm -rf "$_up_tmp_dir"
    _up_built=1   # tmp dir/image now exist (or are about to) → trap should clean them
    ( cd "$root" && pnpm --filter @sitewright/api deploy --prod "$_up_tmp_dir" ) >&2
    if [ "$build_editor" = 1 ]; then
      [ -d "$root/apps/editor/dist" ] || die "apps/editor/dist missing — build the editor or pass --no-editor"
      cp -r "$root/apps/editor/dist" "$_up_tmp_dir/editor"
    fi
    log "Building image → $_up_tmp_image"
    docker build -t "$_up_tmp_image" -f "$_up_tmp_dir/Dockerfile" "$_up_tmp_dir" >&2
  fi

  # ── Claim a slot atomically: `docker run` is the arbiter.
  local port container image deploy_dir run_err claimed=0
  while read -r port; do
    container="$(sw_e2e_container_for "$port")"
    # Fast pre-filter: skip names already taken (the run below is the real guard).
    if docker ps -a --format '{{.Names}}' | grep -qx "$container"; then
      log "Slot $port busy (container exists); next…"; continue
    fi
    log "Claiming slot $port → $container"
    # `2>&1 >/dev/null`: capture the daemon's stderr into run_err, discard the
    # container-id on stdout (order matters — stderr is dup'd to the pipe first).
    if run_err="$(docker run -d --name "$container" -p "${port}:80" \
          -e COOKIE_SECRET="$(secret)" \
          -e SW_ENCRYPTION_KEY="$(secret)" \
          -e SW_ADMIN_EMAIL="$SW_E2E_ADMIN_EMAILS" \
          -e SW_ADMIN_PASSWORD="$SW_E2E_ADMIN_PASSWORD" \
          -e SW_AUTH_RATE_LIMIT_MAX="$SW_E2E_AUTH_RATE_LIMIT_MAX" \
          "$_up_tmp_image" 2>&1 >/dev/null)"; then
      claimed=1; break
    fi
    case "$run_err" in
      *"already in use"*)
        # NAME race: a peer created this slot between our pre-filter and run — it
        # is THEIRS. Never `docker rm` it; just try the next port.
        log "Slot $port just claimed by a peer; next…" ;;
      *)
        # PORT in use (or other): docker left a Created-state container under OUR
        # name — safe to remove before moving on.
        log "Slot $port unavailable (${run_err##*: }); next…"
        docker rm -f "$container" >/dev/null 2>&1 || true ;;
    esac
  done < <(sw_e2e_pool)

  [ "$claimed" = 1 ] || die "no free slot in ${SW_E2E_PORT_MIN}-${SW_E2E_PORT_MAX}. Free one: $0 down --all"

  # ── Normalise artifacts to deterministic, port-derived names for clean teardown.
  if [ "$_up_built" = 1 ]; then
    image="$(sw_e2e_image_for "$port")"
    deploy_dir="$(sw_e2e_deploydir_for "$port")"
    docker tag "$_up_tmp_image" "$image" >/dev/null
    docker rmi "$_up_tmp_image" >/dev/null 2>&1 || true   # drops the tmp tag only; layers stay under $image + container
    rm -rf "$deploy_dir"; mv "$_up_tmp_dir" "$deploy_dir"
    _up_normalised=1   # tmp artifacts are gone/renamed → EXIT trap is now a no-op
  else
    image="$reuse_image"
    deploy_dir=""   # nothing of ours to remove for a reused image
  fi

  log "Waiting for $container to become healthy (≤${SW_E2E_HEALTH_TIMEOUT}s)…"
  if ! wait_healthy "$port"; then
    err "slot $port never became healthy; last 40 log lines:"
    docker logs --tail 40 "$container" >&2 || true
    docker rm -f "$container" >/dev/null 2>&1 || true
    if [ "$_up_built" = 1 ]; then docker rmi -f "$image" >/dev/null 2>&1 || true; rm -rf "$deploy_dir"; fi
    die "deploy failed health check on slot $port"
  fi

  # Open self-registration for the E2E specs (the instance is invitation-only by default now).
  if ! open_self_registration "$port"; then
    docker logs --tail 40 "$container" >&2 || true
    docker rm -f "$container" >/dev/null 2>&1 || true
    if [ "$_up_built" = 1 ]; then docker rmi -f "$image" >/dev/null 2>&1 || true; rm -rf "$deploy_dir"; fi
    die "could not open self-registration on slot $port (admin login / settings write failed)"
  fi

  log "Slot ready: http://${SW_E2E_HOST}:${port}  (container $container)"
  emit_env "$port" "$container" "$image" "$deploy_dir"
}

down_one() {
  local port="$1" container image deploy_dir
  [[ "$port" =~ ^[0-9]+$ ]] || die "refusing to tear down non-numeric slot '$port' (bare 'sitewright-api' is protected)"
  container="$(sw_e2e_container_for "$port")"
  image="$(sw_e2e_image_for "$port")"
  deploy_dir="$(sw_e2e_deploydir_for "$port")"
  log "Tearing down slot $port ($container)…"
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker rmi -f "$image"    >/dev/null 2>&1 || true   # only our e2e-<port> tag; reused/base images are untagged here
  rm -rf "$deploy_dir"
}

cmd_down() {
  need docker
  local all=0 port="" container=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --all)         all=1 ;;
      --port)        port="${2:?--port needs a value}"; shift ;;
      --port=*)      port="${1#--port=}" ;;
      --container)   container="${2:?--container needs a value}"; shift ;;
      --container=*) container="${1#--container=}" ;;
      *) die "unknown 'down' option: $1" ;;
    esac
    shift
  done

  if [ "$all" = 1 ]; then
    local c found=0
    while read -r c; do
      [ -n "$c" ] || continue
      found=1; down_one "${c#"$SW_E2E_NAME_PREFIX"}"
    done < <(sw_e2e_slot_containers)
    if [ "$found" = 1 ]; then log "All e2e slots torn down."; else log "No e2e slots to tear down."; fi
    return 0
  fi

  if [ -n "$container" ]; then
    port="${container#"$SW_E2E_NAME_PREFIX"}"
    # Require the prefix to have actually stripped AND the remainder to be all-numeric,
    # so e.g. the bare 'sitewright-api' or 'sitewright-api-2005x' are rejected here.
    if [ "$port" = "$container" ] || ! [[ "$port" =~ ^[0-9]+$ ]]; then
      die "not an e2e slot container: '$container' (expected ${SW_E2E_NAME_PREFIX}<port>)"
    fi
  fi
  [ -n "$port" ] || die "down needs --port <p>, --container <name>, or --all"
  down_one "$port"
}

cmd_list() {
  need docker
  log "Sitewright E2E slots (pool ${SW_E2E_PORT_MIN}-${SW_E2E_PORT_MAX}):"
  # Docker's `--filter name=` is a substring match, so post-filter with the same
  # anchored regex used for teardown — the bare 'sitewright-api' is never listed.
  docker ps -a --format '{{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null \
    | grep -E "^${SW_E2E_NAME_PREFIX}[0-9]+[[:space:]]" >&2 || log "  (no e2e slots)"
  log "Reserved (not managed here): bare 'sitewright-api'; dev/preview ports 2000-2004."
}

cmd_free() {
  need docker
  sw_e2e_first_free || die "no advisory-free slot in ${SW_E2E_PORT_MIN}-${SW_E2E_PORT_MAX}"
}

# Spin up two slots, assert they land on DISTINCT ports and both pass /health while
# the shared bare `sitewright-api` keeps running, then tear both down. Reuses an
# existing local image so it needs no build (and deletes no image on teardown).
cmd_selftest() {
  need docker
  local image=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --image)   image="${2:?--image needs a value}"; shift ;;
      --image=*) image="${1#--image=}" ;;
      *) die "unknown 'selftest' option: $1" ;;
    esac
    shift
  done
  if [ -z "$image" ]; then
    image="$(docker inspect --format '{{.Config.Image}}' sitewright-api 2>/dev/null || true)"
    [ -n "$image" ] || image="$(docker images --format '{{.Repository}}:{{.Tag}}' 'sitewright-api' 2>/dev/null | grep -v '<none>' | head -1 || true)"
  fi
  [ -n "$image" ] || die "selftest needs a reusable image; pass --image <ref>"
  log "selftest: reusing image $image"

  local out1 out2 p1 p2 fail=0
  out1="$(cmd_up --image "$image")" || die "selftest: first 'up' failed"
  p1="$(sed -n 's/^export SW_E2E_PORT=//p' <<<"$out1")"
  out2="$(cmd_up --image "$image")" || { down_one "$p1"; die "selftest: second 'up' failed"; }
  p2="$(sed -n 's/^export SW_E2E_PORT=//p' <<<"$out2")"

  log "selftest: claimed ports $p1 and $p2"
  if [ -z "$p1" ] || [ -z "$p2" ] || [ "$p1" = "$p2" ]; then err "selftest: ports not distinct ($p1 / $p2)"; fail=1; fi
  # Guard the health/teardown calls on non-empty ports so a failed parse can't
  # busy-wait the full timeout or feed an empty arg to down_one.
  if [ -n "$p1" ]; then wait_healthy "$p1" || { err "selftest: slot $p1 unhealthy"; fail=1; }; fi
  if [ -n "$p2" ]; then wait_healthy "$p2" || { err "selftest: slot $p2 unhealthy"; fail=1; }; fi
  if ! docker ps --format '{{.Names}}' | grep -qx 'sitewright-api'; then
    log "selftest: note — no bare 'sitewright-api' running to confirm non-interference (ok)"
  else
    log "selftest: bare 'sitewright-api' still running — not disturbed ✔"
  fi

  if [ -n "$p1" ]; then down_one "$p1"; fi
  if [ -n "$p2" ]; then down_one "$p2"; fi
  if [ "$fail" = 0 ]; then log "selftest PASS ✔"; else die "selftest FAILED"; fi
}

main() {
  local cmd="${1:-}"; shift || true
  validate_env
  case "$cmd" in
    up)       cmd_up "$@" ;;
    down)     cmd_down "$@" ;;
    list)     cmd_list "$@" ;;
    free)     cmd_free "$@" ;;
    selftest) cmd_selftest "$@" ;;
    ""|-h|--help|help)
      # Print the contiguous leading comment block (stops at the first code line).
      awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "${BASH_SOURCE[0]}" >&2 ;;
    *) die "unknown command: $cmd (try: up | down | list | free | selftest)" ;;
  esac
}

main "$@"
