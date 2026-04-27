import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionDB } from '../context/session-db.js';
import { ContentDB } from '../context/content-db.js';
import { buildResumeSnapshot } from '../context/snapshot.js';

// We test the sub-command logic directly without spinning up an MCP server.
// The registerSatoriContext function wires these same operations.

type SubCommand = 'restore' | 'query' | 'status' | 'flush';
const TOOL_SESSION = 'tool-session';
const C = 'test-client';

function dispatch(
  args: { sub_command: SubCommand; q?: string; limit?: number; session_id?: string },
  sessionDb: SessionDB,
  contentDb: ContentDB,
): string {
  const sessionId = args.session_id ?? TOOL_SESSION;
  const explicitSession = args.session_id !== undefined;

  switch (args.sub_command) {
    case 'restore': {
      const resume = explicitSession
        ? sessionDb.getResume(C, sessionId)
        : sessionDb.getLatestResumeForClient(C);
      if (!resume) return 'No session snapshot available.';
      sessionDb.markResumeConsumed(C, resume.session_id);
      return resume.snapshot;
    }
    case 'query': {
      const q = args.q ?? '';
      if (!q) return JSON.stringify([]);
      const results = contentDb.search(C, q, args.limit ?? 10);
      return JSON.stringify(results);
    }
    case 'status': {
      const stats = sessionDb.getSessionStats();
      const captureCount = contentDb.getBySession(C, sessionId).length;
      return JSON.stringify({
        sessions: stats.session_count,
        events: stats.event_count,
        resumes: stats.resume_count,
        captures: captureCount,
      });
    }
    case 'flush': {
      const events = sessionDb.getEvents(C, sessionId);
      const snapshot = buildResumeSnapshot(events);
      sessionDb.upsertResume(C, sessionId, snapshot, events.length);
      return `Snapshot generated: ${Buffer.byteLength(snapshot, 'utf8')} bytes`;
    }
  }
}

describe('satori_context sub-commands', () => {
  let sessionDb: SessionDB;
  let contentDb: ContentDB;

  beforeEach(() => {
    sessionDb = new SessionDB(':memory:');
    contentDb = new ContentDB(':memory:');
    sessionDb.ensureSession(C, TOOL_SESSION, '/project');
  });

  afterEach(() => {
    sessionDb.close();
    contentDb.close();
  });

  it('restore with no data -> "No session snapshot available."', () => {
    const result = dispatch({ sub_command: 'restore' }, sessionDb, contentDb);
    expect(result).toBe('No session snapshot available.');
  });

  it('flush -> generates snapshot -> restore returns it', () => {
    sessionDb.insertEvent(C, TOOL_SESSION, 'file_read', 'file', 1, '/src/index.ts', 'test');
    sessionDb.insertEvent(C, TOOL_SESSION, 'file_edit', 'file', 1, '/src/app.ts', 'test');

    const flushResult = dispatch({ sub_command: 'flush' }, sessionDb, contentDb);
    expect(flushResult).toMatch(/^Snapshot generated: \d+ bytes$/);

    const restoreResult = dispatch({ sub_command: 'restore' }, sessionDb, contentDb);
    expect(restoreResult).toContain('<session_resume');
    expect(restoreResult).toContain('</session_resume>');
  });

  it('restore marks snapshot as consumed -> second restore returns no snapshot', () => {
    sessionDb.upsertResume(C, TOOL_SESSION, '<session_resume />', 0);
    const first = dispatch({ sub_command: 'restore' }, sessionDb, contentDb);
    expect(first).toBe('<session_resume />');

    const second = dispatch({ sub_command: 'restore' }, sessionDb, contentDb);
    expect(second).toBe('No session snapshot available.');
  });

  it('restore without explicit session_id returns latest cross-session resume for the client', () => {
    sessionDb.upsertResume(C, 'old-session', '<old-snapshot />', 0);
    sessionDb.upsertResume(C, 'newer-session', '<newer-snapshot />', 0);
    const result = dispatch({ sub_command: 'restore' }, sessionDb, contentDb);
    expect(result).toBe('<newer-snapshot />');
  });

  it('query with matching data -> returns results', () => {
    contentDb.insertCapture(C, TOOL_SESSION, 'filesystem', 'read_file', null, 'satori-unique-search-term content');

    const result = dispatch({ sub_command: 'query', q: 'satori-unique-search-term' }, sessionDb, contentDb);
    const parsed = JSON.parse(result) as Array<{ server: string; tool: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].server).toBe('filesystem');
    expect(parsed[0].tool).toBe('read_file');
  });

  it('query with no match -> returns empty array', () => {
    contentDb.insertCapture(C, TOOL_SESSION, 'github', 'list_issues', null, 'some other content');
    const result = dispatch({ sub_command: 'query', q: 'nonexistent-xyz-999' }, sessionDb, contentDb);
    const parsed = JSON.parse(result) as unknown[];
    expect(parsed).toHaveLength(0);
  });

  it('query with empty q -> returns empty array', () => {
    const result = dispatch({ sub_command: 'query', q: '' }, sessionDb, contentDb);
    const parsed = JSON.parse(result) as unknown[];
    expect(parsed).toHaveLength(0);
  });

  it('status -> returns JSON with numeric counts', () => {
    sessionDb.insertEvent(C, TOOL_SESSION, 'file_read', 'file', 1, '/x.ts', 'test');
    contentDb.insertCapture(C, TOOL_SESSION, 'server', 'tool', null, 'output');
    sessionDb.upsertResume(C, TOOL_SESSION, '<xml />', 1);

    const result = dispatch({ sub_command: 'status' }, sessionDb, contentDb);
    const stats = JSON.parse(result) as {
      sessions: number;
      events: number;
      resumes: number;
      captures: number;
    };
    expect(typeof stats.sessions).toBe('number');
    expect(typeof stats.events).toBe('number');
    expect(typeof stats.resumes).toBe('number');
    expect(typeof stats.captures).toBe('number');
    expect(stats.sessions).toBeGreaterThanOrEqual(1);
    expect(stats.events).toBeGreaterThanOrEqual(1);
    expect(stats.resumes).toBeGreaterThanOrEqual(1);
    expect(stats.captures).toBeGreaterThanOrEqual(1);
  });

  it('session_id param passed through to restore', () => {
    sessionDb.ensureSession(C, 'other-session', '/other');
    sessionDb.upsertResume(C, 'other-session', '<other-snapshot />', 0);

    const result = dispatch(
      { sub_command: 'restore', session_id: 'other-session' },
      sessionDb,
      contentDb,
    );
    expect(result).toBe('<other-snapshot />');
  });

  it('flush with no events -> minimal snapshot', () => {
    const result = dispatch({ sub_command: 'flush' }, sessionDb, contentDb);
    expect(result).toMatch(/^Snapshot generated: \d+ bytes$/);

    const snapshot = dispatch({ sub_command: 'restore' }, sessionDb, contentDb);
    expect(snapshot).toContain('<session_resume');
    expect(snapshot).toContain('events_captured="0"');
  });

  it('registerSatoriContext is exported from the tool module', async () => {
    const mod = await import('../tools/satori-context.js');
    expect(typeof mod.registerSatoriContext).toBe('function');
  });
});
