#!/usr/bin/env bash
# Starts the T3 image and checks the contract we rely on: web app on /, 401 without a session,
# OAuth metadata for /mcp, and the pinned tool versions.
set -euo pipefail
image="${1:?usage: smoke-image.sh <image>}"
name="t3-smoke-$$"
docker run -d --name "$name" -p 13773:3773 "$image" >/dev/null
trap 'docker logs "$name" | tail -40 || true; docker rm -f "$name" >/dev/null' EXIT

for _ in $(seq 1 60); do
  curl -fsS -o /dev/null http://127.0.0.1:13773/ && break
  sleep 2
done
curl -fsS -o /dev/null http://127.0.0.1:13773/ && echo "ok: GET / returns 200"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:13773/api/projects/mutate)
[ "$code" = "401" ] && echo "ok: API without a session returns 401" || { echo "expected 401, got $code"; exit 1; }
curl -fsS http://127.0.0.1:13773/.well-known/oauth-authorization-server | grep -q registration_endpoint \
  && echo "ok: MCP OAuth metadata is published"
docker exec "$name" sh -c 't3 --version && claude --version && gh --version | head -1'
