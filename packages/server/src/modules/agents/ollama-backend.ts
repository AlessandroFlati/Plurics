import { randomUUID } from 'node:crypto';
import type { AgentBackend, NewBackendType } from './agent-backend.js';
import type {
  ConversationHandle,
  ToolDefinition,
  UserMessage,
  AssistantMessage,
  ToolCall,
  ToolResult,
} from './new-types.js';
import { BackendError } from './new-types.js';

export interface OllamaBackendConfig {
  baseUrl: string;             // default 'http://localhost:11434'
  model: string;               // e.g. 'qwen3.5:35b'
  disableThinking?: boolean;   // sets think: false in request (default false)
  maxTokens?: number;          // maps to options.num_predict; default 4096
}

interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
}

interface ConversationState {
  systemPrompt: string;
  model: string;
  maxTokens: number;
  tools: OllamaTool[];
  messages: OllamaMessage[];
}

/** Strip <think>...</think> blocks (including multi-line) from content. */
function stripThinkBlocks(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export class OllamaBackend implements AgentBackend {
  readonly backendType: NewBackendType = 'ollama';
  readonly id: string;

  private readonly config: OllamaBackendConfig;
  private readonly conversations = new Map<string, ConversationState>();

  constructor(config: OllamaBackendConfig) {
    this.config = config;
    this.id = `ollama-backend-${randomUUID()}`;
  }

  async startConversation(params: {
    systemPrompt: string;
    toolDefinitions: ToolDefinition[];
    model: string;
    maxTokens?: number;
  }): Promise<ConversationHandle> {
    const conversationId = randomUUID();
    this.conversations.set(conversationId, {
      systemPrompt: params.systemPrompt,
      model: params.model,
      maxTokens: params.maxTokens ?? this.config.maxTokens ?? 4096,
      tools: params.toolDefinitions.map(def => ({
        type: 'function' as const,
        function: {
          name: def.name,
          description: def.description,
          parameters: def.inputSchema,
        },
      })),
      messages: [],
    });
    return { conversationId };
  }

  async sendMessage(
    conversation: ConversationHandle,
    userMessage: UserMessage,
  ): Promise<AssistantMessage> {
    const state = this.getConversationState(conversation);

    state.messages.push({ role: 'user', content: userMessage.content });

    const messages: OllamaMessage[] = [
      { role: 'system', content: state.systemPrompt },
      ...state.messages,
    ];

    const body: Record<string, unknown> = {
      model: state.model,
      messages,
      stream: false,
      options: {
        num_predict: state.maxTokens,
      },
      ...(state.tools.length > 0 && { tools: state.tools }),
    };

    if (this.config.disableThinking) {
      body['think'] = false;
    }

    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      state.messages.pop();
      throw new BackendError(
        `Ollama unreachable at ${this.config.baseUrl}: ${(err as Error).message}`,
        'backend_unavailable',
        undefined,
        { cause: err },
      );
    }

    if (!response.ok) {
      state.messages.pop();
      await this.throwApiError(response);
    }

    const data = await response.json() as {
      message: { content: string; tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }> };
      done_reason: string;
    };

    const rawContent = data.message.content;
    const cleanContent = stripThinkBlocks(rawContent);

    const toolCalls: ToolCall[] = (data.message.tool_calls ?? []).map((tc, idx) => ({
      toolCallId: `ollama-tc-${idx}`,
      toolName: tc.function.name,
      inputs: tc.function.arguments,
    }));

    const assistantMsg: OllamaMessage = { role: 'assistant', content: cleanContent };
    if (data.message.tool_calls && data.message.tool_calls.length > 0) {
      assistantMsg.tool_calls = data.message.tool_calls;
    }
    state.messages.push(assistantMsg);

    return {
      content: cleanContent,
      text: cleanContent,
      toolCalls,
      stopReason: data.done_reason,
    };
  }

  async sendToolResults(
    conversation: ConversationHandle,
    toolResults: ToolResult[],
  ): Promise<AssistantMessage> {
    const state = this.getConversationState(conversation);

    // Ollama 0.4.x: tool result messages use { role: 'tool', content } — no tool_call_id field.
    for (const r of toolResults) {
      state.messages.push({ role: 'tool', content: r.content });
    }

    const messages: OllamaMessage[] = [
      { role: 'system', content: state.systemPrompt },
      ...state.messages,
    ];

    const body: Record<string, unknown> = {
      model: state.model,
      messages,
      stream: false,
      options: {
        num_predict: state.maxTokens,
      },
      ...(state.tools.length > 0 && { tools: state.tools }),
    };

    if (this.config.disableThinking) {
      body['think'] = false;
    }

    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      state.messages.splice(state.messages.length - toolResults.length, toolResults.length);
      throw new BackendError(
        `Ollama unreachable at ${this.config.baseUrl}: ${(err as Error).message}`,
        'backend_unavailable',
        undefined,
        { cause: err },
      );
    }

    if (!response.ok) {
      state.messages.splice(state.messages.length - toolResults.length, toolResults.length);
      await this.throwApiError(response);
    }

    const data = await response.json() as {
      message: { content: string; tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }> };
      done_reason: string;
    };

    const rawContent = data.message.content;
    const cleanContent = stripThinkBlocks(rawContent);

    const toolCalls: ToolCall[] = (data.message.tool_calls ?? []).map((tc, idx) => ({
      toolCallId: `ollama-tc-${idx}`,
      toolName: tc.function.name,
      inputs: tc.function.arguments,
    }));

    const assistantMsg: OllamaMessage = { role: 'assistant', content: cleanContent };
    if (data.message.tool_calls && data.message.tool_calls.length > 0) {
      assistantMsg.tool_calls = data.message.tool_calls;
    }
    state.messages.push(assistantMsg);

    return {
      content: cleanContent,
      text: cleanContent,
      toolCalls,
      stopReason: data.done_reason,
    };
  }

  async closeConversation(conversation: ConversationHandle): Promise<void> {
    this.conversations.delete(conversation.conversationId);
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
    let errorMessage = `HTTP ${response.status}`;
    try {
      const data = await response.json() as { error?: string };
      if (data.error) errorMessage = data.error;
    } catch {
      // Ignore JSON parse failures
    }
    throw new BackendError(errorMessage, 'backend_error', response.status);
  }
}
