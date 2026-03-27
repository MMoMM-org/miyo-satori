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
    const events = sessionDb.getEvents(sessionId);

    const hasContext = (resume !== null) || (events.length > 0);
    if (!hasContext) {
      process.stdout.write(
        '[satori] No session context. Call satori_context(restore) if context was saved.\n',
      );
    }
  } catch {
    // Non-blocking: ignore DB errors on prompt submit
  } finally {
    sessionDb?.close();
  }
}

main().catch(() => {
  process.exit(0);
});
