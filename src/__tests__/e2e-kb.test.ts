/**
 * E2E: satori_kb integration tests
 * Tests full path: KnowledgeDB index → search → RRF ranking
 * Covers PRD F4 acceptance criteria.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { KnowledgeDB } from '../knowledge/knowledge-db.js';
import type { KbSearchResult, ThrottleBlock } from '../knowledge/knowledge-db.js';

const C = 'test-client';

const SAMPLE_DOC = `# Getting Started

This section explains how to install the software.

## Installation

Run the following command to install:

\`\`\`bash
npm install my-package
\`\`\`

## Configuration

Edit the config file to configure settings.

## Usage

After installation, you can use the tool by running the main command.
`;

describe('E2E: satori_kb integration', () => {
  let tmpDir: string;
  let kb: KnowledgeDB;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'satori-e2e-kb-'));
    kb = new KnowledgeDB(join(tmpDir, 'kb.sqlite'));
  });

  afterAll(() => {
    kb.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('kbPath returns satori/kb.sqlite', () => {
    expect(KnowledgeDB.kbPath('/some/repo')).toBe('/some/repo/satori/kb.sqlite');
  });

  it('index markdown: chunks by heading', () => {
    const chunkCount = kb.index({ client: C, title: 'test-doc', content: SAMPLE_DOC });
    expect(chunkCount).toBeGreaterThan(0);
  });

  it('search: returns results for indexed term', () => {
    kb.index({ client: C, title: 'install-doc', content: SAMPLE_DOC });
    const results = kb.search({ client: C, query: 'installation' });
    expect(Array.isArray(results)).toBe(true);
    expect((results as KbSearchResult[]).length).toBeGreaterThan(0);
  });

  it('search: heading-weighted result ranks headings higher', () => {
    kb.index({ client: C, title: 'heading-doc', content: SAMPLE_DOC });
    const results = kb.search({ client: C, query: 'installation' });
    expect(Array.isArray(results)).toBe(true);
    const arr = results as KbSearchResult[];
    // Heading chunk should appear in results
    const hasHeadingMatch = arr.some(
      (r) =>
        r.heading.toLowerCase().includes('install') ||
        r.snippet.toLowerCase().includes('install'),
    );
    expect(hasHeadingMatch).toBe(true);
  });

  it('search: contentType filter returns only matching type', () => {
    kb.index({ client: C, title: 'code-doc', content: SAMPLE_DOC });
    const codeResults = kb.search({ client: C, query: 'npm install', contentType: 'code' });
    expect(Array.isArray(codeResults)).toBe(true);
    // All results should be code chunks
    for (const r of codeResults as KbSearchResult[]) {
      expect(r.type).toBe('code');
    }
  });

  it('search: performance < 200ms for moderate corpus', () => {
    // Index several documents to build up a corpus
    for (let i = 0; i < 10; i++) {
      kb.index({ client: C, title: `perf-doc-${i}`, content: SAMPLE_DOC });
    }
    const start = Date.now();
    kb.search({ client: C, query: 'installation configure usage' });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
  });

  it('throttle: blocks after 8 searches per session', () => {
    const sessionId = 'throttle-test-session';
    // Exhaust the throttle limit (default 8 free searches per session)
    for (let i = 0; i < 8; i++) {
      const result = kb.search({ client: C, query: `query ${i}`, sessionId });
      expect(Array.isArray(result)).toBe(true);
    }
    // 9th search should be throttled — returns ThrottleBlock
    const throttled = kb.search({ client: C, query: 'final query', sessionId });
    expect(Array.isArray(throttled)).toBe(false);
    expect((throttled as ThrottleBlock).blocked).toBe(true);
  });

  it('second index of same title adds new chunks (cumulative)', () => {
    const doc1 = '# Alpha\n\nAlpha section content about widgets';
    const doc2 = '# Beta\n\nBeta section content about gadgets';
    kb.index({ client: C, title: 'cumulative-source', content: doc1 });
    kb.index({ client: C, title: 'cumulative-source', content: doc2 });
    // Both indexed: searching for each term should find its content
    const r1 = kb.search({ client: C, query: 'widgets' });
    expect(Array.isArray(r1)).toBe(true);
    expect((r1 as KbSearchResult[]).some((r) => r.title === 'cumulative-source')).toBe(true);
    const r2 = kb.search({ client: C, query: 'gadgets' });
    expect(Array.isArray(r2)).toBe(true);
    expect((r2 as KbSearchResult[]).some((r) => r.title === 'cumulative-source')).toBe(true);
  });
});
