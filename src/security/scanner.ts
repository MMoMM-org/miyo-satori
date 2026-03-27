import type { ServerConfig } from '../config/schema.js';
import type { AuditLog } from './audit-log.js';
import {
  SECRET_PATTERNS,
  SECRET_ENV_KEYS,
  RISKY_DESCRIPTION_PATTERNS,
  SHELL_INJECTION_PATTERNS,
} from './patterns.js';

export interface BlockedResult {
  blocked: true;
  reason: string;
}

export interface ScanResult {
  status: 'passed' | 'blocked' | 'skipped' | 'pending';
  reason?: string;
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function matchesSecretPattern(str: string): string | null {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(str)) return str;
  }
  return null;
}

function isSecretKey(key: string): boolean {
  const upper = key.toUpperCase();
  return SECRET_ENV_KEYS.some(k => upper === k || upper.includes(k));
}

function scanValue(key: string, value: unknown): BlockedResult | null {
  const str = stringifyValue(value);
  if (str.length === 0) return null;

  if (isSecretKey(key)) {
    return { blocked: true, reason: `secret env key matched: ${key}` };
  }

  if (matchesSecretPattern(str)) {
    return { blocked: true, reason: `secret pattern matched in value for key: ${key}` };
  }

  return null;
}

function scanObject(obj: Record<string, unknown>): BlockedResult | null {
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const nested = scanObject(value as Record<string, unknown>);
      if (nested) return nested;
      continue;
    }
    const result = scanValue(key, value);
    if (result) return result;
  }
  return null;
}

function checkShellInjection(str: string): string | null {
  for (const pattern of SHELL_INJECTION_PATTERNS) {
    if (pattern.test(str)) return pattern.toString();
  }
  return null;
}

export class SecurityScanner {
  constructor(private auditLog: AuditLog) {}

  scanOut(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): BlockedResult | null {
    const result = scanObject(args);
    if (result) {
      this.auditLog.append({
        event: 'OUT_SCAN',
        server: serverName,
        tool: toolName,
        status: 'blocked',
        reason: result.reason,
        via: 'satori_exec',
      });
    }
    return result;
  }

  scanConfig(server: ServerConfig): ScanResult {
    const candidates: string[] = [];
    if (server.command) candidates.push(server.command);
    if (server.image) candidates.push(server.image);
    if (server.args) candidates.push(...server.args);

    for (const candidate of candidates) {
      const match = checkShellInjection(candidate);
      if (match) {
        const reason = `shell injection pattern matched in config: ${match}`;
        this.auditLog.append({
          event: 'BLOCKED',
          server: server.name,
          status: 'blocked',
          reason,
        });
        return { status: 'blocked', reason };
      }
    }

    return { status: 'passed' };
  }

  scanDescription(
    serverName: string,
    toolName: string,
    description: string,
  ): ScanResult {
    for (const pattern of RISKY_DESCRIPTION_PATTERNS) {
      if (pattern.test(description)) {
        const reason = `risky description pattern matched: ${pattern.toString()}`;
        this.auditLog.append({
          event: 'BLOCKED',
          server: serverName,
          tool: toolName,
          status: 'blocked',
          reason,
        });
        return { status: 'blocked', reason };
      }
    }
    return { status: 'passed' };
  }
}
