# Upstream maintenance

- Upstream: <https://github.com/orchidfiles/ungate>
- Fork point: `13af0434d507f3bf64a8d87c3377d5b21574811d`
- Last merged upstream commit: `13af0434d507f3bf64a8d87c3377d5b21574811d` (2026-07-22)
- License: MIT; upstream copyright notices and attribution remain intact.

## UNN-specific changes

- Distribution identity is `unn-corp.ungate`, released as GitHub VSIX assets.
- Node 22.x is the supported runtime, with `UNGATE_NODE_BIN` as an explicit override.
- Quick-tunnel URLs are cleared after a previous Cursor session and are usable only after Cloudflare connector registration.
- SuperGrok is available through the local Grok CLI's existing OAuth session; Ungate does not persist Grok credentials.
- OpenCode setup is distributed as a copy-safe local OpenAI-compatible provider snippet.

## Monthly sync procedure

1. Fetch the source: `git fetch upstream main`.
2. Create `sync/upstream-YYYY-MM` from `main` and merge `upstream/main` with a merge commit.
3. Resolve conflicts while preserving the UNN-specific changes above; update this file with the merged commit.
4. Run `pnpm test` and `pnpm run package:build` under Node 22.
5. Open a reviewed pull request into `main`. Create a patch release only after CI is green and the change is reviewed.

Upstream merges are deliberately not automated.
