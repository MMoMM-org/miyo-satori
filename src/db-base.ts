import Database from 'better-sqlite3';
import { mkdirSync, existsSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';

export abstract class SQLiteBase {
  protected db: Database.Database;
  protected dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.applyWALPragmas();
    this.initSchema();
    this.prepareStatements();
  }

  private applyWALPragmas(): void {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
  }

  /** Subclasses create tables here */
  protected abstract initSchema(): void;

  /** Subclasses prepare statements here */
  protected abstract prepareStatements(): void;

  close(): void {
    this.db.close();
  }

  cleanup(): void {
    this.close();
    if (existsSync(this.dbPath)) {
      unlinkSync(this.dbPath);
    }
    const walPath = this.dbPath + '-wal';
    const shmPath = this.dbPath + '-shm';
    if (existsSync(walPath)) unlinkSync(walPath);
    if (existsSync(shmPath)) unlinkSync(shmPath);
  }

  static defaultDBPath(repoRoot: string): string {
    return join(repoRoot, '.satori', 'db.sqlite');
  }
}
