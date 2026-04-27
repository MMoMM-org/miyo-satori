import { basename } from 'path';
import type { SatoriConfig } from './schema.js';

export interface ClientOverrides {
  /** From CLI flag --client. */
  client?: string;
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
 * Throws if no value can be resolved (only happens when repoRoot is "/").
 */
export function resolveClient(
  overrides: ClientOverrides,
  config: SatoriConfig,
  repoRoot: string,
): string {
  if (overrides.client) return overrides.client;
  if (config.context?.client) return config.context.client;

  const auto = basename(repoRoot);
  if (!auto) {
    throw new Error(
      'Cannot auto-derive client from repoRoot — set --client or [context] client explicitly',
    );
  }
  return auto;
}
