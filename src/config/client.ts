import { basename } from 'path';
import type { SatoriConfig } from './schema.js';

export interface ClientOverrides {
  /** From CLI flag --client. */
  client?: string;
}

const CLIENT_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function validate(value: string, source: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(
      `Client identifier from ${source} is blank — set --client or [context] client to a non-empty value`,
    );
  }
  if (!CLIENT_PATTERN.test(trimmed)) {
    throw new Error(
      `Client identifier from ${source} is invalid: ${JSON.stringify(value)} — must match ${CLIENT_PATTERN.source}`,
    );
  }
  return trimmed;
}

/**
 * Resolve the client identifier for this Satori process.
 *
 * Precedence (highest first):
 *   1. CLI override (overrides.client)
 *   2. [context] client from merged config
 *   3. basename(repoRoot) — auto-derived from the repo's directory name
 *
 * The client tags every capture, event, resume, and KB chunk so that
 * cross-session lookups within the same working scope return the
 * right rows even when storage is shared across repos.
 *
 * Throws if the resolved value is blank or contains characters outside
 * [A-Za-z0-9_-]. Forces explicit override when basename(repoRoot) is
 * non-ASCII or otherwise unsuitable as an identifier.
 */
export function resolveClient(
  overrides: ClientOverrides,
  config: SatoriConfig,
  repoRoot: string,
): string {
  if (overrides.client !== undefined) {
    return validate(overrides.client, 'CLI flag --client');
  }
  if (config.context?.client !== undefined) {
    return validate(config.context.client, '[context] client in satori.toml');
  }
  return validate(basename(repoRoot), 'basename(repoRoot) — set --client or [context] client to override');
}
