# The bridge: REST and Slack

The bridge (`bridge/`) is an optional Bun + TypeScript service that lets programs and Slack start and continue T3
threads. It has no framework and no model of its own: it is an MCP client of T3.

## Deploy

| Setting | Value |
| --- | --- |
| Image | `ghcr.io/quaveone/t3-bridge:latest`, or build `bridge/Dockerfile` |
| Port | `8787` |
| Health check | `GET /healthz` |
| Volume | Persistent, at `/data` (holds `bridge.sqlite`) |
| Containers | 1 |
| Size | 0.5 CPU and 512 MB is enough |

The entrypoint gives `/data` to the `bun` user and then drops privileges, so a root-owned volume works.

## Configuration

| Variable | Required | Meaning |
| --- | --- | --- |
| `BRIDGE_TOKEN` | Yes | Bearer token for every `/v1` route. At least 32 characters: `openssl rand -hex 24`. Secret. |
| `PUBLIC_URL` | Yes | The bridge's own HTTPS address, without a trailing slash. The OAuth callback is `<PUBLIC_URL>/oauth/callback`. |
| `T3_MCP_URL` | Yes | `https://<t3-host>/mcp`. T3 finishes an OAuth sign-in only over HTTPS or `localhost`. |
| `STATE_PATH` | No | Default `/data/bridge.sqlite`. |
| `DEFAULT_PROJECT` | No | T3 project id or title used when a request names none. |
| `DEFAULT_BASE_REF` | No | Base branch for new worktrees. Default `main`. |
| `T3_MODEL` | No | Default `claude-opus-5-5`. |
| `T3_MODEL_EFFORT` | No | Default `medium`. |
| `T3_PROVIDER_INSTANCE` | No | Default `claudeAgent`. |
| `T3_RUNTIME_MODE` | No | `full-access` (default), `auto`, `auto-accept-edits` or `approval-required`. It can never exceed the mode approved at sign-in. Threads run unattended, so anything below `auto` can stop and wait for an approval in the T3 app. |
| `T3_REPOS_ROOT` | No | Where `POST /v1/projects` clones repositories. Default `/data/home/repos`. |
| `WAIT_TIMEOUT_MS` | No | How long Slack waits for an answer. Default 2 hours. |
| `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_ALLOWED_USERS` | All or none | Turn Slack on. `SLACK_ALLOWED_USERS` is a comma-separated list of Slack user ids. |

## Sign the bridge in to T3

T3 approves outside agents with OAuth. A grant lasts **30 days** and cannot be refreshed.

```sh
curl -X POST -H "Authorization: Bearer $BRIDGE_TOKEN" https://<bridge-host>/v1/t3/login
# -> {"authorizationUrl":"https://<t3-host>/oauth/mcp/authorize?..."}
```

1. Open `authorizationUrl` in a browser.
2. Choose **Full access** (or a lower mode).
3. Enter a pairing code from `as-t3 t3 auth pairing create --ttl 5m` in the T3 console. A browser that is already
   paired with the server can approve without a code.
4. Approve. T3 redirects to `<PUBLIC_URL>/oauth/callback`, which stores the grant.

Check it:

```sh
curl -H "Authorization: Bearer $BRIDGE_TOKEN" https://<bridge-host>/v1/t3/status
# -> {"signedIn":true,"at":"...","expiresAt":"..."}
```

Repeat the sign-in before `expiresAt`. A redeploy of T3 or of the bridge keeps the grant.

## REST API

Every `/v1` route needs `Authorization: Bearer <BRIDGE_TOKEN>`. Errors return JSON `{ "error": "..." }` with 400
(bad input), 401 (bad token), 503 (bridge not signed in to T3) or 500.

| Route | Body | Returns |
| --- | --- | --- |
| `GET /v1/projects` | | `{projects: [...]}` |
| `POST /v1/projects` | `{repository: "owner/name", title?}` | `201` with the project. Clones from GitHub with the server's `GH_TOKEN` and registers it. Returns the existing project if the title is taken. |
| `POST /v1/tasks` | `{message, project?, title?, baseRef?, clientRequestId?}` | `202 {taskId, projectId}`. Starts a thread in a new worktree from `baseRef` (default `DEFAULT_BASE_REF`); `baseRef: null` uses the project checkout. A repeated `clientRequestId` returns the same thread. |
| `GET /v1/tasks/:id` | | `{thread, items}`: thread status and the newest messages. |
| `POST /v1/tasks/:id/messages` | `{message}` | `202`. Sends a follow-up to the same thread; a busy thread gets it as its next turn. |
| `POST /v1/tasks/:id/wait` | | `{status, reply, link}` once the current run ends. |
| `POST /v1/t3/login` | | `{authorizationUrl}` |
| `GET /v1/t3/status` | | `{signedIn, at, expiresAt}` |
| `GET /healthz` | | `{ok: true}`, no auth |

Example:

```sh
B=https://<bridge-host>; H="Authorization: Bearer $BRIDGE_TOKEN"
curl -s -X POST $B/v1/projects -H "$H" -d '{"repository":"acme/web"}'
id=$(curl -s -X POST $B/v1/tasks -H "$H" \
  -d '{"project":"web","message":"Find why the login test is flaky, fix it, push branch fix/flaky-login"}' | jq -r .taskId)
curl -s -X POST "$B/v1/tasks/$(jq -rn --arg i "$id" '$i|@uri')/wait" -H "$H" | jq .
```

Task ids contain `:`; URL-encode them in paths.

## Slack

Usage in a channel the bot is in:

```text
@T3 [my-service] the nightly sync stopped creating events, find out why
```

`[project]` is optional when `DEFAULT_PROJECT` is set. The bridge answers in the Slack thread with the T3 thread
id, then posts the final answer with a link. Any later reply in that Slack thread goes to the same T3 thread. Only
users in `SLACK_ALLOWED_USERS` are served; others get a short refusal.

### Create the Slack app

1. At <https://api.slack.com/apps>, under **Your App Configuration Tokens**, generate a configuration token for your
   workspace. It lasts 12 hours.
2. Create the app from `bridge/slack-manifest.json` with the request URL host replaced, but **remove
   `event_subscriptions`** for now, because Slack verifies the URL and the bridge cannot answer yet:

   ```sh
   curl -s -X POST https://slack.com/api/apps.manifest.create \
     -H "Authorization: Bearer $SLACK_CONFIG_TOKEN" --data-urlencode "manifest@manifest.json"
   ```

   The response contains `app_id` and `credentials` (`client_id`, `client_secret`, `signing_secret`). Store them in
   your secret store.
3. Install it: open
   `https://slack.com/oauth/v2/authorize?client_id=<client_id>&scope=app_mentions:read,chat:write,channels:history,groups:history,channels:join&redirect_uri=<PUBLIC_URL>/slack/oauth`,
   click **Allow**, take the `code` from the redirect URL (the bridge shows 404 there, which is expected), and
   exchange it:

   ```sh
   curl -s https://slack.com/api/oauth.v2.access -d client_id=... -d client_secret=... \
     -d code=... -d redirect_uri=<PUBLIC_URL>/slack/oauth   # -> access_token (xoxb-...)
   ```

4. Set `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` and `SLACK_ALLOWED_USERS` on the bridge and redeploy. `POST
   /slack/events` without a signature now returns 401.
5. Add `event_subscriptions` back with `apps.manifest.update` (`app_id` plus the full manifest). Slack verifies the
   URL against the running bridge.
6. Invite the bot to a channel, or let it join a public channel:
   `curl -s https://slack.com/api/conversations.join -H "Authorization: Bearer $SLACK_BOT_TOKEN" -d channel=<id>`.

You can also do steps 2 to 5 in the Slack app UI.

Notes:

- Messages that a person sends through another Slack app (for example "Sent using Claude") carry a `bot_id` and a
  mention footer. The bridge still treats them as that person's message and ignores only its own posts.
- A mention also arrives as a plain `message` event; the bridge acts on it once.
- Slack retries deliveries; the bridge drops repeated event ids.

## Run it locally

```sh
cd bridge && bun install
BRIDGE_TOKEN=$(openssl rand -hex 24) PUBLIC_URL=http://127.0.0.1:8787 \
T3_MCP_URL=http://127.0.0.1:3773/mcp STATE_PATH=./bridge.sqlite bun run src/main.ts
```

Reach a remote T3 on `localhost` through an SSH tunnel (`ssh -L 3773:127.0.0.1:3773 <host>`) so the OAuth sign-in
is allowed over plain HTTP.

## Tests

```sh
bun run typecheck && bun test
```

`src/slack.flow.test.ts` runs the whole Slack flow against a fake Slack API.
