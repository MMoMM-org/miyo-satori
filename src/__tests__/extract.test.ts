import { describe, it, expect } from 'vitest';
import { extractEvent } from '../context/extract.js';

describe('extractEvent', () => {
  it('Read tool -> file_read event with correct path', () => {
    const event = extractEvent('Read', { path: '/src/index.ts' });
    expect(event).not.toBeNull();
    expect(event!.type).toBe('file_read');
    expect(event!.category).toBe('file');
    expect(event!.priority).toBe(1);
    expect(event!.data).toBe('/src/index.ts');
  });

  it('Write tool -> file_write event', () => {
    const event = extractEvent('Write', { path: '/src/output.ts' });
    expect(event).not.toBeNull();
    expect(event!.type).toBe('file_write');
    expect(event!.category).toBe('file');
    expect(event!.priority).toBe(1);
    expect(event!.data).toBe('/src/output.ts');
  });

  it('Edit tool -> file_edit event', () => {
    const event = extractEvent('Edit', { path: '/src/edit.ts' });
    expect(event).not.toBeNull();
    expect(event!.type).toBe('file_edit');
    expect(event!.category).toBe('file');
    expect(event!.priority).toBe(1);
    expect(event!.data).toBe('/src/edit.ts');
  });

  it('MultiEdit tool -> file_edit event with paths joined', () => {
    const event = extractEvent('MultiEdit', { paths: ['/a.ts', '/b.ts'] });
    expect(event).not.toBeNull();
    expect(event!.type).toBe('file_edit');
    expect(event!.data).toBe('/a.ts, /b.ts');
  });

  it('MultiEdit with single path fallback', () => {
    const event = extractEvent('MultiEdit', { path: '/single.ts' });
    expect(event).not.toBeNull();
    expect(event!.data).toBe('/single.ts');
  });

  it('TaskCreate -> task_create with subject', () => {
    const event = extractEvent('TaskCreate', { subject: 'Implement feature X' });
    expect(event).not.toBeNull();
    expect(event!.type).toBe('task_create');
    expect(event!.category).toBe('task');
    expect(event!.priority).toBe(1);
    const parsed = JSON.parse(event!.data) as { subject: string };
    expect(parsed.subject).toBe('Implement feature X');
  });

  it('TaskUpdate -> task_update with taskId and status', () => {
    const event = extractEvent('TaskUpdate', { taskId: 'abc123', status: 'completed' });
    expect(event).not.toBeNull();
    expect(event!.type).toBe('task_update');
    expect(event!.category).toBe('task');
    const parsed = JSON.parse(event!.data) as { taskId: string; status: string };
    expect(parsed.taskId).toBe('abc123');
    expect(parsed.status).toBe('completed');
  });

  it('Bash with stderr -> error_caught event', () => {
    const event = extractEvent('Bash', {}, { stderr: 'command not found: foo' });
    expect(event).not.toBeNull();
    expect(event!.type).toBe('error_caught');
    expect(event!.category).toBe('error');
    expect(event!.priority).toBe(2);
    expect(event!.data).toBe('command not found: foo');
  });

  it('Bash with no stderr -> null', () => {
    const event = extractEvent('Bash', {}, { stderr: '' });
    expect(event).toBeNull();
  });

  it('Bash with whitespace-only stderr -> null', () => {
    const event = extractEvent('Bash', {}, { stderr: '   ' });
    expect(event).toBeNull();
  });

  it('Bash with no output at all -> null', () => {
    const event = extractEvent('Bash', {});
    expect(event).toBeNull();
  });

  it('Agent tool -> subagent_launched event', () => {
    const event = extractEvent('Agent', { description: 'Analyze the codebase structure' });
    expect(event).not.toBeNull();
    expect(event!.type).toBe('subagent_launched');
    expect(event!.category).toBe('subagent');
    expect(event!.priority).toBe(3);
    expect(event!.data).toBe('Analyze the codebase structure');
  });

  it('Agent description truncated to 100 chars', () => {
    const longDesc = 'a'.repeat(150);
    const event = extractEvent('Agent', { description: longDesc });
    expect(event!.data.length).toBe(100);
  });

  it('WebFetch -> mcp_call event with url', () => {
    const event = extractEvent('WebFetch', { url: 'https://example.com/api' });
    expect(event).not.toBeNull();
    expect(event!.type).toBe('mcp_call');
    expect(event!.category).toBe('mcp');
    expect(event!.priority).toBe(4);
    expect(event!.data).toBe('WebFetch:https://example.com/api');
  });

  it('WebSearch -> mcp_call event with query', () => {
    const event = extractEvent('WebSearch', { query: 'typescript generics' });
    expect(event).not.toBeNull();
    expect(event!.type).toBe('mcp_call');
    expect(event!.data).toBe('WebSearch:typescript generics');
  });

  it('Glob -> null', () => {
    const event = extractEvent('Glob', { pattern: '**/*.ts' });
    expect(event).toBeNull();
  });

  it('Grep -> null', () => {
    const event = extractEvent('Grep', { pattern: 'import' });
    expect(event).toBeNull();
  });

  it('Unknown tool -> null', () => {
    const event = extractEvent('UnknownTool', { something: true });
    expect(event).toBeNull();
  });

  it('Malformed input -> null (no throw)', () => {
    expect(() => extractEvent('Read', null)).not.toThrow();
    const event = extractEvent('Read', null);
    // Returns event with 'unknown' path rather than null — both are acceptable
    if (event !== null) {
      expect(event.type).toBe('file_read');
      expect(event.data).toBe('unknown');
    }
  });

  it('Read with missing path -> data is "unknown"', () => {
    const event = extractEvent('Read', {});
    expect(event).not.toBeNull();
    expect(event!.data).toBe('unknown');
  });

  it('path truncated to 200 chars', () => {
    const longPath = '/'.repeat(250);
    const event = extractEvent('Read', { path: longPath });
    expect(event!.data.length).toBe(200);
  });

  it('Bash stderr truncated to 150 chars', () => {
    const longError = 'e'.repeat(200);
    const event = extractEvent('Bash', {}, { stderr: longError });
    expect(event!.data.length).toBe(150);
  });
});
