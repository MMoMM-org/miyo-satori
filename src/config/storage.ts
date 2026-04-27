import { join, isAbsolute } from 'path';
import { homedir } from 'os';
import type { SatoriConfig } from './schema.js';

export interface StorageOverrides {
  /** From CLI flag --storage or --project (project resolves to bare-name form). */
  storage?: string;
}

function expandTilde(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

/**
 * Resolve the directory where Satori writes db.sqlite, kb.sqlite, scanner.log.
 *
 * Precedence (highest first):
 *   1. CLI override (overrides.storage)
 *   2. [context] storage_dir from merged config
 *   3. Default: "<repoRoot>/satori/"
 *
 * Value forms:
 *   - "repo"           → "<repoRoot>/satori/"
 *   - "project"        → "<project_dir>/satori/"  (errors if project_dir not set)
 *   - "global"         → "~/.satori/data/"
 *   - "<bare-name>"    → "~/.satori/projects/<bare-name>/"
 *   - "/abs/path" or "~/path" → expanded as-is
 */
export function resolveStorageDir(
  overrides: StorageOverrides,
  config: SatoriConfig,
  repoRoot: string,
): string {
  const raw = overrides.storage ?? config.context?.storage_dir ?? 'repo';

  // Absolute or home-relative — used as-is
  if (raw.startsWith('~') || isAbsolute(raw)) {
    return expandTilde(raw);
  }

  if (raw === 'repo') {
    return join(repoRoot, 'satori');
  }
  if (raw === 'project') {
    if (!config.project_dir) {
      throw new Error(
        'storage_dir = "project" but no project_dir is set in any config layer',
      );
    }
    return join(expandTilde(config.project_dir), 'satori');
  }
  if (raw === 'global') {
    return join(homedir(), '.satori', 'data');
  }

  // Bare name → named-project storage under the global root
  return join(homedir(), '.satori', 'projects', raw);
}

/**
 * Resolve a per-file path within a storage directory.
 * Accepts absolute paths (used as-is) or relative paths (joined to storageDir).
 */
export function resolveFilePath(storageDir: string, override: string | undefined, defaultName: string): string {
  if (override === undefined) {
    return join(storageDir, defaultName);
  }
  if (override.startsWith('~') || isAbsolute(override)) {
    return expandTilde(override);
  }
  return join(storageDir, override);
}
