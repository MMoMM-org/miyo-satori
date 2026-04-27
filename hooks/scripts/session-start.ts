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

    const resume = sessionDb.getResume(client, sessionId);
    if (resume && !resume.consumed) {
      process.stdout.write(resume.snapshot + '\n');
      sessionDb.markResumeConsumed(client, sessionId);
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
