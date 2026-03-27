import { readFileSync } from 'fs';

export interface HookPayload {
  transcript_path?: string;
  session_id?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: { content?: unknown; is_error?: boolean };
}

export function extractSessionId(payload: HookPayload): string {
  if (payload.transcript_path) {
    const match = payload.transcript_path.match(/([a-f0-9-]{36})\.jsonl$/);
    if (match) return match[1];
  }
  if (payload.session_id) return payload.session_id;
  if (process.env.CLAUDE_SESSION_ID) return process.env.CLAUDE_SESSION_ID;
  return `pid-${process.ppid}`;
}

export function getRepoRoot(): string {
  return process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
}

export function readStdinPayload(): HookPayload {
  try {
    const raw = readFileSync('/dev/stdin', 'utf-8');
    return JSON.parse(raw) as HookPayload;
  } catch {
    return {};
  }
}
