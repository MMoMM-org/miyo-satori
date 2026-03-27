import { SessionDB } from '../../src/context/session-db.js';
import { extractSessionId, getRepoRoot, readStdinPayload } from './utils.js';

async function main(): Promise<void> {
  const payload = readStdinPayload();
  const sessionId = extractSessionId(payload);
  const repoRoot = getRepoRoot();
  const dbPath = SessionDB.defaultDBPath(repoRoot);

  let sessionDb: SessionDB | null = null;
  try {
    sessionDb = new SessionDB(dbPath);
    sessionDb.ensureSession(sessionId, repoRoot);

    const resume = sessionDb.getResume(sessionId);
    if (resume && !resume.consumed) {
      process.stdout.write(resume.snapshot + '\n');
      sessionDb.markResumeConsumed(sessionId);
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
