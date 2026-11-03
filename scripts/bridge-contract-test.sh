#!/usr/bin/env bash
# Proves the bridge still works against a T3 image, with no Claude token and no browser:
#   T3 image starts -> a project exists -> the bridge signs in through T3's MCP OAuth (approved with a pairing
#   code) -> lists projects -> launches a thread -> waits -> reads the reply.
# Without a Claude token the run fails with "Not logged in", which is the expected, fully readable outcome.
# Usage: scripts/bridge-contract-test.sh <t3-image>   (needs docker, bun, curl, jq; run from the repo root)
set -euo pipefail
image="${1:?usage: bridge-contract-test.sh <t3-image>}"
t3_port=13774
bridge_port=18787
name="t3-contract-$$"
work="$(mktemp -d)"
bridge_pid=""

cleanup() {
  [ -n "$bridge_pid" ] && kill "$bridge_pid" 2>/dev/null || true
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; [ -f "$work/bridge.log" ] && tail -20 "$work/bridge.log" >&2; docker logs "$name" 2>&1 | tail -20 >&2; exit 1; }

docker run -d --name "$name" -p "127.0.0.1:${t3_port}:3773" "$image" >/dev/null
for _ in $(seq 1 60); do curl -fsS -o /dev/null "http://127.0.0.1:${t3_port}/" 2>/dev/null && break; sleep 2; done
curl -fsS -o /dev/null "http://127.0.0.1:${t3_port}/" || fail "T3 did not start"

docker exec "$name" as-t3 sh -c 'mkdir -p "$HOME/repos/contract" && cd "$HOME/repos/contract" &&
  git init -q && git -c user.name=ci -c user.email=ci@example.com commit -q --allow-empty -m init &&
  t3 project add "$HOME/repos/contract" --title contract >/dev/null'
code=$(docker exec "$name" as-t3 t3 auth pairing create --ttl 5m --json | jq -r .credential)
[ -n "$code" ] && [ "$code" != null ] || fail "no pairing code"

token=$(openssl rand -hex 24)
(cd bridge && BRIDGE_TOKEN="$token" PORT="$bridge_port" PUBLIC_URL="http://127.0.0.1:${bridge_port}" \
  T3_MCP_URL="http://127.0.0.1:${t3_port}/mcp" STATE_PATH="$work/bridge.sqlite" \
  bun run src/main.ts >"$work/bridge.log" 2>&1) &
bridge_pid=$!
B="http://127.0.0.1:${bridge_port}"; H="Authorization: Bearer $token"
for _ in $(seq 1 30); do curl -fsS -o /dev/null "$B/healthz" 2>/dev/null && break; sleep 1; done

# OAuth: the bridge starts the sign-in, the test approves it like the T3 page does, the bridge stores the grant.
auth_url=$(curl -fsS -X POST "$B/v1/t3/login" -H "$H" | jq -r .authorizationUrl)
authorization=$(python3 -c 'import json,sys,urllib.parse as u; print(json.dumps(dict(u.parse_qsl(u.urlsplit(sys.argv[1]).query))))' "$auth_url")
redirect=$(curl -fsS -X POST "http://127.0.0.1:${t3_port}/oauth/mcp/decision" -H 'Content-Type: application/json' \
  -d "{\"authorization\":${authorization},\"decision\":{\"_tag\":\"pairing-code\",\"access\":\"full-access\",\"code\":\"${code}\"}}" \
  | jq -r .redirectTo)
case "$redirect" in "$B/oauth/callback"*) ;; *) fail "unexpected approval redirect: $redirect" ;; esac
curl -fsS -o /dev/null "$redirect" || fail "OAuth callback failed"
[ "$(curl -fsS "$B/v1/t3/status" -H "$H" | jq -r .signedIn)" = true ] || fail "bridge not signed in"
echo "ok: bridge signed in through T3 MCP OAuth"

curl -fsS "$B/v1/projects" -H "$H" | jq -e '.projects[] | select(.title=="contract")' >/dev/null || fail "project not listed"
echo "ok: t3_project_list"

task=$(curl -fsS -X POST "$B/v1/tasks" -H "$H" -d '{"project":"contract","message":"Reply with PONG.","baseRef":null}' | jq -r .taskId)
[ -n "$task" ] && [ "$task" != null ] || fail "no task id"
enc=$(jq -rn --arg t "$task" '$t|@uri')
echo "ok: t3_thread_launch ($task)"

result=$(curl -fsS -m 300 -X POST "$B/v1/tasks/$enc/wait" -H "$H")
status=$(echo "$result" | jq -r .status)
case "$status" in completed|failed) ;; *) fail "unexpected wait status: $status" ;; esac
echo "ok: t3_thread_wait ($status)"

read=$(curl -fsS "$B/v1/tasks/$enc" -H "$H")
echo "$read" | jq -e '.thread.threadId and ([.items[].type] | index("user_message"))' >/dev/null || fail "thread read shape changed"
echo "$read" | jq -e '[.items[].type] | index("assistant_message")' >/dev/null || fail "no assistant message in thread read"
echo "ok: t3_thread_read (reply: $(echo "$result" | jq -r .reply | head -c 80))"
echo "bridge contract: pass"
