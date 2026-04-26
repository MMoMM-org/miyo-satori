# Satori Configuration Reference

Satori is configured via TOML files. This document covers every supported field, their types, defaults, and usage examples.

---

## Config Resolution Order

Satori merges configuration from up to three layers, in this order:

1. **Global** — `~/.satori/config.toml`
2. **Project** — `satori.toml` in the directory pointed to by `project_dir`
3. **Repo** — `satori.toml` in the nearest ancestor of the current working directory

Each later layer overrides the earlier layer for **scalar fields**. For `[[servers]]` arrays, entries are merged by `name` — a server definition in a later layer replaces any entry with the same name from an earlier layer, and new entries are appended.

This means global defaults apply everywhere, project config extends them across all repos in a project, and each repo can still override individual values or add repo-specific servers without repeating shared configuration.

---

## `project_dir`

| Field | Type | Default |
|---|---|---|
| `project_dir` | `string` (path) | _(unset)_ |

`project_dir` points to a shared project directory that contains its own `satori.toml`. It is intended for situations where multiple repos belong to the same logical project (for example, several repos under `~/Kouzou/projects/miyo/`). When set, that directory's `satori.toml` is loaded as the **project layer** between global and repo config.

Set it by adding the line to the top of the repo-level `satori.toml`:

```toml
project_dir = "~/Kouzou/projects/myproject"
```

Once set, the project-layer config is automatically loaded on every subsequent Satori startup in that repo.

---

## [gateway]

Gateway controls how Satori integrates with the Claude Code environment at startup.

### `auto_register_mcp_json`

| Type | Default |
|---|---|
| `boolean` | `false` |

When `true`, Satori imports any servers defined in `.mcp.json` at startup, appends them to `satori.toml`, and renames the file to `.mcp.satori-json` so the import only happens once. This lets you bootstrap from an existing `.mcp.json` without duplicating entries.

Both transports are supported:

- **stdio** entries (`command`, `args`, `env`) are imported as `runtime = "npx"`.
- **HTTP** entries (`type: "http"` or any entry with a `url`) are imported as `runtime = "external"` with `url` and `headers` carried over.
- **SSE** entries (`type: "sse"`) are skipped with a warning — the gateway only speaks Streamable HTTP.

```toml
[gateway]
auto_register_mcp_json = true
```

---

## [context]

Context controls the session-guide database — the persistent store Satori uses to surface relevant project knowledge to Claude at the start of each session.

### `db_path`

| Type | Default |
|---|---|
| `string` (path) | `".satori/db.sqlite"` |

Path to the SQLite database file, relative to the repo root. Change this if you want to store the database outside the default `.satori/` directory, for example on a shared volume.

```toml
[context]
db_path = ".satori/db.sqlite"
```

### `session_guide_max_bytes`

| Type | Default |
|---|---|
| `number` | `2048` |

Maximum size in bytes of the XML session-guide snapshot injected into the Claude session context at startup. Larger values include more history at the cost of increased context usage. Tune this based on your available context budget.

```toml
[context]
session_guide_max_bytes = 4096
```

### `retain_days`

| Type | Default |
|---|---|
| `number` | `30` |

Number of days to keep session captures before they are pruned from the database. Older entries are removed automatically on startup. Set to a higher value for longer project memory, or lower to keep the database small.

```toml
[context]
retain_days = 90
```

---

## [lifecycle]

Lifecycle controls timing and startup behavior for managed server processes.

### `npx_startup_timeout_ms`

| Type | Default |
|---|---|
| `number` | `30000` |

Maximum time in milliseconds to wait for an `npx`-runtime server to become ready. If the server does not respond within this window, Satori marks it as failed and does not route calls to it. Increase this on slow networks or when using packages that require large downloads on first run.

```toml
[lifecycle]
npx_startup_timeout_ms = 60000
```

---

## [security]

Security controls Satori's tool-call scanning and audit logging. Scans evaluate tool calls against a policy and produce one of three statuses:

| Status | Meaning |
|---|---|
| `pass` | Call is allowed to proceed |
| `warn` | Call is allowed but flagged in the audit log |
| `blocked` | Call is rejected before it reaches the downstream server |

### `startup_scan`

| Type | Default |
|---|---|
| `boolean` | `true` |

When `true`, Satori scans server configurations at startup to detect obviously unsafe entries (for example, servers with commands that include shell injection patterns). Misconfigurations are logged before any server is started.

### `runtime_scan`

| Type | Default |
|---|---|
| `boolean` | `true` |

When `true`, Satori scans tool arguments before every call to a downstream server. This is the primary runtime guard against prompt-injection and argument-manipulation attacks. Disabling it improves throughput but removes call-level protection.

### `return_scan`

| Type | Default |
|---|---|
| `boolean` | `false` |

When `true`, Satori scans tool responses returned by downstream servers before passing them back to Claude. This guards against data-exfiltration payloads embedded in server responses. Disabled by default because it adds latency to every tool call.

### `audit_log`

| Type | Default |
|---|---|
| `string` (path) | `".satori/scanner.log"` |

Path to the scanner audit log file, relative to the repo root. All scan events (`pass`, `warn`, `blocked`) are appended here in JSONL format. Set to an absolute path to share a single log across repos.

```toml
[security]
startup_scan = true
runtime_scan = true
return_scan = false
audit_log = ".satori/scanner.log"
```

---

## [[servers]]

`[[servers]]` is a TOML array of tables. Each entry defines one downstream MCP server that Satori manages or proxies. Entries are identified by `name` and merged across config layers by name.

### Common fields (all runtimes)

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | `string` | Yes | — | Unique identifier for this server |
| `runtime` | `string` | Yes | — | One of `npx`, `docker`, `external`, `builtin` |
| `enabled` | `boolean` | No | `true` | Set to `false` to disable without removing the entry |
| `handler` | `string` | No | `"passthrough"` | Handler to apply to calls routed to this server |
| `env` | `table` | No | — | Environment variables passed to the server process |

### `npx` runtime

Starts the server by running an npm package via `npx`. Use for standard MCP servers distributed on npm.

| Field | Type | Required | Description |
|---|---|---|---|
| `command` | `string` | Yes | The npm package name (or scoped package) to execute |
| `args` | `string[]` | No | Arguments passed to the package after it starts |

```toml
[[servers]]
name = "filesystem"
runtime = "npx"
command = "@modelcontextprotocol/server-filesystem"
args = ["/path/to/allowed/dir"]
handler = "passthrough"
enabled = true
```

### `docker` runtime

Starts the server inside a Docker container. Use for servers that need an isolated environment or specific system dependencies.

| Field | Type | Required | Description |
|---|---|---|---|
| `image` | `string` | Yes | Docker image to run (including tag) |
| `args` | `string[]` | No | Arguments passed to the container's entrypoint |

```toml
[[servers]]
name = "my-docker-server"
runtime = "docker"
image = "ghcr.io/example/my-mcp-server:latest"
args = ["--port", "8080"]
enabled = true
```

### `external` runtime

Connects to an already-running MCP server over HTTP using the Streamable HTTP transport. Use for servers you start and manage outside of Satori, or for remote servers.

| Field | Type | Required | Description |
|---|---|---|---|
| `url` | `string` | Yes | Full URL of the running MCP endpoint, e.g. `http://127.0.0.1:23026/mcp` |
| `headers` | `table` | No | HTTP headers sent with every request (supports `${VAR}` env interpolation) |

```toml
[[servers]]
name = "kado"
runtime = "external"
url = "http://127.0.0.1:23026/mcp"
headers = { Authorization = "Bearer ${KADO_KEY}" }
enabled = true
```

If Satori itself runs inside a container, replace `127.0.0.1` with `host.docker.internal` (and have the downstream server bind to a host-reachable interface, not pure loopback).

---

## Env Var Interpolation

String values in `[[servers]]` support `${VAR_NAME}` interpolation. At startup, Satori expands these references from the current process environment. Use this to keep secrets out of `satori.toml` and out of version control.

```toml
[[servers]]
name = "github"
runtime = "npx"
command = "@modelcontextprotocol/server-github"
env = { GITHUB_TOKEN = "${GITHUB_TOKEN}" }
enabled = true
```

When `GITHUB_TOKEN` is set in your shell environment (for example via a `.env` file or a secrets manager), Satori substitutes the value at startup. If the variable is not set, Satori passes an empty string and logs a warning.

---

## Complete Example

The following `satori.toml` shows all sections together with representative values:

```toml
# satori.toml — repo root

# project_dir = "~/Kouzou/projects/myproject"

[gateway]
auto_register_mcp_json = false

[context]
db_path = ".satori/db.sqlite"
session_guide_max_bytes = 2048
retain_days = 30

[lifecycle]
npx_startup_timeout_ms = 30000

[security]
startup_scan = true
runtime_scan = true
return_scan = false
audit_log = ".satori/scanner.log"

[[servers]]
name = "filesystem"
runtime = "npx"
command = "@modelcontextprotocol/server-filesystem"
args = ["/home/user/projects"]
enabled = true

[[servers]]
name = "github"
runtime = "npx"
command = "@modelcontextprotocol/server-github"
env = { GITHUB_TOKEN = "${GITHUB_TOKEN}" }
enabled = true

[[servers]]
name = "build-tools"
runtime = "docker"
image = "ghcr.io/example/build-mcp:1.2.0"
args = ["--workspace", "/workspace"]
enabled = true

[[servers]]
name = "remote-api"
runtime = "external"
url = "https://api.internal.example.com/mcp"
headers = { Authorization = "Bearer ${INTERNAL_API_KEY}" }
enabled = true
```
