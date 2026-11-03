# Security

## What protects the T3 server

- **Pairing:** clients get in only with a one-time pairing token, minted by `t3 pair` or `t3 auth pairing create`.
  The server prints one at every start, so logs are sensitive.
- **Sessions:** every API call needs a session; without one T3 returns 401. WebSockets use short-lived tickets.
- **Outside agents:** `/mcp` accepts only T3's OAuth grants, approved by a paired user, capped at the mode approved,
  and valid for 30 days. Revoke them in the T3 app under **Settings → Sharing & access**.
- **No IP allowlist by default**, because phones and laptops connect from anywhere. Put the server behind a private
  network or an allowlist if every client is on a known network.

## What an agent can reach

Agents run as the `t3` user inside the container with every secret in its environment: the Claude token, `GH_TOKEN`
and any MCP keys. In `full-access` mode they run commands without asking. So:

- give `GH_TOKEN` write access only to the repositories the agents work on (a machine account that is a collaborator
  on those repositories works well);
- give MCP keys only the scopes the agents need;
- run one server per person or per trust boundary; never share one server between people who should not see each
  other's work or credentials.

## Secrets handling

- Store every token as a secret environment variable. Never commit it, never put it in an issue, chat or log.
- The image never prints the Claude token, `GH_TOKEN` or MCP keys. `MCP_SERVERS_JSON` holds the *name* of the variable
  with the token, not the token.
- The entrypoint refuses Anthropic API keys so usage cannot silently move to per-token billing.
- The bridge never logs request bodies or tokens, and keeps the OAuth grant only in its own SQLite file.

## Reporting

Report security problems privately to the repository owners instead of opening a public issue.
