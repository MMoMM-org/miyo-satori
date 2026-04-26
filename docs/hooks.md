# Hooks Setup

Claude Code hooks wire satori into your session lifecycle so context capture works passively — no manual calls required.

## Why Hooks Are Needed

Satori's context database is populated by hooks, not by direct tool calls. Without hooks:

- `satori_context(status)` returns a capture count of 0
- `satori_context(query)` has nothing to search
- `satori_context(restore)` returns an empty snapshot

The **PostToolUse** hook runs after every tool call and records the output to the context DB. The **PreCompact** hook fires before Claude Code compacts the conversation and writes a session guide snapshot so continuity survives context resets. The **SessionStart** hook restores that snapshot at the beginning of a new session. The **UserPromptSubmit** hook captures each user message for context. The **PreToolUse** hook runs before tool execution to support intent-driven pre-processing.

All five hooks are needed for full satori functionality.

---

## Available Hooks

| Event | Script | Purpose |
|-------|--------|---------|
| `PostToolUse` | `post-tool-use.js` | Captures tool output to context DB after every tool call |
| `PreCompact` | `pre-compact.js` | Writes session guide snapshot before conversation compaction |
| `SessionStart` | `session-start.js` | Restores session guide at the start of a new session |
| `UserPromptSubmit` | `user-prompt-submit.js` | Captures user messages for context |
| `PreToolUse` | `pre-tool-use.js` | Pre-processes tool calls for intent-driven mode |

---

## Setup

The `miyo-satori install-hooks` subcommand registers all five hooks in your Claude Code `settings.json` for you. For stable hook paths across satori updates, install satori globally so the install path does not move:

```bash
npm install -g miyo-satori
miyo-satori install-hooks
```

By default this writes to `<cwd>/.claude/settings.json` if it exists, otherwise `~/.claude/settings.json`. Override with `--settings <path>` or the `SATORI_HOOKS_SETTINGS` environment variable.

The command is idempotent — re-running adds nothing if the hooks are already there. After upgrading satori (`npm install -g miyo-satori@latest`), run `miyo-satori install-hooks` once more to refresh the paths in case the global install location changed.

`npx -y miyo-satori install-hooks` also works but writes paths into the npx cache directory, which gets invalidated on version bumps. The command warns when it detects this.

---

## Verify

After running `install-hooks`, restart Claude Code, then:

1. Make any tool call (e.g., a `satori_find` or `satori_manage(list)` call).
2. Call `satori_context(status)`.

The response should show a `captureCount` greater than 0:

```json
{
  "captureCount": 1,
  "lastEvent": "...",
  "dbPath": "..."
}
```

A `captureCount` of 0 after a tool call means the PostToolUse hook is not running — check that:

- `miyo-satori install-hooks` ran without errors and reported the settings file path
- Claude Code was restarted after the install
- The hook entry is present in `settings.json` and the path it points to actually exists

---

## See Also

- [Getting Started](getting-started.md) — full setup including MCP registration
- [Tools — satori_context](tools.md#satori_context) — restore, query, status, flush sub-commands
- [Concepts — Session Continuity](concepts.md#session-continuity) — how PreCompact and SessionStart work together
