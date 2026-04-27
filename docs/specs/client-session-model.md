# `(client, session_id)` Identity Model — Design Spec

> Status: Draft, agreed in principle (2026-04-27). Not yet implemented.
> Companion to: `storage-resolution.md` (already implemented). Required
> when storage is shared across multiple repos.

## Problem

`session_id` alone is the wrong scope for "show me what happened in
this repo." Two failure modes:

1. **Fresh-start blindness.** A new `claude` invocation in a repo gets
   a fresh UUID. `satori_context(restore)` queries by that UUID and
   returns nothing — even though the repo had hours of work last week
   under a different UUID.

2. **Shared-storage cross-talk.** With the new `storage_dir = "miyo"`
   layout, four repos write into one DB. Filtering by `session_id`
   alone returns mixed results across repos. Filtering by nothing at
   all is worse.

There is also a latent bug: **hooks and tool-calls disagree on
session_id**. Hooks extract a UUID from `transcript_path` (stable per
Claude Code session); tool-calls without an explicit `session_id` arg
fall back to the literal string `"tool-session"`. Captures from the
same Claude Code session land under two different keys.

## Design

Introduce `client` as a second identifier alongside `session_id`. The
two together form the full identity tuple:

| Identifier | Scope | Stability | Source |
|---|---|---|---|
| `client` | A working scope: usually one repo, or a shared-tenant within shared storage | **Stable** across Claude restarts | CLI flag, toml setting, or `basename(repoRoot)` |
| `session_id` | One Claude Code conversation | Transient — fresh on `claude`, stable on `--continue` | `transcript_path` UUID (hooks) or env-var (tool-calls) |

`(client, session_id)` becomes the primary key for captures, events,
and resumes. KB chunks gain a `client` column for tenant filtering.

### Client resolver

Precedence (highest first):

1. CLI flag: `--client <name>`
2. Toml: `[context] client = "<name>"`
3. Auto-derive: `basename(repoRoot)`

The auto-derive picks distinctive names for the MiYo case
(`Satori`, `Tomo`, `Kado`, `Hashi`). When two repos collide on basename,
explicit override is required.

### Session-id alignment

The hook-vs-tool-call divergence is fixed by **passing the same UUID to
both**. At startup, Satori reads:

1. CLI flag `--session-id <uuid>` (explicit, takes precedence)
2. Env-var `CLAUDE_SESSION_ID` (set by Claude Code when spawning MCP servers)
3. Fallback: synthetic UUID generated at startup

This value becomes the new `TOOL_SESSION_ID` default. Hooks continue
extracting the UUID from `transcript_path`; both paths converge on the
same string.

### Restore semantics with `(client, session_id)`

`satori_context(restore)` gains a session-resolution policy:

| Caller | Behaviour |
|---|---|
| No `session_id` arg | Return latest resume for `client = currentClient` (any session within this client) — solves fresh-start blindness |
| Explicit `session_id` | Return that specific session's resume; require it to belong to current `client` (refuse cross-tenant reads) |
**note:** if we have no session_id we should return not all from the client. it should be the latest X records.. plus an information to ask for more if neccessary
question would be what is X...

`satori_context(query)` gains an analogous filter: default `client =
currentClient`, optional override.

### Decisions

| # | Decision | Detail |
|---|---|---|
| 1 | **`client` is auto-derived** | `basename(repoRoot)` by default. Manual override only when collisions matter. No UX burden in the common case. |
| 2 | **Pre-release schema migration is wipe-and-recreate** | No ALTER TABLE backfill code. Existing dev DBs from before this change get reset. |
| 3 | **Session-id alignment via env-var + CLI fallback** | Hooks and tool-calls converge on one UUID per Claude Code session. The literal `"tool-session"` default is removed. |
| 4 | **Cross-tenant reads are refused** | Tool-calls with explicit `session_id` belonging to a different `client` get an error, not silent merge. Hard fail surfaces config bugs. |
| 5 | **KB chunks are client-scoped** | Default search filters to `client = currentClient`. Optional `client` parameter on `satori_kb(search)` for cross-tenant lookups (rare). |

## What the client sees

- `satori_context(restore)` works the same shape, but now returns
  cross-session content from this repo by default. Fresh starts get
  meaningful resumes.
- New optional parameter on `satori_context` and `satori_kb` tools:
  `client?: string` (advanced — overrides default tenant filter).
- No new tools. The model is invisible to Claude until it cares.

## Configuration sketch

```toml
# Most users: do nothing — basename(repoRoot) is the default
# Override only when needed:
[context]
client = "personal"          # this Claude is "personal" regardless of cwd
storage_dir = "miyo"          # shared storage with three other repos
```

Or per CLI:

```json
{
  "mcpServers": {
    "satori-personal": {
      "command": "miyo-satori",
      "args": ["--storage", "miyo", "--client", "personal"]
    }
  }
}
```

## Schema changes

Add `client TEXT NOT NULL DEFAULT ''` to:

- `captures` (ContentDB) — also revise indexes/queries
- `session_events` (SessionDB)
- `session_meta` (SessionDB) — change PRIMARY KEY to `(client, session_id)`
- `session_resumes` (SessionDB) — change PRIMARY KEY to `(client, session_id)`
- `chunks` (KnowledgeDB)

No migration code: pre-release. Users (= us) wipe and recreate.

## Out of scope

- **Cross-tenant reporting / audit views** — possible later but not v1.
- **Client-level RBAC / authn** — explicitly *not* this. `client` is a
  label, not a permission boundary. (b) from the earlier
  multi-instance discussion remains separate.
- **Persistence of synthetic UUIDs** — if we generate a fallback UUID,
  it lives only for the process lifetime. Different fallbacks across
  restarts would leak into captures; better to require an env-var or
  CLI value in production setups.

## Open questions

1. **Does Claude Code actually set `CLAUDE_SESSION_ID`?** The hook
   `extractSessionId` lists it as a fallback after `transcript_path`.
   Need to confirm by inspecting an actual hook payload at runtime.
   If it doesn't set it, we need another channel — possibly a
   `--session-id` CLI flag that Claude Code's MCP config can interpolate.

2. **Tool-call `session_id` parameter today is optional.** Should we
   keep it optional (Satori uses startup-resolved value if missing) or
   require it on every call? Recommend keep optional; Satori fills in.

3. **`(client, session_id)` PRIMARY KEY collision risk** — only if a
   user runs two Satori instances with the same `client` *and* the
   same `session_id`. Unlikely but possible. Recommend leaving it as
   a known limitation; surfacing via UNIQUE constraint not worth the
   complication.

## Implementation plan (when we get there)

### Phase 1 — Resolver, no schema change yet
- Add `client?: string` to `ContextConfig` schema.
- New `src/config/client.ts` exporting `resolveClient(cliFlag, config, repoRoot)`.
- Parse `--client` CLI flag in `index.ts`.
- Tests for resolver against the precedence table.

### Phase 2 — Schema + plumbing
- Add `client` column to all five tables. Drop+recreate (no migration).
- Update PRIMARY KEYs on `session_meta` and `session_resumes`.
- Plumb `client` through every `insert*` / `getBy*` / `search` call site.
- Update all 30+ existing tests that pass empty/missing client.

### Phase 3 — Restore + session-id alignment
- Rework `satori_context(restore)` to do client-scoped lookup when
  `session_id` not given.
- Replace `TOOL_SESSION_ID = 'tool-session'` literal with the
  startup-resolved session-id (env-var → CLI → synthetic).
- Add `--session-id` CLI flag (uncommon; for explicit testing).
- E2E test: fresh Claude restart in same repo gets the previous
  session's resume back.

### Phase 4 — Cross-tenant refusal + tool surfaces
- Hard-fail tool-calls that pass a `session_id` belonging to a
  different `client`.
- Add optional `client?` parameter to `satori_context` and `satori_kb`
  tool inputs, document as advanced.

Sized at ~1 day total, but each phase is independently shippable.
