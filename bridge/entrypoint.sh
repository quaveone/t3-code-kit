#!/bin/sh
# Volumes are often mounted owned by root: give /data to the `bun` user, then drop privileges.
set -eu
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data
  find /data ! -user bun -exec chown -h bun:bun {} + 2>/dev/null || true
  exec setpriv --reuid=bun --regid=bun --init-groups "$0" "$@"
fi
exec "$@"
