import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PolyglotExecutor } from '../execution/executor.js';
import { BuiltinServer } from '../execution/builtin-server.js';
import { KnowledgeDB } from '../knowledge/knowledge-db.js';

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

let executor: PolyglotExecutor;
let knowledgeDb: KnowledgeDB;
let server: BuiltinServer;
let tmpDir: string;

beforeEach(() => {
  executor = new PolyglotExecutor();
  knowledgeDb = new KnowledgeDB(':memory:');
  server = new BuiltinServer(executor, knowledgeDb, 'test-client');
  tmpDir = mkdtempSync(join(tmpdir(), 'builtin-server-test-'));
});

afterEach(() => {
  executor.cleanupBackgrounded();
  knowledgeDb.close();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

// ─────────────────────────────────────────────────────────
// run — basic shell
// ─────────────────────────────────────────────────────────

describe('exec — run (basic)', () => {
  it('returns content containing stdout for echo hello', async () => {
    const result = await server.exec('bash', 'run', {
      language: 'shell',
      code: 'echo hello',
    });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('hello');
  });
});

// ─────────────────────────────────────────────────────────
// run — intent-driven mode (small output, intent ignored)
// ─────────────────────────────────────────────────────────

describe('exec — run (intent ignored for small output)', () => {
  it('returns full stdout when output ≤5000 bytes even if intent is set', async () => {
    const result = await server.exec('bash', 'run', {
      language: 'shell',
      code: 'echo hi',
      intent: 'greeting',
    });
    expect(result.isError).toBeFalsy();
    // Should return raw stdout, not JSON search results
    expect(result.content).toContain('hi');
    // Should NOT be a JSON object with "results" key
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.content);
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed === 'object' && parsed !== null) {
      expect((parsed as Record<string, unknown>).truncated).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────
// run — intent-driven mode (large output → JSON results)
// ─────────────────────────────────────────────────────────

describe('exec — run (intent-driven mode with large output)', () => {
  it('returns JSON search results (not raw stdout) when output >5000 bytes and intent is set', async () => {
    // Generate output larger than 5000 bytes
    const result = await server.exec('bash', 'run', {
      language: 'shell',
      // Print 5001 'x' characters — ensures stdout > 5_000 bytes threshold
      code: `printf '%5001s' | tr ' ' 'x'`,
      intent: 'find something',
    });
    expect(result.isError).toBeFalsy();

    // Content must be valid JSON
    let parsed: Record<string, unknown>;
    expect(() => {
      parsed = JSON.parse(result.content);
    }).not.toThrow();
    parsed = JSON.parse(result.content);

    // Must have truncated: true
    expect(parsed['truncated']).toBe(true);
    // Must have intent echoed back
    expect(parsed['intent']).toBe('find something');
    // Must have results key (search results or throttle block)
    expect(parsed).toHaveProperty('results');
    // Must NOT contain the raw repeated 'x' string
    expect(result.content).not.toContain('x'.repeat(100));
  });
});

// ─────────────────────────────────────────────────────────
// run_file
// ─────────────────────────────────────────────────────────

describe('exec — run_file', () => {
  it('executes a shell script file and returns its output', async () => {
    const scriptPath = join(tmpDir, 'test.sh');
    writeFileSync(scriptPath, '#!/bin/sh\necho "file-output"\n', { mode: 0o700 });

    const executor2 = new PolyglotExecutor({ projectRoot: tmpDir });
    const server2 = new BuiltinServer(executor2, knowledgeDb, 'test-client');

    const result = await server2.exec('bash', 'run_file', {
      path: scriptPath,
      language: 'shell',
    });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('file-output');
  });
});

// ─────────────────────────────────────────────────────────
// batch
// ─────────────────────────────────────────────────────────

describe('exec — batch', () => {
  it('runs commands, indexes outputs, and returns JSON results for each query', async () => {
    const result = await server.exec('bash', 'batch', {
      commands: [{ label: 'ls', command: 'echo test' }],
      queries: ['test'],
    });
    expect(result.isError).toBeFalsy();

    let parsed: Record<string, unknown>;
    expect(() => {
      parsed = JSON.parse(result.content);
    }).not.toThrow();
    parsed = JSON.parse(result.content);

    // Must have results key
    expect(parsed).toHaveProperty('results');
    const results = parsed['results'] as Record<string, unknown>;
    // Must have an entry for our query
    expect(results).toHaveProperty('test');
    // The entry should be an array (search results)
    expect(Array.isArray(results['test'])).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────
// Error cases
// ─────────────────────────────────────────────────────────

describe('exec — error cases', () => {
  it('returns isError: true for unknown server name', async () => {
    const result = await server.exec('unknown', 'run', {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Unknown builtin server: unknown');
  });

  it('returns isError: true for unknown tool name', async () => {
    const result = await server.exec('bash', 'unknown-tool', {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Unknown tool: unknown-tool');
    expect(result.content).toContain('run, run_file, batch');
  });

  it('returns isError: true for missing language in run', async () => {
    const result = await server.exec('bash', 'run', { code: 'echo hi' });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/invalid.*missing.*language/i);
  });

  it('returns isError: true for invalid language in run', async () => {
    const result = await server.exec('bash', 'run', {
      language: 'cobol',
      code: 'DISPLAY "HELLO"',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/invalid.*missing.*language/i);
  });
});
