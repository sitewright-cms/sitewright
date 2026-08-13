#!/usr/bin/env bash
#
# Run ONE headless agent against ONE Sitewright project, with a key that cannot outlive the run.
#
# MCP project scope is fixed per CONNECTION (it rides on the token), so a fleet of agents needs one
# project-scoped key each — otherwise every agent writes into whichever project the shared session
# happens to be connected to. That part was always understood. What was not: nothing revoked those
# keys afterwards. A real instance accumulated 56 PATs, 55 of them dead, only 12 ever revoked — the
# rest were minted per agent per site and left to expire. Housekeeping now reaps dead PATs after
# DEAD_PAT_RETENTION_DAYS, but a key that stays valid for days after its agent exited is a live
# credential nobody is watching, and that is the part retention does not fix.
#
# So: mint, run, revoke — with the revoke in a trap, because the runs that end badly (a crash, a
# Ctrl-C, a killed fleet) are exactly the ones a human would forget to clean up after.
#
# Usage:
#   SW_COOKIE='sw_session=…' ./scripts/fleet-agent.sh <project-id> <brief-file> [extra claude args…]
#   SW_EMAIL=… SW_PASSWORD=… ./scripts/fleet-agent.sh <project-id> <brief-file>
#
# Env:
#   SW_BASE      instance origin (default https://sitewright.buchweitz.house)
#   SW_COOKIE    a session cookie, e.g. 'sw_session=…' — key management is session-only, so a token
#                can never mint or revoke another token. Take it from the browser's devtools.
#   SW_EMAIL/SW_PASSWORD  logs in to obtain the cookie instead. Fails clearly if the account has MFA.
#   SW_MODEL     model to pin (default claude-opus-5[1m]); `claude -p` does NOT inherit your session
#                model, so leaving it unset makes runs incomparable.
#   SW_KEY_TTL_DAYS  key lifetime (default 1) — a floor under the trap, not a substitute for it.
set -euo pipefail

BASE="${SW_BASE:-https://sitewright.buchweitz.house}"
MODEL="${SW_MODEL:-claude-opus-5[1m]}"
KEY_TTL_DAYS="${SW_KEY_TTL_DAYS:-1}"
PROJECT="${1:?usage: fleet-agent.sh <project-id> <brief-file> [claude args…]}"
BRIEF="${2:?usage: fleet-agent.sh <project-id> <brief-file> [claude args…]}"
shift 2
[ -r "$BRIEF" ] || { echo "fleet-agent: brief not readable: $BRIEF" >&2; exit 2; }

# --- session cookie -----------------------------------------------------------------------------
if [ -z "${SW_COOKIE:-}" ]; then
  [ -n "${SW_EMAIL:-}" ] && [ -n "${SW_PASSWORD:-}" ] || {
    echo "fleet-agent: set SW_COOKIE, or SW_EMAIL + SW_PASSWORD" >&2; exit 2; }
  login_headers=$(mktemp)
  trap 'rm -f "$login_headers"' EXIT
  login_body=$(curl -sS -D "$login_headers" -H 'content-type: application/json' \
    --data "$(SW_EMAIL="$SW_EMAIL" SW_PASSWORD="$SW_PASSWORD" node -e \
      'process.stdout.write(JSON.stringify({email:process.env.SW_EMAIL,password:process.env.SW_PASSWORD}))')" \
    "$BASE/auth/login")
  if node -e 'process.exit(JSON.parse(process.argv[1]).mfaRequired ? 0 : 1)' "$login_body" 2>/dev/null; then
    echo "fleet-agent: this account has MFA — finish login in a browser and pass SW_COOKIE instead" >&2
    exit 2
  fi
  SW_COOKIE=$(grep -i '^set-cookie:' "$login_headers" | sed -E 's/^[Ss]et-[Cc]ookie: *([^;]+).*/\1/' | head -1)
  rm -f "$login_headers"
  [ -n "$SW_COOKIE" ] || { echo "fleet-agent: login did not return a session cookie" >&2; exit 1; }
fi

# --- mint the key -------------------------------------------------------------------------------
# `deploy` is deliberately absent: an agent building a site must not be able to configure hosting.
created=$(curl -sS -f -H 'content-type: application/json' -H "cookie: $SW_COOKIE" \
  --data "$(SW_NAME="fleet-$(basename "$BRIEF" .txt)-$$" SW_TTL="$KEY_TTL_DAYS" node -e \
    'process.stdout.write(JSON.stringify({name:process.env.SW_NAME,role:"owner",expiresInDays:Number(process.env.SW_TTL),capabilities:["content:read","content:write","content:delete","publish"]}))')" \
  "$BASE/projects/$PROJECT/api-keys")
KEY_ID=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).key.id)' "$created")
TOKEN=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).token)' "$created")

WORK=$(mktemp -d)   # the agent's cwd: a fresh dir means no CLAUDE.md and no project memory
# ★ The whole point of this script. Runs that end badly are the ones a human forgets to clean up
# after, so revocation is a trap, not a final line — it fires on success, failure, and Ctrl-C alike.
cleanup() {
  local status=$?
  curl -sS -o /dev/null -X DELETE -H "cookie: $SW_COOKIE" "$BASE/projects/$PROJECT/api-keys/$KEY_ID" \
    && echo "fleet-agent: revoked key $KEY_ID" >&2 \
    || echo "fleet-agent: WARNING could not revoke key $KEY_ID — revoke it in Settings → API Keys" >&2
  rm -rf "$WORK"
  exit "$status"
}
trap cleanup EXIT
# ★ Forward the signal to the agent, and run the agent in the BACKGROUND + `wait` so we can. A
# foreground child makes bash defer every trap until that child returns: an interactive Ctrl-C still
# works (the terminal signals the whole process group, so claude dies too), but `kill -TERM <pid>`
# from a fleet supervisor — the way these runs actually get stopped — hits only the launcher, which
# then sits blocked while the key it was supposed to revoke stays live for as long as the agent runs.
on_signal() { [ -n "${AGENT:-}" ] && kill -TERM "$AGENT" 2>/dev/null; }
trap on_signal INT TERM

# --- run ----------------------------------------------------------------------------------------
# One server named `sitewright`, so the tool namespace stays mcp__sitewright__* and token/tool counts
# compare across runs. --strict-mcp-config makes a cross-project write structurally impossible.
umask 077
SW_TOKEN="$TOKEN" node -e '
  const fs = require("fs");
  fs.writeFileSync(process.argv[1], JSON.stringify({ mcpServers: { sitewright: {
    type: "http", url: process.argv[2] + "/mcp",
    headers: { Authorization: "Bearer " + process.env.SW_TOKEN },
  } } }));
' "$WORK/mcp.json" "$BASE"
unset TOKEN

cd "$WORK"
claude -p "$(cat "$BRIEF")" \
  --model "$MODEL" \
  --mcp-config "$WORK/mcp.json" \
  --strict-mcp-config \
  --output-format json \
  "$@" &
AGENT=$!
status=0
wait "$AGENT" || status=$?
exit "$status"
