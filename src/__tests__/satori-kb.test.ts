import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { KnowledgeDB } from '../knowledge/knowledge-db.js';
import { registerSatoriKb } from '../tools/satori-kb.js';

// ---------------------------------------------------------------------------
// Helper — call a registered MCP tool by name
// ---------------------------------------------------------------------------

type McpRegisteredTools = Record<
  string,
  { handler: (args: Record<string, unknown>) => Promise<unknown> }
>;

async function callTool(
  mcpServer: McpServer,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const registeredTools = (mcpServer as unknown as { _registeredTools: McpRegisteredTools })
    ._registeredTools;
  const tool = registeredTools[toolName];
  if (!tool) throw new Error(`Tool ${toolName} not found`);
  return tool.handler(args) as Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('satori_kb', () => {
  let mcpServer: McpServer;
  let db: KnowledgeDB;

  beforeEach(() => {
    mcpServer = new McpServer({ name: 'test', version: '0.1.0' });
    db = new KnowledgeDB(':memory:');
    registerSatoriKb(mcpServer, db);
  });

  afterEach(() => {
    db.close();
  });

  // -------------------------------------------------------------------------
  // index sub-command
  // -------------------------------------------------------------------------

  it('index with content returns { indexed: N }', async () => {
    const result = await callTool(mcpServer, 'satori_kb', {
      sub_command: 'index',
      content: '## Hello\nSome prose content here.',
      title: 'Test Doc',
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text) as { indexed: number };
    expect(parsed.indexed).toBeGreaterThan(0);
  });

  it('index without content returns isError: true', async () => {
    const result = await callTool(mcpServer, 'satori_kb', {
      sub_command: 'index',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('content is required for index');
  });

  // -------------------------------------------------------------------------
  // search sub-command
  // -------------------------------------------------------------------------

  it('search with query returns array of results with snippet, title, score fields', async () => {
    // Index some content first
    db.index({ content: '## BM25 ranking\nThe BM25 algorithm ranks documents.', title: 'BM25 Doc' });

    const result = await callTool(mcpServer, 'satori_kb', {
      sub_command: 'search',
      query: 'BM25 ranking',
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text) as Array<{
      snippet: string;
      title: string;
      score: number;
    }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(typeof parsed[0].snippet).toBe('string');
    expect(typeof parsed[0].title).toBe('string');
    expect(typeof parsed[0].score).toBe('number');
  });

  it('search without query returns isError: true', async () => {
    const result = await callTool(mcpServer, 'satori_kb', {
      sub_command: 'search',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('query is required for search');
  });

  it('contentType filter passes to KnowledgeDB correctly', async () => {
    // Index prose and code content
    db.index({ content: 'Prose content about functions.', title: 'Prose', type: 'prose' });
    db.index({ content: 'function hello() { return 42; }', title: 'Code', type: 'code' });

    const result = await callTool(mcpServer, 'satori_kb', {
      sub_command: 'search',
      query: 'functions',
      contentType: 'code',
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text) as Array<{ type: string }>;
    // All returned results should be 'code' type when filter is applied
    for (const item of parsed) {
      expect(item.type).toBe('code');
    }
  });

  // -------------------------------------------------------------------------
  // fetch_and_index sub-command
  // -------------------------------------------------------------------------

  it('fetch_and_index with url — mock fetch returns HTML, verifies chunks indexed', async () => {
    const mockHtml = `
      <html>
        <body>
          <h1>Test Page</h1>
          <p>This is a test page with some content about indexing and search.</p>
          <p>More content here for better chunking behaviour.</p>
        </body>
      </html>
    `;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      text: async () => mockHtml,
    });
    vi.stubGlobal('fetch', mockFetch);

    try {
      const result = await callTool(mcpServer, 'satori_kb', {
        sub_command: 'fetch_and_index',
        url: 'https://example.com/test',
        title: 'Example Page',
      });
      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(result.content[0].text) as { indexed: number };
      expect(parsed.indexed).toBeGreaterThan(0);
      expect(mockFetch).toHaveBeenCalledWith('https://example.com/test', { redirect: 'manual' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fetch_and_index without url returns isError: true', async () => {
    const result = await callTool(mcpServer, 'satori_kb', {
      sub_command: 'fetch_and_index',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('url is required for fetch_and_index');
  });

  it('fetch_and_index with failed fetch returns isError: true', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', mockFetch);

    try {
      const result = await callTool(mcpServer, 'satori_kb', {
        sub_command: 'fetch_and_index',
        url: 'https://example.com/missing',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('404');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // -------------------------------------------------------------------------
  // Throttle block
  // -------------------------------------------------------------------------

  it('search called 9 times returns blocked: true and redirect: satori_exec (not isError)', async () => {
    db.index({ content: 'Throttle test content with searchable terms.', title: 'Throttle Doc' });

    const sessionId = 'throttle-test-session';
    let lastResult: { content: Array<{ type: string; text: string }>; isError?: boolean } | null =
      null;

    for (let i = 0; i < 9; i++) {
      lastResult = await callTool(mcpServer, 'satori_kb', {
        sub_command: 'search',
        query: 'throttle test',
        session_id: sessionId,
      });
    }

    expect(lastResult).not.toBeNull();
    // Throttle block is a valid response — not an error
    expect(lastResult!.isError).toBeFalsy();
    const parsed = JSON.parse(lastResult!.content[0].text) as {
      blocked: boolean;
      redirect: string;
    };
    expect(parsed.blocked).toBe(true);
    expect(parsed.redirect).toBe('satori_exec');
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it('thrown error returns isError: true in the MCP response', async () => {
    // Replace search with a throwing mock
    const throwingDb = {
      index: () => { throw new Error('unexpected db failure'); },
    } as unknown as KnowledgeDB;

    const throwServer = new McpServer({ name: 'throw-test', version: '0.1.0' });
    registerSatoriKb(throwServer, throwingDb);

    const result = await callTool(throwServer, 'satori_kb', {
      sub_command: 'index',
      content: 'some content',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error:');
    expect(result.content[0].text).toContain('unexpected db failure');
  });

  // -------------------------------------------------------------------------
  // Module export
  // -------------------------------------------------------------------------

  it('registerSatoriKb is exported from the tool module', async () => {
    const mod = await import('../tools/satori-kb.js');
    expect(typeof mod.registerSatoriKb).toBe('function');
  });
});
