/**
 * AgentBackend — conversation-oriented interface for LLM reasoning node backends.
 *
 * Three implementations:
 * - ClaudeBackend: Anthropic Messages API (direct + proxy)
 * - OpenAICompatBackend: /v1/chat/completions (vLLM, LM Studio, OpenAI direct)
 * - OllamaBackend: /api/chat with think:false support
 */

import type {
  ConversationHandle,
  ToolDefinition,
  UserMessage,
  AssistantMessage,
  ToolResult,
} from './new-types.js';

export type NewBackendType = 'claude' | 'openai-compat' | 'ollama';

/**
 * Conversation-oriented backend interface for LLM reasoning nodes.
 *
 * Three implementations:
 * - ClaudeBackend: Anthropic Messages API (direct + proxy)
 * - OpenAICompatBackend: /v1/chat/completions (vLLM, LM Studio, OpenAI direct)
 * - OllamaBackend: /api/chat with think:false support
 */
export interface AgentBackend {
  readonly backendType: NewBackendType;
  readonly id: string;

  /**
   * Start a new LLM conversation with the given system prompt and (in Phase 1,
   * empty) tool definitions. Returns a handle that must be passed to all
   * subsequent calls.
   */
  startConversation(params: {
    systemPrompt: string;
    toolDefinitions: ToolDefinition[];
    model: string;
    maxTokens?: number;
  }): Promise<ConversationHandle>;

  /**
   * Send a user message and receive the assistant's response.
   * In Phase 1 this is a single-turn HTTP call; the message history is
   * accumulated inside the ConversationHandle's backing state.
   */
  sendMessage(
    conversation: ConversationHandle,
    userMessage: UserMessage,
  ): Promise<AssistantMessage>;

  /**
   * Send tool results back and receive the next assistant response.
   * Phase 1: throws BackendError with category 'not_implemented'.
   * Phase 3: submits tool results and continues the tool-calling loop.
   */
  sendToolResults(
    conversation: ConversationHandle,
    toolResults: ToolResult[],
  ): Promise<AssistantMessage>;

  /** Release any resources held by the conversation (clears message history). */
  closeConversation(conversation: ConversationHandle): Promise<void>;
}
