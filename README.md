# T3 Code Kit

Run [T3 Code](https://github.com/pingdotgg/t3code) **as it is** on a container platform, and talk to it from
Slack and a REST API.

- `image/`: a container image that installs a pinned, unmodified T3 Code stable release, plus Claude Code,
  `git` and `gh`.
- `bridge/`: a small service that turns Slack mentions and REST calls into T3 threads.
- `scripts/`: the image smoke test.

This repository is **not a fork** of T3 Code. It never patches T3. It only uses T3's public surfaces:

- the `t3` CLI;
- the MCP endpoint `/mcp`;
- signed webhooks;
- per-repo `t3.json`.

> This repository starts private and is meant to become public. Keep it free of secrets, customer or business
> details, and internal platform details (hostnames, account ids, internal endpoints). Configuration examples
> use placeholders.

## How it fits together

```text
 Slack ──Events API──┐
                     ├──> bridge (REST + Slack) ──MCP over HTTPS (OAuth)──> T3 server ──> Claude Code
 REST clients ───────┘                                                       │   (one container,
 T3 desktop / web / mobile apps ──────── pairing ────────────────────────────┘    persistent /data)
```

- **One T3 server = one container.** T3 keeps its state in SQLite under `/data/t3`. SQLite allows one writer,
  so the server runs as one container on a persistent single-writer disk. Never put it on NFS or object
  storage, and never run two replicas or a blue-green deploy against the same disk.
- **Scale by adding servers, not replicas.** When one container is not enough, run another T3 server, for
  example one per person or per repository. Each has its own disk. The T3 apps connect to many servers at once.
- **Shared storage is not used for T3 state.** It can still hold read-only shared files (team skills, docs)
  mounted next to `/data`, but this is optional.

## The image

`image/Dockerfile` installs:

| Component | Version policy |
| --- | --- |
| T3 Code | `ARG T3_VERSION`. An official self-contained Linux build, checked against the release `SHA256SUMS`. |
| Claude Code | `ARG CLAUDE_CODE_VERSION`. The official native installer. Auto-update is off. |
| `git`, `gh`, `sqlite3`, `jq` | From Debian and GitHub's apt repositories. |
| Chrome runtime libraries | For T3's built-in browser. Chrome downloads into `/data` on first use. |

The entrypoint starts as root only to give `/data` to the `t3` user (platforms often mount volumes owned by root), then runs T3 as the non-root user `t3`. In a console that opens as root, prefix commands with `as-t3`, for example `as-t3 t3 pair`. `HOME=/data/home` and `T3CODE_HOME=/data/t3` both live on the
persistent volume, so threads, projects, pairings, Claude's own settings and cloned repositories survive
redeploys. The command is `t3 serve --host 0.0.0.0 --port 3773 --base-dir /data/t3`.

### Environment variables

| Variable | Required | Meaning |
| --- | --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | Yes, for Claude | Long-lived token from `claude setup-token` (Claude Pro or Max). Personal: one token serves one person. Store it as a secret. The entrypoint removes `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`, so agents never fall back to per-token API billing. |
| `GH_TOKEN` | For GitHub work | A token limited to the repositories the agents work on. `gh` uses it, and `git` uses `gh` as its credential helper. |
| `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL` | No | Commit identity for agent commits. |
| `MCP_SERVERS_JSON` | No | Remote MCP servers to add to Claude Code at start: `{"name":{"url":"https://…","bearerEnv":"ENV_WITH_TOKEN"}}`. The token is read from the named env var and written only to Claude's user config on the volume. |
| `T3_PORT` | No | Default `3773`. |

### First run

1. Deploy the image with a persistent volume at `/data` (30 GB is a good start), one container, health check
   `GET /` on port 3773.
2. Open a shell in the container and run `as-t3 t3 pair`. Open the pairing link, or scan the QR code, from the T3
   desktop or mobile app. The server log also prints a one-time pairing link at start, so treat logs as
   sensitive.
3. Add projects from the app, or ask an agent to clone with T3's own tools.

Requests without a session get `401`. Only paired clients and approved MCP clients get in.

## The bridge

`bridge/` is a Bun + TypeScript service with no framework and no model of its own. It is an **MCP client of
T3**. It signs in to T3's `/mcp` endpoint with OAuth, like any outside agent, and calls T3's public tools:
`t3_project_list`, `t3_thread_launch`, `t3_thread_send`, `t3_thread_wait` and `t3_thread_read`.

### REST API

Every `/v1` route needs `Authorization: Bearer <BRIDGE_TOKEN>`.

| Route | What it does |
| --- | --- |
| `GET /v1/projects` | Lists T3 projects. |
| `POST /v1/projects` `{repository, title?}` | Clones `owner/name` from GitHub into the T3 server (`T3_REPOS_ROOT`, default `/data/home/repos`) and registers it as a project. Returns the existing project when the title is taken. |
| `POST /v1/tasks` `{project?, message, title?, baseRef?, clientRequestId?}` | Starts a T3 thread and returns `202 {taskId, projectId}`. `project` is a T3 project id or title (default `DEFAULT_PROJECT`). The thread runs in a new worktree from `baseRef` (default `DEFAULT_BASE_REF`, `main`); `baseRef: null` uses the project checkout. Retrying with the same `clientRequestId` does not start a second thread. |
| `GET /v1/tasks/:id` | Reads the latest messages of the thread. |
| `POST /v1/tasks/:id/messages` `{message}` | Sends a follow-up message to the same thread. |
| `POST /v1/tasks/:id/wait` | Waits for the current run to finish and returns `{status, reply, link}`. |
| `POST /v1/t3/login` | Starts the T3 sign-in and returns the URL to approve. |
| `GET /v1/t3/status` | Shows whether the bridge is signed in to T3 and when the grant expires. |
| `GET /healthz` | Liveness, no auth. |

### Slack

Mention the bot in a channel it was invited to:

```text
@T3 [palmeiras-calendar-sync] the sync stopped creating events, find out why
```

`[project]` is optional when `DEFAULT_PROJECT` is set. The bridge starts a T3 thread, answers in the Slack thread
when the agent finishes, and sends every later reply in that Slack thread to the same T3 thread. Only Slack user
ids in `SLACK_ALLOWED_USERS` are served.

Create the Slack app from `bridge/slack-manifest.json` (replace the host), install it, invite it to the
channel, and set the three `SLACK_*` variables.

### Bridge environment variables

| Variable | Required | Meaning |
| --- | --- | --- |
| `BRIDGE_TOKEN` | Yes | Bearer token for `/v1`, 32 characters or more. |
| `PUBLIC_URL` | Yes | The bridge's own HTTPS address. The OAuth callback is `<PUBLIC_URL>/oauth/callback`. |
| `T3_MCP_URL` | Yes | `https://<t3-server>/mcp`. T3 only finishes an OAuth sign-in over HTTPS or `localhost`. |
| `STATE_PATH` | No | SQLite file for the OAuth grant and Slack thread links. Default `/data/bridge.sqlite`, on a persistent volume. |
| `DEFAULT_PROJECT` | No | T3 project id or title used when a request names none. |
| `DEFAULT_BASE_REF` | No | Base for new worktrees, default `main`. |
| `T3_MODEL`, `T3_MODEL_EFFORT`, `T3_PROVIDER_INSTANCE` | No | Model for new threads and for projects the bridge creates. Default `claude-opus-5-5` with effort `medium` on `claudeAgent`. |
| `T3_RUNTIME_MODE` | No | `full-access` (default), `auto`, `auto-accept-edits` or `approval-required`. It can never exceed the mode approved at sign-in. |
| `WAIT_TIMEOUT_MS` | No | How long Slack waits for an answer, default 2 hours. |
| `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_ALLOWED_USERS` | All or none | Turns Slack on. Users are Slack user ids, comma separated. |

### Signing the bridge in to T3

T3 approves outside agents with a pairing code, and a grant lasts **30 days**; T3 offers no refresh grant.

1. `curl -X POST -H "Authorization: Bearer $BRIDGE_TOKEN" https://<bridge>/v1/t3/login`, then open the returned
   URL.
2. On the T3 page, choose **Full access** (or a lower mode) and enter a pairing code from `as-t3 t3 auth pairing create`
   in the T3 container, or from **Settings → Sharing & access** in the T3 app.
3. Approve. T3 redirects to `<PUBLIC_URL>/oauth/callback` and the bridge stores the grant.

`GET /v1/t3/status` shows `expiresAt`. Repeat the sign-in before it expires. Set an alert on it.

## Upstream sync rules

T3 Code moves very fast: well over a hundred commits a day on `main`. We do not follow `main`.

1. **Stable releases only.** `.github/workflows/t3-release-bump.yml` runs daily. When a new stable release
   appears, it bumps `ARG T3_VERSION`, builds the image, runs `scripts/smoke-image.sh`, and opens a PR.
2. **Pinned images.** CI publishes `ghcr.io/quaveone/t3-code:<t3-version>-<kit-revision>`. Environments move to a
   new tag on purpose, after the smoke test. Image auto-deploy stays off.
3. **The bridge depends only on T3's public MCP tools.** The smoke test checks the MCP OAuth metadata. When a
   bump changes a tool, fix the bridge in the same PR.

## If T3 itself must change

Last resort, in this order:

1. Open an issue or PR upstream.
2. Meanwhile, try every extension point:
   - MCP;
   - webhooks;
   - the `t3` CLI;
   - `t3.json`;
   - provider env vars;
   - a "Local ACP command" provider.
3. Only if the change still blocks us, create the fork `quaveone/t3code`:
   - Branch `quave/<t3-version>` = the stable tag plus at most 3 small patches. Each patch links its upstream PR.
   - CI re-applies the patches on each new stable tag.
   - The image builds from the fork only while a patch exists.
   - Each patch is dropped when upstream merges it.

New behaviour goes in this repository, outside T3, behind T3's public surfaces. A new endpoint belongs in the
bridge, not in T3.

## Rollout plan

The plan is tracked in the Quave ONE issue for the T3 Code Solution. In short:

1. **Run T3 as it is** in one container with a persistent volume. Pair the apps. Have a thread fix a real repository
   and push a branch. Confirm that state survives a redeploy, that a long session streams, and that requests
   without a session get `401`.
2. **Protect the data:**
   - hourly volume snapshots;
   - a restore of a snapshot into a new environment, with the threads intact;
   - snapshot validation;
   - alerts on memory, CPU and restarts.
3. **Measure one container:** run 1, 2, 4 and 8 parallel threads, record CPU, memory and failures, and write
   down the safe number of parallel threads per size.
4. **Bridge:** REST and Slack, as above.
5. **Catalog:** publish the image and offer it as a one-click install.

## Development

```sh
cd bridge
bun install
bun run typecheck
bun test
```

Local run against a T3 server reachable on `localhost` (for example through an SSH tunnel):

```sh
BRIDGE_TOKEN=$(openssl rand -hex 24) PUBLIC_URL=http://127.0.0.1:8787 \
T3_MCP_URL=http://127.0.0.1:3773/mcp STATE_PATH=./bridge.sqlite bun run src/main.ts
```

Image:

```sh
docker build -t t3-code:dev image
scripts/smoke-image.sh t3-code:dev
```

## License

MIT. T3 Code is a separate project under its own MIT license.
