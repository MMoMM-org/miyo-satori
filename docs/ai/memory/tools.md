# Tools — Satori
<!-- CI, build pipeline, API clients, local dev setup. Updated: 2026-04-26 -->
<!-- What goes here: commands that are non-obvious, tool quirks, CI gotchas, env var names -->
<!-- What does NOT go here: domain rules (→ domain.md), code style (→ general.md) -->

## Release flow
- Releases are fully automated via `.github/workflows/release.yml`. To cut a release: `npm version patch|minor|major && git push --follow-tags`. The workflow runs typecheck, tests, build, version-tag-match check, then `npm publish` with provenance.
- The publish step uses `npx -y -p npm@11.5.1 npm publish` because Node 22's bundled npm 10 lacks OIDC trusted-publishing support. Do not change to `npm install -g npm@latest` — that hits a `promise-retry` MODULE_NOT_FOUND race on cached runners.
- CI runner is pinned to **Node 22 LTS**, not 24, because `better-sqlite3@9` has no Node 24 prebuilds.

## Local npm cache quirk on this machine
- `~/.npm/_cacache` has root-owned files left over from old npm versions. Any `npm pack`, `npm view`, etc. fails with `EPERM`. Workaround per command: `--cache "$TMPDIR/npm-cache"`. Permanent fix: `sudo chown -R 501:20 ~/.npm`.
