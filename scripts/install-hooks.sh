#!/usr/bin/env bash
#
# install-hooks.sh — Register Satori capture hooks in Claude Code settings.json
#
# Adds PostToolUse, PreCompact, and SessionStart entries pointing to the
# compiled hook scripts in dist/hooks/scripts/.
#
# Idempotent: safe to run multiple times — will not duplicate entries.
# Requires: node (in PATH), python3 (in PATH)
# Compatible: bash 3.2+
#
# Usage:
#   bash modules/satori/scripts/install-hooks.sh [--settings <path>]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SATORI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$SATORI_DIR/dist/hooks/scripts"

# Default settings file: project-level if in a repo, otherwise global
if [ -n "${SATORI_HOOKS_SETTINGS:-}" ]; then
  SETTINGS_FILE="$SATORI_HOOKS_SETTINGS"
elif [ -f "$(pwd)/.claude/settings.json" ]; then
  SETTINGS_FILE="$(pwd)/.claude/settings.json"
else
  SETTINGS_FILE="$HOME/.claude/settings.json"
fi

# Allow --settings override
while [ "$#" -gt 0 ]; do
  case "$1" in
    --settings)
      SETTINGS_FILE="$2"
      shift 2
      ;;
    *)
      echo "[satori] install-hooks: unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# Verify dist exists
if [ ! -d "$DIST_DIR" ]; then
  echo "[satori] install-hooks: dist/ not found at $DIST_DIR" >&2
  echo "[satori] install-hooks: run 'npm run build' in $SATORI_DIR first" >&2
  exit 1
fi

POST_TOOL_CMD="node $DIST_DIR/post-tool-use.js"
PRE_COMPACT_CMD="node $DIST_DIR/pre-compact.js"
SESSION_START_CMD="node $DIST_DIR/session-start.js"

# Ensure settings file exists
mkdir -p "$(dirname "$SETTINGS_FILE")"
if [ ! -f "$SETTINGS_FILE" ]; then
  echo '{}' > "$SETTINGS_FILE"
fi

# Write hook entries via python3 (handles JSON correctly)
python3 - "$SETTINGS_FILE" "$POST_TOOL_CMD" "$PRE_COMPACT_CMD" "$SESSION_START_CMD" << 'PYEOF'
import json, sys

settings_file  = sys.argv[1]
post_tool_cmd  = sys.argv[2]
pre_compact_cmd = sys.argv[3]
session_start_cmd = sys.argv[4]

with open(settings_file) as f:
    data = json.load(f)

data.setdefault('hooks', {})

def add_hook_if_absent(hooks_dict, event, command):
    """Add hook entry only if command not already present (idempotency check)."""
    entries = hooks_dict.get(event, [])
    for entry in entries:
        for hook in entry.get('hooks', []):
            if hook.get('command') == command:
                return False  # already present
    entries.append({
        "matcher": "",
        "hooks": [{"type": "command", "command": command}]
    })
    hooks_dict[event] = entries
    return True

added = []
if add_hook_if_absent(data['hooks'], 'PostToolUse',  post_tool_cmd):
    added.append('PostToolUse')
if add_hook_if_absent(data['hooks'], 'PreCompact',   pre_compact_cmd):
    added.append('PreCompact')
if add_hook_if_absent(data['hooks'], 'SessionStart', session_start_cmd):
    added.append('SessionStart')

with open(settings_file, 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')

if added:
    print('[satori] hooks registered: ' + ', '.join(added))
    print('[satori] settings: ' + settings_file)
else:
    print('[satori] hooks already registered (no changes)')
PYEOF
