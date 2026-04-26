# miyo-satori

miyo-satori is an MCP gateway server that routes tool calls to downstream MCP servers while capturing session context. It sits between Claude Code and your MCP servers, recording activity into a local SQLite database and providing tools for context retrieval, tool discovery, and schema inspection.

## Quick start

```bash
npm install && npm run build
```

Then add satori to your MCP config.

## MCP config

Add the following to your Claude Code settings (`.claude/settings.json` or `~/.claude/settings.json`):

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

The path must be absolute — relative paths fail in Claude Code.

## Configuration: satori.toml

Satori merges configuration from three levels (global → project → repo). Create a `satori.toml` at the repo root (or `~/.satori/config.toml` for global defaults). See `satori.toml.example` for all available fields with comments.

## Tools

| Tool | Description |
|------|-------------|
| `satori_context` | Retrieve the current session snapshot — active files, task state, decisions, and recent MCP tool calls |
| `satori_manage` | Start, stop, or inspect downstream server status; register servers at runtime |
| `satori_find` | Search the tool catalog across all registered servers by keyword |
| `satori_schema` | Get the full input schema for a specific tool on a specific server |
| `satori_exec` | Route a tool call to a downstream server; starts the server if not running |
| `satori_kb` | Knowledge base search (index/search/fetch_and_index) |

> **Note:** `bash` is a built-in code execution tool (not listed as a separate MCP tool — use directly as `satori_exec("bash", ...)`)

## Documentation

- [`docs/getting-started.md`](docs/getting-started.md) — Setup and first tool call
- [`docs/concepts.md`](docs/concepts.md) — Architecture: gateway, context DB, knowledge base
- [`docs/configuration.md`](docs/configuration.md) — All satori.toml fields and server configuration
- [`docs/tools.md`](docs/tools.md) — Complete tool API reference
- [`docs/hooks.md`](docs/hooks.md) — Claude Code hooks setup for passive context capture

## Hooks setup

Satori ships Claude Code hooks that capture file activity, git operations, and other session events. Add the entries from `.claude-plugin/hooks/hooks.json` to your Claude Code `hooks` configuration (`.claude/settings.json`).

## Usage example

```
satori_find("read file")
  → returns: filesystem:read_file

satori_schema("filesystem", "read_file")
  → returns input schema with required "path" parameter

satori_exec("filesystem", "read_file", { "path": "/path/to/file" })
  → routes call to the filesystem server, captures output to context DB
```
