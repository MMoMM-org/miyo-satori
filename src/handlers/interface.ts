import type { ServerConfig } from '../config/schema.js';

export interface ToolCallRequest {
  serverName: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResponse {
  content: unknown;
  isError?: boolean;
}

export interface BlockedResult {
  blocked: true;
  reason: string;
}

export interface SatoriHandler {
  readonly name: string;
  onRegister(config: ServerConfig): Promise<void>;
  beforeCall(request: ToolCallRequest): Promise<ToolCallRequest | BlockedResult>;
  afterCall(request: ToolCallRequest, response: ToolCallResponse): Promise<ToolCallResponse>;
}
