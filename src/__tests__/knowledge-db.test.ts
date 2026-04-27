import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { KnowledgeDB, KbSearchResult, ThrottleBlock } from '../knowledge/knowledge-db.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isThrottleBlock(v: unknown): v is ThrottleBlock {
  return typeof v === 'object' && v !== null && (v as ThrottleBlock).blocked === true;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('KnowledgeDB', () => {
  let db: KnowledgeDB;

  beforeEach(() => {
    db = new KnowledgeDB(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  it('constructs without error using :memory:', () => {
    expect(db).toBeTruthy();
  });

  it('kbPath() returns satori/kb.sqlite under repoRoot', () => {
    expect(KnowledgeDB.kbPath('/some/repo')).toBe('/some/repo/satori/kb.sqlite');
  });

  // -------------------------------------------------------------------------
  // index() — chunking
  // -------------------------------------------------------------------------

  it('index() returns chunk count for headingless content', () => {
    const n = db.index({ content: 'Hello world. No headings here.', title: 'test' });
    expect(n).toBe(1);
  });

  it('index() chunks markdown by headings', () => {
    const md = [
      '## Introduction',
      'Intro paragraph.',
      '',
      '## Details',
      'Details paragraph.',
      '',
      '### Sub-section',
      'Sub-section content.',
    ].join('\n');

    const n = db.index({ content: md, title: 'Doc' });
    expect(n).toBe(3);
  });

  it('index() does not split code blocks mid-block', () => {
    const md = [
      '## Setup',
      '',
      'Some text before the fence.',
      '',
      '```bash',
      '## this looks like a heading but is inside a code block',
      'echo hello',
      '```',
      '',
      'Text after fence.',
    ].join('\n');

    const n = db.index({ content: md, title: 'Code doc' });
    // Should produce exactly 1 chunk (everything under ## Setup)
    expect(n).toBe(1);
  });

  it('index() returns 0 for empty content', () => {
    const n = db.index({ content: '', title: 'empty' });
    expect(n).toBe(0);
  });

  // -------------------------------------------------------------------------
  // search()
  // -------------------------------------------------------------------------

  it('search() finds inserted content', () => {
    db.index({ content: '## Overview\nThis document covers xenomorph biology.', title: 'Bio' });
    const results = db.search({ query: 'xenomorph', sessionId: 'find-test' });
    expect(Array.isArray(results)).toBe(true);
    expect((results as KbSearchResult[]).length).toBeGreaterThan(0);
    expect((results as KbSearchResult[])[0].snippet).toMatch(/xenomorph/i);
  });

  it('search() returns empty array for no match', () => {
    db.index({ content: '## Intro\nHello world content.', title: 'doc' });
    const results = db.search({ query: 'zzznomatch999', sessionId: 'empty-test' });
    expect(Array.isArray(results)).toBe(true);
    expect((results as KbSearchResult[]).length).toBe(0);
  });

  it('search() returns KbSearchResult[] sorted by score (descending)', () => {
    db.index({
      content: [
        '## Alpha',
        'The quick brown fox jumps over the lazy dog.',
        '## Beta',
        'Another chunk with fox content here, fox fox.',
      ].join('\n'),
      title: 'Scores',
    });
    const results = db.search({ query: 'fox', sessionId: 'sort-test' }) as KbSearchResult[];
    expect(Array.isArray(results)).toBe(true);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('search() contentType filter returns only matching type', () => {
    db.index({ content: '## Prose chunk\nThis is prose text.', title: 'p', type: 'prose' });
    db.index({ content: '## Code chunk\nThis is prose text too.', title: 'c', type: 'code' });

    const proseResults = db.search({
      query: 'prose',
      contentType: 'prose',
      sessionId: 'filter-test-prose',
    }) as KbSearchResult[];

    const codeResults = db.search({
      query: 'prose',
      contentType: 'code',
      sessionId: 'filter-test-code',
    }) as KbSearchResult[];

    expect(proseResults.every(r => r.type === 'prose')).toBe(true);
    expect(codeResults.every(r => r.type === 'code')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Throttle
  // -------------------------------------------------------------------------

  it('throttle: calls 1-3 return at most 2 results', () => {
    // Insert plenty of content so limit is the bottleneck, not result count
    for (let i = 0; i < 10; i++) {
      db.index({ content: `## Item ${i}\nthrottle-term content item number ${i}`, title: `t${i}` });
    }

    const session = 'throttle-a';
    for (let call = 1; call <= 3; call++) {
      const res = db.search({ query: 'throttle-term', sessionId: session });
      expect(Array.isArray(res)).toBe(true);
      expect((res as KbSearchResult[]).length).toBeLessThanOrEqual(2);
    }
  });

  it('throttle: calls 4-8 return at most 1 result', () => {
    for (let i = 0; i < 10; i++) {
      db.index({ content: `## Item ${i}\nthrottle-term content item number ${i}`, title: `t${i}` });
    }

    const session = 'throttle-b';
    // Burn first 3 calls
    for (let i = 0; i < 3; i++) {
      db.search({ query: 'throttle-term', sessionId: session });
    }
    // Calls 4-8
    for (let call = 4; call <= 8; call++) {
      const res = db.search({ query: 'throttle-term', sessionId: session });
      expect(Array.isArray(res)).toBe(true);
      expect((res as KbSearchResult[]).length).toBeLessThanOrEqual(1);
    }
  });

  it('throttle: call 9 returns ThrottleBlock', () => {
    const session = 'throttle-c';
    // Burn 8 calls
    for (let i = 0; i < 8; i++) {
      db.search({ query: 'anything', sessionId: session });
    }
    // Call 9
    const res = db.search({ query: 'anything', sessionId: session });
    expect(isThrottleBlock(res)).toBe(true);
  });

  it('ThrottleBlock has blocked: true and redirect: satori_exec', () => {
    const session = 'throttle-d';
    for (let i = 0; i < 8; i++) {
      db.search({ query: 'x', sessionId: session });
    }
    const res = db.search({ query: 'x', sessionId: session }) as ThrottleBlock;
    expect(res.blocked).toBe(true);
    expect(res.redirect).toBe('satori_exec');
    expect(typeof res.message).toBe('string');
    expect(res.message.length).toBeGreaterThan(0);
  });

  it('throttle resets per session (different sessions are independent)', () => {
    const sessionA = 'throttle-e-a';
    const sessionB = 'throttle-e-b';

    // Exhaust session A
    for (let i = 0; i < 8; i++) {
      db.search({ query: 'x', sessionId: sessionA });
    }
    const resA = db.search({ query: 'x', sessionId: sessionA });
    expect(isThrottleBlock(resA)).toBe(true);

    // Session B is still fresh
    const resB = db.search({ query: 'x', sessionId: sessionB });
    expect(isThrottleBlock(resB)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // fetchAndIndex()
  // -------------------------------------------------------------------------

  it('fetchAndIndex returns {error} on non-200 response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });
    const original = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      const result = await db.fetchAndIndex({ url: 'https://example.com/missing' });
      expect(result).toHaveProperty('error');
      expect((result as { error: string }).error).toMatch(/404/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('fetchAndIndex returns {error} on network failure', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network unreachable'));
    const original = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      const result = await db.fetchAndIndex({ url: 'https://example.com/page' });
      expect(result).toHaveProperty('error');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('fetchAndIndex indexes HTML content and strips tags', async () => {
    const html = `<!DOCTYPE html><html><body>
      <h1>Test Page</h1>
      <p>This page contains the word <strong>mammoth</strong>.</p>
      <script>alert('ignore me')</script>
    </body></html>`;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => html,
    });
    const original = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      const result = await db.fetchAndIndex({
        url: 'https://example.com/page',
        title: 'Test Page',
      });
      expect(result).toHaveProperty('indexed');
      expect((result as { indexed: number }).indexed).toBeGreaterThan(0);

      // Now search for content from the page
      const searchRes = db.search({ query: 'mammoth', sessionId: 'fetch-test' }) as KbSearchResult[];
      expect(Array.isArray(searchRes)).toBe(true);
      expect(searchRes.length).toBeGreaterThan(0);
      // Script content should NOT be in the index
      const allSnippets = searchRes.map(r => r.snippet).join(' ');
      expect(allSnippets).not.toMatch(/alert/);
    } finally {
      globalThis.fetch = original;
    }
  });

  // -------------------------------------------------------------------------
  // Trigram availability
  // -------------------------------------------------------------------------

  it('exposes isTrigramAvailable (boolean)', () => {
    expect(typeof db.isTrigramAvailable).toBe('boolean');
  });
});
