# T3 Code Kit

Run [T3 Code](https://github.com/pingdotgg/t3code) **unmodified** as a durable, headless coding-agent server, and
drive it from the T3 apps, from Slack and from a REST API.

- **`image/`**: a container image with a pinned T3 Code stable release, Claude Code, `git` and `gh`. It runs as a
  non-root user on a persistent `/data` volume and uses a Claude **subscription** only, never API billing.
- **`bridge/`**: an optional Bun service that turns REST calls and Slack mentions into T3 threads, through T3's own
  MCP endpoint.
- **`docs/`**: setup, operations and design.

This is not a fork. The kit never patches T3; it only uses T3's public surfaces.

## Set up a new T3 Code server on Quave ONE

This runbook is written so that a person, or an agent with the Quave ONE MCP, can follow it from top to bottom. Tool
names in brackets are Quave ONE MCP tools; the dashboard has the same actions. Two steps need the person who will use
the server; they are marked **(person)**. Do the steps in order: pairing comes last because every restart invalidates
the pairing link. Allow about 20 minutes.

### 0. Decide and collect

| Item | Default | Who |
| --- | --- | --- |
| Quave ONE account | The person's account, or a team account where only trusted people have **Secrets Access** | Agent |
| Region | From [`list-regions`] for the account: one with `volumeEnabled: true` and `canCreateEnvironment: true`. Prefer `defaultRegion` when it qualifies; otherwise the region where the account already runs apps. Step 2 tells you if a region cannot provision the volume. | Agent |
| App name | `t3-<person>`, for example `t3-filipe` | Agent |
| Claude subscription token | Created by `claude setup-token` with the person's Claude Pro or Max account | **(person)** |
| GitHub token | Write access only to the repositories the agents will work on | Person or agent |

One server serves one person: a Claude subscription belongs to one person, and the agents on the server can read
every secret on it.

**Agents: never ask for a token in chat.** The person enters secret values directly in the dashboard (step 4), or
gives them through your secret-input tool.

### 1. Create the server

**Option A, the catalog (preferred).** Call [`list-solutions`] for the account. If it lists `t3-code`, call
[`create-solution`]:

```json
{ "accountId": "<account>", "solutionSlug": "t3-code", "appName": "t3-<person>", "region": "<region>" }
```

Leave the optional inputs (`"inputs": { "claudeCodeOauthToken": "...", "githubToken": "..." }`) out when an agent
installs; the person adds the
secrets in step 4. When the **person** installs from the dashboard (**New project → Solutions → T3 Code**), they can
type both tokens in the form instead and skip step 4.

The Solution creates one environment that runs `ghcr.io/quaveone/t3-code:stable` on port 3773, with a persistent
volume at `/data`, 1 container, 8 zClouds (4 CPU, 4 GB) and image auto-deploy on. Note the returned `appEnvId`. Ignore
the catalog's post-install note about the Console: step 7 below pairs without one.

**Option B, by hand** (only when the account has no `t3-code` in the catalog):

1. [`create-app`] with `{ "name": "t3-<person>", "accountId": "<account>", "port": 3773, "dockerPreset": "CUSTOM",
   "useImage": true, "isCliDeployment": true, "healthCheckPath": "/" }`.
2. [`create-app-env`] with `{ "appId": "<app>", "accountId": "<account>", "name": "production", "region":
   "<region>", "zClouds": 8, "image": "ghcr.io/quaveone/t3-code:stable" }`.
3. [`update-app-env-volume`] with `{ "appEnvId": "<env>", "useVolume": true, "volumePath": "/data" }`.
4. [`apply-app-env-changes`], then [`update-app-env-image-auto-deploy`] with `{ "appEnvId": "<env>", "enabled": true }`.

### 2. Wait until it runs

Check [`get-app-env-status`] about every 15 seconds until `currentDeployment.status` is `DEPLOYED` (usually one or two
minutes). Without a wait tool, loop on the host instead, then confirm the status once:
`until [ "$(curl -s -o /dev/null -w '%{http_code}' https://<host>/)" = 200 ]; do sleep 15; done` (the host is in
[`get-app-env`] `hosts[0].host`). If it is still not deployed after 10 minutes, check [`get-app-env-pods`]: a pod in `Pending` with no
`nodeName` means the region cannot provision the volume. Delete the app [`delete-app`] and go back to step 1 with the
next qualifying region.

### 3. Give it disk

The volume starts at the account's default size (often 1 GB). Repositories and worktrees need more. Only once step 2
shows `DEPLOYED`, set [`update-app-env-resources`] `{ "appEnvId": "<env>", "disk": 30000, "applyImmediately": true }`
(30 GB). The disk grows without a restart.

- "can only be expanded while the environment is Running": step 2 is not finished; wait and retry.
- "maximum disk size": ask Quave ONE support to raise the account's app volume limit, then retry.

### 4. Add the secrets **(person)**

Skip this step if the person typed both tokens in the install form.

The person creates the Claude token on any computer with a browser:

```sh
claude setup-token     # sign in with the Claude account, approve, paste the code back, copy the sk-ant-oat01-... token
```

Then, in the dashboard, the person opens the environment → **Settings → Environment variables**, adds each of these
marked **secret**, and saves and applies the changes (the dashboard asks to apply; this restarts the server):

| Variable | Value |
| --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | The token from `claude setup-token` |
| `GH_TOKEN` | The GitHub token |

Optional, not secret: `GIT_AUTHOR_NAME` and `GIT_AUTHOR_EMAIL` for the agents' commits.

Optional, to give the agents the Quave ONE MCP: create an MCP key with only the scopes the agents need
[`create-mcp-key`], add it as the secret `QUAVE_ONE_MCP_KEY`, and add (not secret):

```text
MCP_SERVERS_JSON={"quave-one":{"url":"https://mcp.quave.cloud/","bearerEnv":"QUAVE_ONE_MCP_KEY"}}
```

**Agent:** this step is a gate. Wait until the person says the secrets are saved, then confirm with
[`list-app-env-variables`] that `CLAUDE_CODE_OAUTH_TOKEN` and `GH_TOKEN` exist (values stay masked).

- Missing: tell the person which variable is missing and how to add it (above), and wait. Do steps 5 and 6 meanwhile,
  but not step 7.
- Present: if [`get-app-env`] still shows `pendingChanges.hasDeployChanges: true`, call [`apply-app-env-changes`].
  Then repeat step 2, because saving the secrets restarted the server.

### 5. Check it is up

Find the host with [`get-app-env`] (`hosts[0].host`):

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/                           # 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<host>/api/projects/mutate  # 401 (no session)
```

### 6. Protect it

1. Snapshots: [`update-app-env-snapshot-options`] `{ "appEnvId": "<env>", "snapshotFrequency": "EVERY_HOUR",
   "fullSnapshotPeriod": "EVERY_7_DAYS" }`.
2. Contact point for the person: [`create-contact-point`] `{ "accountId": "<account>", "name": "<person> email",
   "type": "email", "config": { "addresses": ["<person's email>"] } }`.
3. Alerts, each with [`create-alert`], `appEnvId` set and `contactPointNames: ["<person> email"]`:

   | `name` | `metric` | `operator` | `threshold` | `duration` |
   | --- | --- | --- | --- | --- |
   | `T3 high memory` | `memory_percent` | `gt` | 85 | `5m` |
   | `T3 high CPU` | `cpu_percent` | `gt` | 90 | `10m` |
   | `T3 disk usage` | `disk_usage_percent` | `gt` | 80 | `10m` |

   Leave `aggregation` and `queryRange` at their defaults.

### 7. Pair the person's apps **(person)**

Do this last, only after step 4 is confirmed: saving secrets restarts the server, and a restart invalidates the link
below. Pairing needs a one-time code, which the server prints in its log every time it starts:

1. [`get-logs`] with `{ "appEnvId": "<env>", "type": "WEB_APP", "search": "Pairing URL" }`. Take the newest line, which
   looks like `Pairing URL: http://10.x.x.x:3773/pair#token=<code>`. Its time must be later than the `startedAt` of the
   running pod in [`get-app-env-pods`]; otherwise it belongs to an earlier start and no longer works.
2. Replace the internal address with the public host: `https://<host>/pair#token=<code>`.
3. Send the link to the person privately. They open it in a browser (this pairs the T3 web app), or paste it into the
   T3 desktop or mobile app. The page then shows **Welcome** with **Add project**.

Each link works once. For another device, either open the environment **Console** and run `as-t3 t3 pair`, or
redeploy [`redeploy-app-env`] and take the new link from the log. Paired devices can also invite others from
**Settings → Sharing & access** in the T3 app.

### 8. Hand it over

Send the person:

- the host `https://<host>`;
- that updates are automatic: the server follows `:stable` and restarts for about a minute when a new release
  arrives;
- that work happens in **projects**: in the T3 app, **Add project** and clone a repository.

### Verify the setup

- [ ] `GET https://<host>/` returns 200 and the API returns 401 without a session.
- [ ] [`get-app-env`] shows `useVolume: true`, `volumePath: "/data"`, `containers: 1`, `disk: 30000` and
      `imageAutoDeploy.enabled: true`.
- [ ] [`list-app-env-variables`] lists `CLAUDE_CODE_OAUTH_TOKEN` and `GH_TOKEN` (values masked).
- [ ] The person is paired, and a first thread on a project answers.
- [ ] Snapshots and the three alerts are configured.

### If something goes wrong

| Symptom | Fix |
| --- | --- |
| `list-solutions` has no `t3-code` | Use Option B. The catalog entry may not be released to that installation yet. |
| Pod stays `Pending` with no node | The region could not provision the volume. Delete the app and use another region (step 2). |
| Disk change refused | See step 3. |
| A thread says `Not logged in · Please run /login` | `CLAUDE_CODE_OAUTH_TOKEN` is missing, wrong or expired. The person creates a new one (step 4). |
| Agents cannot push | `GH_TOKEN` lacks write access to that repository. |
| The pairing link says it is invalid | It was already used, or the server restarted after you took it. Take the newest `Pairing URL` from the log. |
| Memory alert fires | Too many threads at once: about 300 MB each, 6 to 8 at a time on 4 GB. Add a second server. |
| [`get-app-env`] shows `blueGreenDeploy: true` | Harmless on this setup: an environment with a local volume never runs a blue-green deploy. |

For Slack and a REST API on top of the server, add the [bridge](docs/bridge.md).

## Run with Docker

```sh
docker run -d --name t3 -p 127.0.0.1:3773:3773 -v t3data:/data \
  -e CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`> \
  -e GH_TOKEN=<github token> \
  ghcr.io/quaveone/t3-code:stable
docker exec t3 as-t3 t3 pair   # open the link or scan the QR code from the T3 app
```

More in [docs/setup-docker.md](docs/setup-docker.md).

## Documentation

| Guide | Read it for |
| --- | --- |
| [Set up on Quave ONE](docs/setup-quave-one.md) | Building from source, the restore drill, secrets handling for agents |
| [Run with Docker](docs/setup-docker.md) | Any Linux host with Docker |
| [Claude on a subscription](docs/claude-subscription.md) | Creating, checking and rotating the subscription token |
| [The bridge: REST and Slack](docs/bridge.md) | Configuration, OAuth sign-in, REST API reference, Slack app setup |
| [Releases and automatic updates](docs/releases.md) | Tags, the automatic release chain, auto-deploy, rollback |
| [Operations](docs/operations.md) | Capacity numbers, monitoring, backups, upgrades, rotation, troubleshooting |
| [Architecture](docs/architecture.md) | How the pieces fit and why |
| [Upstream sync and fork rules](docs/upstream-sync.md) | Following T3 releases without carrying T3 code |
| [Security](docs/security.md) | What protects the server and what the agents can reach |

## Images and updates

| Image | Built from |
| --- | --- |
| `ghcr.io/quaveone/t3-code:stable` (recommended), `:<t3-version>`, `:<t3-version>-<kit-revision>`, `:latest` | `image/` |
| `ghcr.io/quaveone/t3-bridge:stable` (recommended), `:<kit-revision>`, `:latest` | `bridge/` |

Releases are automatic. Every 4 hours a workflow picks up new T3 Code and Claude Code stable releases, tests them,
and publishes them; every push to `main` is tested and published too. `:stable` moves only after the smoke test and
the bridge contract test pass, and only when the image content changed. Servers with image auto-deploy on `:stable`
stay current on their own. See [Releases and automatic updates](docs/releases.md).

## Development

```sh
cd bridge && bun install && bun run typecheck && bun test
docker build -t t3-code:dev image && scripts/smoke-image.sh t3-code:dev
scripts/bridge-contract-test.sh t3-code:dev   # real T3 + real bridge, no Claude token needed
```

## License

MIT. T3 Code is a separate project under its own MIT license.
