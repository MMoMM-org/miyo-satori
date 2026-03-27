import { describe, it, expect } from 'vitest';
import { extractSessionId } from '../../hooks/scripts/utils.js';

describe('extractSessionId', () => {
  it('extracts UUID from transcript_path', () => {
    const id = extractSessionId({
      transcript_path: '/path/to/550e8400-e29b-41d4-a716-446655440000.jsonl',
    });
    expect(id).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('falls back to session_id field', () => {
    const id = extractSessionId({ session_id: 'my-session' });
    expect(id).toBe('my-session');
  });

  it('falls back to pid fallback', () => {
    const id = extractSessionId({});
    expect(id).toMatch(/^pid-\d+$/);
  });
});
