# Run with Docker

Use this on any Linux host with Docker: a lab box, a VM, or a laptop for testing.

## T3 server

```sh
docker volume create t3data

cat > t3.env <<'EOF'
CLAUDE_CODE_OAUTH_TOKEN=<subscription token>
GH_TOKEN=<github token>
GIT_AUTHOR_NAME=T3 Agent
GIT_AUTHOR_EMAIL=agent@example.com
MCP_SERVERS_JSON={"quave-one":{"url":"https://mcp.quave.cloud/","bearerEnv":"QUAVE_ONE_MCP_KEY"}}
QUAVE_ONE_MCP_KEY=<mcp key>
EOF
chmod 600 t3.env

docker run -d --name t3 --restart unless-stopped \
  -p 127.0.0.1:3773:3773 -v t3data:/data --env-file t3.env \
  ghcr.io/quaveone/t3-code:latest
```

- Publish the port on `127.0.0.1` and reach it through an SSH tunnel or a private network such as Tailscale. Put a
  TLS proxy in front of it before exposing it publicly.
- Pair: `docker exec t3 as-t3 t3 pair`.
- Logs: `docker logs t3`. The start log prints a one-time pairing link.
- Build from source instead: `docker build -t t3-code:dev image`, then use `t3-code:dev`.

## Bridge

```sh
docker run -d --name t3-bridge --restart unless-stopped \
  -p 127.0.0.1:8787:8787 -v t3bridge:/data \
  -e BRIDGE_TOKEN=$(openssl rand -hex 24) \
  -e PUBLIC_URL=https://bridge.example.com \
  -e T3_MCP_URL=https://t3.example.com/mcp \
  ghcr.io/quaveone/t3-bridge:latest
```

Both URLs must be HTTPS (or `localhost`) for the OAuth sign-in. See [bridge.md](bridge.md).

## Smoke test

```sh
scripts/smoke-image.sh ghcr.io/quaveone/t3-code:latest
```

It starts the image on port 13773 and checks `/`, the 401 without a session, the MCP OAuth metadata and the tool
versions.
