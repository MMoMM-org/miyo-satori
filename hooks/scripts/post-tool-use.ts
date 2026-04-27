import { SessionDB } from '../../src/context/session-db.js';
import { ContentDB } from '../../src/context/content-db.js';
import { extractEvent } from '../../src/context/extract.js';
import { extractSessionId, getRepoRoot, readStdinPayload, resolveHookPaths } from './utils.js';

const CAPTURE_TOOLS = new Set(['Read', 'Bash', 'WebFetch']);

async function main(): Promise<void> {
  const payload = readStdinPayload();
  const sessionId = extractSessionId(payload);
  const repoRoot = getRepoRoot();

  // Guard: exit 0 silently if Satori is not configured for this repo
  const paths = resolveHookPaths(repoRoot);
  if (!paths) {
    process.exit(0);
  }
  const { dbPath } = paths;

  let sessionDb: SessionDB | null = null;
  let contentDb: ContentDB | null = null;

  try {
    sessionDb = new SessionDB(dbPath);
    contentDb = new ContentDB(dbPath);

    sessionDb.ensureSession(sessionId, repoRoot);

    const toolName = payload.tool_name ?? '';
    const toolInput = payload.tool_input;
    const toolOutput = payload.tool_response?.content;

    const event = extractEvent(toolName, toolInput, toolOutput);
    if (event) {
      sessionDb.insertEvent(
        sessionId,
        event.type,
        event.category,
        event.priority,
        event.data ?? '',
        'PostToolUse',
      );
    }

    if (CAPTURE_TOOLS.has(toolName) && toolOutput != null) {
      contentDb.insertCapture(
        sessionId,
        'claude-code',
        toolName,
        JSON.stringify(toolInput),
        String(toolOutput).slice(0, 10000),
      );
    }
  } catch (err) {
    process.stderr.write(`[satori:PostToolUse] ${err}\n`);
  } finally {
    sessionDb?.close();
    contentDb?.close();
  }
}

main().catch((err) => {
  process.stderr.write(`[satori:PostToolUse] fatal: ${err}\n`);
  process.exit(0);
});
