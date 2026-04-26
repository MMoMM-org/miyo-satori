# Getting Started with miyo-satori

miyo-satori is an MCP gateway that sits between Claude Code and your downstream MCP servers.
It routes tool calls, captures session context to a local SQLite database, and exposes tools
for discovery, schema inspection, and execution.

This guide walks through the standalone setup path. If you installed satori through The Custom
Startup (`install.sh`), skip to [TCS-integrated path](#tcs-integrated-path) at the end.

---

## 1. Prerequisites

- **Node.js ≥ 18** and **npm** must be installed on your machine.

Verify:

```bash
node --version   # must be v18 or higher
npm --version
```

---

## 2. Build

From the `modules/satori/` directory:

```bash
npm install && npm run build
```

This compiles the TypeScript source to `dist/src/index.js`.

---

## 3. Configure satori.toml

Create a `satori.toml` at your repo root with at least one downstream server. The minimal
working configuration below registers a filesystem server via `npx`:

```toml
# satori.toml — repo root

[[servers]]
name = "filesystem"
runtime = "npx"
command = "@modelcontextprotocol/server-filesystem"
args = ["/your/allowed/directory"]
enabled = true
```

That is all that is required to get satori running with one server. All other sections
(`[gateway]`, `[context]`, `[lifecycle]`, `[security]`) have safe defaults and can be omitted
until you need to tune them.

For the full list of configuration fields and multi-layer (global → project → repo) merging
rules, see [configuration.md](configuration.md).

---

## 4. Register with Claude Code

Add satori to your Claude Code MCP settings. This can be done in `.mcp.json` (repo-level) or
in `~/.claude/settings.json` (global):

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

> **Warning: absolute paths are required.**
>
> Replace `/absolute/path/to/modules/satori/dist/src/index.js` with the real absolute path on
> your machine. **Relative paths fail silently** — Claude Code spawns MCP server processes from
> a different working directory than your shell, so a path like `./modules/satori/dist/src/index.js`
> will resolve to the wrong location and satori will not start.
>
> To get the absolute path, run this from the `modules/satori/` directory:
>
> ```bash
> echo "$(pwd)/dist/src/index.js"
> ```

After saving the config, restart Claude Code (or reload MCP servers) for the change to take
effect.

---

## 5. Verify

Once Claude Code restarts, call `satori_manage` to confirm the gateway is running and your
server is registered:

```json
{
  "sub_command": "list"
}
```

A healthy response lists all registered servers with their current state:

```json
[
  {
    "name": "filesystem",
    "runtime": "npx",
    "enabled": true,
    "handler": "passthrough"
  }
]
```

If the array is empty, satori started but could not read `satori.toml`. Check that the file
is at the repo root and contains at least one `[[servers]]` block.

See [tools.md](tools.md) for the full `satori_manage` sub-command reference.

---

## 6. First Tool Call

Satori exposes a three-step flow: **discover → inspect → execute**.

### Step 1: Discover — `satori_find`

Search for tools across all registered downstream servers by keyword:

```json
{
  "query": "read file"
}
```

Example response:

```json
[
  {
    "server": "filesystem",
    "tool": "read_file",
    "description": "Read the complete contents of a file from the filesystem",
    "state": "stopped"
  }
]
```

The `state` field shows the server's lifecycle state. `stopped` is expected here — servers
start on first use (hot-start).

### Step 2: Inspect — `satori_schema`

Retrieve the full input schema for a specific tool before calling it:

```json
{
  "server": "filesystem",
  "tool": "read_file"
}
```

Example response:

```json
{
  "name": "read_file",
  "description": "Read the complete contents of a file from the filesystem",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": { "type": "string" }
    },
    "required": ["path"]
  }
}
```

### Step 3: Execute — `satori_exec`

Call the tool through the gateway. Satori starts the downstream server on the first call
and reuses the running process for all subsequent calls — no per-call startup overhead after
the first invocation.

```json
{
  "server": "filesystem",
  "tool": "read_file",
  "args": {
    "path": "/your/allowed/directory/hello.txt"
  }
}
```

The response is passed through directly from the downstream server. Satori also captures the
output to the context database for session continuity.

---

## 7. TCS-integrated path

If you installed satori through The Custom Startup `install.sh`, the following is configured
automatically:

- The MCP server entry (with an absolute path) is written to your Claude Code settings.
- The Claude Code hooks are registered via `miyo-satori install-hooks` so that file edits,
  git operations, and other session events are captured. See [hooks.md](hooks.md) for hook
  details.

**After TCS installation, customize:**

- Add your downstream servers to `satori.toml` at the repo root (or globally at
  `~/.satori/config.toml`). The TCS install does not add any downstream servers.
- If multiple repos share a project, set a shared project directory:
  `satori_manage(set_project_dir, {dir: "/absolute/path/to/project"})`.
  See [configuration.md](configuration.md) for the three-layer merge model.

---

*Related documentation: [configuration.md](configuration.md) · [hooks.md](hooks.md) · [tools.md](tools.md)*
