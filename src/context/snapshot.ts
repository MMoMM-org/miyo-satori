// Snapshot accepts any object with the fields it needs —
// both extract.ts SessionEvent and session-db.ts row shapes satisfy this interface.
export interface EventLike {
  type: string;
  category: string;
  data: string;
}

interface SnapshotOpts {
  maxBytes?: number;
  compactCount?: number;
  generatedAt?: string;
}

function xmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

interface FileActivity {
  path: string;
  readCount: number;
  writeCount: number;
  editCount: number;
  lastOp: string;
  lastId: number;
}

function buildActiveFiles(events: EventLike[]): string {
  const fileMap = new Map<string, FileActivity>();
  let idx = 0;
  for (const ev of events) {
    if (ev.category !== 'file') { idx++; continue; }
    const path = ev.data;
    let entry = fileMap.get(path);
    if (!entry) {
      entry = { path, readCount: 0, writeCount: 0, editCount: 0, lastOp: '', lastId: idx };
      fileMap.set(path, entry);
    }
    if (ev.type === 'file_read') { entry.readCount++; entry.lastOp = 'read'; }
    else if (ev.type === 'file_write') { entry.writeCount++; entry.lastOp = 'write'; }
    else if (ev.type === 'file_edit') { entry.editCount++; entry.lastOp = 'edit'; }
    entry.lastId = idx;
    idx++;
  }

  if (fileMap.size === 0) return '';

  // Keep last 10 by lastId
  const sorted = Array.from(fileMap.values())
    .sort((a, b) => a.lastId - b.lastId)
    .slice(-10);

  const lines = sorted.map((f) => {
    const ops: string[] = [];
    if (f.readCount > 0) ops.push(`read:${f.readCount}`);
    if (f.writeCount > 0) ops.push(`write:${f.writeCount}`);
    if (f.editCount > 0) ops.push(`edit:${f.editCount}`);
    return `    <file path="${xmlEscape(f.path)}" ops="${ops.join(',')}" last="${f.lastOp}" />`;
  });

  return `  <active_files>\n${lines.join('\n')}\n  </active_files>`;
}

function buildTaskState(events: EventLike[]): string {
  const tasks = new Map<string, string>();
  for (const ev of events) {
    if (ev.category !== 'task') continue;
    if (ev.type === 'task_create') {
      try {
        const parsed = JSON.parse(ev.data) as { subject?: string };
        const subject = parsed.subject ?? ev.data;
        tasks.set(subject, 'pending');
      } catch {
        tasks.set(ev.data, 'pending');
      }
    } else if (ev.type === 'task_update') {
      try {
        const parsed = JSON.parse(ev.data) as { taskId?: string; status?: string };
        const status = parsed.status ?? '';
        if (status === 'completed' || status === 'done') {
          const taskId = parsed.taskId ?? '';
          // Mark completed by taskId — also try to find matching subject
          for (const [subject] of tasks) {
            if (subject === taskId || subject.includes(taskId)) {
              tasks.set(subject, 'completed');
            }
          }
        }
      } catch {
        // ignore malformed
      }
    }
  }

  const active = Array.from(tasks.entries()).filter(([, status]) => status !== 'completed');
  if (active.length === 0) return '';

  const lines = active.map(([subject]) => `    - ${xmlEscape(subject)}`);
  return `  <task_state>\n${lines.join('\n')}\n  </task_state>`;
}

function buildRules(events: EventLike[]): string {
  const paths = new Set<string>();
  const contents: string[] = [];
  for (const ev of events) {
    if (ev.category !== 'rule') continue;
    if (ev.type === 'rule_path') paths.add(ev.data);
    else if (ev.type === 'rule_content') contents.push(ev.data);
  }
  if (paths.size === 0 && contents.length === 0) return '';

  const lines: string[] = [];
  for (const content of contents) {
    lines.push(`    <rule_content>${xmlEscape(content)}</rule_content>`);
  }
  for (const path of paths) {
    lines.push(`    - ${xmlEscape(path)}`);
  }
  return `  <rules>\n${lines.join('\n')}\n  </rules>`;
}

function buildDecisions(events: EventLike[]): string {
  const seen = new Set<string>();
  const decisions: string[] = [];
  for (const ev of events) {
    if (ev.category !== 'decision') continue;
    if (!seen.has(ev.data)) {
      seen.add(ev.data);
      decisions.push(ev.data);
    }
  }
  if (decisions.length === 0) return '';

  const lines = decisions.map((d) => `    - ${xmlEscape(d)}`);
  return `  <decisions>\n${lines.join('\n')}\n  </decisions>`;
}

function buildEnvironment(events: EventLike[]): string {
  let lastCwd: string | null = null;
  let lastGitOp: string | null = null;
  const envEntries: string[] = [];

  for (const ev of events) {
    if (ev.category === 'cwd') lastCwd = ev.data;
    else if (ev.category === 'git') lastGitOp = ev.data;
    else if (ev.category === 'env') envEntries.push(ev.data);
  }

  if (!lastCwd && !lastGitOp && envEntries.length === 0) return '';

  const lines: string[] = [];
  if (lastCwd) lines.push(`    <cwd>${xmlEscape(lastCwd)}</cwd>`);
  if (lastGitOp) lines.push(`    <git op="${xmlEscape(lastGitOp)}" />`);
  for (const entry of envEntries) lines.push(`    <env>${xmlEscape(entry)}</env>`);

  return `  <environment>\n${lines.join('\n')}\n  </environment>`;
}

function buildErrors(events: EventLike[]): string {
  const errors = events.filter((ev) => ev.category === 'error');
  if (errors.length === 0) return '';

  const lines = errors.map((ev) => `    - ${xmlEscape(ev.data)}`);
  return `  <errors_encountered>\n${lines.join('\n')}\n  </errors_encountered>`;
}

function buildSubagents(events: EventLike[]): string {
  const subagents = events.filter((ev) => ev.category === 'subagent');
  if (subagents.length === 0) return '';

  const lines = subagents.map((ev) => `    - ${xmlEscape(ev.data)}`);
  return `  <subagents>\n${lines.join('\n')}\n  </subagents>`;
}

function buildMcpTools(events: EventLike[]): string {
  const toolCounts = new Map<string, number>();
  for (const ev of events) {
    if (ev.category !== 'mcp') continue;
    toolCounts.set(ev.data, (toolCounts.get(ev.data) ?? 0) + 1);
  }
  if (toolCounts.size === 0) return '';

  const lines = Array.from(toolCounts.entries()).map(
    ([tool, count]) => `    <tool name="${xmlEscape(tool)}" calls="${count}" />`,
  );
  return `  <mcp_tools>\n${lines.join('\n')}\n  </mcp_tools>`;
}

function buildIntent(events: EventLike[]): string {
  const intentEvents = events.filter((ev) => ev.category === 'intent');
  if (intentEvents.length === 0) return '';
  const last = intentEvents[intentEvents.length - 1];
  return `  <intent>${xmlEscape(last.data)}</intent>`;
}

function buildPlanMode(events: EventLike[]): string {
  const planEvents = events.filter((ev) => ev.category === 'plan');
  if (planEvents.length === 0) return '';
  const last = planEvents[planEvents.length - 1];
  if (last.type !== 'plan_enter') return '';
  return `  <plan_mode>${xmlEscape(last.data)}</plan_mode>`;
}

function assembleXml(
  sections: string[],
  compactCount: number,
  eventCount: number,
  generatedAt: string,
): string {
  const body = sections.filter((s) => s.length > 0).join('\n');
  const header = `<session_resume compact_count="${compactCount}" events_captured="${eventCount}" generated_at="${generatedAt}">`;
  if (!body) return `${header}</session_resume>`;
  return `${header}\n${body}\n</session_resume>`;
}

export function buildResumeSnapshot(
  events: EventLike[],
  opts?: SnapshotOpts,
): string {
  const maxBytes = opts?.maxBytes ?? 2048;
  const compactCount = opts?.compactCount ?? 0;
  const generatedAt = opts?.generatedAt ?? new Date().toISOString();
  const eventCount = events.length;

  // P1 sections
  const activeFiles = buildActiveFiles(events);
  const taskState = buildTaskState(events);
  const rules = buildRules(events);

  // P2 sections
  const decisions = buildDecisions(events);
  const environment = buildEnvironment(events);
  const errors = buildErrors(events);

  // P3-P4 sections
  const subagents = buildSubagents(events);
  const mcpTools = buildMcpTools(events);
  const intent = buildIntent(events);
  const planMode = buildPlanMode(events);

  // Try full output
  let sections = [activeFiles, taskState, rules, decisions, environment, errors, subagents, mcpTools, intent, planMode];
  let xml = assembleXml(sections, compactCount, eventCount, generatedAt);

  if (byteLength(xml) <= maxBytes) return xml;

  // Drop P3-P4
  sections = [activeFiles, taskState, rules, decisions, environment, errors];
  xml = assembleXml(sections, compactCount, eventCount, generatedAt);
  if (byteLength(xml) <= maxBytes) return xml;

  // Drop P2 sections
  sections = [activeFiles, taskState, rules];
  xml = assembleXml(sections, compactCount, eventCount, generatedAt);
  if (byteLength(xml) <= maxBytes) return xml;

  // Truncate P1: reduce active_files to last 5, trim tasks
  const trimmedActiveFiles = buildTrimmedActiveFiles(events, 5);
  const trimmedTaskState = buildTrimmedTaskState(events, 3);
  sections = [trimmedActiveFiles, trimmedTaskState, rules];
  xml = assembleXml(sections, compactCount, eventCount, generatedAt);
  if (byteLength(xml) <= maxBytes) return xml;

  // Further trim: only active files
  sections = [trimmedActiveFiles];
  xml = assembleXml(sections, compactCount, eventCount, generatedAt);
  if (byteLength(xml) <= maxBytes) return xml;

  // Absolute minimum: empty body
  return assembleXml([], compactCount, eventCount, generatedAt);
}

function byteLength(str: string): number {
  return Buffer.byteLength(str, 'utf8');
}

function buildTrimmedActiveFiles(events: EventLike[], maxFiles: number): string {
  const fileMap = new Map<string, FileActivity>();
  let idx = 0;
  for (const ev of events) {
    if (ev.category !== 'file') { idx++; continue; }
    const path = ev.data;
    let entry = fileMap.get(path);
    if (!entry) {
      entry = { path, readCount: 0, writeCount: 0, editCount: 0, lastOp: '', lastId: idx };
      fileMap.set(path, entry);
    }
    if (ev.type === 'file_read') { entry.readCount++; entry.lastOp = 'read'; }
    else if (ev.type === 'file_write') { entry.writeCount++; entry.lastOp = 'write'; }
    else if (ev.type === 'file_edit') { entry.editCount++; entry.lastOp = 'edit'; }
    entry.lastId = idx;
    idx++;
  }

  if (fileMap.size === 0) return '';

  const sorted = Array.from(fileMap.values())
    .sort((a, b) => a.lastId - b.lastId)
    .slice(-maxFiles);

  const lines = sorted.map((f) => {
    const ops: string[] = [];
    if (f.readCount > 0) ops.push(`read:${f.readCount}`);
    if (f.writeCount > 0) ops.push(`write:${f.writeCount}`);
    if (f.editCount > 0) ops.push(`edit:${f.editCount}`);
    return `    <file path="${xmlEscape(f.path)}" ops="${ops.join(',')}" last="${f.lastOp}" />`;
  });

  return `  <active_files>\n${lines.join('\n')}\n  </active_files>`;
}

function buildTrimmedTaskState(events: EventLike[], maxTasks: number): string {
  const tasks = new Map<string, string>();
  for (const ev of events) {
    if (ev.category !== 'task') continue;
    if (ev.type === 'task_create') {
      try {
        const parsed = JSON.parse(ev.data) as { subject?: string };
        tasks.set(parsed.subject ?? ev.data, 'pending');
      } catch {
        tasks.set(ev.data, 'pending');
      }
    }
  }

  const active = Array.from(tasks.entries())
    .filter(([, status]) => status !== 'completed')
    .slice(0, maxTasks);

  if (active.length === 0) return '';

  const lines = active.map(([subject]) => `    - ${xmlEscape(subject)}`);
  return `  <task_state>\n${lines.join('\n')}\n  </task_state>`;
}
