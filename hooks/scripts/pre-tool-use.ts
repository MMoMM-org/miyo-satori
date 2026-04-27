import { SessionDB } from '../../src/context/session-db.js';
import { extractEvent } from '../../src/context/extract.js';
import { extractSessionId, getRepoRoot, readStdinPayload, resolveHookPaths } from './utils.js';

function extractBashCommand(toolInput: unknown): string | null {
  try {
    const input = toolInput as Record<string, unknown>;
    return typeof input?.command === 'string' ? input.command : null;
  } catch {
    return null;
  }
}

function extractFilePath(toolInput: unknown): string | null {
  try {
    const input = toolInput as Record<string, unknown>;
    if (typeof input?.file_path === 'string') return input.file_path;
    if (typeof input?.path === 'string') return input.path;
    return null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const payload = readStdinPayload();
  const sessionId = extractSessionId(payload);
  const repoRoot = getRepoRoot();

  // Guard: exit 0 silently if Satori is not configured for this repo
  const paths = resolveHookPaths(repoRoot);
  if (!paths) {
    process.exit(0);
  }
  const { dbPath, client } = paths;

  let sessionDb: SessionDB | null = null;
  try {
    sessionDb = new SessionDB(dbPath);
    sessionDb.ensureSession(client, sessionId, repoRoot);

    const toolName = payload.tool_name ?? '';
    const toolInput = payload.tool_input;

    if (toolName === 'Bash') {
      const cmd = extractBashCommand(toolInput);
      if (cmd !== null) {
        if (cmd.includes('git ')) {
          sessionDb.insertEvent(client, sessionId, 'git_op', 'git', 2, cmd.slice(0, 200), 'PreToolUse');
        }
        if (cmd.includes('cd ')) {
          const cdMatch = cmd.match(/cd\s+(\S+)/);
          const dir = cdMatch ? cdMatch[1] : cmd.slice(0, 200);
          sessionDb.insertEvent(client, sessionId, 'cwd_change', 'cwd', 3, dir.slice(0, 200), 'PreToolUse');
        }
      }
    } else if (toolName === 'Read' || toolName === 'Grep') {
      const path = extractFilePath(toolInput);
      if (path !== null) {
        const event = extractEvent(toolName, toolInput);
        if (event) {
          sessionDb.insertEvent(
            client,
            sessionId,
            event.type,
            event.category,
            event.priority,
            event.data,
            'PreToolUse',
          );
        }
      }
    }
  } catch (err) {
    process.stderr.write(`[satori:PreToolUse] ${err}\n`);
  } finally {
    sessionDb?.close();
  }
}

main().catch((err) => {
  process.stderr.write(`[satori:PreToolUse] fatal: ${err}\n`);
  process.exit(0);
});
