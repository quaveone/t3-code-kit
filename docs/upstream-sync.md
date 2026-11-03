# Upstream sync and fork rules

[T3 Code](https://github.com/pingdotgg/t3code) moves very fast: well over a hundred commits a day on `main`, several
nightlies a day and a few stable releases a week. This repository stays easy to maintain by never carrying T3 code.

## Follow stable releases only

- The image installs an official stable release (`ARG T3_VERSION`) and checks it against the release's `SHA256SUMS`.
- `.github/workflows/t3-release-bump.yml` runs every 4 hours. When a new stable release of T3 Code (or of the Claude
  Code `stable` channel) appears, it updates `image/Dockerfile`, builds, runs the smoke test and the bridge contract
  test, commits to `main` and dispatches CI, which publishes. See [releases.md](releases.md).
- Never track `main` or nightly builds.

The bridge contract test runs a real T3 container and a real bridge through the OAuth sign-in and a full thread
launch, wait and read. When a release changes an MCP tool the bridge uses, the test fails, nothing is published,
and an issue is opened; fix the bridge in a normal commit.

## Where new behaviour goes

Put new behaviour **outside** T3, behind its public surfaces:

| Need | Where |
| --- | --- |
| A new HTTP endpoint or integration | The bridge, or a new service next to it |
| Repository setup on new worktrees | The repository's own `t3.json` (`runOnWorktreeCreate`, scripts) |
| Tools for the agents | MCP servers through `MCP_SERVERS_JSON` |
| Events into T3 | T3 webhooks (signed with HMAC) or the bridge |
| A different agent runtime | T3's "Local ACP command" provider |
| Container behaviour | `image/entrypoint.sh` |

## If T3 itself must change

Last resort, in this order:

1. Open an issue or pull request upstream.
2. Meanwhile, use every extension point above.
3. Only if the change still blocks real work, create the fork `quaveone/t3code`:
   - branch `quave/<t3-version>` = the upstream stable tag plus at most 3 small patches;
   - each patch links its upstream pull request;
   - the image builds from the fork only while a patch exists;
   - CI re-applies the patches on every new stable tag;
   - each patch is dropped as soon as upstream merges it.
