/**
 * BuiltinServer — dispatches run/run_file/batch to PolyglotExecutor.
 *
 * Not a RuntimeInterface — bypasses LifecycleManager entirely.
 * Intent-driven mode: when `intent` is set and stdout exceeds 5_000 bytes,
 * the output is indexed to KnowledgeDB and a semantic search is returned
 * instead of the raw stdout.
 */

import { PolyglotExecutor } from './executor.js';
import type { Language } from './runtime.js';
import { KnowledgeDB } from '../knowledge/knowledge-db.js';
import type { KbSearchResult, ThrottleBlock } from '../knowledge/knowledge-db.js';

// ---------------------------------------------------------------------------
// Arg types
// ---------------------------------------------------------------------------

interface RunArgs {
  language: Language;
  code: string;
  timeout?: number;
  background?: boolean;
  intent?: string;
  env?: Record<string, string>;
}

interface RunFileArgs {
  path: string;
  language: Language;
  code?: string;
  timeout?: number;
}

interface BatchArgs {
  commands: { label: string; command: string }[];
  queries: string[];
  timeout?: number;
}

// ---------------------------------------------------------------------------
// Valid language values (mirrors Language union from runtime.ts)
// ---------------------------------------------------------------------------

const VALID_LANGUAGES = new Set<string>([
  'javascript',
  'typescript',
  'python',
  'shell',
  'ruby',
  'go',
  'rust',
  'php',
  'perl',
  'r',
  'elixir',
]);

const INTENT_THRESHOLD = 5_000; // bytes — exact per spec ADR

// ---------------------------------------------------------------------------
// BuiltinServer
// ---------------------------------------------------------------------------

export class BuiltinServer {
  constructor(
    private executor: PolyglotExecutor,
    private knowledgeDb: KnowledgeDB,
  ) {}

  async exec(
    serverName: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<{ content: string; isError?: boolean }> {
    // Unknown server name
    if (serverName !== 'bash') {
      return { content: `Unknown builtin server: ${serverName}`, isError: true };
    }

    switch (tool) {
      case 'run':
        return this.#handleRun(args as unknown as RunArgs);
      case 'run_file':
        return this.#handleRunFile(args as unknown as RunFileArgs);
      case 'batch':
        return this.#handleBatch(args as unknown as BatchArgs);
      default:
        return {
          content: `Unknown tool: ${tool}. Valid tools: run, run_file, batch`,
          isError: true,
        };
    }
  }

  // -------------------------------------------------------------------------
  // run
  // -------------------------------------------------------------------------

  async #handleRun(args: RunArgs): Promise<{ content: string; isError?: boolean }> {
    const { language, code, timeout, background, intent, env } = args;

    // Validate language
    if (!language || !VALID_LANGUAGES.has(language)) {
      return {
        content: `Invalid or missing language: "${language}". Valid values: ${[...VALID_LANGUAGES].join(', ')}`,
        isError: true,
      };
    }

    let result;
    try {
      result = await this.executor.execute({ language, code, timeout, background, env });
    } catch (err) {
      return {
        content: `Execution error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }

    const parts: string[] = [];

    // Build up response
    const stdout = result.stdout;

    // Intent-driven mode: output > threshold → index + search
    if (intent && stdout.length > INTENT_THRESHOLD) {
      this.knowledgeDb.index({ content: stdout, title: 'exec-output', type: 'prose' });
      const searchResult = this.knowledgeDb.search({ query: intent, sessionId: 'builtin-exec' });

      const response: {
        truncated: boolean;
        intent: string;
        results: KbSearchResult[] | ThrottleBlock;
      } = {
        truncated: true,
        intent,
        results: searchResult,
      };

      return { content: JSON.stringify(response) };
    }

    // Normal mode
    if (result.backgrounded) {
      parts.push('[Process started in background]');
    } else {
      if (stdout) parts.push(stdout);
      if (result.timedOut) {
        parts.push(`[Process timed out after ${timeout ?? 30_000}ms]`);
      }
      if (result.capExceeded) {
        parts.push('[Output cap exceeded — process was killed]');
      }
      if (result.stderr) {
        parts.push(`[stderr]\n${result.stderr}`);
      }
    }

    return { content: parts.join('\n') };
  }

  // -------------------------------------------------------------------------
  // run_file
  // -------------------------------------------------------------------------

  async #handleRunFile(args: RunFileArgs): Promise<{ content: string; isError?: boolean }> {
    const { path, language, code, timeout } = args;

    // Validate language
    if (!language || !VALID_LANGUAGES.has(language)) {
      return {
        content: `Invalid or missing language: "${language}". Valid values: ${[...VALID_LANGUAGES].join(', ')}`,
        isError: true,
      };
    }

    if (!path) {
      return { content: 'Missing required argument: path', isError: true };
    }

    let result;
    try {
      result = await this.executor.executeFile({ path, language, code, timeout });
    } catch (err) {
      return {
        content: `Execution error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }

    const parts: string[] = [];

    if (result.stdout) parts.push(result.stdout);
    if (result.timedOut) {
      parts.push(`[Process timed out after ${timeout ?? 30_000}ms]`);
    }
    if (result.capExceeded) {
      parts.push('[Output cap exceeded — process was killed]');
    }
    if (result.stderr) {
      parts.push(`[stderr]\n${result.stderr}`);
    }

    return { content: parts.join('\n') };
  }

  // -------------------------------------------------------------------------
  // batch
  // -------------------------------------------------------------------------

  async #handleBatch(args: BatchArgs): Promise<{ content: string; isError?: boolean }> {
    const { commands = [], queries = [], timeout } = args;

    // Run each command and index its output
    for (const { label, command } of commands) {
      let result;
      try {
        result = await this.executor.execute({
          language: 'shell',
          code: command,
          timeout,
        });
      } catch (err) {
        // Index the error message so queries can still surface something
        this.knowledgeDb.index({
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          title: label,
          type: 'prose',
        });
        continue;
      }

      this.knowledgeDb.index({ content: result.stdout, title: label, type: 'prose' });
    }

    // Run each query against the indexed content
    const batchResults: Record<string, KbSearchResult[] | ThrottleBlock> = {};
    for (const query of queries) {
      batchResults[query] = this.knowledgeDb.search({ query, sessionId: 'builtin-batch' });
    }

    return { content: JSON.stringify({ results: batchResults }) };
  }
}
