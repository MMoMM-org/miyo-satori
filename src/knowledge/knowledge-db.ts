import { join } from 'path';
import type Database from 'better-sqlite3';
import { SQLiteBase } from '../db-base.js';

export interface KbChunk {
  id: number;
  title: string;
  heading: string;
  content: string;
  type: 'prose' | 'code';
  source_url: string | null;
  indexed_at: number;
}

export interface KbSearchResult {
  chunk_id: number;
  title: string;
  heading: string;
  snippet: string;
  type: 'prose' | 'code';
  score: number;
}

export interface ThrottleBlock {
  blocked: true;
  message: string;
  redirect: 'satori_exec';
}

/** Per-session call counter entry */
interface ThrottleEntry {
  count: number;
}

/**
 * KnowledgeDB — FTS5-backed knowledge base with RRF search, progressive
 * throttling, and URL indexing.
 */
export class KnowledgeDB extends SQLiteBase {
  // IMPORTANT: Use `declare` (not `!`) for all fields that are initialised
  // inside initSchema() / prepareStatements().  With `target: ES2022` and
  // useDefineForClassFields=true, a plain `field!: T` declaration compiles to
  // an Object.defineProperty call that runs AFTER super() returns — silently
  // overwriting values set by the parent constructor's initSchema() calls.
  // `declare field: T` is a type-only annotation; it emits no JS at all.
  declare private throttleMap: Map<string, ThrottleEntry>;
  declare private trigramAvailable: boolean;

  // Prepared statement references (set in prepareStatements)
  // Use Database.Statement<unknown[]> — the explicit variadic form — so that
  // run(...args) accepts any number of bind parameters without TS errors.
  declare private stmtInsertChunk: Database.Statement<unknown[]>;
  declare private stmtGetChunkById: Database.Statement<unknown[]>;

  protected initSchema(): void {
    // Initialize instance state here because class-field initializers haven't
    // run yet when the parent constructor calls this method (ES2022 semantics).
    this.throttleMap = new Map();
    this.trigramAvailable = true;
    // Core table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        title       TEXT    NOT NULL DEFAULT '',
        heading     TEXT    NOT NULL DEFAULT '',
        content     TEXT    NOT NULL,
        type        TEXT    NOT NULL DEFAULT 'prose',
        source_url  TEXT,
        indexed_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
    `);

    // Porter FTS5 virtual table
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        title, heading, content,
        content='chunks', content_rowid='id',
        tokenize='porter unicode61'
      );
    `);

    // Trigram FTS5 — requires SQLite 3.38+. Wrap in try/catch for older builds.
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_trigram USING fts5(
          title, heading, content,
          content='chunks', content_rowid='id',
          tokenize='trigram'
        );
      `);
    } catch {
      console.warn('[satori:kb] SQLite trigram not available, falling back to Porter-only search');
      this.trigramAvailable = false;
    }

    // Insert trigger — keep both FTS indexes in sync
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, title, heading, content) VALUES (new.id, new.title, new.heading, new.content);
        ${this.trigramAvailable ? "INSERT INTO chunks_trigram(rowid, title, heading, content) VALUES (new.id, new.title, new.heading, new.content);" : ''}
      END;
    `);

    // Delete trigger
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, title, heading, content) VALUES ('delete', old.id, old.title, old.heading, old.content);
        ${this.trigramAvailable ? "INSERT INTO chunks_trigram(chunks_trigram, rowid, title, heading, content) VALUES ('delete', old.id, old.title, old.heading, old.content);" : ''}
      END;
    `);
  }

  protected prepareStatements(): void {
    this.stmtInsertChunk = this.db.prepare(
      `INSERT INTO chunks (title, heading, content, type, source_url)
       VALUES (?, ?, ?, ?, ?)`,
    );
    this.stmtGetChunkById = this.db.prepare(
      `SELECT * FROM chunks WHERE id = ?`,
    );
  }

  // ---------------------------------------------------------------------------
  // index()
  // ---------------------------------------------------------------------------

  /**
   * Chunk markdown by headings and store each chunk. Code blocks (```) are
   * never split across chunk boundaries. Returns the number of chunks stored.
   */
  index(opts: {
    content: string;
    title?: string;
    type?: 'prose' | 'code';
    sourceUrl?: string;
  }): number {
    const { content, title = '', type = 'prose', sourceUrl = null } = opts;
    const chunks = splitIntoChunks(content);

    const insertMany = this.db.transaction((items: ChunkDraft[]) => {
      for (const item of items) {
        this.stmtInsertChunk.run(title, item.heading, item.content, type, sourceUrl);
      }
    });

    insertMany(chunks);
    return chunks.length;
  }

  // ---------------------------------------------------------------------------
  // search()
  // ---------------------------------------------------------------------------

  search(opts: {
    query: string;
    contentType?: 'prose' | 'code';
    limit?: number;
    sessionId?: string;
  }): KbSearchResult[] | ThrottleBlock {
    const { query, contentType, limit = 5, sessionId = 'default' } = opts;

    // --- Throttle ---
    const entry = this.throttleMap.get(sessionId) ?? { count: 0 };
    entry.count += 1;
    this.throttleMap.set(sessionId, entry);

    const callNum = entry.count;

    if (callNum >= 9) {
      return {
        blocked: true,
        message: `Knowledge search throttled after ${callNum - 1} calls for session "${sessionId}". Use satori_exec to continue your work.`,
        redirect: 'satori_exec',
      };
    }

    let effectiveLimit: number;
    if (callNum <= 3) {
      effectiveLimit = Math.min(limit, 2);
    } else {
      // calls 4-8
      effectiveLimit = 1;
      console.warn(
        `[satori:kb] throttle warning: session "${sessionId}" call ${callNum}/8 — returning 1 result`,
      );
    }

    // --- Build query ---
    const safeQuery = sanitizeFtsQuery(query);
    if (!safeQuery) return [];

    const typeFilter = contentType ? `AND c.type = '${contentType.replace(/'/g, "''")}'` : '';

    // Porter FTS search
    const porterResults = this.runFtsSearch(
      'chunks_fts',
      safeQuery,
      typeFilter,
      effectiveLimit * 3, // over-fetch for RRF
    );

    // Trigram search (if available)
    let trigramResults: RawFtsRow[] = [];
    if (this.trigramAvailable) {
      try {
        trigramResults = this.runFtsSearch(
          'chunks_trigram',
          safeQuery,
          typeFilter,
          effectiveLimit * 3,
        );
      } catch {
        // Trigram query failed at runtime — degrade gracefully
      }
    }

    // If no results and query has words, try simple fuzzy correction
    let combinedResults: RawFtsRow[];
    if (porterResults.length === 0 && trigramResults.length === 0) {
      const corrected = this.tryFuzzyCorrect(query);
      if (corrected && corrected !== safeQuery) {
        const safeCorrection = sanitizeFtsQuery(corrected);
        if (safeCorrection) {
          const fuzzyResults = this.runFtsSearch(
            'chunks_fts',
            safeCorrection,
            typeFilter,
            effectiveLimit * 3,
          );
          combinedResults = fuzzyResults;
        } else {
          combinedResults = [];
        }
      } else {
        combinedResults = [];
      }
    } else {
      // Merge with RRF
      combinedResults = rrfMerge(porterResults, trigramResults, effectiveLimit);
    }

    // Build search results with snippets
    const seen = new Set<number>();
    const rawOutput: KbSearchResult[] = [];

    for (const row of combinedResults) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rawOutput.push({
        chunk_id: row.id,
        title: row.title,
        heading: row.heading,
        snippet: buildSnippet(row.content, query),
        type: row.type as 'prose' | 'code',
        score: row.score,
      });
    }

    // Apply proximity reranking then slice to limit
    const queryWords = query.trim().split(/\s+/).filter((w) => w.length > 1);
    const reranked = this.applyProximityReranking(rawOutput, queryWords);

    return reranked.slice(0, effectiveLimit);
  }

  // ---------------------------------------------------------------------------
  // fetchAndIndex()
  // ---------------------------------------------------------------------------

  async fetchAndIndex(opts: {
    url: string;
    title?: string;
  }): Promise<{ indexed: number } | { error: string }> {
    const { url, title } = opts;

    // Follow redirects manually, capped at 5 (spec: max 5 redirects)
    const MAX_REDIRECTS = 5;
    let response: Response;
    let currentUrl = url;
    let redirectCount = 0;
    try {
      while (true) {
        response = await globalThis.fetch(currentUrl, { redirect: 'manual' });
        if (
          (response.status === 301 || response.status === 302 ||
           response.status === 303 || response.status === 307 ||
           response.status === 308) &&
          response.headers.get('location')
        ) {
          if (redirectCount >= MAX_REDIRECTS) {
            return { error: `Too many redirects (max ${MAX_REDIRECTS})` };
          }
          currentUrl = new URL(response.headers.get('location')!, currentUrl).href;
          redirectCount++;
          continue;
        }
        break;
      }
    } catch (err) {
      return { error: `Fetch failed: ${String(err)}` };
    }

    if (!response.ok) {
      return { error: `HTTP ${response.status}: ${response.statusText}` };
    }

    let text: string;
    try {
      text = await response.text();
    } catch (err) {
      return { error: `Failed to read response body: ${String(err)}` };
    }

    // Strip HTML tags
    const cleaned = stripHtml(text);

    const indexed = this.index({
      content: cleaned,
      title: title ?? url,
      sourceUrl: url,
    });

    return { indexed };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private runFtsSearch(
    table: string,
    ftsQuery: string,
    typeFilter: string,
    limit: number,
  ): RawFtsRow[] {
    // Use bm25 heading weights: title=5.0, heading=3.0, content=1.0
    const sql = `
      SELECT c.id, c.title, c.heading, c.content, c.type,
             bm25(${table}, 5.0, 3.0, 1.0) AS bm25_score
      FROM ${table}
      JOIN chunks c ON ${table}.rowid = c.id
      WHERE ${table} MATCH ?
      ${typeFilter}
      ORDER BY bm25_score
      LIMIT ?
    `;
    return this.db.prepare(sql).all(ftsQuery, limit) as RawFtsRow[];
  }

  /** Tries 1-char deletion candidates against the FTS5 index; returns corrected query or original */
  private tryFuzzyCorrect(query: string): string {
    const words = query.trim().split(/\s+/);
    const corrected = words.map((word) => this.fuzzyWord(word));
    return corrected.join(' ');
  }

  private fuzzyWord(word: string): string {
    // Only attempt correction for words 4+ chars that look like real words
    if (word.length < 4 || !/^[a-zA-Z]+$/.test(word)) return word;

    // Try 1-char deletions (most common typo: extra or wrong char)
    for (let i = 0; i < word.length; i++) {
      const candidate = word.slice(0, i) + word.slice(i + 1);
      if (this.termExistsInIndex(candidate)) return candidate;
    }
    // Try adjacent transpositions (swapped chars)
    for (let i = 0; i < word.length - 1; i++) {
      const candidate = word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2);
      if (this.termExistsInIndex(candidate)) return candidate;
    }
    return word;
  }

  private termExistsInIndex(term: string): boolean {
    try {
      const row = this.db.prepare(
        `SELECT COUNT(*) as cnt FROM chunks_fts WHERE chunks_fts MATCH ?`
      ).get(`${term}*`) as { cnt: number } | undefined;
      return (row?.cnt ?? 0) > 0;
    } catch {
      return false;
    }
  }

  private applyProximityReranking(
    results: KbSearchResult[],
    queryWords: string[],
  ): KbSearchResult[] {
    if (queryWords.length < 2) return results; // single-word: no proximity to measure

    return results
      .map((r) => {
        const text = (r.heading + ' ' + r.snippet).toLowerCase();
        const words = text.split(/\s+/);
        const positions = new Map<string, number[]>();

        queryWords.forEach((qw) => {
          const qwLower = qw.toLowerCase();
          words.forEach((w, i) => {
            if (w.startsWith(qwLower)) {
              const arr = positions.get(qw) ?? [];
              arr.push(i);
              positions.set(qw, arr);
            }
          });
        });

        // Minimum span covering all query terms (sweep-line)
        const allTermsCovered = queryWords.every((qw) => (positions.get(qw)?.length ?? 0) > 0);
        if (!allTermsCovered) return { ...r }; // no boost if not all terms present

        // Find minimum window
        const pointers = queryWords.map(() => 0);
        let minSpan = Infinity;
        let done = false;

        while (!done) {
          const currentPositions = queryWords.map((qw, i) => positions.get(qw)![pointers[i]]);
          const windowMin = Math.min(...currentPositions);
          const windowMax = Math.max(...currentPositions);
          minSpan = Math.min(minSpan, windowMax - windowMin);

          // Advance the pointer for the term with the smallest position
          const minIdx = currentPositions.indexOf(windowMin);
          pointers[minIdx]++;
          if (pointers[minIdx] >= (positions.get(queryWords[minIdx])?.length ?? 0)) {
            done = true;
          }
        }

        const boost = 1 / (1 + minSpan / Math.max(words.length, 1));
        return { ...r, score: r.score * (1 + boost) };
      })
      .sort((a, b) => b.score - a.score);
  }

  // ---------------------------------------------------------------------------
  // Static helpers
  // ---------------------------------------------------------------------------

  static kbPath(repoRoot: string): string {
    return join(repoRoot, 'satori', 'kb.sqlite');
  }

  /** Expose trigramAvailable for tests / diagnostics */
  get isTrigramAvailable(): boolean {
    return this.trigramAvailable;
  }
}

// =============================================================================
// Internal types
// =============================================================================

interface ChunkDraft {
  heading: string;
  content: string;
}

interface RawFtsRow {
  id: number;
  title: string;
  heading: string;
  content: string;
  type: string;
  bm25_score: number;
  score: number; // populated after RRF merge
}

// =============================================================================
// Markdown chunking
// =============================================================================

/**
 * Split markdown content into chunks at heading boundaries.
 * Code blocks (triple-backtick fences) are never split.
 */
function splitIntoChunks(content: string): ChunkDraft[] {
  const lines = content.split('\n');
  const chunks: ChunkDraft[] = [];

  let currentHeading = '';
  let currentLines: string[] = [];
  let inCodeBlock = false;

  const flushChunk = () => {
    const text = currentLines.join('\n').trim();
    if (text) {
      chunks.push({ heading: currentHeading, content: text });
    }
  };

  for (const line of lines) {
    // Toggle code block state
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
    }

    // Heading detection — only when not inside a code block
    if (!inCodeBlock && /^#{1,6}\s/.test(line)) {
      flushChunk();
      currentHeading = line.replace(/^#{1,6}\s+/, '').trim();
      currentLines = [];
      continue;
    }

    currentLines.push(line);
  }

  // Flush final chunk
  flushChunk();

  // If nothing was produced (empty input), return empty
  return chunks;
}

// =============================================================================
// RRF (Reciprocal Rank Fusion)
// =============================================================================

const RRF_K = 60;

function rrfMerge(
  listA: RawFtsRow[],
  listB: RawFtsRow[],
  limit: number,
): RawFtsRow[] {
  const scores = new Map<number, number>();
  const rowMap = new Map<number, RawFtsRow>();

  const addList = (list: RawFtsRow[]) => {
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      const prev = scores.get(row.id) ?? 0;
      scores.set(row.id, prev + 1 / (RRF_K + i + 1));
      if (!rowMap.has(row.id)) rowMap.set(row.id, row);
    }
  };

  addList(listA);
  addList(listB);

  const sorted = Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit * 2); // over-fetch, caller trims

  return sorted.map(([id, score]) => {
    const row = rowMap.get(id)!;
    return { ...row, score };
  });
}


// =============================================================================
// Snippet extraction
// =============================================================================

const SNIPPET_WINDOW = 200;

/**
 * Return a ~200-char snippet centred on the first matched query term.
 * Matched terms are wrapped in **bold**.
 */
function buildSnippet(content: string, query: string): string {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 1);

  let matchIndex = -1;
  for (const term of terms) {
    const idx = content.toLowerCase().indexOf(term);
    if (idx !== -1) {
      matchIndex = idx;
      break;
    }
  }

  let start: number;
  let end: number;

  if (matchIndex === -1) {
    start = 0;
    end = Math.min(SNIPPET_WINDOW, content.length);
  } else {
    start = Math.max(0, matchIndex - Math.floor(SNIPPET_WINDOW / 2));
    end = Math.min(content.length, start + SNIPPET_WINDOW);
    // Adjust start if end was clamped
    if (end - start < SNIPPET_WINDOW) {
      start = Math.max(0, end - SNIPPET_WINDOW);
    }
  }

  let snippet = content.slice(start, end);

  // Highlight matched terms
  for (const term of terms) {
    // Simple case-insensitive replace
    snippet = snippet.replace(
      new RegExp(`(${escapeRegex(term)})`, 'gi'),
      '**$1**',
    );
  }

  return snippet.trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// =============================================================================
// HTML stripping
// =============================================================================

function stripHtml(html: string): string {
  // Remove script and style blocks entirely
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');

  // Replace block-level tags with newlines
  text = text.replace(/<\/?(p|div|br|h[1-6]|li|tr|td|th|blockquote|pre|section|article|header|footer|nav|main|aside)[^>]*>/gi, '\n');

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // Collapse whitespace
  text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

// =============================================================================
// FTS query sanitisation
// =============================================================================

/**
 * Escape the query for FTS5 MATCH. Wraps in double quotes per term so
 * special characters are treated as literals.
 */
function sanitizeFtsQuery(query: string): string {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return '';
  return terms.map(t => `"${t.replace(/"/g, '""')}"`).join(' ');
}
