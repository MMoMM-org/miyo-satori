import type Database from 'better-sqlite3';
import { SQLiteBase } from '../db-base.js';

export interface SessionRow {
  id: number;
  session_id: string;
  created_at: string;
  context_json: string | null;
}

export class SessionDB extends SQLiteBase {
  private stmtInsert!: Database.Statement;
  private stmtGetById!: Database.Statement;
  private stmtGetBySessionId!: Database.Statement;
  private stmtUpdate!: Database.Statement;

  protected initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        context_json TEXT
      )
    `);
  }

  protected prepareStatements(): void {
    this.stmtInsert = this.db.prepare(
      `INSERT OR IGNORE INTO sessions (session_id, created_at, context_json)
       VALUES (?, ?, ?)`,
    );
    this.stmtGetById = this.db.prepare(
      `SELECT * FROM sessions WHERE id = ?`,
    );
    this.stmtGetBySessionId = this.db.prepare(
      `SELECT * FROM sessions WHERE session_id = ?`,
    );
    this.stmtUpdate = this.db.prepare(
      `UPDATE sessions SET context_json = ? WHERE session_id = ?`,
    );
  }

  upsert(sessionId: string, contextJson?: string): number {
    const now = new Date().toISOString();
    const info = this.stmtInsert.run(sessionId, now, contextJson ?? null);
    if (info.changes > 0) {
      return Number(info.lastInsertRowid);
    }
    const row = this.stmtGetBySessionId.get(sessionId) as SessionRow;
    return row.id;
  }

  getBySessionId(sessionId: string): SessionRow | null {
    return (this.stmtGetBySessionId.get(sessionId) as SessionRow) ?? null;
  }

  updateContext(sessionId: string, contextJson: string): void {
    this.stmtUpdate.run(contextJson, sessionId);
  }
}
