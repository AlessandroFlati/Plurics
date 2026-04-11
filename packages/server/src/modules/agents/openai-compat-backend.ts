import { randomUUID } from 'node:crypto';
import type { AgentBackend, NewBackendType } from './agent-backend.js';
import type {
  ConversationHandle,
  ToolDefinition,
  UserMessage,
  AssistantMessage,
  ToolResult,
} from './new-types.js';
import { BackendError } from './new-types.js';

export interface OpenAICompatBackendConfig {
  baseUrl: string;        // e.g. 'http://localhost:8000', 'https://api.openai.com'
  apiKey?: string;        // required for OpenAI direct; optional for local servers
  model: string;          // default model
  maxTokens?: number;     // default 4096
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ConversationState {
  systemPrompt: string;
  model: string;
  maxTokens: number;
  // Does not include the system message — it is injected at request time
  turns: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export class OpenAICompatBackend implements AgentBackend {
  readonly backendType: NewBackendType = 'openai-compat';
  readonly id: string;

  private readonly config: OpenAICompatBackendConfig;
  private readonly conversations = new Map<string, ConversationState>();

  constructor(config: OpenAICompatBackendConfig) {
    this.config = config;
    this.id = `openai-compat-backend-${randomUUID()}`;
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
      turns: [],
    });
    return { conversationId };
  }

  async sendMessage(
    conversation: ConversationHandle,
    userMessage: UserMessage,
  ): Promise<AssistantMessage> {
    const state = this.getConversationState(conversation);

    state.turns.push({ role: 'user', content: userMessage.content });

    const messages: OpenAIMessage[] = [
      { role: 'system', content: state.systemPrompt },
      ...state.turns,
    ];

    const body = {
      model: state.model,
      max_tokens: state.maxTokens,
      messages,
    };

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      state.turns.pop();
      await this.throwApiError(response);
    }

    const data = await response.json() as {
      choices: Array<{
        message: { content: string };
        finish_reason: string;
      }>;
    };

    const assistantText = data.choices[0].message.content;
    state.turns.push({ role: 'assistant', content: assistantText });

    return {
      content: assistantText,
      toolCalls: [],
      stopReason: data.choices[0].finish_reason,
    };
  }

  async sendToolResults(
    _conversation: ConversationHandle,
    _toolResults: ToolResult[],
  ): Promise<AssistantMessage> {
    throw new BackendError(
      'sendToolResults: not implemented in Phase 1 — tool-calling loop requires NR Phase 3',
      'not_implemented',
    );
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
    let errorData: { error?: { message?: string; type?: string } } = {};
    try {
      errorData = await response.json() as typeof errorData;
    } catch {
      // Ignore JSON parse failures
    }

    const message = errorData.error?.message ?? `HTTP ${response.status}`;

    if (response.status === 401) {
      throw new BackendError(message, 'auth_error', response.status);
    }
    if (response.status === 429) {
      throw new BackendError(message, 'rate_limit', response.status);
    }
    throw new BackendError(message, 'backend_error', response.status);
  }
}
