# Releases and automatic updates

Everything from an upstream release to a running server happens without a human step. This page explains the
chain, the tags, what protects it, and how to roll back.

## The chain

```text
 T3 Code stable release            Claude Code `stable` channel
 (github.com/pingdotgg/t3code)      (npm dist-tag)
            │                               │
            └──────────────┬────────────────┘
                           ▼
   Upstream stable bump workflow (every 4 hours, and on demand)
     update image/Dockerfile → build → smoke test → bridge contract test
     pass: commit to main and dispatch CI        fail: open an issue, publish nothing
                           ▼
   CI on main (also runs on every other push to main)
     bridge tests → build → smoke test → bridge contract test
     → publish images → move :stable if the content changed → GitHub release for a new T3 version
                           ▼
   Servers with image auto-deploy on :stable redeploy within minutes, on the same /data volume
```

The scheduled watchdog (see [Watchdog](#watchdog)) checks the chain from outside and repairs it if a step did not run.

## Image tags

| Tag | Moves when | Use it for |
| --- | --- | --- |
| `t3-code:<t3-version>-<kit-revision>` | Never (one per commit) | Pinning an exact build |
| `t3-code:<t3-version>` | Every main commit while that T3 version is current | Staying on one T3 version |
| `t3-code:latest` | Every main commit | Testing |
| **`t3-code:stable`** | Only when the content of `image/` changes, after all tests pass | **Servers with auto-deploy, and new installs** |
| `t3-bridge:<kit-revision>` | Never | Pinning |
| `t3-bridge:latest` | Every main commit | Testing |
| **`t3-bridge:stable`** | Only when the content of `bridge/` changes, after all tests pass | **Bridges with auto-deploy** |

`:stable` compares a content fingerprint (the git tree hash of `image/` or `bridge/`, stored in the image label
`kit.content-tree`). A commit that only changes docs or CI publishes `:latest` but does not move `:stable`, so servers
are not restarted for nothing.

Every image carries labels with its source: `org.opencontainers.image.revision`, `kit.t3-version` and
`kit.claude-code-version`.

## What has to pass before :stable moves

1. **Bridge tests:** typecheck and unit tests, including a full Slack flow against a fake Slack API.
2. **Smoke test** (`scripts/smoke-image.sh`): the image starts; `/` returns 200; the API returns 401 without a
   session; the MCP OAuth metadata is published; the tool versions print.
3. **Bridge contract test** (`scripts/bridge-contract-test.sh`): a real T3 container and a real bridge. The bridge signs
   in through T3's MCP OAuth (approved with a pairing code, like a person would), lists projects, launches a thread,
   waits for it, and reads it back. No Claude token is needed: the run ends with "Not logged in", which is the
   expected, readable outcome. If a T3 release changes an MCP tool or the OAuth flow the bridge uses, this test fails
   and nothing is published.

## Turn on automatic updates on Quave ONE

On the T3 server environment:

1. Deploy the image `ghcr.io/quaveone/t3-code:stable` [`deploy-app-env-image`].
2. Turn on image auto-deploy [`update-app-env-image-auto-deploy` with `enabled: true`]. Quave ONE checks the tag every
   few minutes and deploys the exact new digest through the normal deploy flow.

Do the same for the bridge with `ghcr.io/quaveone/t3-bridge:stable`. The **T3 Code** Solution installs `:stable` with
image auto-deploy already on, so a server from the catalog needs no extra step.

On plain Docker, use a tag watcher such as Watchtower on `:stable`, or redeploy from your own scheduler.

## What a redeploy does

- The same `/data` volume is mounted, so threads, projects, pairings, repositories, the Claude login and the bridge's
  OAuth grant all survive. T3 migrates its own SQLite state when the new version starts.
- One container with a volume means no blue-green: the old container stops before the new one starts. **Threads that
  are running at that moment are interrupted**; they stay in T3 and can be continued. Expect about a minute of downtime.
- Clients reconnect on their own.

If interrupting running threads is not acceptable, leave auto-deploy off and redeploy `:stable` at a quiet time.

## Roll back

T3 may migrate its database in ways an older version cannot read, so do not just deploy an older tag over the same
volume.

1. Find the last recovery point before the bad deploy (hourly snapshots).
2. Restore it into a new environment, pinned to the previous immutable tag `t3-code:<t3-version>-<kit-revision>`, with
   auto-deploy off.
3. Check it in the T3 app, then switch your clients to it.
4. Open an issue in this repository so the next release fixes it.

## Releases

CI creates a GitHub release `t3-v<version>` the first time a T3 version ships, with links to the upstream release
and the image tags. Kit-only changes (bridge, entrypoint) do not create a release; they show up as new `:stable`
digests and in the commit history.

## Failures

- A bump that fails a test is not committed. The workflow opens an issue named
  `Upstream bump failed: T3 Code <version> / Claude Code <version>` (or comments on the open one) with a link to the
  run. Fix the cause in a normal commit; the next scheduled run retries.
- A failed CI run on main publishes nothing, and `:stable` stays where it was.

## Watchdog

A scheduled task outside GitHub checks the chain every 6 hours:

1. It compares the latest T3 stable release and the Claude Code `stable` channel with the pin and with the labels of
   `t3-code:stable`.
2. If upstream is newer and no bump is running, it dispatches the bump workflow and watches it and the CI run after it.
3. It checks that the release exists and that `:stable` carries the new versions.
4. It reports only when something is wrong.

It checks the image chain only. Each server with auto-deploy picks up the new `:stable` on its own (see
[Turn on automatic updates](#turn-on-automatic-updates-on-quave-one)).

Any scheduler that can run `gh` works for this; the kit's maintainers run it from their agent workspace.

## Run it by hand

```sh
gh workflow run t3-release-bump.yml --repo quaveone/t3-code-kit   # check upstream now
gh workflow run ci.yml --repo quaveone/t3-code-kit --ref main      # rebuild and republish main
```
