import { parse } from 'smol-toml';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import type { SatoriConfig, ServerConfig } from './schema.js';

function expandPath(p: string): string {
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return resolve(p);
}

function parseTomlFile(filePath: string): SatoriConfig {
  if (!existsSync(filePath)) {
    return {};
  }
  const raw = readFileSync(filePath, 'utf-8');
  return parse(raw) as unknown as SatoriConfig;
}

function mergeServers(
  base: ServerConfig[],
  override: ServerConfig[],
): ServerConfig[] {
  const map = new Map<string, ServerConfig>();
  for (const s of base) {
    map.set(s.name, s);
  }
  for (const s of override) {
    map.set(s.name, s);
  }
  return Array.from(map.values());
}

function mergeConfigs(base: SatoriConfig, override: SatoriConfig): SatoriConfig {
  const merged: SatoriConfig = {
    ...base,
    ...override,
  };

  if (base.gateway || override.gateway) {
    merged.gateway = { ...base.gateway, ...override.gateway };
  }
  if (base.context || override.context) {
    merged.context = { ...base.context, ...override.context };
  }
  if (base.lifecycle || override.lifecycle) {
    merged.lifecycle = { ...base.lifecycle, ...override.lifecycle };
  }
  if (base.security || override.security) {
    merged.security = { ...base.security, ...override.security };
  }

  const baseServers = base.servers ?? [];
  const overrideServers = override.servers ?? [];
  if (baseServers.length > 0 || overrideServers.length > 0) {
    merged.servers = mergeServers(baseServers, overrideServers);
  }

  const baseHandlers = base.handlers ?? [];
  const overrideHandlers = override.handlers ?? [];
  if (baseHandlers.length > 0 || overrideHandlers.length > 0) {
    merged.handlers = [...baseHandlers, ...overrideHandlers];
  }

  return merged;
}

export function loadConfig(repoRoot: string): SatoriConfig {
  const globalPath = resolve(homedir(), '.satori', 'config.toml');
  const repoPath = join(repoRoot, 'satori.toml');

  const globalConfig = parseTomlFile(globalPath);
  const repoConfig = parseTomlFile(repoPath);

  const projectDir = repoConfig.project_dir;
  if (projectDir) {
    const projectPath = join(expandPath(projectDir), 'satori.toml');
    const projectConfig = parseTomlFile(projectPath);
    // global → project → repo (repo wins by name for servers)
    return mergeConfigs(mergeConfigs(globalConfig, projectConfig), repoConfig);
  }

  return mergeConfigs(globalConfig, repoConfig);
}

export function expandEnv(
  value: string,
  env: Record<string, string>,
): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
    if (!(key in env)) {
      throw new Error(`Unexpanded variable: \${${key}}`);
    }
    return env[key];
  });
}
