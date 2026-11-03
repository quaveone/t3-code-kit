# T3 Code Kit

Run [T3 Code](https://github.com/pingdotgg/t3code) **unmodified** as a durable, headless coding-agent server, and
drive it from the T3 apps, from Slack and from a REST API.

- **`image/`**: a container image with a pinned T3 Code stable release, Claude Code, `git` and `gh`. It runs as a
  non-root user on a persistent `/data` volume and uses a Claude **subscription** only, never API billing.
- **`bridge/`**: an optional Bun service that turns REST calls and Slack mentions into T3 threads, through T3's own
  MCP endpoint.
- **`docs/`**: setup, operations and design.

This is not a fork. The kit never patches T3; it only uses T3's public surfaces.

## Quick start

On [Quave ONE](https://quave.one), install the **T3 Code** Solution from the catalog. Anywhere else with Docker:

```sh
docker run -d --name t3 -p 127.0.0.1:3773:3773 -v t3data:/data \
  -e CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`> \
  -e GH_TOKEN=<github token> \
  ghcr.io/quaveone/t3-code:latest
docker exec t3 as-t3 t3 pair   # open the link or scan the QR code from the T3 app
```

## Documentation

| Guide | Read it for |
| --- | --- |
| [Set up on Quave ONE](docs/setup-quave-one.md) | The full setup: server, variables, pairing, projects, snapshots, alerts, bridge |
| [Run with Docker](docs/setup-docker.md) | Any Linux host with Docker |
| [Claude on a subscription](docs/claude-subscription.md) | Creating, checking and rotating the subscription token |
| [The bridge: REST and Slack](docs/bridge.md) | Configuration, OAuth sign-in, REST API reference, Slack app setup |
| [Operations](docs/operations.md) | Capacity numbers, monitoring, backups, upgrades, rotation, troubleshooting |
| [Architecture](docs/architecture.md) | How the pieces fit and why |
| [Upstream sync and fork rules](docs/upstream-sync.md) | Following T3 releases without carrying T3 code |
| [Security](docs/security.md) | What protects the server and what the agents can reach |

## Images

| Image | Built from |
| --- | --- |
| `ghcr.io/quaveone/t3-code:<t3-version>-<kit-revision>`, `:<t3-version>`, `:latest` | `image/` |
| `ghcr.io/quaveone/t3-bridge:<kit-revision>`, `:latest` | `bridge/` |

CI builds both on every push to `main`, smoke-tests the T3 image, and publishes them. A daily workflow opens a PR for
each new T3 stable release.

## Development

```sh
cd bridge && bun install && bun run typecheck && bun test
docker build -t t3-code:dev image && scripts/smoke-image.sh t3-code:dev
```

## License

MIT. T3 Code is a separate project under its own MIT license.
