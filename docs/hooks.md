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

Satori ships five hooks in `hooks/hooks.json`:

| Event | Script | Purpose |
|-------|--------|---------|
| `PostToolUse` | `dist/hooks/scripts/post-tool-use.js` | Captures tool output to context DB after every tool call |
| `PreCompact` | `dist/hooks/scripts/pre-compact.js` | Writes session guide snapshot before conversation compaction |
| `SessionStart` | `dist/hooks/scripts/session-start.js` | Restores session guide at the start of a new session |
| `UserPromptSubmit` | `dist/hooks/scripts/user-prompt-submit.js` | Captures user messages for context |
| `PreToolUse` | `dist/hooks/scripts/pre-tool-use.js` | Pre-processes tool calls for intent-driven mode |

---

## Setup

Add the hooks to `.claude/settings.json` in your project root (or `~/.claude/settings.json` for global scope). The hook commands must be run from the satori module directory — use absolute paths.

Replace `/absolute/path/to/modules/satori` with the real path on your machine.

```json
{
  "hooks": [
    {
      "event": "PostToolUse",
      "command": "node dist/hooks/scripts/post-tool-use.js"
    },
    {
      "event": "PreCompact",
      "command": "node dist/hooks/scripts/pre-compact.js"
    },
    {
      "event": "SessionStart",
      "command": "node dist/hooks/scripts/session-start.js"
    },
    {
      "event": "UserPromptSubmit",
      "command": "node dist/hooks/scripts/user-prompt-submit.js"
    },
    {
      "event": "PreToolUse",
      "command": "node dist/hooks/scripts/pre-tool-use.js"
    }
  ]
}
```

If your `settings.json` already has a `"hooks"` array, merge the entries — do not replace the existing array.

> **Note:** The hook scripts are compiled TypeScript. Run `npm run build` inside the satori module directory before activating hooks, or the `dist/` files will not exist.

---

## Verify

After saving `settings.json`, confirm hooks are active:

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
- The `dist/` directory exists (run `npm run build` if not)
- The hook entry is present in `settings.json`
- Claude Code was restarted after editing `settings.json`

---

## See Also

- [Getting Started](getting-started.md) — full setup including MCP registration
- [Tools — satori_context](tools.md#satori_context) — restore, query, status, flush sub-commands
- [Concepts — Session Continuity](concepts.md#session-continuity) — how PreCompact and SessionStart work together
