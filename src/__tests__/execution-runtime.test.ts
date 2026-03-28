import { describe, it, expect } from 'vitest';
import { detectRuntimes, buildCommand } from '../execution/runtime.js';
import type { Language } from '../execution/runtime.js';

// ─────────────────────────────────────────────────────────
// detectRuntimes
// ─────────────────────────────────────────────────────────

describe('detectRuntimes', () => {
  it('returns an array', async () => {
    const runtimes = await detectRuntimes();
    expect(Array.isArray(runtimes)).toBe(true);
  });

  it("always includes 'shell'", async () => {
    const runtimes = await detectRuntimes();
    expect(runtimes).toContain('shell');
  });

  it('returns only valid Language values', async () => {
    const valid: Language[] = [
      'javascript', 'typescript', 'python', 'shell',
      'ruby', 'go', 'rust', 'php', 'perl', 'r', 'elixir',
    ];
    const runtimes = await detectRuntimes();
    for (const lang of runtimes) {
      expect(valid).toContain(lang);
    }
  });
});

// ─────────────────────────────────────────────────────────
// buildCommand
// ─────────────────────────────────────────────────────────

describe('buildCommand', () => {
  it("shell: returns a valid spawn args array containing the file path", () => {
    const args = buildCommand('shell', '/tmp/test.sh');
    expect(Array.isArray(args)).toBe(true);
    expect(args.length).toBeGreaterThanOrEqual(2);
    expect(args[args.length - 1]).toBe('/tmp/test.sh');
  });

  it("python: returns spawn args with python binary and file path", () => {
    // python or python3 must be available in CI/dev environments
    // If neither is installed this test is skipped gracefully
    let args: string[];
    try {
      args = buildCommand('python', '/tmp/test.py');
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('No Python runtime')) {
        console.warn('Skipping python test — python not available');
        return;
      }
      throw err;
    }
    expect(Array.isArray(args)).toBe(true);
    expect(args.length).toBeGreaterThanOrEqual(2);
    expect(args[args.length - 1]).toBe('/tmp/test.py');
    expect(['python', 'python3']).toContain(args[0]);
  });

  it('shell command uses a known shell binary', () => {
    const args = buildCommand('shell', '/tmp/test.sh');
    expect(['bash', 'sh', 'powershell', 'cmd.exe']).toContain(args[0]);
  });

  it('all 11 Language values are accepted without throwing (skips unavailable runtimes)', () => {
    const all: Language[] = [
      'javascript', 'typescript', 'python', 'shell',
      'ruby', 'go', 'rust', 'php', 'perl', 'r', 'elixir',
    ];
    for (const lang of all) {
      let threw = false;
      try {
        const result = buildCommand(lang, `/tmp/test-${lang}`);
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
      } catch (err: unknown) {
        threw = true;
        // Only acceptable failure is "not available"
        if (err instanceof Error) {
          expect(err.message).toMatch(/not available|No .* runtime/i);
        }
      }
      // Either it succeeded OR it threw a "not available" error — both are valid
      void threw;
    }
  });

  it('typescript: returns ts-node/tsx/bun args or throws not-available', () => {
    try {
      const args = buildCommand('typescript', '/tmp/test.ts');
      expect(Array.isArray(args)).toBe(true);
      expect(args[args.length - 1]).toBe('/tmp/test.ts');
    } catch (err: unknown) {
      if (err instanceof Error) {
        expect(err.message).toContain('No TypeScript runtime');
      }
    }
  });

  it('rust: returns compile-run sentinel or throws not-available', () => {
    try {
      const args = buildCommand('rust', '/tmp/test.rs');
      expect(args[0]).toBe('__rust_compile_run__');
      expect(args[1]).toBe('/tmp/test.rs');
    } catch (err: unknown) {
      if (err instanceof Error) {
        expect(err.message).toContain('Rust not available');
      }
    }
  });
});
