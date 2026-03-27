import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SQLiteBase } from '../db-base.js';

class TestDB extends SQLiteBase {
  protected initSchema(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY)');
  }
  protected prepareStatements(): void {}
}

describe('SQLiteBase', () => {
  // SQLite in-memory databases do not support WAL mode — the pragma is accepted
  // but the journal mode remains 'memory'. WAL is verified on file-based DBs.
  it('opens in-memory DB and is operational', () => {
    const db = new TestDB(':memory:');
    const result = db['db'].pragma('journal_mode') as { journal_mode: string }[];
    expect(result[0].journal_mode).toBe('memory');
    db.close();
  });

  it('applies WAL mode on file-based DB', () => {
    const dir = mkdtempSync(join(tmpdir(), 'satori-test-'));
    const db = new TestDB(join(dir, 'test.sqlite'));
    const result = db['db'].pragma('journal_mode') as { journal_mode: string }[];
    expect(result[0].journal_mode).toBe('wal');
    db.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  it('cleanup() removes DB file and WAL/SHM files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'satori-test-'));
    const dbPath = join(dir, 'test.sqlite');
    const db = new TestDB(dbPath);
    expect(existsSync(dbPath)).toBe(true);
    db.cleanup();
    expect(existsSync(dbPath)).toBe(false);
    expect(existsSync(dbPath + '-wal')).toBe(false);
    expect(existsSync(dbPath + '-shm')).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates tables via initSchema', () => {
    const db = new TestDB(':memory:');
    const tables = db['db'].prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    expect(tables.some(t => t.name === 'test')).toBe(true);
    db.close();
  });
});
