import { SessionDB } from '../../src/context/session-db.js';
import { extractSessionId, getRepoRoot, readStdinPayload, resolveHookPaths } from './utils.js';

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

    // Cross-session restore: a fresh `claude` invocation gets a new session_id,
    // so getResume(client, sessionId) would always miss. Match the MCP tool's
    // restore path: hand back the latest unconsumed resume for this client and
    // mark *that* resume as consumed (its session_id, not ours).
    const resume = sessionDb.getLatestResumeForClient(client);
    if (resume) {
      process.stdout.write(resume.snapshot + '\n');
      sessionDb.markResumeConsumed(client, resume.session_id);
    }
  } catch (err) {
    process.stderr.write(`[satori:SessionStart] ${err}\n`);
  } finally {
    sessionDb?.close();
  }
}

main().catch((err) => {
  process.stderr.write(`[satori:SessionStart] fatal: ${err}\n`);
  process.exit(0);
});
