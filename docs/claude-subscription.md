# Claude on a subscription

Claude Code inside the T3 server must run on a Claude Pro or Max **subscription**, never on an Anthropic API key.
API usage is billed per token and is much more expensive for agent work.

## Create the token

On any machine with a browser:

```sh
claude setup-token
```

1. Open the printed URL and sign in to the Claude account whose subscription the server should use.
2. Approve the request. The page shows an authorization code.
3. Paste the code back into the terminal. Claude prints a token that starts with `sk-ant-oat01-` and is valid for one year.

The token is shown once. Copy it straight into your secret store; do not paste it into chats, issues or logs.

If you run `claude setup-token` from a script or `tmux`, keep the pane open after the process exits
(`tmux set-option remain-on-exit on`), or the token disappears with the pane.

## Give it to the server

Set it as a **secret** environment variable on the T3 server:

```text
CLAUDE_CODE_OAUTH_TOKEN=<token>
```

At start the entrypoint removes `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` if they are present, because
Claude Code would prefer them over the subscription.

## Check that it really uses the subscription

In the container, as the `t3` user:

```sh
as-t3 sh -c 'cd /tmp && claude -p "Reply with PONG" --output-format stream-json --verbose' \
  | jq -c 'select(.type=="system" and .subtype=="init") | {apiKeySource, model}'
```

`"apiKeySource": "none"` means no API key is in use: the request ran on the subscription token. (The
`total_cost_usd` field in Claude's output is an estimate it always prints, not a bill.)

## One subscription, one person

A subscription belongs to one person. Do not share one T3 server, and its token, between several people. Give each
person their own server, or use a dedicated account for automation so that a problem with it never affects anyone's
main account.

## Rotate

1. Run `claude setup-token` again.
2. Update `CLAUDE_CODE_OAUTH_TOKEN` and redeploy.

Tokens expire one year after creation, so put a reminder in your calendar when you create one.
