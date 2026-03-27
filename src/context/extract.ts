export interface SessionEvent {
  type: string;
  category: string;
  priority: number;
  data: string;
  sourceHook: string;
}

function extractPath(toolInput: unknown): string {
  try {
    const input = toolInput as Record<string, unknown>;
    const path = typeof input?.path === 'string' ? input.path : 'unknown';
    return path.slice(0, 200);
  } catch {
    return 'unknown';
  }
}

function extractPaths(toolInput: unknown): string {
  try {
    const input = toolInput as Record<string, unknown>;
    if (Array.isArray(input?.paths)) {
      return (input.paths as string[])
        .filter((p) => typeof p === 'string')
        .join(', ')
        .slice(0, 200);
    }
    // MultiEdit may also have a single path
    if (typeof input?.path === 'string') {
      return input.path.slice(0, 200);
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function extractStderr(toolOutput: unknown): string | null {
  try {
    const output = toolOutput as Record<string, unknown>;
    const stderr = output?.stderr;
    if (typeof stderr === 'string' && stderr.trim().length > 0) {
      return stderr.trim().slice(0, 150);
    }
    return null;
  } catch {
    return null;
  }
}

function extractDescription(toolInput: unknown): string {
  try {
    const input = toolInput as Record<string, unknown>;
    const desc =
      typeof input?.description === 'string'
        ? input.description
        : typeof input?.prompt === 'string'
          ? input.prompt
          : 'subagent';
    return desc.slice(0, 100);
  } catch {
    return 'subagent';
  }
}

export function extractEvent(
  toolName: string,
  toolInput: unknown,
  toolOutput?: unknown,
): SessionEvent | null {
  try {
    switch (toolName) {
      case 'Read':
        return {
          type: 'file_read',
          category: 'file',
          priority: 1,
          data: extractPath(toolInput),
          sourceHook: 'PostToolUse',
        };

      case 'Write':
        return {
          type: 'file_write',
          category: 'file',
          priority: 1,
          data: extractPath(toolInput),
          sourceHook: 'PostToolUse',
        };

      case 'Edit':
        return {
          type: 'file_edit',
          category: 'file',
          priority: 1,
          data: extractPath(toolInput),
          sourceHook: 'PostToolUse',
        };

      case 'MultiEdit':
        return {
          type: 'file_edit',
          category: 'file',
          priority: 1,
          data: extractPaths(toolInput),
          sourceHook: 'PostToolUse',
        };

      case 'TaskCreate': {
        const input = toolInput as Record<string, unknown>;
        const subject = typeof input?.subject === 'string' ? input.subject : '';
        return {
          type: 'task_create',
          category: 'task',
          priority: 1,
          data: JSON.stringify({ subject }),
          sourceHook: 'PostToolUse',
        };
      }

      case 'TaskUpdate': {
        const input = toolInput as Record<string, unknown>;
        const taskId = input?.taskId ?? input?.id ?? '';
        const status = input?.status ?? '';
        return {
          type: 'task_update',
          category: 'task',
          priority: 1,
          data: JSON.stringify({ taskId, status }),
          sourceHook: 'PostToolUse',
        };
      }

      case 'Bash': {
        const stderr = extractStderr(toolOutput);
        if (stderr === null) return null;
        return {
          type: 'error_caught',
          category: 'error',
          priority: 2,
          data: stderr,
          sourceHook: 'PostToolUse',
        };
      }

      case 'Agent': {
        return {
          type: 'subagent_launched',
          category: 'subagent',
          priority: 3,
          data: extractDescription(toolInput),
          sourceHook: 'PostToolUse',
        };
      }

      case 'WebFetch': {
        try {
          const input = toolInput as Record<string, unknown>;
          const url = typeof input?.url === 'string' ? input.url : 'unknown';
          return {
            type: 'mcp_call',
            category: 'mcp',
            priority: 4,
            data: `WebFetch:${url}`,
            sourceHook: 'PostToolUse',
          };
        } catch {
          return null;
        }
      }

      case 'WebSearch': {
        try {
          const input = toolInput as Record<string, unknown>;
          const query = typeof input?.query === 'string' ? input.query : 'unknown';
          return {
            type: 'mcp_call',
            category: 'mcp',
            priority: 4,
            data: `WebSearch:${query}`,
            sourceHook: 'PostToolUse',
          };
        } catch {
          return null;
        }
      }

      case 'Glob':
      case 'Grep':
        return null;

      default:
        return null;
    }
  } catch {
    return null;
  }
}
