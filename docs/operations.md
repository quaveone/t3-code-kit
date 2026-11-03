# Operations

## Capacity

Measured on 2026-11-03 on a 4 CPU / 4 GB server. Each task installed dependencies, ran a small test suite and
summarized the code, on Claude Opus 5.5 with medium effort.

| Parallel threads | Completed | Wall time | Peak CPU | Peak memory |
| --- | --- | --- | --- | --- |
| idle | | | 0.03 core | 0.63 GB |
| 2 | 2 of 2 | 42 s | ~0.15 core | 0.67 GB |
| 4 | 4 of 4 | 68 s | ~0.75 core | 1.5 GB |
| 8 | 8 of 8 | 58 s | ~0.75 core | 3.0 GB |

- Memory is the limit: about 300 MB per active thread on small repositories. It is released over several minutes
  after the threads finish (part of it is file cache).
- Plan for 8 parallel threads on small repositories and 6 on repositories with heavy installs or builds per 4 GB.
- For more parallel work, add another T3 server instead of a bigger one.
- Agents install the toolchains they need (`bun`, `node`, and so on) into `$HOME` on the volume. The first thread pays
  the install; later threads reuse it.

## Monitoring

Alert on:

- memory above 85% for 5 minutes (too many parallel threads);
- CPU above 90% for 10 minutes;
- disk above 80% (repositories and worktrees);
- the bridge's T3 grant: `GET /v1/t3/status` `expiresAt` within 3 days.

The health check `GET /` covers restarts.

## Backups and restore

- Back up the T3 volume with your platform's volume snapshots (hourly is a good default). A crash-consistent
  snapshot restores T3's SQLite cleanly; this was verified with a restore drill.
- To recover, restore a snapshot into a **new** environment, check the projects in the T3 app, then switch over.
- The bridge volume holds only the OAuth grant and Slack thread links. Losing it means signing the bridge in again;
  old Slack threads stop mapping to their T3 threads.

## Upgrades

Upgrades are automatic. See [releases.md](releases.md) for the whole chain: new T3 and Claude Code stable releases
are tested and published as `:stable`, and servers with image auto-deploy on `:stable` redeploy within minutes. A
redeploy interrupts threads that are running at that moment, and rolling back means restoring a snapshot, not
deploying an older tag over the same volume.

## Rotating secrets

| Secret | How |
| --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | `claude setup-token`, update the variable, redeploy. Valid for one year. |
| `GH_TOKEN` | Create a new token, update the variable, redeploy. |
| MCP keys in `MCP_SERVERS_JSON` | Regenerate the key, update its variable, redeploy. |
| `BRIDGE_TOKEN` | Generate a new value, update the bridge and every client. |
| Bridge T3 grant | `POST /v1/t3/login` and approve again (every 30 days). |
| Slack signing secret or bot token | Regenerate in the Slack app settings, update the bridge, redeploy. |

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Container restarts with `mkdir: cannot create directory '/data/home': Permission denied` | An old image that ran as `t3` from the start. Current images fix `/data` ownership as root and then drop to `t3`. |
| Files in `/data` owned by root after using the console | Commands ran as root. Use `as-t3 <command>`; the next start fixes ownership anyway. |
| Thread fails with `Not logged in · Please run /login` | `CLAUDE_CODE_OAUTH_TOKEN` is missing or expired. |
| `t3_thread_launch` fails with `Pass modelSelection` | The project has no default model. The bridge always passes one; set it in the T3 app for app-created threads. |
| Bridge returns 503 "not signed in" | The 30-day grant expired, or T3's state was replaced. Sign in again. |
| Bridge answers 500 right after T3 restarted | Old MCP session; the bridge reconnects once automatically. Retry. |
| Slack mention gets no answer | Check the bot is in the channel, the user is in `SLACK_ALLOWED_USERS`, and the access log shows `POST /slack/events` returning 200. |
| Slack verification of the request URL fails | The bridge lacks `SLACK_SIGNING_SECRET`. Set the Slack variables first, then add event subscriptions. |
| Pod stays `Pending` with no node | The volume could not be provisioned in that region. Try another region and report it to your platform. |
| A restored environment does not start | A source-built environment waits for a code upload, and its first deploy can fail while the volume restores. Redeploy once. |
