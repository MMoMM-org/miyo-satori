import { SQLiteBase } from '../db-base.js';

export interface Capture {
  id: number;
  client: string;
  session_id: string;
  server: string;
  tool: string;
  input_json: string | null;
  output_text: string;
  summary: string | null;
  captured_at: number;
}

export interface SearchResult {
  server: string;
  tool: string;
  summary: string | null;
}

export class ContentDB extends SQLiteBase {
  protected initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS captures (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        client      TEXT    NOT NULL DEFAULT '',
        session_id  TEXT    NOT NULL,
        server      TEXT    NOT NULL,
        tool        TEXT    NOT NULL,
        input_json  TEXT,
        output_text TEXT    NOT NULL,
        summary     TEXT,
        captured_at INTEGER NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS captures_fts USING fts5(
        server, tool, output_text, summary,
        content='captures', content_rowid='id'
      );

      CREATE INDEX IF NOT EXISTS idx_captures_client_session ON captures(client, session_id);

      CREATE TRIGGER IF NOT EXISTS captures_ai AFTER INSERT ON captures BEGIN
        INSERT INTO captures_fts(rowid, server, tool, output_text, summary)
        VALUES (new.id, new.server, new.tool, new.output_text, COALESCE(new.summary, ''));
      END;
    `);
  }

  protected prepareStatements(): void {
    // Statements built inline per method.
  }

  insertCapture(
    client: string,
    sessionId: string,
    server: string,
    tool: string,
    inputJson: string | null,
    outputText: string,
  ): number {
    const capturedAt = Math.floor(Date.now() / 1000);
    const result = this.db
      .prepare(
        `INSERT INTO captures (client, session_id, server, tool, input_json, output_text, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(client, sessionId, server, tool, inputJson, outputText, capturedAt);
    return result.lastInsertRowid as number;
  }

  updateSummary(id: number, summary: string): void {
    // Fetch current row values for FTS rebuild
    const row = this.db
      .prepare('SELECT server, tool, output_text FROM captures WHERE id = ?')
      .get(id) as { server: string; tool: string; output_text: string } | undefined;

    if (!row) return;

    // Update the main table
    this.db
      .prepare('UPDATE captures SET summary = ? WHERE id = ?')
      .run(summary, id);

    // Rebuild FTS for this row: delete then re-insert
    this.db
      .prepare(
        `INSERT INTO captures_fts(captures_fts, rowid, server, tool, output_text, summary)
         VALUES ('delete', ?, ?, ?, ?, ?)`,
      )
      .run(id, row.server, row.tool, row.output_text, '');

    this.db
      .prepare(
        `INSERT INTO captures_fts(rowid, server, tool, output_text, summary)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, row.server, row.tool, row.output_text, summary);
  }

  search(client: string, q: string, limit = 10): SearchResult[] {
    // Wrap in FTS5 phrase quotes so hyphens and other operators are treated as literals
    const ftsQuery = `"${q.replace(/"/g, '""')}"`;
    return this.db
      .prepare(
        `SELECT c.server, c.tool, c.summary
         FROM captures_fts
         JOIN captures c ON captures_fts.rowid = c.id
         WHERE captures_fts MATCH ? AND c.client = ?
         ORDER BY captures_fts.rank
         LIMIT ?`,
      )
      .all(ftsQuery, client, limit) as SearchResult[];
  }

  getBySession(client: string, sessionId: string): Capture[] {
    return this.db
      .prepare('SELECT * FROM captures WHERE client = ? AND session_id = ? ORDER BY id ASC')
      .all(client, sessionId) as Capture[];
  }

  pruneOlderThan(days: number): number {
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
    const result = this.db
      .prepare('DELETE FROM captures WHERE captured_at < ?')
      .run(cutoff);
    return result.changes;
  }
}
