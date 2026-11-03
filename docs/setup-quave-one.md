# Set up on Quave ONE

This guide sets up a T3 server on [Quave ONE](https://quave.one), then optionally the Slack and REST bridge.
It takes about 20 minutes. Everything here also works through the Quave ONE MCP tools named in brackets.

## Before you start

- A Claude Pro or Max subscription token: see [claude-subscription.md](claude-subscription.md).
- A GitHub token for the repositories the agents will work on. Prefer a machine account that is a collaborator
  with write access on only those repositories, or a fine-grained token limited to them.
- A region where your account can use persistent volumes.

## 1. Create the T3 server

### Option A: the Solutions catalog (recommended)

In the dashboard choose **New project → Solutions → T3 Code**, or call `create-solution` with `solutionSlug:
"t3-code"`. Fill in the optional **Claude Code token** and **GitHub token** inputs. The Solution creates one
environment with:

- image `ghcr.io/quaveone/t3-code:<t3-version>`, port 3773, health check `GET /`;
- a persistent volume at `/data`;
- one container, 4 CPU and 4 GB (8 zClouds).

The Quave ONE public docs describe the Solution: <https://docs.quave.one/solutions/t3-code>.

### Option B: by hand

1. Create an app with the **Custom** preset and **use image** on, port `3773`, health check path `/`
   [`create-app`].
2. Create an environment with image `ghcr.io/quaveone/t3-code:<t3-version>` and 8 zClouds [`create-app-env`].
3. Turn on a persistent volume at `/data` [`update-app-env-volume`] and size the disk, for example 30 GB
   [`update-app-env-resources`]. A local persistent volume also limits the environment to one container and turns
   off blue-green deploys, which is what T3 needs.
4. Deploy [`deploy-app-env-image` or `apply-app-env-changes`].

To build from source instead of using the published image, deploy the `image/` folder as a Dockerfile app
(`quaveone deploy` or `request-deploy-storage-key` + `notify-code-upload`).

## 2. Set the environment variables

| Variable | Secret | Value |
| --- | --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | Yes | Subscription token from `claude setup-token`. |
| `GH_TOKEN` | Yes | GitHub token. `gh` reads it; `git` uses `gh` as its credential helper. |
| `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL` | No | Identity on agent commits. |
| `MCP_SERVERS_JSON` | No | Remote MCP servers for Claude Code, see below. |
| `QUAVE_ONE_MCP_KEY` (or any name you choose) | Yes | Bearer token referenced by `MCP_SERVERS_JSON`. |

Give the agents the Quave ONE MCP:

```text
MCP_SERVERS_JSON={"quave-one":{"url":"https://mcp.quave.cloud/","bearerEnv":"QUAVE_ONE_MCP_KEY"}}
QUAVE_ONE_MCP_KEY=<an MCP key with only the scopes the agents need>
```

At every start the entrypoint runs `claude mcp add --scope user` for each entry, reading the token from the named
variable. Check it in the console with `as-t3 claude mcp list`.

Apply the changes and wait for the environment to be running. `GET /` returns 200 and any API call without a session
returns 401.

## 3. Pair your apps

Open the environment **Console** and run:

```sh
as-t3 t3 pair
```

Open the printed link, or scan the QR code, from the T3 desktop or mobile app, or open the link in a browser for the
web app. The server also prints a one-time pairing link in its log at every start; treat the logs as sensitive.

Consoles open as root. Prefix T3 and Claude commands with `as-t3` so the files they create belong to the `t3` user.

## 4. Add projects

In the T3 app choose **Add project**, or ask an agent to clone a repository with T3's own tools, or use the bridge:
`POST /v1/projects {"repository":"owner/name"}`. Repositories land in `/data/home/repos`.

## 5. Protect the data

- **Snapshots:** in **Snapshots**, set the recovery point interval to every hour and a full snapshot every 7 days
  [`update-app-env-snapshot-options`]. Run a validation on a recovery point [`validate-app-env-volume-backup`].
- **Restore drill:** restore a recovery point into a new environment [`create-app-env-from-volume-backup`]. A restored
  environment that was built from source waits for a code upload, and its first deploy can fail while the volume is
  still restoring; redeploy it once. Then open it, check your projects, and delete it.
- **Alerts:** create a contact point and alerts on memory above 85% for 5 minutes, CPU above 90% for 10 minutes and
  disk above 80% [`create-contact-point`, `create-alert`].
- **Disk:** repositories and worktrees grow the volume. Raise the disk or turn on disk autoresize
  [`update-app-env-storage-autoresize`].

## 6. Optional: the bridge (REST and Slack)

Follow [bridge.md](bridge.md). In short:

1. Create a second app from `ghcr.io/quaveone/t3-bridge:latest` (or the `bridge/` Dockerfile) on port `8787`, health
   check `/healthz`, persistent volume at `/data`, 1 zCloud.
2. Set `BRIDGE_TOKEN` (secret), `PUBLIC_URL` (the bridge's own HTTPS host) and `T3_MCP_URL`
   (`https://<t3-host>/mcp`).
3. Sign the bridge in to T3 once: `POST /v1/t3/login`, open the URL, approve with Full access.
4. Optionally add Slack.

## Verify

- `GET https://<t3-host>/` returns 200, and `POST https://<t3-host>/api/projects/mutate` without a session returns 401.
- In the console, `as-t3 claude mcp list` shows your MCP servers as connected.
- A thread started from the app or the bridge can clone, edit, run tests and push a branch.
- The Claude check in [claude-subscription.md](claude-subscription.md) reports `apiKeySource: none`.
