# Satori Concepts

Architecture and mental model — how the pieces fit together and why.

---

## What is a gateway?

Satori is a single MCP server that proxies any number of downstream MCP servers. Claude Code only needs one entry in its MCP config:

```json
{
  "mcpServers": {
    "satori": {
      "command": "node",
      "args": ["/absolute/path/to/modules/satori/dist/src/index.js"]
    }
  }
}
```

From that single entry, satori exposes tools from every downstream server you configure. Each downstream tool is addressed by its server name and tool name — e.g. `satori_exec("filesystem", "read_file", { "path": "..." })`. Claude Code never needs a separate config entry for `filesystem`, `github`, or any other server you add.

This means you can add, remove, and swap downstream servers by editing `satori.toml` — no changes to your Claude Code config required.

---

## Three layers

Satori is organised into three functional layers.

### Gateway layer — routing, discovery, and bash builtin

The gateway layer handles everything directly visible to Claude Code:

- **Tool routing** — `satori_exec` dispatches a call to the correct downstream server, starting it on first use if needed.
- **Tool discovery** — `satori_find` searches the tool catalog across all registered servers; `satori_schema` returns the full input schema for any tool.
- **Server inspection** — `satori_manage` lets you list registered servers, inspect their state, and run security scans. It is read-only; configuration changes happen by editing `satori.toml`.
- **Bash builtin** — a fully-implemented code execution server (`BuiltinServer`) that handles `run`, `run_file`, and `batch`. It bypasses `LifecycleManager` entirely and is always available without any `satori.toml` entry. Accessed via `satori_exec("bash", "run", { ... })`.

### Context layer — session capture

`satori_context` captures tool outputs into a local SQLite database (FTS5) via Claude Code hooks. At any point you can call `satori_context(restore)` to get a compact XML snapshot of the current session — active files, decisions, recent tool calls — fitting within the context budget.

This layer answers the question: *what have we already done this session?*

Use `satori_context(query)` for full-text search over captured tool outputs when you need to find a specific result from earlier in the session.

### Knowledge layer — indexed search

`satori_kb` is a local knowledge base with BM25+RRF (Reciprocal Rank Fusion) search. It stores indexed content — documentation, code output, fetched URLs — and returns ranked excerpts.

This layer answers the question: *what do we know about this topic?*

Use `satori_kb(index)` to store content explicitly, `satori_kb(fetch_and_index)` to fetch and index a URL, and `satori_kb(search)` to retrieve ranked results. The knowledge base is also used internally by intent-driven mode (see below).

---

## Hot/cold loading

Downstream servers do not start when satori starts. They start on demand — the first time a tool call is routed to them.

This is hot/cold loading:

- **Cold** — the server is registered in `satori.toml` but not running. It costs nothing at startup.
- **Hot** — the first `satori_exec` call to that server triggers startup (subject to security scan). Subsequent calls reuse the running process.

`enabled = false` in `satori.toml` prevents a server from ever starting. It will not appear in `satori_find` results and `satori_exec` calls to it will fail immediately.

If a security scan blocks a server, it stays cold and is invisible to Claude Code until the block is cleared.

---

## Security scan flow

Satori runs security checks at multiple points in a server's lifecycle. All scan behaviour is configured under `[security]` in `satori.toml`. See [configuration.md](configuration.md) for all fields.

### `startup_scan`

Runs against server configurations when satori starts (or when `satori_manage(scan)` is called). Checks server command paths, image names, and argument patterns for known-dangerous patterns. A server that fails startup scan is set to `blocked` state and will not start.

### `runtime_scan`

Runs against tool arguments at call time, before the call is dispatched to the downstream server. If the arguments match a blocked pattern, the call is rejected and the server state is set to `blocked`.

### `return_scan`

Runs against tool output before it is returned to Claude Code. Detects sensitive data patterns (tokens, secrets, PII) in responses. A failed return scan redacts or blocks the response.

### `audit_log`

When enabled, writes a structured log entry for every scan event — pass, block, or skip. The log records the server name, tool name, scan type, result, and timestamp. Useful for reviewing what satori has allowed or blocked over time.

A server in `blocked` state is invisible to Claude Code: `satori_find` will not list its tools and `satori_exec` calls to it will return an error.

---

## Intent-driven mode

When a tool call produces a large output, returning the full raw text wastes context. Intent-driven mode addresses this: instead of returning raw stdout, satori indexes the output into the knowledge base and returns semantically relevant excerpts.

Intent-driven mode activates when two conditions are met:

1. The `intent` parameter is set on the call (a natural-language description of what you are looking for in the output).
2. The stdout exceeds **5000 bytes**.

When both conditions are true, satori:

1. Indexes the full output into `KnowledgeDB`.
2. Runs a BM25+RRF search against the `intent` string.
3. Returns the ranked search results instead of the raw output.

The response shape changes: instead of a plain string, you receive `{ truncated: true, intent: "...", results: [...] }`.

Intent-driven mode applies to the bash builtin (`run`, `run_file`) and to `batch` (which always indexes all command output and then runs the provided `queries` against it).

To use intent-driven mode with `bash:run`:

```json
{
  "server": "bash",
  "tool": "run",
  "args": {
    "language": "shell",
    "code": "find /large/repo -name '*.ts' | xargs wc -l | sort -rn",
    "intent": "which TypeScript files are largest"
  }
}
```

If the output is under 5000 bytes, the raw output is returned normally regardless of whether `intent` is set.

---

## Session continuity

Each tool call routed through satori is captured by a Claude Code `PostToolUse` hook, which writes a record (server, tool, input, output excerpt, timestamp) to the SQLite context database.

At the start of a session, call `satori_context(restore)` to retrieve a compact XML snapshot of the previous session. The snapshot includes recent tool calls, captured decisions, and active context — formatted to stay within approximately 2 KB.

When Claude Code is about to compact the conversation, the `PreCompact` hook triggers `satori_context(flush)`, which writes a session guide entry to the database. This ensures the most important context survives compaction and is available to `satori_context(restore)` in the next session.

`restore` without an explicit `session_id` returns the **latest unconsumed resume for the current client across all sessions**. This solves "fresh-start blindness" — a new `claude` invocation in a repo gets a brand-new session UUID, but the previous session's resume is still recovered because the lookup is scoped by `client`, not `session_id`. See the next section for what `client` actually is.

Without hooks, the context database stays empty. See [hooks.md](hooks.md) for setup instructions.

---

## Tenant model: `(client, session_id)`

Every row Satori writes — captures, events, resumes, KB chunks — is tagged with two identifiers:

| Identifier | Scope | Stability | Source |
|---|---|---|---|
| `client` | A working scope: usually one repo, or a shared-tenant within shared storage | **Stable** across Claude restarts | `--client` flag → `[context] client` in toml → `basename(repoRoot)` |
| `session_id` | One Claude Code conversation | Transient — fresh on `claude`, stable on `--continue` | `transcript_path` UUID (hooks) or `--session-id` / `$CLAUDE_SESSION_ID` (tool-calls) |

Together they form the primary key for every read and write. The two scopes solve different problems:

- **`client` solves shared-storage cross-talk.** With `storage_dir = "miyo"`, four MiYo repos write into one DB. Without `client`, every query would return mixed results from all four; with `client`, each Satori process only sees its own rows. Pruning, search, status counts, and KB lookups all filter by `client` automatically — there is no cross-tenant access from the tool surface in this version.
- **`session_id` solves intra-session correlation.** A single Claude Code conversation produces many tool calls and many hook events; they all join cleanly because they share one `session_id`.

The hooks resolve `client` the same way the MCP server does, so the hook-written and tool-call-written rows always agree. Two hooks/tool-calls disagreeing on `client` or `session_id` was the latent bug this model was introduced to fix.

For most users this is invisible — `basename(repoRoot)` is a sensible default and Claude Code provides the `session_id`. Override `--client` only when basenames collide, or to explicitly tag a Satori process with a logical name (`personal`, `work`) independent of the working directory. See [configuration.md — `client`](configuration.md#client) for the full resolution rules.

---

## Architecture diagram

```
Claude Code
    │
    │  single MCP entry: "satori"
    ▼
┌─────────────────────────────────────────────────┐
│  Satori                                         │
│                                                 │
│  ┌────────────────┐  ┌──────────────────────┐   │
│  │ Context Server │  │ Gateway / Registry   │   │
│  │ (SQLite FTS5)  │  │  ┌────────────────┐  │   │
│  │                │  │  │ Tool Catalog   │  │   │
│  │ satori_context │  │  └────────────────┘  │   │
│  │ satori_kb      │  │  route + handle      │   │
│  └────────────────┘  └──────────────────────┘   │
│                                │                │
│  ┌─────────────────────────┐   │                │
│  │ Builtin Server ("bash") │   │                │
│  │ run / run_file / batch  │   │                │
│  └─────────────────────────┘   │                │
└───────────────────────────────┼────────────────┘
                                │
              ┌─────────────────┼────────────┐
              ▼                 ▼            ▼
       [npx server A]   [docker server B]  [external C]
         (hot/cold)       (hot/cold)
```

---

## Planned Extensions

**Kairn** is a planned semantic memory backend that would replace the current SQLite FTS5 layer for session-boot queries. Where the current `satori_context(restore)` snapshot is based on recency and size limits, Kairn would use vector similarity to surface the most relevant context for the current task at session start. It is not yet implemented.

---

For tool API reference see [tools.md](tools.md). For security configuration fields see [configuration.md](configuration.md).
