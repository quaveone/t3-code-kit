# Upstream sync and fork rules

[T3 Code](https://github.com/pingdotgg/t3code) moves very fast: well over a hundred commits a day on `main`, several
nightlies a day and a few stable releases a week. This repository stays easy to maintain by never carrying T3 code.

## Follow stable releases only

- The image installs an official stable release (`ARG T3_VERSION`) and checks it against the release's `SHA256SUMS`.
- `.github/workflows/t3-release-bump.yml` runs daily. When a new stable release appears it bumps `T3_VERSION`, builds
  the image, runs `scripts/smoke-image.sh`, and opens a PR. (PRs opened with `GITHUB_TOKEN` do not trigger CI, which
  is why the workflow tests before it opens the PR.)
- Never track `main` or nightly builds.

The smoke test checks the contract the bridge relies on: the web app on `/`, 401 without a session, and the MCP
OAuth metadata. When a release changes an MCP tool the bridge uses, fix the bridge in the same PR.

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
