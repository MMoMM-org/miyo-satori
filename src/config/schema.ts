export interface GatewayConfig {
  auto_register_mcp_json?: boolean;
}

export interface ContextConfig {
  db_path?: string;
  kb_path?: string;
  storage_dir?: string;
  session_guide_max_bytes?: number;
  retain_days?: number;
  backend?: 'satori' | 'kairn';
}

export interface LifecycleConfig {
  npx_startup_timeout_ms?: number;
}

export interface SecurityConfig {
  startup_scan?: boolean;
  runtime_scan?: boolean;
  return_scan?: boolean;
  audit_log?: string;
}

export interface ServerConfig {
  name: string;
  runtime: 'npx' | 'docker' | 'external' | 'builtin';
  command?: string;
  image?: string;
  args?: string[];
  env?: Record<string, string>;
  handler?: string;
  enabled?: boolean;
  host?: string;
  port?: number;
  transport?: string;
  url?: string;
  headers?: Record<string, string>;
}

export interface HandlerConfig {
  name: string;
  module: string;
}

export interface SatoriConfig {
  project_dir?: string;
  gateway?: GatewayConfig;
  context?: ContextConfig;
  lifecycle?: LifecycleConfig;
  security?: SecurityConfig;
  handlers?: HandlerConfig[];
  servers?: ServerConfig[];
}
