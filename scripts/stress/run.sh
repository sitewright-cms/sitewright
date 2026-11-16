#!/usr/bin/env bash
#
# stress/run.sh — run the mixed heavy-load stress suite against ONE capped Sitewright container.
#
# Starts the image with a production-like cgroup (memory + CPU quota), a fresh data dir and throwaway
# secrets, runs the plan's phases (agents editing with the preview watching, big photo uploads, cold
# whole-site previews, screenshot previews, Lighthouse, publish builds, export zips, list reads), then
# reports per-phase latency, CPU (the API's MAIN thread separately), memory by process kind, GC, and
# whether the instance SETTLES once the load stops. See scripts/README.md (`stress/run.sh`).
#
#   scripts/stress/run.sh --image <ref> [--plan <json>] [--memory 1536m] [--cpus 6] [--port <p>]
#                         [--out <dir>] [--profile <phase>] [--env KEY=VALUE]… [--keep]
#
#   --image    image to test (e.g. sitewright-api:e2e-2008, ghcr.io/sitewright-cms/sitewright:0.80.0)
#   --plan     phases + workload counts (default: plans/standard.json, ~15 min)
#   --memory   cgroup memory limit (default 1536m)      --cpus  CPU quota (default 6)
#   --port     host port (default: the first free E2E pool port)
#   --out      results directory (default: a new temp dir; printed at the end)
#   --profile  CPU-profile the API's main thread for 30 s, 20 s into this phase (e.g. 3-heavy)
#   --env      pass an extra setting to the container (repeatable), e.g. --env SW_BUILD_THREADS=0
#   --keep     leave the container running afterwards (default: removed)
#
# Env: SW_STRESS_HOST (default $SW_E2E_HOST or dind.local), SW_STRESS_IMAGES (a fixture dir to reuse).
# Progress goes to stderr; the last line on stdout is the results directory.
#
# ⚠ The container publishes its port on every interface of the Docker host and the driver logs in over
# plain HTTP, as the E2E slots do: run it on a private network. Its admin is a throwaway with a random
# password that is deleted with the container (with --keep, remove the container yourself).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
log() { printf '\033[36m[stress]\033[0m %s\n' "$*" >&2; }
die() { log "error: $*"; exit 1; }

image="" plan="$here/plans/standard.json" memory=1536m cpus=6 port="" out="" profile_phase="" keep=0
extra_env=()
while [ $# -gt 0 ]; do
  case "$1" in
    --image) image="$2"; shift 2 ;;
    --plan) plan="$2"; shift 2 ;;
    --memory) memory="$2"; shift 2 ;;
    --cpus) cpus="$2"; shift 2 ;;
    --port) port="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --profile) profile_phase="$2"; shift 2 ;;
    --env) case "$2" in *=*) extra_env+=("$2") ;; *) die "--env needs KEY=VALUE" ;; esac; shift 2 ;;
    --keep) keep=1; shift ;;
    -h|--help) awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "${BASH_SOURCE[0]}" >&2; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[ -n "$image" ] || die "--image is required"
[ -r "$plan" ] || die "plan not readable: $plan"
host="${SW_STRESS_HOST:-${SW_E2E_HOST:-dind.local}}"
port="${port:-$("$repo/scripts/e2e-deploy.sh" free)}"
name="sitewright-stress-$port"
out="${out:-$(mktemp -d "${TMPDIR:-/tmp}/sw-stress-XXXXXX")}"
mkdir -p "$out"

# Throwaway secrets, never printed, removed on exit.
secrets="$(mktemp -d "${TMPDIR:-/tmp}/sw-stress-secrets-XXXXXX")"
chmod 700 "$secrets"
sampler_pid="" profiler_pid=""
cleanup() {
  [ -n "$sampler_pid" ] && kill "$sampler_pid" 2>/dev/null || true
  [ -n "$profiler_pid" ] && kill "$profiler_pid" 2>/dev/null || true
  rm -rf "$secrets"
  if [ "$keep" -eq 0 ]; then docker rm -f "$name" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
openssl rand -hex 16 > "$secrets/pw"
{
  echo "SW_ENCRYPTION_KEY=$(openssl rand -base64 32)"
  echo "COOKIE_SECRET=$(openssl rand -hex 32)"
  echo "SW_ADMIN_EMAIL=stress@stress.test"
  echo "SW_ADMIN_PASSWORD=$(cat "$secrets/pw")"
  echo "SW_DISABLE_UPDATE_CHECK=true"
  for kv in ${extra_env[@]+"${extra_env[@]}"}; do echo "$kv"; done
} > "$secrets/env"

log "starting $name ($image, --memory $memory --cpus $cpus) on $host:$port"
# --trace-gc goes on the command line (Node refuses it in NODE_OPTIONS); the entrypoint still derives the
# heap ceiling from the cgroup exactly as in production.
docker run -d --name "$name" -p "$port:80" --memory "$memory" --cpus "$cpus" --env-file "$secrets/env" \
  "$image" node --trace-gc --trace-gc-ignore-scavenger dist/server.js >/dev/null
for _ in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$name" 2>/dev/null)" = healthy ] && break
  sleep 2
done
[ "$(docker inspect -f '{{.State.Health.Status}}' "$name")" = healthy ] || die "$name did not become healthy"

imgdir="${SW_STRESS_IMAGES:-$out/img}"
if [ ! -d "$imgdir" ] || [ -z "$(ls "$imgdir"/*.jpg 2>/dev/null)" ]; then
  log "generating photo fixtures in $imgdir"
  mkdir -p "$imgdir"
  node "$here/gen-images.mjs" "$imgdir" 40
fi

docker cp "$here/sampler.mjs" "$name:/tmp/sampler.mjs"
docker cp "$here/cpu-profile.mjs" "$name:/tmp/cpu-profile.mjs"
docker exec "$name" node /tmp/sampler.mjs > "$out/sampler.jsonl" 2>&1 &
sampler_pid=$!

if [ -n "$profile_phase" ]; then
  (
    until grep -q "phase $profile_phase" "$out/driver.log" 2>/dev/null; do sleep 2; done
    sleep 20
    docker exec "$name" sh -c 'kill -USR1 1' && sleep 1
    docker exec "$name" node /tmp/cpu-profile.mjs 30000 /tmp/main.cpuprofile 1000 >/dev/null 2>&1 &&
      docker cp "$name:/tmp/main.cpuprofile" "$out/main-$profile_phase.cpuprofile"
  ) >/dev/null 2>&1 &
  profiler_pid=$!
fi

log "running $(basename "$plan") — results in $out"
BASE="http://$host:$port" EMAIL=stress@stress.test PWFILE="$secrets/pw" PLAN="$plan" OUT="$out/results.json" \
  IMGDIR="$imgdir" node "$here/driver.mjs" > "$out/summary.txt" 2> "$out/driver.log" || log "driver exited non-zero"

docker logs "$name" 2>&1 | grep -E 'Mark-Compact|Mark-Sweep' > "$out/gc.log" || true
state="$(docker inspect -f 'status={{.State.Status}} exit={{.State.ExitCode}} oomKilled={{.State.OOMKilled}}' "$name")"
started="$(date -d "$(docker inspect -f '{{.State.StartedAt}}' "$name")" +%s.%N)"
echo "$state" > "$out/container-state.txt"
node "$here/report.mjs" "$out" "$out/gc.log" "$started" > "$out/report.txt" 2>&1 || log "report failed"
log "container: $state"
cat "$out/summary.txt" "$out/report.txt" >&2
echo "$out"
