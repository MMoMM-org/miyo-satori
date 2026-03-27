import type Database from 'better-sqlite3';
import { SQLiteBase } from '../db-base.js';

export interface CaptureInsert {
  sessionId: string;
  server: string;
  tool: string;
  inputJson: string;
  outputJson: string;
}

export interface CaptureRow {
  id: number;
  session_id: string;
  server: string;
  tool: string;
  input_json: string;
  output_json: string;
  summary: string | null;
  created_at: string;
}

export class ContentDB extends SQLiteBase {
  private stmtInsert!: Database.Statement;
  private stmtUpdateSummary!: Database.Statement;
  private stmtSearch!: Database.Statement;

  protected initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS captures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        server TEXT NOT NULL,
        tool TEXT NOT NULL,
        input_json TEXT NOT NULL,
        output_json TEXT NOT NULL,
        summary TEXT,
        created_at TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_captures_session ON captures (session_id)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_captures_server ON captures (server)
    `);
  }

  protected prepareStatements(): void {
    this.stmtInsert = this.db.prepare(
      `INSERT INTO captures (session_id, server, tool, input_json, output_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.stmtUpdateSummary = this.db.prepare(
      `UPDATE captures SET summary = ? WHERE id = ?`,
    );
    this.stmtSearch = this.db.prepare(
      `SELECT * FROM captures
       WHERE summary LIKE ? OR tool LIKE ? OR server LIKE ?
       ORDER BY created_at DESC
       LIMIT ?`,
    );
  }

  insertCapture(capture: CaptureInsert): number {
    const now = new Date().toISOString();
    const info = this.stmtInsert.run(
      capture.sessionId,
      capture.server,
      capture.tool,
      capture.inputJson,
      capture.outputJson,
      now,
    );
    return Number(info.lastInsertRowid);
  }

  updateSummary(captureId: number, summary: string): void {
    this.stmtUpdateSummary.run(summary, captureId);
  }

  search(query: string, limit = 20): CaptureRow[] {
    const pattern = `%${query}%`;
    return this.stmtSearch.all(pattern, pattern, pattern, limit) as CaptureRow[];
  }
}
