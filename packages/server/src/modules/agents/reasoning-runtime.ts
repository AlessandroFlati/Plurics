/**
 * Reasoning Runtime — Node Runtimes Phase 3
 *
 * Orchestrates the multi-turn tool-calling loop for `kind: reasoning` nodes.
 *
 * Public API:
 *   runReasoningNode(params: ReasoningNodeParams): Promise<ReasoningNodeResult>
 *
 * State machine:
 *   startConversation → sendMessage(purpose)
 *     → [no tool calls] → parseSignal → done
 *     → [tool calls]    → dispatchTools → sendToolResults → loop
 *
 * Safety mechanisms:
 *   - Per-tool consecutive failure budget (default 3)
 *   - Max turns before forced termination message (default 20)
 *   - Wall clock timeout via Promise.race (default 900s)
 *
 * Scope-local ValueStore:
 *   Created fresh per invocation. Upstream input handles pre-loaded.
 *   Declared signal outputs promoted to run-level store on completion.
 */

import type { AgentBackend } from './agent-backend.js';
import type { ToolCall, ToolResult } from './new-types.js';
import type { ToolDefinition } from './toolset-resolver.js';
import { extractAndParseSignal, SignalParseError } from './signal-parser.js';
import type { SignalFile } from './signal-parser.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ReasoningErrorCategory =
  | 'tool_not_allowed'
  | 'tool_budget_exhausted'
  | 'max_turns_exceeded'
  | 'signal_parse_error'
  | 'wall_clock_timeout'
  | 'context_exceeded'
  | 'handle_not_found';

export class ReasoningError extends Error {
  readonly category: ReasoningErrorCategory;
  constructor(category: ReasoningErrorCategory, message: string) {
    super(message);
    this.name = 'ReasoningError';
    this.category = category;
  }
}

// ---------------------------------------------------------------------------
// Minimal value store interface
// ---------------------------------------------------------------------------

export interface ScopeValueStore {
  put(handle: string, value: unknown): void;
  get(handle: string): unknown;
  has(handle: string): boolean;
  adopt(handle: string, value: unknown): void;
  generateHandle(nodeName: string, portName: string): string;
}

// ---------------------------------------------------------------------------
// Minimal registry interface
// ---------------------------------------------------------------------------

export interface RuntimeRegistryClient {
  invoke(toolName: string, inputs: Record<string, unknown>, opts: {
    valueStore: ScopeValueStore;
  }): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ReasoningNodeParams {
  backend: AgentBackend;
  toolDefinitions: ToolDefinition[];
  toolNameMap: Map<string, string>;    // underscore_name → dotted.name
  registryClient: RuntimeRegistryClient;
  valueStore: ScopeValueStore;         // scope-local store for this node
  runId: string;
  nodeName: string;
  purpose: string;                     // resolved purpose markdown
  systemPrompt: string;
  model: string;
  maxTokens?: number;
  maxTurns?: number;                   // default 20
  perToolRetryBudget?: number;         // default 3
  wallClockTimeoutMs?: number;         // default 900_000
  upstreamHandles?: Array<[string, unknown]>;  // [handle, envelope] pairs to pre-load
  runLevelStore?: ScopeValueStore;             // run-level store for output promotion
}

export interface ReasoningNodeResult {
  signal: SignalFile;
  reasoningTrace: string;
  turnsUsed: number;
  toolCallsTotal: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TURNS = 20;
const DEFAULT_PER_TOOL_RETRY_BUDGET = 3;
const DEFAULT_WALL_CLOCK_TIMEOUT_MS = 900_000;

const MAX_TURNS_MESSAGE =
  'You have reached your turn budget. Please produce your final answer now, ' +
  'with a properly formatted signal block at the end. Do not make any more tool calls.';

const CORRECTIVE_REPROMPT_MESSAGE =
  'Your last response did not contain a valid signal block. Please produce your ' +
  'final answer again. Your response MUST end with a properly formatted signal ' +
  'block in a fenced code block tagged `signal`, containing valid JSON with ' +
  '`status`, `agent`, and `outputs` fields.';

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function _runLoop(params: ReasoningNodeParams): Promise<ReasoningNodeResult> {
  const {
    backend,
    toolDefinitions,
    toolNameMap,
    registryClient,
    valueStore,
    nodeName,
    purpose,
    systemPrompt,
    model,
    maxTokens = 4096,
    maxTurns = DEFAULT_MAX_TURNS,
    perToolRetryBudget = DEFAULT_PER_TOOL_RETRY_BUDGET,
  } = params;

  // Pre-load upstream handles into scope-local store
  if (params.upstreamHandles) {
    for (const [handle, envelope] of params.upstreamHandles) {
      valueStore.put(handle, envelope);
    }
  }

  const traceLines: string[] = [];
  let turnsUsed = 0;
  let toolCallsTotal = 0;
  let correctiveRepromptIssued = false;

  // Per-tool consecutive failure counter
  const consecutiveFailures = new Map<string, number>();

  const conversationHandle = await backend.startConversation({
    systemPrompt,
    toolDefinitions,
    model,
    maxTokens,
  });

  try {
    // --- Turn 1: send purpose ---
    let response = await backend.sendMessage(conversationHandle, { content: purpose });
    turnsUsed++;
    traceLines.push(`[turn ${turnsUsed}] ${response.text}`);

    // --- Loop ---
    while (true) {
      const hasToolCalls = (response.toolCalls ?? []).length > 0;

      if (!hasToolCalls) {
        // Try to parse signal
        const signal = extractAndParseSignal(response.text);

        if (signal !== null) {
          // Promote declared outputs from scope-local store to run-level store
          if (params.runLevelStore && signal.outputs && Array.isArray(signal.outputs)) {
            for (const output of signal.outputs) {
              if (typeof output === 'object' && output !== null) {
                const ref = output as Record<string, unknown>;
                if (typeof ref.value_ref === 'string' && valueStore.has(ref.value_ref as string)) {
                  const envelope = valueStore.get(ref.value_ref as string);
                  params.runLevelStore.adopt(ref.value_ref as string, envelope as any);
                }
              }
            }
          }

          return {
            signal,
            reasoningTrace: traceLines.join('\n\n'),
            turnsUsed,
            toolCallsTotal,
          };
        }

        // No signal block — corrective re-prompt
        if (correctiveRepromptIssued) {
          throw new ReasoningError(
            'signal_parse_error',
            `Node "${nodeName}" failed to produce a valid signal block after corrective re-prompt.`,
          );
        }

        correctiveRepromptIssued = true;
        traceLines.push('[corrective re-prompt issued]');
        response = await backend.sendMessage(conversationHandle, { content: CORRECTIVE_REPROMPT_MESSAGE });
        turnsUsed++;
        traceLines.push(`[turn ${turnsUsed} corrective] ${response.text}`);
        continue;
      }

      // Has tool calls — check turn budget
      if (turnsUsed >= maxTurns) {
        traceLines.push('[max turns budget injected]');
        response = await backend.sendMessage(conversationHandle, { content: MAX_TURNS_MESSAGE });
        turnsUsed++;
        traceLines.push(`[turn ${turnsUsed} budget] ${response.text}`);

        if ((response.toolCalls ?? []).length > 0) {
          throw new ReasoningError(
            'max_turns_exceeded',
            `Node "${nodeName}" exceeded max turns (${maxTurns}) and LLM still emitted tool calls.`,
          );
        }
        // Fall through to signal parsing at top of loop
        continue;
      }

      // --- Dispatch tool calls ---
      const toolResults: ToolResult[] = [];

      for (const toolCall of response.toolCalls!) {
        toolCallsTotal++;
        const result = await dispatchToolCall(
          toolCall,
          toolNameMap,
          registryClient,
          valueStore,
          nodeName,
          consecutiveFailures,
          perToolRetryBudget,
        );
        toolResults.push(result);
      }

      // Send results back to LLM
      response = await backend.sendToolResults(conversationHandle, toolResults);
      turnsUsed++;
      traceLines.push(`[turn ${turnsUsed} tool results] ${response.text}`);
    }
  } finally {
    await backend.closeConversation(conversationHandle);
  }
}

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

async function dispatchToolCall(
  toolCall: ToolCall,
  toolNameMap: Map<string, string>,
  registryClient: RuntimeRegistryClient,
  valueStore: ScopeValueStore,
  nodeName: string,
  consecutiveFailures: Map<string, number>,
  perToolRetryBudget: number,
): Promise<ToolResult> {
  const dottedName = toolNameMap.get(toolCall.toolName);

  if (dottedName === undefined) {
    return {
      toolCallId: toolCall.toolCallId,
      content: `ERROR: Tool "${toolCall.toolName}" is not allowed in this node's toolset. ` +
               `Only these tools are available: [${[...toolNameMap.keys()].join(', ')}].`,
      isError: true,
    };
  }

  // Check if this tool's budget is already exhausted
  const failCount = consecutiveFailures.get(dottedName) ?? 0;
  if (failCount >= perToolRetryBudget) {
    return {
      toolCallId: toolCall.toolCallId,
      content: `BUDGET_EXHAUSTED: This tool has failed ${perToolRetryBudget} consecutive times. ` +
               `Do not call it again in this session. Try a different approach or proceed without this tool's output.`,
      isError: true,
    };
  }

  // Resolve inputs (pass through value_ref handles as-is; registry resolves them)
  const inputs = toolCall.inputs as Record<string, unknown>;

  try {
    const output = await registryClient.invoke(dottedName, inputs, { valueStore });

    // Success: reset consecutive failure count
    consecutiveFailures.set(dottedName, 0);

    const content = typeof output === 'string' ? output : JSON.stringify(output);
    return {
      toolCallId: toolCall.toolCallId,
      content,
      isError: false,
    };
  } catch (err) {
    const newFailCount = failCount + 1;
    consecutiveFailures.set(dottedName, newFailCount);

    const errorMessage = err instanceof Error ? err.message : String(err);

    if (newFailCount >= perToolRetryBudget) {
      return {
        toolCallId: toolCall.toolCallId,
        content: `BUDGET_EXHAUSTED: This tool has failed ${perToolRetryBudget} consecutive times. ` +
                 `Do not call it again in this session. Try a different approach or proceed without this tool's output.`,
        isError: true,
      };
    }

    return {
      toolCallId: toolCall.toolCallId,
      content: `ERROR: ${errorMessage}`,
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function runReasoningNode(
  params: ReasoningNodeParams,
): Promise<ReasoningNodeResult> {
  const wallClockTimeoutMs = params.wallClockTimeoutMs ?? DEFAULT_WALL_CLOCK_TIMEOUT_MS;

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new ReasoningError(
        'wall_clock_timeout',
        `Node "${params.nodeName}" exceeded wall clock timeout of ${wallClockTimeoutMs}ms.`,
      )),
      wallClockTimeoutMs,
    ),
  );

  return Promise.race([_runLoop(params), timeoutPromise]);
}
