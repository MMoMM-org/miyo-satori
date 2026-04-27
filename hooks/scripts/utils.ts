import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { loadConfig } from '../../src/config/loader.js';
import { resolveStorageDir, resolveFilePath } from '../../src/config/storage.js';

export interface HookPayload {
  transcript_path?: string;
  session_id?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: { content?: unknown; is_error?: boolean };
}

export function extractSessionId(payload: HookPayload): string {
  if (payload.transcript_path) {
    const match = payload.transcript_path.match(/([a-f0-9-]{36})\.jsonl$/);
    if (match) return match[1];
  }
  if (payload.session_id) return payload.session_id;
  if (process.env.CLAUDE_SESSION_ID) return process.env.CLAUDE_SESSION_ID;
  return `pid-${process.ppid}`;
}

export function getRepoRoot(): string {
  return process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
}

export function readStdinPayload(): HookPayload {
  try {
    const raw = readFileSync('/dev/stdin', 'utf-8');
    return JSON.parse(raw) as HookPayload;
  } catch {
    return {};
  }
}

/**
 * Resolve hook DB paths via the same logic the MCP server uses.
 * Returns null if Satori is not configured for this repo (no satori.toml).
 * Hooks that get null should exit 0 silently.
 */
export function resolveHookPaths(repoRoot: string): { dbPath: string; kbPath: string } | null {
  if (!existsSync(join(repoRoot, 'satori.toml'))) {
    return null;
  }
  const config = loadConfig(repoRoot);
  const storageDir = resolveStorageDir({}, config, repoRoot);
  return {
    dbPath: resolveFilePath(storageDir, config.context?.db_path, 'db.sqlite'),
    kbPath: resolveFilePath(storageDir, config.context?.kb_path, 'kb.sqlite'),
  };
}
