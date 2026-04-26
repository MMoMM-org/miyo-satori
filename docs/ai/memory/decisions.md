# Decisions — Satori
<!-- Architecture choices and rationale. Updated: 2026-04-26 -->
<!-- What goes here: why we chose X over Y, ADR links, significant tradeoff choices -->
<!-- Format: YYYY-MM-DD — Decision: [what] — Rationale: [why] -->

2026-04-26 — Decision: Distribute via `npm publish` + `npx -y miyo-satori`, not via bundled binary or vendored deps.
**Rationale:** `better-sqlite3` is a native module with prebuilt binaries per platform; npm/`prebuild-install` resolves this transparently across Linux/macOS/Windows × x64/arm64. A single-file bundle would have required either committing platform-specific binaries or migrating to `node:sqlite` (Node 22.5+), and both options break down once we add native vector-search deps for the planned RAG feature (`sqlite-vec`, `faiss-node` etc.). npm publish is the path that keeps future native deps cheap.

2026-04-26 — Decision: CI uses npm trusted publishing (OIDC) instead of an `NPM_TOKEN` repo secret.
**Rationale:** No long-lived token in GitHub secrets to leak. npm registry validates the GitHub Actions OIDC identity directly. Provenance attestation is generated automatically. Configured at npmjs.com → package settings → Trusted Publisher (publisher: GitHub Actions, repo: MMoMM-org/miyo-satori, workflow: release.yml).

2026-04-26 — Decision: `satori.toml` is the single source of truth for configuration. MCP tools never mutate it.
**Rationale:** Earlier `satori_manage` exposed `add`/`remove`/`enable`/`disable`/`set_project_dir` as LLM-callable subcommands that wrote `[[servers]]` blocks across repo/project/global scopes. Two problems: (1) an LLM that misreads context can silently rewrite scope-tagged config files, and (2) the hand-rolled string-based toml writer (~180 lines) had to track every schema addition in lockstep — the HTTP-runtime work made this concrete (url/headers serialization had to be bolted on). Decision: keep `satori_manage` read-only (`list`/`state`/`scan`); configuration changes happen by editing `satori.toml` directly; runtime control belongs in app flags, not MCP tools. Future feature design must respect this — do not add new MCP tools that mutate config files.
