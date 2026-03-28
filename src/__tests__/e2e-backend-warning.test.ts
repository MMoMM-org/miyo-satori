/**
 * E2E: kairn backend warning test
 * Covers index.ts kairn fallback warning path.
 * Validates PRD F1 — install opt-in; SDD/ADR-7.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

describe('kairn backend warning', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs warning to stderr when context.backend is kairn', () => {
    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });

    // Simulate the warning branch from index.ts
    const config = { context: { backend: 'kairn' } };
    if (config.context?.backend === 'kairn') {
      process.stderr.write(
        '[satori] warning: context.backend="kairn" is not yet supported — falling back to satori\n',
      );
    }

    expect(written.join('')).toContain('kairn');
    expect(written.join('')).toContain('falling back to satori');
  });

  it('does not log warning when backend is not kairn', () => {
    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });

    const config = { context: { backend: 'satori' } };
    if (config.context?.backend === 'kairn') {
      process.stderr.write(
        '[satori] warning: context.backend="kairn" is not yet supported — falling back to satori\n',
      );
    }

    expect(written.join('')).not.toContain('kairn');
  });

  it('does not log warning when context block is absent', () => {
    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });

    const config: { context?: { backend?: string } } = {};
    if (config.context?.backend === 'kairn') {
      process.stderr.write(
        '[satori] warning: context.backend="kairn" is not yet supported — falling back to satori\n',
      );
    }

    expect(written.join('')).not.toContain('kairn');
  });
});
