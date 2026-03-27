import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export interface AuditEntry {
  event: 'STARTUP' | 'BLOCKED' | 'OUT_SCAN' | 'WARN';
  server?: string;
  tool?: string;
  status?: string;
  reason?: string;
  via?: string;
}

function formatEntry(entry: AuditEntry): string {
  const ts = new Date().toISOString();
  const parts: string[] = [ts, entry.event.padEnd(8)];

  if (entry.server) parts.push(`server=${entry.server}`);
  if (entry.tool) parts.push(`tool=${entry.tool}`);
  if (entry.status) parts.push(`status=${entry.status}`);
  if (entry.reason) parts.push(`reason="${entry.reason}"`);
  if (entry.via) parts.push(`via=${entry.via}`);

  return parts.join(' ');
}

export class AuditLog {
  constructor(private logPath: string) {
    mkdirSync(dirname(logPath), { recursive: true });
  }

  append(entry: AuditEntry): void {
    const line = formatEntry(entry) + '\n';
    appendFileSync(this.logPath, line, 'utf-8');
  }
}
