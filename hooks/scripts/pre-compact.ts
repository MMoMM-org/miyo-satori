import { SessionDB } from '../../src/context/session-db.js';
import { buildResumeSnapshot } from '../../src/context/snapshot.js';
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
  const { dbPath } = paths;

  let sessionDb: SessionDB | null = null;
  try {
    sessionDb = new SessionDB(dbPath);
    sessionDb.ensureSession(sessionId, repoRoot);

    const events = sessionDb.getEvents(sessionId);

    // compactCount in the snapshot is informational metadata.
    // The actual count is tracked in session_meta via incrementCompactCount.
    // We use events.length as a stable value for this snapshot invocation.
    const compactCount = events.length;

    const xml = buildResumeSnapshot(events, { compactCount });
    sessionDb.upsertResume(sessionId, xml, events.length);
    sessionDb.incrementCompactCount(sessionId);
  } catch (err) {
    process.stderr.write(`[satori:PreCompact] ${err}\n`);
  } finally {
    sessionDb?.close();
  }
}

main().catch((err) => {
  process.stderr.write(`[satori:PreCompact] fatal: ${err}\n`);
  process.exit(0);
});
