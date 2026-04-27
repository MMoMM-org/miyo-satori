import { createHash } from 'crypto';
import { SQLiteBase } from '../db-base.js';

export interface SessionEvent {
  id: number;
  client: string;
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
  client: string;
  session_id: string;
  project_dir: string;
  started_at: string;
  last_event_at: string | null;
  event_count: number;
  compact_count: number;
}

export interface SessionResume {
  id: number;
  client: string;
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
        client      TEXT    NOT NULL DEFAULT '',
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
        client        TEXT    NOT NULL DEFAULT '',
        session_id    TEXT    NOT NULL,
        project_dir   TEXT    NOT NULL,
        started_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        last_event_at TEXT,
        event_count   INTEGER NOT NULL DEFAULT 0,
        compact_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (client, session_id)
      );

      CREATE TABLE IF NOT EXISTS session_resume (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        client      TEXT    NOT NULL DEFAULT '',
        session_id  TEXT    NOT NULL,
        snapshot    TEXT    NOT NULL,
        event_count INTEGER NOT NULL,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        consumed    INTEGER NOT NULL DEFAULT 0,
        UNIQUE (client, session_id)
      );

      CREATE INDEX IF NOT EXISTS idx_session_events_client_session  ON session_events(client, session_id);
      CREATE INDEX IF NOT EXISTS idx_session_events_type     ON session_events(client, session_id, type);
      CREATE INDEX IF NOT EXISTS idx_session_events_priority ON session_events(client, session_id, priority);
    `);
  }

  protected prepareStatements(): void {
    // Statements are built inline per method for clarity and correctness.
    // better-sqlite3 statement preparation is fast; no caching needed for this volume.
  }

  insertEvent(
    client: string,
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
           WHERE client = ? AND session_id = ?
           ORDER BY id DESC LIMIT 5`,
        )
        .all(client, sessionId) as { type: string; data_hash: string }[];

      const isDuplicate = recent.some(
        (row) => row.type === type && row.data_hash === dataHash,
      );
      if (isDuplicate) return;

      // Eviction: if at 1000+, remove lowest-priority (then oldest) event
      const count = (
        this.db
          .prepare('SELECT COUNT(*) as cnt FROM session_events WHERE client = ? AND session_id = ?')
          .get(client, sessionId) as { cnt: number }
      ).cnt;

      if (count >= 1000) {
        const toEvict = this.db
          .prepare(
            `SELECT id FROM session_events
             WHERE client = ? AND session_id = ?
             ORDER BY priority DESC, id ASC
             LIMIT 1`,
          )
          .get(client, sessionId) as { id: number } | undefined;

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
             (client, session_id, type, category, priority, data, source_hook, data_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(client, sessionId, type, category, priority, data, sourceHook, dataHash);

      // Update session_meta
      this.db
        .prepare(
          `UPDATE session_meta
           SET event_count = event_count + 1,
               last_event_at = datetime('now')
           WHERE client = ? AND session_id = ?`,
        )
        .run(client, sessionId);
    });

    insert();
  }

  ensureSession(client: string, sessionId: string, projectDir: string): void {
    this.db
      .prepare(
        `INSERT INTO session_meta (client, session_id, project_dir)
         VALUES (?, ?, ?)
         ON CONFLICT(client, session_id) DO NOTHING`,
      )
      .run(client, sessionId, projectDir);
  }

  getEvents(client: string, sessionId: string): SessionEvent[] {
    return this.db
      .prepare(
        'SELECT * FROM session_events WHERE client = ? AND session_id = ? ORDER BY id ASC',
      )
      .all(client, sessionId) as SessionEvent[];
  }

  getResume(client: string, sessionId: string): SessionResume | null {
    const row = this.db
      .prepare(
        `SELECT * FROM session_resume
         WHERE client = ? AND session_id = ? AND consumed = 0
         ORDER BY id DESC LIMIT 1`,
      )
      .get(client, sessionId) as SessionResume | undefined;

    return row ?? null;
  }

  /**
   * Cross-session restore: latest resume for a client, regardless of session_id.
   * Solves fresh-start blindness — `claude` in repo X gets the previous session's
   * resume back even though the new UUID has no captures yet.
   */
  getLatestResumeForClient(client: string): SessionResume | null {
    const row = this.db
      .prepare(
        `SELECT * FROM session_resume
         WHERE client = ? AND consumed = 0
         ORDER BY id DESC LIMIT 1`,
      )
      .get(client) as SessionResume | undefined;
    return row ?? null;
  }

  upsertResume(
    client: string,
    sessionId: string,
    snapshot: string,
    eventCount: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO session_resume (client, session_id, snapshot, event_count)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(client, session_id) DO UPDATE SET
           snapshot = excluded.snapshot,
           event_count = excluded.event_count,
           created_at = datetime('now'),
           consumed = 0`,
      )
      .run(client, sessionId, snapshot, eventCount);
  }

  markResumeConsumed(client: string, sessionId: string): void {
    this.db
      .prepare(
        'UPDATE session_resume SET consumed = 1 WHERE client = ? AND session_id = ?',
      )
      .run(client, sessionId);
  }

  incrementCompactCount(client: string, sessionId: string): void {
    this.db
      .prepare(
        `UPDATE session_meta
         SET compact_count = compact_count + 1
         WHERE client = ? AND session_id = ?`,
      )
      .run(client, sessionId);
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
