export function summarize(server: string, tool: string, output: string): string {
  if (output.length <= 300) return output;

  // Try JSON
  try {
    const parsed = JSON.parse(output);
    if (typeof parsed === 'object' && parsed !== null) {
      const keys = Object.keys(parsed).slice(0, 10);
      const pairs = keys.map(k => {
        const v = String((parsed as Record<string, unknown>)[k]).slice(0, 50);
        return `${k}: ${v}`;
      });
      const summary = pairs.join(', ');
      return summary.length > 500 ? summary.slice(0, 497) + '...' : summary;
    }
  } catch {
    // not JSON
  }

  // Multi-line text
  const lines = output.split('\n');
  if (lines.length > 15) {
    const preview = lines.slice(0, 15).join('\n');
    const result = `${preview}\n[... ${lines.length - 15} more lines]`;
    return result.length > 500 ? result.slice(0, 497) + '...' : result;
  }

  // Long single-line
  return output.slice(0, 497) + '...';
}
