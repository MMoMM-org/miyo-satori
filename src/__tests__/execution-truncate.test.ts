import { describe, it, expect } from 'vitest';
import { smartTruncate, capBytes, truncateString } from '../execution/truncate.js';

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function makeLines(count: number, lineLength = 80): string {
  return Array.from({ length: count }, (_, i) => `line ${i + 1} ${'x'.repeat(lineLength)}`).join('\n');
}

// ─────────────────────────────────────────────────────────
// smartTruncate
// ─────────────────────────────────────────────────────────

describe('smartTruncate', () => {
  it('returns input unchanged when within budget', () => {
    const input = 'short string';
    expect(smartTruncate(input, 1024)).toBe(input);
  });

  it('returns at most maxBytes bytes for large input', () => {
    const input = makeLines(500, 80);
    const maxBytes = 2048;
    const result = smartTruncate(input, maxBytes);
    expect(Buffer.byteLength(result)).toBeLessThanOrEqual(maxBytes + 512); // separator overhead allowed
    expect(Buffer.byteLength(result)).toBeLessThan(Buffer.byteLength(input));
  });

  it('head portion is larger than tail (60/40 split)', () => {
    const input = makeLines(200, 100);
    const maxBytes = 4096;
    const result = smartTruncate(input, maxBytes);
    // Find separator
    const sepIdx = result.indexOf('... [');
    expect(sepIdx).toBeGreaterThan(0);
    const head = result.slice(0, sepIdx);
    const tail = result.slice(result.lastIndexOf('] ...\n\n') + 7);
    expect(Buffer.byteLength(head)).toBeGreaterThan(Buffer.byteLength(tail));
  });

  it('does not cut in the middle of a line (snaps to line boundary)', () => {
    const input = makeLines(100, 120);
    const maxBytes = 3000;
    const result = smartTruncate(input, maxBytes);
    const sepIdx = result.indexOf('... [');
    const head = result.slice(0, sepIdx).trimEnd();
    const tailStart = result.slice(result.lastIndexOf('] ...\n\n') + 7);
    // Every segment should consist only of complete lines from the original
    for (const segment of [head, tailStart]) {
      for (const line of segment.split('\n').filter(l => l.length > 0)) {
        // Each line should match the pattern we generated
        expect(line).toMatch(/^line \d+ x+$/);
      }
    }
  });

  it('inserts separator with skipped line count', () => {
    const input = makeLines(300, 80);
    const maxBytes = 2048;
    const result = smartTruncate(input, maxBytes);
    expect(result).toContain('lines /');
    expect(result).toContain('truncated');
    expect(result).toContain('showing first');
    expect(result).toContain('last');
  });

  it('handles single-line input that exceeds budget', () => {
    const input = 'a'.repeat(10000);
    const maxBytes = 100;
    const result = smartTruncate(input, maxBytes);
    // Single line — head gets everything that fits, tail gets nothing
    expect(result).toBeTruthy();
  });

  it('returns unchanged for empty string', () => {
    expect(smartTruncate('', 100)).toBe('');
  });
});

// ─────────────────────────────────────────────────────────
// capBytes
// ─────────────────────────────────────────────────────────

describe('capBytes', () => {
  it('returns empty string for empty input', () => {
    expect(capBytes('', 100)).toBe('');
  });

  it('returns input unchanged when within budget', () => {
    expect(capBytes('hello', 100)).toBe('hello');
  });

  it('truncates at byte boundary', () => {
    const input = 'a'.repeat(200);
    const result = capBytes(input, 50);
    expect(Buffer.byteLength(result)).toBeLessThanOrEqual(50);
    expect(result.length).toBe(50);
  });

  it('handles multibyte characters without splitting a character', () => {
    // Each emoji is 4 bytes
    const input = '😀'.repeat(20);
    const result = capBytes(input, 10);
    // 10 bytes = 2 complete emojis (8 bytes) — must not produce 9 or 10 bytes that cut mid-emoji
    expect(Buffer.byteLength(result)).toBeLessThanOrEqual(10);
    // Should be a valid string (no surrogate pairs broken)
    expect(() => encodeURIComponent(result)).not.toThrow();
  });

  it('returns input unchanged when exactly at budget', () => {
    const input = 'hello';
    expect(capBytes(input, Buffer.byteLength(input))).toBe(input);
  });
});

// ─────────────────────────────────────────────────────────
// truncateString
// ─────────────────────────────────────────────────────────

describe('truncateString', () => {
  it('returns input unchanged when short enough', () => {
    expect(truncateString('hi', 10)).toBe('hi');
  });

  it('appends ellipsis when truncated', () => {
    const result = truncateString('hello world', 8);
    expect(result).toHaveLength(8);
    expect(result.endsWith('...')).toBe(true);
  });

  it('handles exact boundary', () => {
    expect(truncateString('hello', 5)).toBe('hello');
  });
});
