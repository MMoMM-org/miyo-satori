import { createHash } from 'crypto';
import { SQLiteBase } from '../db-base.js';

export interface SessionEvent {
  id: number;
  session_id: string;
  type: string;
  category: string;
  priority: number;
  data: string;
  source_hook: string;
  created_at: string;
  data_hash: string;
}

export interface SessionMeta {
  session_id: string;
  project_dir: string;
  started_at: string;
  last_event_at: string | null;
  event_count: number;
  compact_count: number;
}

export interface SessionResume {
  id: number;
  session_id: string;
  snapshot: string;
  event_count: number;
  created_at: string;
  consumed: number;
}

export interface SessionStats {
  session_count: number;
  event_count: number;
  resume_count: number;
}

function computeHash(type: string, data: string): string {
  return createHash('sha256').update(type + data).digest('hex').slice(0, 16);
}

export class SessionDB extends SQLiteBase {
  protected initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  TEXT    NOT NULL,
        type        TEXT    NOT NULL,
        category    TEXT    NOT NULL,
        priority    INTEGER NOT NULL DEFAULT 2,
        data        TEXT    NOT NULL,
        source_hook TEXT    NOT NULL,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        data_hash   TEXT    NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS session_meta (
        session_id    TEXT    PRIMARY KEY,
        project_dir   TEXT    NOT NULL,
        started_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        last_event_at TEXT,
        event_count   INTEGER NOT NULL DEFAULT 0,
        compact_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS session_resume (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  TEXT    NOT NULL UNIQUE,
        snapshot    TEXT    NOT NULL,
        event_count INTEGER NOT NULL,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        consumed    INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_session_events_session  ON session_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_events_type     ON session_events(session_id, type);
      CREATE INDEX IF NOT EXISTS idx_session_events_priority ON session_events(session_id, priority);
    `);
  }

  protected prepareStatements(): void {
    // Statements are built inline per method for clarity and correctness.
    // better-sqlite3 statement preparation is fast; no caching needed for this volume.
  }

  insertEvent(
    sessionId: string,
    type: string,
    category: string,
    priority: number,
    data: string,
    sourceHook: string,
  ): void {
    const dataHash = computeHash(type, data);

    const insert = this.db.transaction(() => {
      // Dedup: check last 5 events (by id) for same type+data_hash
      const recent = this.db
        .prepare(
          `SELECT type, data_hash FROM session_events
           WHERE session_id = ?
           ORDER BY id DESC LIMIT 5`,
        )
        .all(sessionId) as { type: string; data_hash: string }[];

      const isDuplicate = recent.some(
        (row) => row.type === type && row.data_hash === dataHash,
      );
      if (isDuplicate) return;

      // Eviction: if at 1000+, remove lowest-priority (then oldest) event
      const count = (
        this.db
          .prepare('SELECT COUNT(*) as cnt FROM session_events WHERE session_id = ?')
          .get(sessionId) as { cnt: number }
      ).cnt;

      if (count >= 1000) {
        const toEvict = this.db
          .prepare(
            `SELECT id FROM session_events
             WHERE session_id = ?
             ORDER BY priority DESC, id ASC
             LIMIT 1`,
          )
          .get(sessionId) as { id: number } | undefined;

        if (toEvict) {
          this.db
            .prepare('DELETE FROM session_events WHERE id = ?')
            .run(toEvict.id);
        }
      }

      // Insert event
      this.db
        .prepare(
          `INSERT INTO session_events
             (session_id, type, category, priority, data, source_hook, data_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(sessionId, type, category, priority, data, sourceHook, dataHash);

      // Update session_meta
      this.db
        .prepare(
          `UPDATE session_meta
           SET event_count = event_count + 1,
               last_event_at = datetime('now')
           WHERE session_id = ?`,
        )
        .run(sessionId);
    });

    insert();
  }

  ensureSession(sessionId: string, projectDir: string): void {
    this.db
      .prepare(
        `INSERT INTO session_meta (session_id, project_dir)
         VALUES (?, ?)
         ON CONFLICT(session_id) DO NOTHING`,
      )
      .run(sessionId, projectDir);
  }

  getEvents(sessionId: string): SessionEvent[] {
    return this.db
      .prepare(
        'SELECT * FROM session_events WHERE session_id = ? ORDER BY id ASC',
      )
      .all(sessionId) as SessionEvent[];
  }

  getResume(sessionId: string): SessionResume | null {
    const row = this.db
      .prepare(
        `SELECT * FROM session_resume
         WHERE session_id = ? AND consumed = 0
         ORDER BY id DESC LIMIT 1`,
      )
      .get(sessionId) as SessionResume | undefined;

    return row ?? null;
  }

  upsertResume(
    sessionId: string,
    snapshot: string,
    eventCount: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO session_resume (session_id, snapshot, event_count)
         VALUES (?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           snapshot = excluded.snapshot,
           event_count = excluded.event_count,
           created_at = datetime('now'),
           consumed = 0`,
      )
      .run(sessionId, snapshot, eventCount);
  }

  markResumeConsumed(sessionId: string): void {
    this.db
      .prepare(
        'UPDATE session_resume SET consumed = 1 WHERE session_id = ?',
      )
      .run(sessionId);
  }

  incrementCompactCount(sessionId: string): void {
    this.db
      .prepare(
        `UPDATE session_meta
         SET compact_count = compact_count + 1
         WHERE session_id = ?`,
      )
      .run(sessionId);
  }

  getSessionStats(): SessionStats {
    const sessionCount = (
      this.db
        .prepare('SELECT COUNT(*) as cnt FROM session_meta')
        .get() as { cnt: number }
    ).cnt;

    const eventCount = (
      this.db
        .prepare('SELECT COUNT(*) as cnt FROM session_events')
        .get() as { cnt: number }
    ).cnt;

    const resumeCount = (
      this.db
        .prepare('SELECT COUNT(*) as cnt FROM session_resume')
        .get() as { cnt: number }
    ).cnt;

    return {
      session_count: sessionCount,
      event_count: eventCount,
      resume_count: resumeCount,
    };
  }
}
