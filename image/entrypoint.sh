#!/usr/bin/env bash
# Prepares the persistent HOME, optional integrations, then runs `t3 serve` in the foreground.
set -euo pipefail

mkdir -p "$HOME" "$T3CODE_HOME" "$HOME/repos"

# Subscription only: Claude Code prefers an API key over the subscription token when both exist,
# and API usage is billed per token. Drop any API key so agents always use the subscription.
for var in ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN; do
  if [ -n "${!var:-}" ]; then
    echo "t3-entrypoint: ignoring $var; this image runs Claude Code on a subscription token only" >&2
    unset "$var"
  fi
done
if [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  echo "t3-entrypoint: CLAUDE_CODE_OAUTH_TOKEN is not set; Claude threads will not start until it is" >&2
fi

# Git identity and GitHub auth for agent pushes (GH_TOKEN is read by gh; git uses gh as helper).
if [ -n "${GIT_AUTHOR_NAME:-}" ]; then git config --global user.name "$GIT_AUTHOR_NAME"; fi
if [ -n "${GIT_AUTHOR_EMAIL:-}" ]; then git config --global user.email "$GIT_AUTHOR_EMAIL"; fi
if [ -n "${GH_TOKEN:-}" ]; then
  gh auth setup-git >/dev/null 2>&1 || true
fi

# Optional remote MCP servers for Claude Code, from MCP_SERVERS_JSON:
#   {"quave-one":{"url":"https://mcp.quave.cloud/","bearerEnv":"QUAVE_ONE_MCP_KEY"}}
# The bearer value is read from the named env var at start and written only to Claude's user config.
if [ -n "${MCP_SERVERS_JSON:-}" ]; then
  echo "$MCP_SERVERS_JSON" | jq -r 'to_entries[] | [.key, .value.url, (.value.bearerEnv // "")] | @tsv' |
    while IFS=$'\t' read -r name url bearer_env; do
      claude mcp remove --scope user "$name" >/dev/null 2>&1 || true
      if [ -n "$bearer_env" ] && [ -n "${!bearer_env:-}" ]; then
        claude mcp add --scope user --transport http "$name" "$url" \
          --header "Authorization: Bearer ${!bearer_env}" >/dev/null
      else
        claude mcp add --scope user --transport http "$name" "$url" >/dev/null
      fi
      echo "t3-entrypoint: MCP server '$name' configured"
    done
fi

exec t3 serve --host 0.0.0.0 --port "${T3_PORT}" --base-dir "$T3CODE_HOME" "$@"
