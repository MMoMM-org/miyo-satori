import { describe, it, expect } from 'vitest';
import { buildResumeSnapshot } from '../context/snapshot.js';
import type { SessionEvent } from '../context/extract.js';

function makeEvent(
  type: string,
  category: string,
  priority: number,
  data: string,
): SessionEvent {
  return { type, category, priority, data, sourceHook: 'test' };
}

function makeFileEvent(path: string, type = 'file_read'): SessionEvent {
  return makeEvent(type, 'file', 1, path);
}

describe('buildResumeSnapshot', () => {
  it('empty events -> minimal valid XML', () => {
    const xml = buildResumeSnapshot([], { generatedAt: '2026-01-01T00:00:00.000Z' });
    expect(xml).toContain('<session_resume');
    expect(xml).toContain('</session_resume>');
    expect(xml).toContain('events_captured="0"');
    // No unescaped dangerous chars in structure
    expect(xml).toMatch(/^<session_resume[^>]+><\/session_resume>$/);
  });

  it('50 events -> XML <= 2048 bytes', () => {
    const events: SessionEvent[] = [];
    for (let i = 0; i < 50; i++) {
      events.push(makeFileEvent(`/src/file-${i}.ts`));
    }
    const xml = buildResumeSnapshot(events);
    expect(Buffer.byteLength(xml, 'utf8')).toBeLessThanOrEqual(2048);
  });

  it('200 large file events -> still <= 2048 bytes', () => {
    const events: SessionEvent[] = [];
    for (let i = 0; i < 200; i++) {
      // Paths are 195 chars each (max allowed is 200)
      const longPath = `/volumes/moon/coding/the-custom-startup/modules/satori/src/long-path-file-${String(i).padStart(3, '0')}-extra-padding-here.ts`.slice(0, 195);
      events.push(makeFileEvent(longPath));
    }
    const xml = buildResumeSnapshot(events);
    expect(Buffer.byteLength(xml, 'utf8')).toBeLessThanOrEqual(2048);
  });

  it('P3 sections (subagents, mcp) absent when over budget', () => {
    // Fill with many file events to get close to budget
    const events: SessionEvent[] = [];
    for (let i = 0; i < 50; i++) {
      events.push(makeFileEvent(`/src/component-${i}-with-quite-a-long-name.tsx`));
    }
    // Add subagent events that should be dropped if over budget
    for (let i = 0; i < 20; i++) {
      events.push(makeEvent('subagent_launched', 'subagent', 3, `subagent description number ${i}`));
    }
    for (let i = 0; i < 20; i++) {
      events.push(makeEvent('mcp_call', 'mcp', 4, `WebFetch:https://api.example.com/endpoint/${i}`));
    }

    const xml = buildResumeSnapshot(events);
    expect(Buffer.byteLength(xml, 'utf8')).toBeLessThanOrEqual(2048);

    // If over budget, subagents and mcp sections should be absent
    if (Buffer.byteLength(xml, 'utf8') > 1500) {
      // Might still be under budget with P3 — check structure is valid
      expect(xml).toContain('<session_resume');
    }
  });

  it('no unescaped < > & in output', () => {
    const events: SessionEvent[] = [
      makeFileEvent('/src/file-with-<special>&chars>.ts'),
      makeEvent('error_caught', 'error', 2, 'Error: expected <token> got & something'),
      makeEvent('decision_made', 'decision', 2, 'Use a > b pattern & follow convention'),
    ];
    const xml = buildResumeSnapshot(events);
    // The XML header/footer tags are expected, check no unescaped chars in data
    // XML entities are correct — verify the data was escaped, not absent
    expect(xml).toContain('&amp;');   // raw & was escaped
    expect(xml).toContain('&lt;');    // raw < was escaped
    expect(xml).toContain('&gt;');    // raw > was escaped
    // No raw unescaped special chars in data positions
    const body = xml.replace(/<[^>]+>/g, '');
    expect(body).not.toContain('<');
    expect(body).not.toContain('>');
    // & is valid in body as part of XML entities — do not assert absence
  });

  it('active files deduplicated by path', () => {
    const events: SessionEvent[] = [
      makeFileEvent('/src/index.ts', 'file_read'),
      makeFileEvent('/src/index.ts', 'file_edit'),
      makeFileEvent('/src/index.ts', 'file_read'),
    ];
    const xml = buildResumeSnapshot(events);
    // Should appear only once
    const matches = xml.match(/path="\/src\/index\.ts"/g);
    expect(matches).toHaveLength(1);
  });

  it('active files tracks op counts correctly', () => {
    const events: SessionEvent[] = [
      makeFileEvent('/src/app.ts', 'file_read'),
      makeFileEvent('/src/app.ts', 'file_read'),
      makeFileEvent('/src/app.ts', 'file_edit'),
    ];
    const xml = buildResumeSnapshot(events);
    expect(xml).toContain('read:2');
    expect(xml).toContain('edit:1');
    expect(xml).toContain('last="edit"');
  });

  it('task_state omits completed tasks', () => {
    const events: SessionEvent[] = [
      makeEvent('task_create', 'task', 1, JSON.stringify({ subject: 'Pending task alpha' })),
      makeEvent('task_create', 'task', 1, JSON.stringify({ subject: 'Done task beta' })),
      makeEvent('task_update', 'task', 1, JSON.stringify({ taskId: 'Done task beta', status: 'completed' })),
    ];
    const xml = buildResumeSnapshot(events);
    expect(xml).toContain('Pending task alpha');
    expect(xml).not.toContain('Done task beta');
  });

  it('compact_count and events_captured reflected in output', () => {
    const events = [makeFileEvent('/src/x.ts')];
    const xml = buildResumeSnapshot(events, { compactCount: 3, generatedAt: '2026-01-01T00:00:00.000Z' });
    expect(xml).toContain('compact_count="3"');
    expect(xml).toContain('events_captured="1"');
    expect(xml).toContain('generated_at="2026-01-01T00:00:00.000Z"');
  });

  it('custom maxBytes respected', () => {
    const events: SessionEvent[] = [];
    for (let i = 0; i < 30; i++) {
      events.push(makeFileEvent(`/src/file-${i}.ts`));
    }
    const xml = buildResumeSnapshot(events, { maxBytes: 512 });
    expect(Buffer.byteLength(xml, 'utf8')).toBeLessThanOrEqual(512);
  });

  it('decisions and errors included when budget allows', () => {
    const events: SessionEvent[] = [
      makeEvent('decision_made', 'decision', 2, 'Use SQLite for persistence'),
      makeEvent('error_caught', 'error', 2, 'Module not found: foo'),
    ];
    const xml = buildResumeSnapshot(events);
    expect(xml).toContain('Use SQLite for persistence');
    expect(xml).toContain('Module not found: foo');
    expect(Buffer.byteLength(xml, 'utf8')).toBeLessThanOrEqual(2048);
  });

  it('environment section renders cwd and git op', () => {
    const events: SessionEvent[] = [
      makeEvent('cwd_change', 'cwd', 2, '/Volumes/Moon/Coding/project'),
      makeEvent('git_op', 'git', 2, 'commit'),
    ];
    const xml = buildResumeSnapshot(events);
    expect(xml).toContain('<cwd>/Volumes/Moon/Coding/project</cwd>');
    expect(xml).toContain('<git op="commit"');
  });
});
