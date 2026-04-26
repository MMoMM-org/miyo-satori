# miyo-satori

miyo-satori is an MCP gateway server that routes tool calls to downstream MCP servers while capturing session context. It sits between Claude Code and your MCP servers, recording activity into a local SQLite database and providing tools for context retrieval, tool discovery, and schema inspection.

## Quick start

No install needed — add the entry below to your MCP config and `npx` will fetch and run satori on demand.

## MCP config

Add the following to your Claude Code settings (`.claude/settings.json` or `~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "satori": {
      "command": "npx",
      "args": ["-y", "miyo-satori"]
    }
  }
}
```

The first launch downloads and caches the package; subsequent launches start instantly.

### Local development

If you are working on satori itself, clone the repo and point the MCP config at the built file:

```bash
git clone https://github.com/MMoMM-org/miyo-satori.git
cd miyo-satori
npm install && npm run build
```

```json
{
  "mcpServers": {
    "satori": {
      "command": "node",
      "args": ["/absolute/path/to/miyo-satori/dist/src/index.js"]
    }
  }
}
```

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

Satori ships Claude Code hooks that capture file activity, git operations, and other session events. The `miyo-satori install-hooks` subcommand registers them in your Claude Code `settings.json` for you.

For stable hook paths across satori updates, install satori globally so the install path does not move:

```bash
npm install -g miyo-satori
miyo-satori install-hooks
```

This registers hook entries in `<cwd>/.claude/settings.json` if it exists, otherwise `~/.claude/settings.json`. Override the destination with `--settings <path>` or the `SATORI_HOOKS_SETTINGS` environment variable. Re-run the same command after `npm install -g miyo-satori@latest` to refresh the paths if the global location ever moves.

`npx -y miyo-satori install-hooks` also works but writes paths into the npx cache directory, which gets invalidated on version bumps. You'll see a warning when the install detects this.

## Usage example

```
satori_find("read file")
  → returns: filesystem:read_file

satori_schema("filesystem", "read_file")
  → returns input schema with required "path" parameter

satori_exec("filesystem", "read_file", { "path": "/path/to/file" })
  → routes call to the filesystem server, captures output to context DB
```

## Releasing a new version

Releases are automated via GitHub Actions. Pushing a `v*` tag triggers a workflow that runs typecheck, tests, build, and `npm publish` with provenance.

```bash
git checkout main && git pull
npm version patch        # or: minor / major
git push --follow-tags
```

That is the whole release flow. The workflow at `.github/workflows/release.yml` enforces that the tag matches `package.json` so the two cannot drift.

For pre-release tags (e.g. `v0.2.0-beta.0`) the workflow still publishes; consumers opt in via `npx -y miyo-satori@beta`.
