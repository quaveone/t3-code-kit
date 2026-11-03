# Architecture

## Components

```text
 Slack ──Events API──┐
                     ├──> bridge ──MCP over HTTPS (OAuth)──> T3 server ──> Claude Code
 REST clients ───────┘   (Bun)                               (one container, /data volume)
                                                                  ▲
 T3 desktop, web and mobile apps ──── pairing + WebSocket ────────┘
```

| Component | What it is | State |
| --- | --- | --- |
| T3 server (`image/`) | Unmodified T3 Code stable release running `t3 serve`, plus Claude Code, `git` and `gh`. | SQLite, worktrees, repositories and Claude settings under `/data`. |
| Bridge (`bridge/`) | Small Bun service: REST API and Slack Events API in front of T3's MCP endpoint. Optional. | One SQLite file: the OAuth grant and the Slack-thread-to-T3-thread map. |
| T3 apps | Desktop, web and mobile clients from upstream. They pair with the server directly. | None on the server side. |

## How a request flows

1. A client calls `POST /v1/tasks`, or mentions the bot in Slack.
2. The bridge calls the T3 MCP tool `t3_thread_launch`. T3 creates a thread, usually in a fresh git worktree, and
   starts Claude Code with the chosen model.
3. The bridge waits with `t3_thread_wait` and reads the newest messages with `t3_thread_read`.
4. Slack gets the final answer in the same Slack thread. Later replies in that Slack thread go to the same T3
   thread through `t3_thread_send`.

People can open the same threads at any time in the T3 apps and continue there.

## Design rules

- **T3 is used as it is.** No patches and no fork. Everything new lives outside T3 and uses only its public
  surfaces: the `/mcp` endpoint, webhooks, the `t3` CLI and `t3.json`. See [upstream-sync.md](upstream-sync.md).
- **One T3 server is one container.** T3 stores its state in SQLite, which allows one writer. Run it on a
  single-writer persistent disk with one replica and no blue-green or rolling overlap. Never put that state on NFS
  or object storage.
- **Scale by adding servers.** When one server is not enough, add another (for example one per person or per
  repository). The T3 apps connect to many servers at once.
- **Subscription only.** Claude Code runs on a Claude Pro or Max subscription token. The image refuses API keys.
  See [claude-subscription.md](claude-subscription.md).
- **The bridge has no model.** Routing is deterministic: `[project] message` starts a thread, replies continue it.
  All reasoning happens inside T3.

## Why the bridge uses MCP with OAuth

T3 offers three programmatic surfaces:

- the `t3 thread` CLI, which only works on the same host;
- an internal WebSocket and HTTP API, which changes often between releases;
- the MCP endpoint, which is documented for outside agents.

The bridge uses MCP. Bearer sessions from `t3 auth session issue` are rejected by `/mcp`; it accepts only T3's own
OAuth (dynamic client registration and PKCE), approved once with a pairing code or by an already paired browser.
A grant lasts 30 days and T3 has no refresh grant, so the bridge has to be approved again every month.
