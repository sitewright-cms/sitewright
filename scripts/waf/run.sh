#!/usr/bin/env bash
#
# waf/run.sh — measure which Sitewright requests an OWASP Core Rule Set WAF blocks.
#
# Starts a Sitewright image and the official OWASP CRS nginx image in front of it (own Docker network),
# drives traffic through the WAF, and writes the WAF's audit log, an nginx access log and a per-route
# summary (`summary.txt`) into the results directory. See docs/waf.md for what the findings mean.
#
#   scripts/waf/run.sh --image <ref> [--mode detect|block] [--exclusions] [--crs <ref>] [--port <p>]
#                      [--out <dir>] [--suites mcp,public,probes,api,editor] [--keep]
#
#   --image       Sitewright image to test (e.g. ghcr.io/sitewright-cms/sitewright:0.81.0)
#   --mode        detect = log only, every request reaches Sitewright and the suites run to the end
#                 (what WOULD be blocked is read from the log); block = the WAF denies (default detect)
#   --exclusions  load docs/waf/sitewright-before.conf as a CRS plugin
#   --crs         WAF image (default owasp/modsecurity-crs:4.30.0-nginx-alpine-202610180210)
#   --port        host port for the WAF (default: the first free E2E pool port)
#   --suites      what to drive through the WAF, in order (default mcp,public,probes): `mcp` an agent
#                 session over /mcp, `public` site visitors / forms / bookings / checkout / webhooks /
#                 OAuth / sign-in, `probes` attacks the WAF must still block, `api` and `editor` the
#                 Playwright E2E suites (slow; editor needs the SPA in the image)
#   --keep        leave both containers running afterwards (default: removed)
#
# The WAF runs at blocking paranoia level 1 (the default) and logs level 2 matches too, with the CRS
# defaults otherwise. Env: SW_WAF_HOST (default $SW_E2E_HOST or dind.local), SW_WAF_DOCKER_HOST (the
# Docker host's own name, for health checks; default: the host part of $DOCKER_HOST, else $SW_WAF_HOST).
#
# ⚠ Both containers publish on every interface of the Docker host and the drivers sign in over plain
# HTTP with a throwaway admin, as the E2E slots do: run it on a private network.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
log() { printf '\033[36m[waf]\033[0m %s\n' "$*" >&2; }
die() { log "error: $*"; exit 1; }

image="" mode=detect exclusions=0 crs="owasp/modsecurity-crs:4.30.0-nginx-alpine-202610180210"
port="" out="" suites="mcp,public,probes" keep=0
while [ $# -gt 0 ]; do
  case "$1" in
    --image) image="$2"; shift 2 ;;
    --mode) mode="$2"; shift 2 ;;
    --exclusions) exclusions=1; shift ;;
    --crs) crs="$2"; shift 2 ;;
    --port) port="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --suites) suites="$2"; shift 2 ;;
    --keep) keep=1; shift ;;
    -h|--help) awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "${BASH_SOURCE[0]}" >&2; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[ -n "$image" ] || die "--image is required"
case "$mode" in detect) engine=DetectionOnly ;; block) engine=On ;; *) die "--mode is detect or block" ;; esac
host="${SW_WAF_HOST:-${SW_E2E_HOST:-dind.local}}"
docker_host="${SW_WAF_DOCKER_HOST:-}"
if [ -z "$docker_host" ]; then
  case "${DOCKER_HOST:-}" in tcp://*) docker_host="${DOCKER_HOST#tcp://}"; docker_host="${docker_host%%:*}" ;; *) docker_host="$host" ;; esac
fi
port="${port:-$("$repo/scripts/e2e-deploy.sh" free)}"
out="${out:-$(mktemp -d "${TMPDIR:-/tmp}/sw-waf-XXXXXX")}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
# The seeded admin, also handed to the drivers (which sign in with it).
export SW_WAF_ADMIN_EMAIL="${SW_E2E_ADMIN_EMAILS:-admin@e2e.test}" SW_WAF_ADMIN_PASSWORD="${SW_E2E_ADMIN_PASSWORD:-Pw-secret-1}"
net="sw-waf-$port" api="sw-waf-api-$port" waf="sw-waf-crs-$port"
secret() { openssl rand -hex 32; }

cleanup() {
  [ "$keep" = 1 ] && { log "kept: $waf → $api (network $net)"; return; }
  docker rm -f "$waf" "$api" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
}
trap cleanup EXIT

log "starting $image behind $crs ($engine, exclusions=$exclusions) on port $port"
docker network create "$net" >/dev/null
# The API is also published directly on port+1000: the drivers sign in and set up there, so only the
# traffic under test crosses the WAF.
direct_port=$((port + 1000))
docker run -d --name "$api" --network "$net" -p "$direct_port:80" \
  -e COOKIE_SECRET="$(secret)" -e SW_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  -e SW_ADMIN_EMAIL="$SW_WAF_ADMIN_EMAIL" -e SW_ADMIN_PASSWORD="$SW_WAF_ADMIN_PASSWORD" \
  -e SW_SITES_DOMAIN="$host" -e SW_DISABLE_UPDATE_CHECK=true \
  "$image" >/dev/null
# The access and audit logs go to a tmpfs the (unprivileged) nginx user can write; `docker exec cat`
# reads them back (`docker cp` cannot see a tmpfs).
docker create --name "$waf" --network "$net" -p "$port:8080" \
  --tmpfs /var/log/waf:rw,mode=1777,size=2g \
  -e BACKEND="http://$api:80" -e 'PROXY_HOST_HEADER=$http_host' \
  -e MODSEC_RULE_ENGINE="$engine" -e BLOCKING_PARANOIA=1 -e DETECTION_PARANOIA=2 \
  -e MODSEC_AUDIT_ENGINE=RelevantOnly -e MODSEC_AUDIT_LOG=/var/log/waf/audit.log -e MODSEC_AUDIT_LOG_PARTS=ABFHZ \
  -e ACCESSLOG=/var/log/waf/access.log \
  "$crs" >/dev/null
[ "$exclusions" = 1 ] && docker cp "$repo/docs/waf/sitewright-before.conf" "$waf:/opt/owasp-crs/plugins/sitewright-before.conf"
docker start "$waf" >/dev/null
base="http://$host:$port"
for _ in $(seq 1 120); do
  curl -fsS -o /dev/null "http://$docker_host:$port/health" 2>/dev/null && break
  [ "$(docker inspect -f '{{.State.Running}}' "$waf")" = true ] || { docker logs --tail 30 "$waf" >&2; die "the WAF did not start"; }
  [ "$(docker inspect -f '{{.State.Running}}' "$api")" = true ] || { docker logs --tail 30 "$api" >&2; die "Sitewright did not start"; }
  sleep 1
done
curl -fsS -o /dev/null "$base/health" || die "Sitewright is not reachable through the WAF at $base"
log "ready at $base"

direct="http://$docker_host:$direct_port"
logs_reset() { docker exec "$waf" sh -c ': >/var/log/waf/audit.log; : >/var/log/waf/access.log' || true; }
logs_reset   # the health checks above are not part of any suite
# The project every suite targets: {projectId, slug} on the first line the mcp driver prints.
project_field() { node -e 'const fs = require("fs"); const v = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))[process.argv[2]]; if (!v) process.exit(1); console.log(v)' "$project_info" "$1"; }
ensure_project() {
  [ -s "$project_info" ] && project_field projectId >/dev/null 2>&1 && return 0
  node "$here/mcp-driver.mjs" "$sdk" "$direct" "$base" --setup-only >"$project_info" 2>>"$out/mcp.log" && project_field projectId >/dev/null 2>&1
}

# The MCP SDK the drivers speak through: the one @sitewright/mcp depends on (its package root).
sdk="$(cd "$repo/packages/mcp" && node -e 'const p = require.resolve("@modelcontextprotocol/sdk/package.json"); const k = "@modelcontextprotocol/sdk"; console.log(p.slice(0, p.indexOf(k) + k.length))')"
# A multilingual site's settings, for the large-settings-save check.
export SW_WAF_BUNDLE="$repo/apps/api/example_projects/example/bundle.json"
project_info="$out/project.json"
IFS=',' read -r -a list <<<"$suites"
for s in "${list[@]}"; do
  log "suite: $s"
  case "$s" in
    mcp) node "$here/mcp-driver.mjs" "$sdk" "$direct" "$base" >"$project_info" 2>"$out/mcp.log" || log "mcp driver failed (see $out/mcp.log)" ;;
    public)
      if ensure_project; then
        node "$here/public-driver.mjs" "$direct" "$base" "$host" "$(project_field projectId)" "$(project_field slug)" >"$out/public.txt" 2>&1 \
          || log "public driver failed (see $out/public.txt)"
      else log "no project to drive (see $out/mcp.log)"; fi ;;
    probes)
      if ensure_project; then
        node "$here/attack-probes.mjs" "$base" "$host" "$(project_field slug)" "$(project_field projectId)" >"$out/probes.txt" 2>&1 \
          || log "attack probes failed (see $out/probes.txt)"
      else log "no project to probe (see $out/mcp.log)"; fi ;;
    api) ( cd "$repo" && E2E_BASE_URL="$base" SW_E2E_SITES_DOMAIN="$host" pnpm -F @sitewright/api exec playwright test --reporter=line ) >"$out/api-e2e.log" 2>&1 || log "api E2E had failures (see $out/api-e2e.log)" ;;
    editor) ( cd "$repo" && E2E_BASE_URL="$base" SW_E2E_SITES_DOMAIN="$host" pnpm -F @sitewright/editor exec playwright test --reporter=line ) >"$out/editor-e2e.log" 2>&1 || log "editor E2E had failures (see $out/editor-e2e.log)" ;;
    *) log "unknown suite: $s (skipped)" ;;
  esac
  docker exec "$waf" cat /var/log/waf/audit.log >"$out/$s.audit.log" || log "could not read the audit log after $s"
  docker exec "$waf" cat /var/log/waf/access.log >"$out/$s.access.log" || log "could not read the access log after $s"
  logs_reset
done

routes="$out/routes.tsv"
node "$here/routes.mjs" "$repo/apps/api/src" >"$routes" || log "route listing failed"
node "$here/analyze.mjs" "$routes" "$host" "$out/summary.json" "$out"/*.audit.log -- "$out"/*.access.log >"$out/summary.txt" \
  || log "the summary is incomplete (see the first line of $out/summary.txt)"
log "summary: $out/summary.txt"
log "⚠ the audit logs keep request headers (session cookies, bearer keys) and matched data: treat $out as sensitive"
echo "$out"
