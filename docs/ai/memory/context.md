# Context — Satori
<!-- Current sprint focus, active work, known blockers. Updated: 2026-04-27 -->
<!-- This file is short-lived — prune entries older than 2 weeks via /memory-cleanup -->

## Deferred Review Items

From the `feat/client-resolver` review on 2026-04-27. These were classified `Defer` during `/receive-review` rather than fixed in-branch.

### R11 — `ContentDB.search` FTS scoring spans tenants (2026-04-27)
- Location: `src/context/content-db.ts:101-113`
- Concern: FTS scoring is computed across all tenants' rows before the `c.client = ?` WHERE clause filters. Final results are correctly scoped, but BM25 ranking is influenced by other tenants' content volume.
- Reason deferred: Bigger redesign (per-client FTS partition or `client_partition` hidden column). Final results are correct — only ranking is suboptimal.
- Branch: feat/client-resolver

### R13 — Cross-tenant `session_id` refusal not implemented (2026-04-27)
- Location: `src/tools/satori-context.ts:54-65`
- Concern: Spec Decision #4 says tool-calls with explicit `session_id` belonging to a different `client` should error. Currently silently returns "no snapshot".
- Reason deferred: Spec explicitly assigns this to Phase 4 (`docs/specs/client-session-model.md` §"Implementation plan").
- Branch: feat/client-resolver

### R15 — `resolveHookPaths` TOCTOU between `existsSync` and `loadConfig` (2026-04-27)
- Location: `hooks/scripts/utils.ts:43-57`
- Concern: Two file ops (existsSync + loadConfig) on `satori.toml` create a benign TOCTOU window.
- Reason deferred: Theoretical; one-line cleanup with no real payoff. Address opportunistically.
- Branch: feat/client-resolver

### R18 — Hook silent exit when `satori.toml` missing is a behavior change (2026-04-27)
- Location: `hooks/scripts/*.ts`
- Concern: Pre-branch hooks would write to a hardcoded default path if `satori.toml` was absent. Now they exit 0 silently.
- Reason deferred: New behavior is intended/correct. Document in CHANGELOG/release notes when cutting a release; no code change needed.
- Branch: feat/client-resolver

### R25 — `satori_kb`/`satori_context` don't expose `client` in inputSchema (2026-04-27)
- Location: `src/tools/satori-kb.ts`, `src/tools/satori-context.ts`
- Concern: Spec promises optional `client?` parameter for advanced cross-tenant lookups.
- Reason deferred: Spec explicitly assigns to Phase 4 (`docs/specs/client-session-model.md` §"Implementation plan"). Will be additive — no consumers break.
- Branch: feat/client-resolver
