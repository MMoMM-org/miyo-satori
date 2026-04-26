# miyo-satori

## Core Philosophy
MCP gateway server that routes tool calls to downstream MCP servers while capturing session context. Sits between Claude Code and downstream MCP servers, persisting activity to SQLite and exposing tools for context retrieval, tool discovery, and schema inspection.

## Project Membership
<!-- Part of the MiYo ecosystem: Kokoro, Kouzou, Kado, Tomo, Hashi, Seigyo, Satori -->
<!-- Cross-repo handoffs flow through _inbox/ and _outbox/ symlinks -->

## Memory & Context
@docs/ai/memory/memory.md

## Routing Rules
<!-- Run /memory-add to capture learnings. Routing reference: docs/ai/memory/routing-reference.md -->
- Personal/workflow corrections → global (~/.claude/includes/)
- Repo conventions/style → docs/ai/memory/general.md
- Tool/CI/build knowledge → docs/ai/memory/tools.md
- Domain/business rules → docs/ai/memory/domain.md
- Architectural decisions → docs/ai/memory/decisions.md
- Current focus/blockers → docs/ai/memory/context.md
- Bugs/fixes → docs/ai/memory/troubleshooting.md

## Build & Dev Commands
- `npm install` — install dependencies
- `npm run build` — compile TypeScript (`tsc`) to `dist/`
- `npm run typecheck` — type-check without emitting (`tsc --noEmit`)
- `npm test` — run test suite (`vitest run`)
- `npm run dev` — watch mode (`tsx watch src/index.ts`)

## Known Quirks
- MCP server entry must use absolute path in Claude Code config — relative paths fail.
- Configuration merges three levels: global (`~/.satori/config.toml`) → project → repo (`satori.toml`).
- ESM project (`"type": "module"`) — use `.js` extensions in import paths from TypeScript.
- `_outbox/` and `_inbox/` are MiYo cross-repo handoff dirs — `_inbox/` is a symlink into another repo's outbox; never commit local edits there.
- Editing on `main`/`master` is blocked by `block-main-edits.sh` PreToolUse hook — branch first.

## Stack-Specific Rules
## TypeScript Rules
- Strict mode: `"strict": true` in tsconfig — no exceptions
- No `any` — use `unknown` + narrowing or define a proper type
- Import order: node builtins → external → internal (enforced by ESLint/biome)
- Prefer explicit return types on public functions
