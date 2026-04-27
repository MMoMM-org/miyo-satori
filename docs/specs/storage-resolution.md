# Storage Resolution — Design Spec

> Status: Draft, agreed in principle (2026-04-27). Not yet implemented.
> Companion spec: `(client, session_id)` model — separate doc, lands after this.
> Prerequisite (resolved): `busy_timeout` for concurrent writers is already
> provided by better-sqlite3's default (5000 ms). Regression-tested in
> `src/__tests__/db-base.test.ts`.

## Problem

Configuration today is multi-layer: global (`~/.satori/config.toml`) →
project (`<project_dir>/satori.toml`) → repo (`<cwd>/satori.toml`),
merged by `src/config/loader.ts`.

Data storage is *not* multi-layer. Three files always land at
`<cwd>/.satori/{db.sqlite, kb.sqlite, scanner.log}` regardless of how
config was resolved. There is no way to share storage across sibling
repos that belong to the same project, no way to say "use my global
brain", no way to point storage at an explicit path.

Concrete failure case: I have four repos under `~/Coding/MiYo/`
(Satori, Tomo, Kado, Hashi). I want them to share captures and KB so
that work in one repo informs context in another. Today each repo gets
its own isolated `.satori/` dir; they can't see each other.

## Design

A new resolver determines a single **storage directory** at startup.
All three data files (`db.sqlite`, `kb.sqlite`, `scanner.log`) live
under it. The resolver mirrors the config layering and adds an explicit
override for shared/named storage.

### Path convention

Storage directories drop the leading dot to mirror `satori.toml`:

| Old | New |
|---|---|
| `<repoRoot>/.satori/db.sqlite` | `<repoRoot>/satori/db.sqlite` |
| `<repoRoot>/.satori/kb.sqlite` | `<repoRoot>/satori/kb.sqlite` |
| `<repoRoot>/.satori/scanner.log` | `<repoRoot>/satori/scanner.log` |

`satori.toml` and `satori/` are siblings in the project root. Visible
in `ls`, easy to tab-complete, no hidden-dir confusion.

`.gitignore` entries need updating from `.satori/` to `satori/`.

### Resolution order (highest precedence first)

1. **CLI flag**: `--storage <value>`
2. **Merged toml**: `[context] storage_dir = "<value>"` (post g/p/r merge)
3. **Default**: `<repoRoot>/satori/`

### `<value>` semantics

| Value | Resolves to |
|---|---|
| `"repo"` | `<repoRoot>/satori/` (= the default, made explicit) |
| `"project"` | `<project_dir>/satori/` (uses the existing `project_dir` from merged config; error if `project_dir` not set) |
| `"global"` | `~/.satori/data/` |
| `"<bare-name>"` | `~/.satori/projects/<bare-name>/` (named project storage) |
| `"/abs/path"` or `"~/path"` | Used as-is, expanded |

**Note on global path:** Config lives at `~/.satori/config.toml` (existing).
Global data lands at `~/.satori/data/{db.sqlite, kb.sqlite, scanner.log}`
to keep config and data files distinct under the same parent. Named
projects live at `~/.satori/projects/<name>/`.

### CLI flags

| Flag | Purpose | Notes |
|---|---|---|
| `--root <dir>` | Override `repoRoot` (= where to look for `satori.toml`) | Optional. Default = `process.cwd()`. Useful when launching outside Claude Code. |
| `--storage <value>` | Override storage location | Takes any of the value forms above. Wins over toml setting. |
| `--project <name>` | Alias for `--storage <name>` | Sugar; resolves to named-project form. |

`--client <name>` is **not** part of this spec. It belongs to the
companion `(client, session_id)` work.

### Configuration sketch

```toml
# satori.toml — repo-level, MiYo case
project_dir = "~/Coding/MiYo"

[context]
storage_dir = "miyo"   # → ~/.satori/projects/miyo/
```

Or per-flag, no toml change:

```json
{
  "mcpServers": {
    "satori-miyo": {
      "command": "miyo-satori",
      "args": ["--storage", "miyo"]
    }
  }
}
```

### What stays configurable separately

`[context] db_path` and `[security] audit_log` exist today and remain
working as overrides for individual files within the storage dir. The
new `storage_dir` sets the directory; per-file paths still win when
explicitly set. Most users will leave the per-file paths unset.

`KnowledgeDB.kbPath` is currently hardcoded — it gets a config field
(`[context] kb_path`) for symmetry, but defaults to `<storage_dir>/kb.sqlite`.

### Resolution algorithm (pseudocode)

```ts
function resolveStorageDir(args, config, repoRoot): string {
  const raw = args.storage ?? config.context?.storage_dir ?? "repo";

  if (raw.startsWith("/") || raw.startsWith("~")) return expandPath(raw);
  if (raw === "repo")    return join(repoRoot, "satori");
  if (raw === "project") {
    if (!config.project_dir) throw new Error("storage_dir = \"project\" but no project_dir set");
    return join(expandPath(config.project_dir), "satori");
  }
  if (raw === "global")  return join(homedir(), ".satori", "data");
  // bare name
  return join(homedir(), ".satori", "projects", raw);
}
```

## Out of scope

- **Migration of existing data**: pre-release, no production users.
  Existing `.satori/` dirs from dev work stay where they are; users (=
  us) wipe and recreate. No migration code in this spec.
- **`(client, session_id)` model**: separate spec. The shared-storage
  use case (multiple repos → one DB) needs `client` to differentiate
  rows; until that lands, shared storage works but cross-repo queries
  return mixed results.
- **Per-runtime storage** (e.g. one location for `db.sqlite`, another
  for `kb.sqlite`): possible via the existing per-file overrides.
  Storage_dir is the unifying default, not the only knob.

## Open questions

1. **`--root` in conjunction with `process.argv[2] === 'install-hooks'`**:
   the existing CLI dispatch checks argv[2] for the install-hooks
   subcommand. New flags need to route around that check. Trivially
   done with a proper arg parser, but worth noting.

2. **Auto-create vs. explicit**: should `~/.satori/projects/<name>/` be
   auto-created on first use, or require the user to `mkdir` it first?
   Recommend auto-create with stderr log line ("creating named project
   storage at …"), to match the existing `mkdirSync` behavior in
   `db-base.ts:12`.

3. **`storage_dir = "project"` without `project_dir`**: hard error at
   startup, or fall back to repo with stderr warning? Recommend hard
   error — silent fallback hides config bugs.

## Implementation plan (when we get there)

1. Schema field `storage_dir?: string` on `ContextConfig` (`src/config/schema.ts`).
2. New file `src/config/storage.ts` exporting `resolveStorageDir`.
3. Wire into `src/index.ts`: replace the three `join(repoRoot, …)` paths
   with `join(storageDir, …)`. Drop `KnowledgeDB.kbPath` static helper
   in favour of explicit param.
4. Update `satori.toml.example` and `docs/configuration.md` with the
   `[context] storage_dir` section and value table.
5. Update `.gitignore` template (and the repo's own `.gitignore`):
   `satori/` instead of `.satori/`.
6. Tests: unit-test `resolveStorageDir` against the value table,
   integration-test that startup honours `--storage` and toml setting.

## Companion: `busy_timeout` (resolved)

Shared storage produces concurrent SQLite writers (multiple Satori
processes pointing at the same DB). Investigation showed
`better-sqlite3` already sets `busy_timeout = 5000` as its built-in
default, surviving Satori's WAL pragma application — verified by a
behavioral assertion in `src/__tests__/db-base.test.ts`. No code change
needed; the prerequisite is satisfied for both the existing
parallel-Claudes-in-same-repo case and the new shared-storage case.
