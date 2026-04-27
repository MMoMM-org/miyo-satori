# Satori MCP Gateway — Tool Reference

This document covers every tool exposed by the miyo-satori MCP gateway.
Six tools are registered: `satori_context`, `satori_manage`, `satori_find`,
`satori_schema`, `satori_exec`, and `satori_kb`. A seventh, `bash`, is a
builtin tool handled internally by the gateway and is **not** discoverable
via `satori_find` — see its dedicated section below.

---

## `satori_context`

**Purpose:** Manage the context database — restore a session snapshot, query
captured tool output, check session statistics, or force-flush a new snapshot.

**Tool description (from source):** `Context DB: restore session snapshot, query captured tool output, check status, or force flush.`

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sub_command` | `'restore' \| 'query' \| 'status' \| 'flush'` | Yes | Operation to perform |
| `q` | `string` | No | Search query string (used by `query`) |
| `limit` | `number` | No | Maximum results to return (used by `query`; default: 10) |
| `session_id` | `string` | No | Session identifier. When omitted, Satori uses the process-level default (resolved at startup from `--session-id` → `$CLAUDE_SESSION_ID` → synthetic `satori-pid-<pid>`). |

> Every captured row, event, and resume is also tagged with the `client` of the running Satori process (resolved from `--client` → `[context] client` → `basename(repoRoot)`). All sub-commands below operate within that client's scope automatically — there is no cross-tenant access from the tool surface in this version. See [concepts.md — Tenant model](concepts.md#tenant-model-client-session_id) and [configuration.md — `client`](configuration.md#client) for details.

---

### `restore`

Returns a session snapshot and marks it consumed. The lookup policy depends
on whether `session_id` is given:

| Caller | Behaviour |
|---|---|
| `session_id` **omitted** | Returns the **latest unconsumed resume for this client across all sessions**. Solves fresh-start blindness — a new `claude` invocation in a repo gets the previous session's resume back even though the new UUID has no captures yet. |
| `session_id` **provided** | Returns that specific session's resume **within this client only**. Cross-tenant lookups return `"No session snapshot available."` (in this version a hard refusal is not raised — see Phase 4 in `docs/specs/client-session-model.md`). |

If no resume matches, the response is `"No session snapshot available."`.

```json
{
  "sub_command": "restore"
}
```

```json
{
  "sub_command": "restore",
  "session_id": "8c3d…-uuid"
}
```

---

### `query`

Performs a full-text search over captured tool output for the session.
Returns a JSON array of matching content entries, or `[]` if `q` is empty.

```json
{
  "sub_command": "query",
  "q": "authentication token",
  "limit": 5,
  "session_id": "my-session"
}
```

**Return shape:**

```json
[
  { "...content entry fields..." }
]
```

---

### `status`

Returns session-level statistics: the total number of sessions, events,
resume entries recorded in the session database, and the number of captures
for the current session.

```json
{
  "sub_command": "status",
  "session_id": "my-session"
}
```

**Return shape:**

```json
{
  "sessions": 4,
  "events": 312,
  "resumes": 2,
  "captures": 17
}
```

---

### `flush`

Builds a new resume snapshot from the current session's events and persists
it to the session database. Returns a confirmation string including the
snapshot size in bytes.

```json
{
  "sub_command": "flush",
  "session_id": "my-session"
}
```

**Example response:** `"Snapshot generated: 2048 bytes"`

---

## `satori_manage`

**Purpose:** Inspect downstream MCP servers registered with the gateway.
This tool is **read-only** — it does not modify configuration. To add,
remove, enable, or disable servers, edit `satori.toml` directly and restart
the gateway.

**Tool description (from source):** `Inspect downstream MCP servers (read-only): list, state, scan. Edit satori.toml directly to add, remove, enable, or disable servers.`

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sub_command` | `'list' \| 'state' \| 'scan'` | Yes | Operation to perform |
| `name` | `string` | No | Server name (required for `state`; optional for `scan`) |

---

### `list`

Returns all registered servers with their name, runtime, enabled flag, and
handler.

```json
{
  "sub_command": "list"
}
```

**Return shape:**

```json
[
  {
    "name": "my-server",
    "runtime": "npx",
    "enabled": true,
    "handler": "passthrough"
  }
]
```

---

### `state`

Returns the current configuration and lifecycle state for a single server.
Requires `name`.

```json
{
  "sub_command": "state",
  "name": "my-server"
}
```

**Return shape:**

```json
{
  "name": "my-server",
  "runtime": "npx",
  "enabled": true,
  "handler": "passthrough",
  "lifecycle": "stopped"
}
```

---

### `scan`

Runs the security scanner over one server (if `name` is provided) or all
registered servers. Results include the server name plus scanner output.

```json
{
  "sub_command": "scan",
  "name": "my-server"
}
```

```json
{
  "sub_command": "scan"
}
```

---

## `satori_find`

**Purpose:** Search the tool catalog across all registered downstream MCP
servers by keyword.

> **Note:** `satori_find` only searches tools registered through the
> gateway's catalog. The `bash` builtin is **not** included in this catalog
> and will never appear in `satori_find` results. Use `bash` directly via
> `satori_exec` (see below).

**Tool description (from source):** `Search for tools across downstream MCP servers by name or description`

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | `string` | Yes | Search string matched against tool names and descriptions |
| `server` | `string` | No | Restrict search to this server name only |

### Return shape

Returns a JSON array of matching entries:

```json
[
  {
    "server": "my-server",
    "tool": "create_file",
    "description": "Create a new file at the specified path",
    "state": "stopped"
  }
]
```

| Field | Type | Description |
|---|---|---|
| `server` | `string` | Name of the server that owns the tool |
| `tool` | `string` | Tool name |
| `description` | `string` | Tool description (empty string if not set) |
| `state` | `string` | Current lifecycle state of the owning server |

### Examples

```json
{
  "query": "file"
}
```

```json
{
  "query": "create",
  "server": "my-server"
}
```

---

## `satori_schema`

**Purpose:** Retrieve the full input schema for a specific tool on a
downstream MCP server.

**Tool description (from source):** `Get the input schema for a specific tool on a downstream MCP server`

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `server` | `string` | Yes | Server name as registered in the gateway |
| `tool` | `string` | Yes | Tool name to retrieve the schema for |

### Return shape

```json
{
  "name": "create_file",
  "description": "Create a new file at the specified path",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": { "type": "string" },
      "content": { "type": "string" }
    },
    "required": ["path"]
  }
}
```

If the tool is not found, the response contains `{ "error": "..." }`.

### Example

```json
{
  "server": "my-server",
  "tool": "create_file"
}
```

---

## `satori_exec`

**Purpose:** Execute a tool on a downstream MCP server through the Satori
gateway.

**Tool description (from source):** `Execute a tool on a downstream MCP server through the Satori gateway`

**Hot-start note:** The first call to a server starts it (hot-start). All
subsequent calls within the session reuse the running process — there is no
per-call startup overhead after the first invocation.

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `server` | `string` | Yes | Server name as registered in the gateway |
| `tool` | `string` | Yes | Tool name to invoke on that server |
| `args` | `Record<string, unknown>` | No | Arguments to pass to the tool (key–value map) |
| `session_id` | `string` | No | Session identifier used for context tracking |

### Example

```json
{
  "server": "my-server",
  "tool": "create_file",
  "args": {
    "path": "/tmp/hello.txt",
    "content": "Hello, world!"
  },
  "session_id": "my-session"
}
```

The response content is passed through directly from the downstream server.
If the downstream call fails, `isError: true` is set on the MCP response.

---

## `satori_kb`

**Purpose:** Interact with the gateway's FTS5-backed knowledge base — index
markdown content or remote URLs, and search with BM25 + Reciprocal Rank
Fusion (RRF).

**Tool description (from source):** `Knowledge base: index markdown content or URLs, search with BM25+RRF, retrieve smart snippets`

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sub_command` | `'index' \| 'search' \| 'fetch_and_index'` | Yes | Operation to perform |
| `content` | `string` | No | Markdown content to index (required for `index`) |
| `title` | `string` | No | Title associated with the content or URL |
| `type` | `'prose' \| 'code'` | No | Content type hint for `index` |
| `query` | `string` | No | Search query (required for `search`) |
| `contentType` | `'prose' \| 'code'` | No | Filter `search` results by content type |
| `limit` | `number` | No | Maximum number of results for `search` |
| `url` | `string` | No | URL to fetch and index (required for `fetch_and_index`) |
| `session_id` | `string` | No | Session identifier used for throttle tracking in `search` |

---

### `index`

Chunks the provided markdown content at heading boundaries (code fences are
never split) and stores each chunk in the knowledge base. Returns the number
of chunks indexed. Requires `content`.

```json
{
  "sub_command": "index",
  "content": "# Auth\n\nAuthentication uses JWT tokens...\n\n## Refresh\n\nTokens expire after 1 hour.",
  "title": "Auth Docs",
  "type": "prose"
}
```

**Return shape:**

```json
{ "indexed": 2 }
```

---

### `search`

Searches the knowledge base using BM25 (Porter stemming + optional trigram)
with RRF fusion and proximity re-ranking. Returns an array of
`KbSearchResult` objects, or a `ThrottleBlock` if the per-session call limit
has been reached. Requires `query`.

```json
{
  "sub_command": "search",
  "query": "JWT token refresh",
  "contentType": "prose",
  "limit": 3,
  "session_id": "my-session"
}
```

**Return shape (normal):**

```json
[
  {
    "chunk_id": 14,
    "title": "Auth Docs",
    "heading": "Refresh",
    "snippet": "Tokens expire after 1 hour. **Refresh** tokens are issued alongside...",
    "type": "prose",
    "score": 0.031
  }
]
```

**Return shape (ThrottleBlock):**

```json
{
  "blocked": true,
  "message": "Knowledge search throttled after 8 calls for session \"my-session\". Use satori_exec to continue your work.",
  "redirect": "satori_exec"
}
```

A `ThrottleBlock` is a valid (non-error) response — it is not an MCP
`isError`. It means the knowledge base has detected excessive search calls
for the session and is directing you to use `satori_exec` for further work.
The throttle is session-scoped: calls 1–3 return up to 2 results, calls 4–8
return 1 result, and call 9 or later returns a `ThrottleBlock`.

---

### `fetch_and_index`

Fetches the content at `url` (following up to 5 redirects), strips HTML
tags, and indexes the resulting text. Requires `url`.

```json
{
  "sub_command": "fetch_and_index",
  "url": "https://example.com/docs/api",
  "title": "Example API Docs"
}
```

**Return shape (success):**

```json
{ "indexed": 7 }
```

On HTTP error or fetch failure, `isError: true` is set and the response
contains the error message.

---

## `bash` (builtin)

**Purpose:** Execute code in a variety of languages on the local machine.
Runs directly inside the gateway process via the `PolyglotExecutor` — it
does not go through the `LifecycleManager` and is not a registered downstream
server.

> **IMPORTANT:** The `bash` builtin is **not discoverable via `satori_find`**.
> `satori_find` only searches the downstream server catalog; `bash` is a
> gateway-internal tool and will never appear in those results. To use it,
> call `satori_exec` with `server: "bash"` directly.

```json
{
  "server": "bash",
  "tool": "run",
  "args": { "language": "python", "code": "print('hello')" }
}
```

### Supported languages

The `language` field accepts any value from the `Language` union type
(defined in `runtime.ts`):

`javascript`, `typescript`, `python`, `shell`, `ruby`, `go`, `rust`, `php`,
`perl`, `r`, `elixir`

Not all runtimes are available on every machine — the executor will return
an error if the required runtime is not installed.

---

### `run`

Execute a code string in the specified language. Optionally run it in the
background or supply custom environment variables.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `language` | `Language` | Yes | Language to execute the code in |
| `code` | `string` | Yes | Source code to run |
| `timeout` | `number` | No | Execution timeout in milliseconds (default: 30 000) |
| `background` | `boolean` | No | Start the process in the background; returns immediately |
| `intent` | `string` | No | Semantic intent label — triggers intent-driven mode when output is large (see below) |
| `env` | `Record<string, string>` | No | Additional environment variables for the process |

```json
{
  "server": "bash",
  "tool": "run",
  "args": {
    "language": "python",
    "code": "import sys\nprint(sys.version)",
    "timeout": 5000
  }
}
```

```json
{
  "server": "bash",
  "tool": "run",
  "args": {
    "language": "shell",
    "code": "find /var/log -name '*.log' | head -20",
    "intent": "recent log files"
  }
}
```

#### Intent-driven mode

When `intent` is set and the stdout of the execution exceeds **5 000 bytes**,
the output is automatically indexed into the knowledge base instead of being
returned raw. A semantic search against `intent` is performed immediately,
and the following shape is returned instead of stdout:

```json
{
  "truncated": true,
  "intent": "recent log files",
  "results": [
    {
      "chunk_id": 3,
      "title": "exec-output",
      "heading": "",
      "snippet": "...matched snippet...",
      "type": "prose",
      "score": 0.028
    }
  ]
}
```

`results` may also be a `ThrottleBlock` (see `satori_kb` / `search` above)
if the knowledge base search limit has been reached.

---

### `run_file`

Execute an existing file on disk. Optionally inject or prepend code before
running.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | `string` | Yes | Absolute path to the file to execute |
| `language` | `Language` | Yes | Language to use when executing the file |
| `code` | `string` | No | Optional code to prepend or inject before the file is run |
| `timeout` | `number` | No | Execution timeout in milliseconds (default: 30 000) |

```json
{
  "server": "bash",
  "tool": "run_file",
  "args": {
    "path": "/tmp/analyse.py",
    "language": "python",
    "timeout": 10000
  }
}
```

---

### `batch`

Run multiple shell commands and then answer a set of semantic queries against
all their combined output. All commands are run as `shell`. Output from every
command is indexed into the knowledge base; queries are answered via BM25+RRF
search.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `commands` | `{ label: string; command: string }[]` | Yes | Shell commands to execute and index |
| `queries` | `string[]` | Yes | Semantic queries to run against the combined indexed output |
| `timeout` | `number` | No | Per-command timeout in milliseconds |

```json
{
  "server": "bash",
  "tool": "batch",
  "args": {
    "commands": [
      { "label": "disk usage", "command": "df -h" },
      { "label": "memory",     "command": "vm_stat" },
      { "label": "processes",  "command": "ps aux | head -30" }
    ],
    "queries": [
      "disk space available",
      "high memory usage"
    ],
    "timeout": 5000
  }
}
```

**Return shape:**

```json
{
  "results": {
    "disk space available": [
      {
        "chunk_id": 1,
        "title": "disk usage",
        "heading": "",
        "snippet": "...**disk** space **available**...",
        "type": "prose",
        "score": 0.042
      }
    ],
    "high memory usage": [ "...KbSearchResult or ThrottleBlock..." ]
  }
}
```

Each query maps to either a `KbSearchResult[]` array or a `ThrottleBlock`.
