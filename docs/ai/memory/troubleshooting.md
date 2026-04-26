# Troubleshooting — Satori
<!-- Known issues and proven fixes. Updated: 2026-04-26 -->
<!-- Format: ## [Issue title] — Status: open/resolved — [fix description] -->
<!-- Resolved entries are archived by /memory-cleanup, not deleted -->

## CI release workflow on Node 22 cannot publish with npm 10 (OIDC trusted publishing) — Status: resolved

**Symptom:** `npm install -g npm@latest` in a setup-node-cached job fails with `MODULE_NOT_FOUND: Cannot find module 'promise-retry'` mid self-upgrade.

**Workaround:** Don't self-upgrade the runner's npm. Use a disposable npm 11 only for the publish step:
```yaml
- run: npx -y -p npm@11.5.1 npm publish --access public
```
The rest of the pipeline (`npm ci`, `npm test`, `npm run build`) runs on Node 22's bundled npm 10. Trusted publishing OIDC needs npm ≥ 11.5.1, hence the npx wrapper for that one step.

## better-sqlite3@9 has no prebuilt binary for Node 24 — Status: resolved

**Symptom:** On Node 24 runners, `npm ci` falls back to `node-gyp rebuild` for `better-sqlite3@9.6.0` and the linker fails on the Azure ubuntu runner. Error trail starts with `prebuild-install warn install No prebuilt binaries found (target=24.x runtime=node arch=x64 platform=linux)`.

**Workaround:** Pin CI to Node 22 LTS. Long-term fix would be upgrading `better-sqlite3` to a version with Node 24 prebuilds (≥ 11.x), but that is a separate change.
