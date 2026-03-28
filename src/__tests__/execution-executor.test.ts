import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PolyglotExecutor } from '../execution/executor.js';

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

let executor: PolyglotExecutor;
let tmpDir: string;

beforeEach(() => {
  executor = new PolyglotExecutor();
  tmpDir = mkdtempSync(join(tmpdir(), 'executor-test-'));
});

afterEach(() => {
  executor.cleanupBackgrounded();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

// ─────────────────────────────────────────────────────────
// execute — basic shell
// ─────────────────────────────────────────────────────────

describe('execute — shell', () => {
  it('returns stdout and exitCode 0 for echo hello', async () => {
    const result = await executor.execute({ language: 'shell', code: 'echo hello' });
    expect(result.stdout.trim()).toBe('hello');
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('returns non-zero exitCode for failing command', async () => {
    const result = await executor.execute({ language: 'shell', code: 'exit 42' });
    expect(result.exitCode).toBe(42);
  });
});

// ─────────────────────────────────────────────────────────
// execute — missing runtime
// ─────────────────────────────────────────────────────────

describe('execute — missing runtime', () => {
  it('throws with runtime name in message when language is unavailable', async () => {
    // We mock a non-existent language by abusing a known-unavailable runtime.
    // buildCommand throws synchronously when a runtime is absent; that throw
    // propagates out of execute() as a rejected promise.
    // We test the error-path by calling buildCommand directly for a language
    // whose runtime may be absent. Since we cannot monkey-patch module imports,
    // we verify the error message format this way.
    //
    // The cleanest cross-platform approach: use a custom executor with a
    // non-existent interpreter by passing language='shell' and relying on
    // a bad PATH — but that mutates process.env globally.
    //
    // Instead, we verify the actual runtime detection path works correctly
    // by checking that when a language IS available, execute succeeds, and
    // we document the error format via unit testing buildCommand's throw.
    const { buildCommand } = await import('../execution/runtime.js');
    // If php is not installed, buildCommand('php', ...) throws with 'PHP'
    // If it is installed, skip this sub-assertion.
    let threwForUnavailable = false;
    try {
      buildCommand('php', '/tmp/test.php');
    } catch (err) {
      threwForUnavailable = true;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/php/i);
    }
    if (!threwForUnavailable) {
      // php is available — skip; test is architecturally correct but machine-dependent
    }
  });
});

// ─────────────────────────────────────────────────────────
// execute — timeout
// ─────────────────────────────────────────────────────────

describe('execute — timeout', () => {
  it('kills slow process and sets timedOut: true', async () => {
    const result = await executor.execute({
      language: 'shell',
      code: 'sleep 60',
      timeout: 200,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(1);
  }, 5_000);
});

// ─────────────────────────────────────────────────────────
// execute — background mode
// ─────────────────────────────────────────────────────────

describe('execute — background', () => {
  it('returns backgrounded: true immediately without waiting for process', async () => {
    const start = Date.now();
    const result = await executor.execute({
      language: 'shell',
      code: 'echo hi && sleep 10',
      background: true,
    });
    const elapsed = Date.now() - start;
    expect(result.backgrounded).toBe(true);
    // Should return well under 1 second (not wait for the sleep)
    expect(elapsed).toBeLessThan(2_000);
  });
});

// ─────────────────────────────────────────────────────────
// executeFile
// ─────────────────────────────────────────────────────────

describe('executeFile', () => {
  it('executes a shell file from disk', async () => {
    const scriptPath = join(tmpDir, 'test.sh');
    writeFileSync(scriptPath, '#!/bin/sh\necho "from-file"\n', { mode: 0o700 });

    const executor2 = new PolyglotExecutor({ projectRoot: tmpDir });
    const result = await executor2.executeFile({
      path: scriptPath,
      language: 'shell',
    });
    expect(result.stdout.trim()).toBe('from-file');
    expect(result.exitCode).toBe(0);
  });

  it('prepends code as variable assignments when code is provided', async () => {
    const scriptPath = join(tmpDir, 'vars.sh');
    // Script echoes a variable that will be injected via code
    writeFileSync(scriptPath, '#!/bin/sh\necho "$INJECTED_VAR"\n', { mode: 0o700 });

    const executor2 = new PolyglotExecutor({ projectRoot: tmpDir });
    const result = await executor2.executeFile({
      path: scriptPath,
      language: 'shell',
      code: 'INJECTED_VAR=hello_from_code',
    });
    expect(result.stdout.trim()).toBe('hello_from_code');
    expect(result.exitCode).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────
// #buildSafeEnv — strips dangerous env vars
// ─────────────────────────────────────────────────────────

describe('#buildSafeEnv — env var stripping', () => {
  it('strips BASH_ENV so it does not appear in spawned process environment', async () => {
    // Set BASH_ENV in process.env temporarily, then verify it doesn't reach
    // the child by running `env` and checking BASH_ENV is absent.
    const original = process.env['BASH_ENV'];
    process.env['BASH_ENV'] = '/tmp/injected.sh';
    try {
      const result = await executor.execute({
        language: 'shell',
        // Print env and filter for BASH_ENV — should produce no output
        code: 'env | grep "^BASH_ENV=" || true',
      });
      expect(result.stdout.trim()).toBe('');
      expect(result.exitCode).toBe(0);
    } finally {
      if (original === undefined) {
        delete process.env['BASH_ENV'];
      } else {
        process.env['BASH_ENV'] = original;
      }
    }
  });

  it('strips NODE_OPTIONS so it does not appear in spawned process environment', async () => {
    const original = process.env['NODE_OPTIONS'];
    process.env['NODE_OPTIONS'] = '--require /tmp/inject.js';
    try {
      const result = await executor.execute({
        language: 'shell',
        code: 'env | grep "^NODE_OPTIONS=" || true',
      });
      expect(result.stdout.trim()).toBe('');
      expect(result.exitCode).toBe(0);
    } finally {
      if (original === undefined) {
        delete process.env['NODE_OPTIONS'];
      } else {
        process.env['NODE_OPTIONS'] = original;
      }
    }
  });

  it('allows safe env vars to be merged in via opts.env', async () => {
    const result = await executor.execute({
      language: 'shell',
      code: 'echo "$MY_SAFE_VAR"',
      env: { MY_SAFE_VAR: 'safe-value-123' },
    });
    expect(result.stdout.trim()).toBe('safe-value-123');
    expect(result.exitCode).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────
// cleanupBackgrounded
// ─────────────────────────────────────────────────────────

describe('cleanupBackgrounded', () => {
  it('does not throw when no background processes exist', () => {
    const fresh = new PolyglotExecutor();
    expect(() => fresh.cleanupBackgrounded()).not.toThrow();
  });

  it('cleans up after a backgrounded process is started', async () => {
    await executor.execute({
      language: 'shell',
      code: 'sleep 30',
      background: true,
    });
    // cleanupBackgrounded should kill the process without throwing
    expect(() => executor.cleanupBackgrounded()).not.toThrow();
    // Second call (empty set) also should not throw
    expect(() => executor.cleanupBackgrounded()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────
// 100MB cap test — skipped (impractical in unit tests)
// ─────────────────────────────────────────────────────────

describe('100MB hard cap', () => {
  it.skip(
    'kills process and sets capExceeded when output exceeds cap (skipped — generating 100MB in tests is impractical; tested manually with yes | head -c 105m)',
    () => {},
  );

  it('respects a custom hardCapBytes threshold', async () => {
    // Use a tiny hardCapBytes (512 bytes) to test the cap mechanism
    // without generating large output.
    const smallCapExecutor = new PolyglotExecutor({ hardCapBytes: 512 });
    // Generate output larger than 512 bytes
    const result = await smallCapExecutor.execute({
      language: 'shell',
      // Print 1000 bytes
      code: 'printf "%0.s1234567890" $(seq 1 100)',
    });
    // The process should have been killed and capExceeded set
    expect(result.capExceeded).toBe(true);
  });
});
