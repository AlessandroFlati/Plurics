import { randomUUID } from 'node:crypto';
import type {
  AgentBackend,
  NewBackendType,
} from './agent-backend.js';
import type {
  ConversationHandle,
  ToolDefinition,
  UserMessage,
  AssistantMessage,
  ToolResult,
  ToolCall,
} from './new-types.js';
import { BackendError } from './new-types.js';

export interface ClaudeBackendConfig {
  baseUrl?: string;       // default 'https://api.anthropic.com'
  apiKey: string;         // Bearer token / x-api-key
  model?: string;         // default model for conversations that don't specify one
  maxTokens?: number;     // default 4096
}

// Anthropic wire-format message (content can be string or array of blocks)
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | unknown[];
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: unknown;
}

interface ConversationState {
  systemPrompt: string;
  model: string;
  maxTokens: number;
  messages: AnthropicMessage[];
  tools: AnthropicTool[];
}

export class ClaudeBackend implements AgentBackend {
  readonly backendType: NewBackendType = 'claude';
  readonly id: string;

  private readonly config: Required<Pick<ClaudeBackendConfig, 'baseUrl' | 'apiKey'>> & ClaudeBackendConfig;
  private readonly conversations = new Map<string, ConversationState>();

  constructor(config: ClaudeBackendConfig) {
    this.config = {
      baseUrl: config.baseUrl ?? 'https://api.anthropic.com',
      apiKey: config.apiKey,
      model: config.model,
      maxTokens: config.maxTokens,
    };
    this.id = `claude-backend-${randomUUID()}`;
  }

  // Overload 1: object-params form (AgentBackend interface)
  async startConversation(params: {
    systemPrompt: string;
    toolDefinitions: ToolDefinition[];
    model: string;
    maxTokens?: number;
  }): Promise<ConversationHandle>;
  // Overload 2: positional form used in Phase 3 tests
  async startConversation(
    systemPrompt: string,
    toolDefinitions: ToolDefinition[],
    model: string,
    maxTokens?: number,
  ): Promise<ConversationHandle>;
  async startConversation(
    paramsOrSystemPrompt:
      | { systemPrompt: string; toolDefinitions: ToolDefinition[]; model: string; maxTokens?: number }
      | string,
    toolDefinitions?: ToolDefinition[],
    model?: string,
    maxTokens?: number,
  ): Promise<ConversationHandle> {
    let systemPrompt: string;
    let tools: ToolDefinition[];
    let resolvedModel: string;
    let resolvedMaxTokens: number | undefined;

    if (typeof paramsOrSystemPrompt === 'string') {
      systemPrompt = paramsOrSystemPrompt;
      tools = toolDefinitions ?? [];
      resolvedModel = model ?? this.config.model ?? 'claude-3-5-haiku-20241022';
      resolvedMaxTokens = maxTokens;
    } else {
      systemPrompt = paramsOrSystemPrompt.systemPrompt;
      tools = paramsOrSystemPrompt.toolDefinitions;
      resolvedModel = paramsOrSystemPrompt.model;
      resolvedMaxTokens = paramsOrSystemPrompt.maxTokens;
    }

    const conversationId = randomUUID();
    const state: ConversationState = {
      systemPrompt,
      model: resolvedModel,
      maxTokens: resolvedMaxTokens ?? this.config.maxTokens ?? 4096,
      messages: [],
      tools: tools.map(def => ({
        name: def.name,
        description: def.description,
        input_schema: def.inputSchema,
      })),
    };
    this.conversations.set(conversationId, state);
    return { conversationId };
  }

  async sendMessage(
    conversation: ConversationHandle,
    userMessage: UserMessage | string,
  ): Promise<AssistantMessage> {
    const state = this.getConversationState(conversation);

    const content = typeof userMessage === 'string' ? userMessage : userMessage.content;
    state.messages.push({ role: 'user', content });

    const body: Record<string, unknown> = {
      model: state.model,
      max_tokens: state.maxTokens,
      system: state.systemPrompt,
      ...(state.tools.length > 0 && { tools: state.tools }),
      messages: state.messages,
    };

    const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${this.config.apiKey}`,
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // Remove the user message we just appended (undo optimistic append)
      state.messages.pop();
      await this.throwApiError(response);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
      stop_reason: string;
    };

    return this.parseAnthropicResponse(state, data);
  }

  async sendToolResults(
    conversation: ConversationHandle,
    toolResults: ToolResult[],
  ): Promise<AssistantMessage> {
    const state = this.getConversationState(conversation);

    const toolResultBlocks = toolResults.map(r => ({
      type: 'tool_result' as const,
      tool_use_id: r.toolCallId,
      content: r.content,
      ...(r.isError && { is_error: true }),
    }));

    state.messages.push({ role: 'user', content: toolResultBlocks });

    const body: Record<string, unknown> = {
      model: state.model,
      max_tokens: state.maxTokens,
      system: state.systemPrompt,
      ...(state.tools.length > 0 && { tools: state.tools }),
      messages: state.messages,
    };

    const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${this.config.apiKey}`,
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      state.messages.pop();
      await this.throwApiError(response);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
      stop_reason: string;
    };

    return this.parseAnthropicResponse(state, data);
  }

  async closeConversation(conversation: ConversationHandle): Promise<void> {
    this.conversations.delete(conversation.conversationId);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private parseAnthropicResponse(
    state: ConversationState,
    data: {
      content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
      stop_reason: string;
    },
  ): AssistantMessage {
    const textBlocks = data.content.filter(c => c.type === 'text');
    const toolUseBlocks = data.content.filter(c => c.type === 'tool_use');

    const assistantText = textBlocks.map(b => b.text ?? '').join('');
    const toolCalls: ToolCall[] = toolUseBlocks.map(b => ({
      toolCallId: b.id as string,
      toolName: b.name as string,
      inputs: b.input as Record<string, unknown>,
    }));

    // Store full content array (preserves tool_use blocks for sendToolResults)
    state.messages.push({ role: 'assistant', content: data.content });

    return {
      content: assistantText,
      text: assistantText,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason: data.stop_reason,
    };
  }

  private getConversationState(conversation: ConversationHandle): ConversationState {
    const state = this.conversations.get(conversation.conversationId);
    if (!state) {
      throw new BackendError(
        `Conversation not found: ${conversation.conversationId}`,
        'conversation_not_found',
      );
    }
    return state;
  }

  private async throwApiError(response: Response): Promise<never> {
    let errorData: { error?: { type?: string; message?: string } } = {};
    try {
      errorData = await response.json() as typeof errorData;
    } catch {
      // Ignore JSON parse failures — use status code alone
    }

    const message = errorData.error?.message ?? `HTTP ${response.status}`;

    if (response.status === 401) {
      throw new BackendError(message, 'auth_error', response.status);
    }
    if (response.status === 429 || response.status === 529) {
      throw new BackendError(message, 'rate_limit', response.status);
    }
    throw new BackendError(message, 'backend_error', response.status);
  }
}
