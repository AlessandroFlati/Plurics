/**
 * AgentRegistry — factory for new conversation-oriented agent backends.
 */

import type { AgentBackend as NewAgentBackend } from './agent-backend.js';
import { ClaudeBackend } from './claude-backend.js';
import { OpenAICompatBackend } from './openai-compat-backend.js';
import { OllamaBackend } from './ollama-backend.js';
import type { ClaudeBackendConfig } from './claude-backend.js';
import type { OpenAICompatBackendConfig } from './openai-compat-backend.js';
import type { OllamaBackendConfig } from './ollama-backend.js';

export type NewBackendConfig =
  | { type: 'claude'; config: ClaudeBackendConfig }
  | { type: 'openai-compat'; config: OpenAICompatBackendConfig }
  | { type: 'ollama'; config: OllamaBackendConfig };

export class AgentRegistry {
  /**
   * Returns an empty list — legacy PTY/process sessions have been removed.
   * Retained for call-site compatibility until bootstrap usage is cleaned up.
   */
  listWithPurpose(): Array<{ name: string; purpose: string }> {
    return [];
  }

  /**
   * Factory for conversation-oriented backends.
   * Backends are short-lived per-conversation objects managed by the DAG executor.
   */
  createNewBackend(spec: NewBackendConfig): NewAgentBackend {
    switch (spec.type) {
      case 'claude':
        return new ClaudeBackend(spec.config);
      case 'openai-compat':
        return new OpenAICompatBackend(spec.config);
      case 'ollama':
        return new OllamaBackend(spec.config);
      default: {
        const _exhaustive: never = spec;
        throw new Error(`Unknown new backend type: ${(_exhaustive as NewBackendConfig).type}`);
      }
    }
  }
}
