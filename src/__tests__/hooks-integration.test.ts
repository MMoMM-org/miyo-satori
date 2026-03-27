import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SessionDB } from '../context/session-db.js';
import { buildResumeSnapshot } from '../context/snapshot.js';

describe('PreCompact + SessionStart integration', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: SessionDB;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'satori-hooks-'));
    dbPath = join(tmpDir, 'db.sqlite');
    db = new SessionDB(dbPath);
    db.ensureSession('test-session', tmpDir);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('PreCompact: builds snapshot from events', () => {
    db.insertEvent('test-session', 'file_read', 'file', 1, '/src/index.ts', 'PostToolUse');
    db.insertEvent('test-session', 'file_write', 'file', 1, '/src/out.ts', 'PostToolUse');

    const events = db.getEvents('test-session');
    const xml = buildResumeSnapshot(events);
    db.upsertResume('test-session', xml, events.length);
    db.incrementCompactCount('test-session');

    const resume = db.getResume('test-session');
    expect(resume).not.toBeNull();
    expect(resume!.snapshot).toContain('<session_resume');
    expect(resume!.consumed).toBe(0);
    expect(resume!.snapshot.length).toBeLessThanOrEqual(2048);
  });

  it('SessionStart: outputs resume once then nothing', () => {
    const snapshotXml =
      '<session_resume compact_count="1" events_captured="2" generated_at="2026-01-01T00:00:00Z"></session_resume>';
    db.upsertResume('test-session', snapshotXml, 2);

    const resume1 = db.getResume('test-session');
    expect(resume1?.consumed).toBe(0);
    db.markResumeConsumed('test-session');

    const resume2 = db.getResume('test-session');
    // getResume only returns unconsumed rows, so after consuming it returns null
    expect(resume2).toBeNull();
  });
});
