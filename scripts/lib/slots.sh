# shellcheck shell=bash
# scripts/lib/slots.sh — pure helpers for allocating non-colliding DinD E2E slots.
#
# Sourced by e2e-deploy.sh (and by tests). Sourcing has NO side effects: it only
# sets defaults and defines functions. All functions print to stdout.

# Allocatable host-port pool. dind.local maps 2000–2010 only; 2000–2004 are
# reserved for dev/preview (render 2000, preview 2001, api 2002, default-E2E 2003,
# editor 2004), leaving 2005–2010 as the parallel E2E pool. Override via env.
: "${SW_E2E_PORT_MIN:=2005}"
: "${SW_E2E_PORT_MAX:=2010}"

# Naming is fully derived from the claimed port so teardown is deterministic.
# The bare `sitewright-api` name/tag is deliberately NOT in this namespace — it is
# the dev/preview container and the build-worker image, and must never be touched.
: "${SW_E2E_NAME_PREFIX:=sitewright-api-}"
: "${SW_E2E_IMAGE_PREFIX:=sitewright-api:e2e-}"
: "${SW_E2E_TMP:=/tmp}"

# Echo every port in the pool, one per line.
sw_e2e_pool() {
  local p
  for ((p = SW_E2E_PORT_MIN; p <= SW_E2E_PORT_MAX; p++)); do printf '%s\n' "$p"; done
}

# Host ports currently published by ANY container on the daemon — so we never
# collide even with unrelated workloads sharing the DinD host. Numeric, sorted, unique.
sw_e2e_used_ports() {
  docker ps --format '{{.Ports}}' 2>/dev/null \
    | grep -oE ':[0-9]+->' | tr -dc '0-9\n' | sort -un
}

sw_e2e_container_for() { printf '%s%s\n' "$SW_E2E_NAME_PREFIX" "$1"; }
sw_e2e_image_for()     { printf '%s%s\n' "$SW_E2E_IMAGE_PREFIX" "$1"; }
sw_e2e_deploydir_for() { printf '%s/sw-deploy-%s\n' "${SW_E2E_TMP%/}" "$1"; }

# Names of existing slot containers (running or stopped). Anchored regex so the
# bare `sitewright-api` is never matched.
sw_e2e_slot_containers() {
  docker ps -a --format '{{.Names}}' 2>/dev/null \
    | grep -E "^${SW_E2E_NAME_PREFIX}[0-9]+$" || true
}

# Advisory only: first pool port that is neither published nor owned by a slot
# container. This is NOT an atomic claim (TOCTOU between check and use) — `up`
# claims atomically by letting `docker run` arbitrate. Use this for reporting.
sw_e2e_first_free() {
  local used names p
  used="$(sw_e2e_used_ports)"
  names="$(docker ps -a --format '{{.Names}}' 2>/dev/null || true)"
  while read -r p; do
    grep -qx "$p" <<<"$used" && continue
    grep -qx "$(sw_e2e_container_for "$p")" <<<"$names" && continue
    printf '%s\n' "$p"
    return 0
  done < <(sw_e2e_pool)
  return 1
}
