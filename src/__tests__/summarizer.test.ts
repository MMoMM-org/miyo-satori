import { describe, it, expect } from 'vitest';
import { summarize } from '../context/summarizer.js';

describe('summarize', () => {
  it('returns short input unchanged (<=300 chars)', () => {
    const input = 'hello world';
    expect(summarize('srv', 'tool', input)).toBe(input);
  });

  it('returns empty string unchanged', () => {
    expect(summarize('srv', 'tool', '')).toBe('');
  });

  it('returns exactly 300-char input unchanged', () => {
    const input = 'a'.repeat(300);
    expect(summarize('srv', 'tool', input)).toBe(input);
  });

  it('summarizes long JSON object: extracts keys, <=500 chars', () => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < 20; i++) {
      obj[`key${i}`] = 'a'.repeat(100);
    }
    const json = JSON.stringify(obj);
    expect(json.length).toBeGreaterThan(300);
    const result = summarize('srv', 'tool', json);
    expect(result.length).toBeLessThanOrEqual(500);
    expect(result).toContain('key0');
  });

  it('summarizes long multi-line text: 15 lines + count, <=500 chars', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}: ${'x'.repeat(20)}`);
    const input = lines.join('\n');
    expect(input.length).toBeGreaterThan(300);
    const result = summarize('srv', 'tool', input);
    expect(result.length).toBeLessThanOrEqual(500);
    expect(result).toContain('[... 25 more lines]');
  });

  it('truncates 5000-char single-line input to <=500 chars', () => {
    const input = 'x'.repeat(5000);
    const result = summarize('srv', 'tool', input);
    expect(result.length).toBeLessThanOrEqual(500);
    expect(result.endsWith('...')).toBe(true);
  });

  it('keeps JSON with few keys under 500 chars', () => {
    const obj = { name: 'test', value: 'x'.repeat(400), extra: 'y' };
    const json = JSON.stringify(obj);
    expect(json.length).toBeGreaterThan(300);
    const result = summarize('srv', 'tool', json);
    expect(result.length).toBeLessThanOrEqual(500);
  });
});
