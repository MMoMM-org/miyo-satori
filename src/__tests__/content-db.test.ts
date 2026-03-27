import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContentDB } from '../context/content-db.js';

describe('ContentDB', () => {
  let db: ContentDB;

  beforeEach(() => {
    db = new ContentDB(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('insertCapture stores a row and getBySession returns it', () => {
    const id = db.insertCapture('s1', 'filesystem', 'read_file', null, 'hello world');
    expect(id).toBeGreaterThan(0);
    const captures = db.getBySession('s1');
    expect(captures).toHaveLength(1);
    expect(captures[0].server).toBe('filesystem');
    expect(captures[0].tool).toBe('read_file');
    expect(captures[0].output_text).toBe('hello world');
    expect(captures[0].summary).toBeNull();
  });

  it('insertCapture stores input_json when provided', () => {
    const id = db.insertCapture('s1', 'github', 'list_issues', '{"repo":"x"}', 'issue list');
    const captures = db.getBySession('s1');
    expect(captures[0].input_json).toBe('{"repo":"x"}');
    expect(id).toBeGreaterThan(0);
  });

  it('search returns capture matching keyword in output_text', () => {
    db.insertCapture('s1', 'filesystem', 'read_file', null, 'unique-keyword-alpha content here');
    db.insertCapture('s1', 'github', 'list_issues', null, 'completely different output');
    const results = db.search('unique-keyword-alpha');
    expect(results).toHaveLength(1);
    expect(results[0].server).toBe('filesystem');
    expect(results[0].tool).toBe('read_file');
  });

  it('search returns empty array for no match', () => {
    db.insertCapture('s1', 'filesystem', 'read_file', null, 'hello world');
    const results = db.search('nonexistent-xyz-999');
    expect(results).toHaveLength(0);
  });

  it('updateSummary stores summary and makes it searchable via FTS', () => {
    const id = db.insertCapture('s1', 'github', 'search_code', null, 'raw github output blob');
    db.updateSummary(id, 'compact-summary-token results found');

    const captures = db.getBySession('s1');
    expect(captures[0].summary).toBe('compact-summary-token results found');

    const results = db.search('compact-summary-token');
    expect(results).toHaveLength(1);
    expect(results[0].tool).toBe('search_code');
    expect(results[0].summary).toBe('compact-summary-token results found');
  });

  it('updateSummary is a no-op for unknown id', () => {
    // Should not throw
    db.updateSummary(999, 'summary for unknown row');
    const captures = db.getBySession('s1');
    expect(captures).toHaveLength(0);
  });

  it('pruneOlderThan removes entries older than cutoff', () => {
    // Insert a capture with an artificially old timestamp
    const oldTimestamp = Math.floor(Date.now() / 1000) - 40 * 86400; // 40 days ago
    db['db']
      .prepare(
        `INSERT INTO captures (session_id, server, tool, output_text, captured_at)
         VALUES ('s1', 'old-server', 'old-tool', 'old content', ?)`,
      )
      .run(oldTimestamp);

    // Insert a recent capture
    db.insertCapture('s1', 'new-server', 'new-tool', null, 'fresh content');

    expect(db.getBySession('s1')).toHaveLength(2);

    const removed = db.pruneOlderThan(30);
    expect(removed).toBe(1);
    const remaining = db.getBySession('s1');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].server).toBe('new-server');
  });

  it('pruneOlderThan returns 0 when nothing to prune', () => {
    db.insertCapture('s1', 'server', 'tool', null, 'recent content');
    const removed = db.pruneOlderThan(30);
    expect(removed).toBe(0);
  });

  it('search respects limit parameter', () => {
    for (let i = 0; i < 20; i++) {
      db.insertCapture('s1', 'server', 'tool', null, `common-search-term entry-${i}`);
    }
    const results = db.search('common-search-term', 5);
    expect(results.length).toBeLessThanOrEqual(5);
  });
});
