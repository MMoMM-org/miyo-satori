import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionDB } from '../context/session-db.js';

const C = 'test-client';

describe('SessionDB', () => {
  let db: SessionDB;

  beforeEach(() => {
    db = new SessionDB(':memory:');
    db.ensureSession(C, 's1', '/project');
  });

  afterEach(() => {
    db.close();
  });

  it('insertEvent stores an event and getEvents returns it ordered by id', () => {
    db.insertEvent(C, 's1', 'file_read', 'file', 1, '/src/index.ts', 'post-tool');
    const events = db.getEvents(C, 's1');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('file_read');
    expect(events[0].data).toBe('/src/index.ts');
    expect(events[0].category).toBe('file');
    expect(events[0].priority).toBe(1);
  });

  it('deduplicates same type+data within 5-event window', () => {
    db.insertEvent(C, 's1', 'file_read', 'file', 1, '/src/index.ts', 'hook');
    db.insertEvent(C, 's1', 'file_read', 'file', 1, '/src/index.ts', 'hook');
    const events = db.getEvents(C, 's1');
    expect(events).toHaveLength(1);
  });

  it('does not deduplicate different data even with same type', () => {
    db.insertEvent(C, 's1', 'file_read', 'file', 1, '/src/a.ts', 'hook');
    db.insertEvent(C, 's1', 'file_read', 'file', 1, '/src/b.ts', 'hook');
    const events = db.getEvents(C, 's1');
    expect(events).toHaveLength(2);
  });

  it('allows same type+data after 5 different events (dedup window expired)', () => {
    db.insertEvent(C, 's1', 'file_read', 'file', 1, '/src/target.ts', 'hook');
    // Insert 5 different events to push the first one out of the 5-event window
    for (let i = 0; i < 5; i++) {
      db.insertEvent(C, 's1', 'file_read', 'file', 1, `/src/other-${i}.ts`, 'hook');
    }
    // Now same as first should be allowed again
    db.insertEvent(C, 's1', 'file_read', 'file', 1, '/src/target.ts', 'hook');
    const events = db.getEvents(C, 's1');
    // 1 original + 5 others + 1 re-inserted = 7
    expect(events).toHaveLength(7);
  });

  it('FIFO eviction: count stays <= 1000 after inserting 1001 P3 events', () => {
    // Insert 1001 unique events (all priority 3)
    for (let i = 0; i < 1001; i++) {
      db.insertEvent(C, 's1', 'subagent_launched', 'subagent', 3, `desc-${i}`, 'hook');
    }
    const events = db.getEvents(C, 's1');
    expect(events.length).toBeLessThanOrEqual(1000);
  });

  it('eviction prefers lowest priority (highest number) first', () => {
    // Insert 999 P1 events and 1 P3 event
    for (let i = 0; i < 999; i++) {
      db.insertEvent(C, 's1', 'file_read', 'file', 1, `/p1-${i}.ts`, 'hook');
    }
    db.insertEvent(C, 's1', 'subagent_launched', 'subagent', 3, 'the-p3-event', 'hook');
    // 1000 events now — insert one more P1
    db.insertEvent(C, 's1', 'file_read', 'file', 1, '/trigger-evict.ts', 'hook');

    const events = db.getEvents(C, 's1');
    expect(events.length).toBeLessThanOrEqual(1000);
    // The P3 event should have been evicted
    const p3 = events.find((e) => e.data === 'the-p3-event');
    expect(p3).toBeUndefined();
  });

  it('upsertResume + getResume roundtrip returns stored snapshot', () => {
    db.upsertResume(C, 's1', '<session_resume />', 42);
    const resume = db.getResume(C, 's1');
    expect(resume).not.toBeNull();
    expect(resume!.snapshot).toBe('<session_resume />');
    expect(resume!.event_count).toBe(42);
    expect(resume!.consumed).toBe(0);
  });

  it('markResumeConsumed -> getResume returns null', () => {
    db.upsertResume(C, 's1', '<session_resume />', 10);
    db.markResumeConsumed(C, 's1');
    const resume = db.getResume(C, 's1');
    expect(resume).toBeNull();
  });

  it('upsertResume replaces existing entry and resets consumed flag', () => {
    db.upsertResume(C, 's1', '<first />', 5);
    db.markResumeConsumed(C, 's1');
    db.upsertResume(C, 's1', '<second />', 10);
    const resume = db.getResume(C, 's1');
    expect(resume).not.toBeNull();
    expect(resume!.snapshot).toBe('<second />');
    expect(resume!.consumed).toBe(0);
  });

  it('incrementCompactCount increments the counter', () => {
    db.incrementCompactCount(C, 's1');
    db.incrementCompactCount(C, 's1');
    const meta = db['db']
      .prepare('SELECT compact_count FROM session_meta WHERE client = ? AND session_id = ?')
      .get(C, 's1') as { compact_count: number };
    expect(meta.compact_count).toBe(2);
  });

  it('getSessionStats returns numeric counts', () => {
    db.insertEvent(C, 's1', 'file_read', 'file', 1, '/a.ts', 'hook');
    db.upsertResume(C, 's1', '<xml />', 1);

    const stats = db.getSessionStats();
    expect(typeof stats.session_count).toBe('number');
    expect(typeof stats.event_count).toBe('number');
    expect(typeof stats.resume_count).toBe('number');
    expect(stats.session_count).toBeGreaterThanOrEqual(1);
    expect(stats.event_count).toBeGreaterThanOrEqual(1);
    expect(stats.resume_count).toBeGreaterThanOrEqual(1);
  });

  it('getEvents returns empty array for unknown session', () => {
    const events = db.getEvents(C, 'nonexistent');
    expect(events).toEqual([]);
  });

  it('getResume returns null for unknown session', () => {
    const resume = db.getResume(C, 'nonexistent');
    expect(resume).toBeNull();
  });

  it('getLatestResumeForClient returns latest unconsumed resume across sessions', () => {
    // First session
    db.upsertResume(C, 's1', '<first />', 5);
    // Second session — same client, different session_id
    db.ensureSession(C, 's2', '/project');
    db.upsertResume(C, 's2', '<second />', 10);

    const latest = db.getLatestResumeForClient(C);
    expect(latest).not.toBeNull();
    expect(latest!.snapshot).toBe('<second />');
  });

  it('getLatestResumeForClient is client-scoped — does not bleed across clients', () => {
    db.upsertResume('client-a', 'sa', '<a />', 1);
    db.upsertResume('client-b', 'sb', '<b />', 1);

    const a = db.getLatestResumeForClient('client-a');
    const b = db.getLatestResumeForClient('client-b');
    expect(a!.snapshot).toBe('<a />');
    expect(b!.snapshot).toBe('<b />');
    expect(db.getLatestResumeForClient('client-c')).toBeNull();
  });
});
