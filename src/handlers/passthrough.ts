import type { ServerConfig } from '../config/schema.js';
import type { SatoriHandler, ToolCallRequest, ToolCallResponse } from './interface.js';

export class PassthroughHandler implements SatoriHandler {
  readonly name = 'passthrough';

  async onRegister(_config: ServerConfig): Promise<void> {}

  async beforeCall(request: ToolCallRequest): Promise<ToolCallRequest> {
    return request;
  }

  async afterCall(
    _request: ToolCallRequest,
    response: ToolCallResponse,
  ): Promise<ToolCallResponse> {
    return response;
  }
}
