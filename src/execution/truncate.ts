// port: context-mode/src/truncate.ts

/**
 * truncate — Pure string and output truncation utilities.
 *
 * These helpers are used for smart output truncation and string capping.
 * Ported from context-mode with capBytes signature adapted to match the
 * spec (no ellipsis appended — hard byte-boundary slice only).
 */

// ─────────────────────────────────────────────────────────
// String truncation
// ─────────────────────────────────────────────────────────

/**
 * Truncate a string to at most `maxChars` characters, appending an ellipsis
 * when truncation occurs.
 *
 * @param str      - Input string.
 * @param maxChars - Maximum character count (inclusive). Must be >= 3.
 * @returns The original string if short enough, otherwise a truncated string
 *          ending with "...".
 */
export function truncateString(str: string, maxChars: number): string {
  if (str.length <= maxChars) return str;
  return str.slice(0, Math.max(0, maxChars - 3)) + '...';
}

// ─────────────────────────────────────────────────────────
// Byte-aware smart truncation (head + tail)
// ─────────────────────────────────────────────────────────

/**
 * Smart truncation that keeps the head (60%) and tail (40%) of output,
 * preserving both initial context and final error messages.
 * Snaps to line boundaries and handles UTF-8 safely via `Buffer.byteLength`.
 *
 * @param raw      - Raw output string.
 * @param maxBytes - Soft cap in bytes. Output below this threshold is returned as-is.
 * @returns The original string if within budget, otherwise head + separator + tail.
 */
export function smartTruncate(raw: string, maxBytes: number): string {
  if (Buffer.byteLength(raw) <= maxBytes) return raw;

  const lines = raw.split('\n');

  // Budget: 60% head, 40% tail (errors/results are usually at the end)
  const headBudget = Math.floor(maxBytes * 0.6);
  const tailBudget = maxBytes - headBudget;

  // Collect head lines
  const headLines: string[] = [];
  let headBytes = 0;
  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line) + 1; // +1 for \n
    if (headBytes + lineBytes > headBudget) break;
    headLines.push(line);
    headBytes += lineBytes;
  }

  // Collect tail lines (from end)
  const tailLines: string[] = [];
  let tailBytes = 0;
  for (let i = lines.length - 1; i >= headLines.length; i--) {
    const lineBytes = Buffer.byteLength(lines[i]) + 1;
    if (tailBytes + lineBytes > tailBudget) break;
    tailLines.unshift(lines[i]);
    tailBytes += lineBytes;
  }

  const skippedLines = lines.length - headLines.length - tailLines.length;
  const skippedBytes = Buffer.byteLength(raw) - headBytes - tailBytes;

  const separator =
    `\n\n... [${skippedLines} lines / ${(skippedBytes / 1024).toFixed(1)}KB truncated` +
    ` — showing first ${headLines.length} + last ${tailLines.length} lines] ...\n\n`;

  return headLines.join('\n') + separator + tailLines.join('\n');
}

// ─────────────────────────────────────────────────────────
// maxBytes guard
// ─────────────────────────────────────────────────────────

/**
 * Return `str` unchanged if it fits within `maxBytes`, otherwise return a
 * byte-safe hard slice. Empty input returns empty string.
 *
 * @param str      - Input string.
 * @param maxBytes - Hard byte cap.
 */
export function capBytes(str: string, maxBytes: number): string {
  if (str.length === 0) return '';
  if (Buffer.byteLength(str) <= maxBytes) return str;

  // Binary-search for the largest character slice within maxBytes.
  let lo = 0;
  let hi = str.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (Buffer.byteLength(str.slice(0, mid)) <= maxBytes) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return str.slice(0, lo);
}
