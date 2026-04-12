import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runReasoningNode } from '../reasoning-runtime.js';
import type { AgentBackend, AssistantMessage, ToolCall, ToolResult } from '../../agents/new-types.js';
import type { ConversationHandle } from '../../agents/new-types.js';

// ---- helpers ----

const MOCK_HANDLE = 'conv-handle-001' as unknown as ConversationHandle;

function makeSignalText(status = 'success'): string {
  return `Here is my answer.\n\`\`\`signal\n${JSON.stringify({
    status, agent: 'test_agent', outputs: [],
  })}\n\`\`\``;
}

function makeToolCallResponse(toolName: string, toolCallId: string, inputs = {}): AssistantMessage {
  return {
    text: `I will call ${toolName}.`,
    content: `I will call ${toolName}.`,
    toolCalls: [{ toolCallId, toolName, inputs }],
  };
}

function makeFinalResponse(text = makeSignalText()): AssistantMessage {
  return { text, content: text, toolCalls: undefined };
}

function mockBackend(overrides: Partial<AgentBackend> = {}): AgentBackend {
  return {
    startConversation: vi.fn().mockResolvedValue(MOCK_HANDLE),
    sendMessage: vi.fn().mockResolvedValue(makeFinalResponse()),
    sendToolResults: vi.fn().mockResolvedValue(makeFinalResponse()),
    closeConversation: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AgentBackend;
}

function mockRegistry(toolResult: unknown = { result: 42 }) {
  return {
    invoke: vi.fn().mockResolvedValue({ result: toolResult }),
  };
}

function mockValueStore() {
  const store = new Map<string, unknown>();
  return {
    put: vi.fn((handle: string, value: unknown) => { store.set(handle, value); }),
    get: vi.fn((handle: string) => store.get(handle)),
    has: vi.fn((handle: string) => store.has(handle)),
    adopt: vi.fn((handle: string, value: unknown) => { store.set(handle, value); }),
    generateHandle: vi.fn(() => `vs-${Date.now()}-mock`),
  };
}

const BASE_PARAMS = {
  toolDefinitions: [],
  toolNameMap: new Map<string, string>(),
  runId: 'run-001',
  nodeName: 'test_node',
  purpose: 'Test purpose.',
  systemPrompt: 'You are a test agent.',
  model: 'claude-3-5-haiku-20241022',
  maxTokens: 1024,
};

// ---- tests ----

describe('runReasoningNode — single turn (no tool calls)', () => {
  it('returns parsed signal when LLM responds with valid signal on first turn', async () => {
    const backend = mockBackend({
      sendMessage: vi.fn().mockResolvedValue(makeFinalResponse()),
    });
    const runStore = mockValueStore();
    const result = await runReasoningNode({
      ...BASE_PARAMS,
      backend,
      registryClient: mockRegistry() as any,
      valueStore: runStore as any,
    });

    expect(result.signal.status).toBe('success');
    expect(result.turnsUsed).toBe(1);
    expect(result.toolCallsTotal).toBe(0);
    expect(backend.startConversation).toHaveBeenCalledOnce();
    expect(backend.sendMessage).toHaveBeenCalledWith(MOCK_HANDLE, 'Test purpose.');
    expect(backend.closeConversation).toHaveBeenCalledOnce();
  });
});

describe('runReasoningNode — tool call round-trip', () => {
  it('dispatches tool calls, sends results, then parses signal on second turn', async () => {
    const backend = mockBackend({
      sendMessage: vi.fn().mockResolvedValue(
        makeToolCallResponse('statistics_mean', 'tc_001', { x: 5 }),
      ),
      sendToolResults: vi.fn().mockResolvedValue(makeFinalResponse()),
    });
    const registry = mockRegistry({ mean: 3.14 });
    const runStore = mockValueStore();

    const result = await runReasoningNode({
      ...BASE_PARAMS,
      backend,
      toolNameMap: new Map([['statistics_mean', 'statistics.mean']]),
      registryClient: registry as any,
      valueStore: runStore as any,
    });

    expect(registry.invoke).toHaveBeenCalledWith('statistics.mean', { x: 5 }, expect.anything());
    expect(backend.sendToolResults).toHaveBeenCalledOnce();
    expect(result.turnsUsed).toBe(2);
    expect(result.toolCallsTotal).toBe(1);
    expect(result.signal.status).toBe('success');
  });
});

describe('runReasoningNode — per-tool retry budget', () => {
  it('injects BUDGET_EXHAUSTED result after 3 consecutive failures and then succeeds', async () => {
    let sendToolResultsCallCount = 0;
    const backend = mockBackend({
      sendMessage: vi.fn().mockResolvedValue(
        makeToolCallResponse('statistics_mean', 'tc_001'),
      ),
      sendToolResults: vi.fn().mockImplementation(async () => {
        sendToolResultsCallCount++;
        if (sendToolResultsCallCount <= 3) {
          return makeToolCallResponse('statistics_mean', `tc_00${sendToolResultsCallCount + 1}`);
        }
        return makeFinalResponse();
      }),
    });
    const registry = {
      invoke: vi.fn().mockRejectedValue(new Error('Tool failed')),
    };

    const result = await runReasoningNode({
      ...BASE_PARAMS,
      backend,
      toolNameMap: new Map([['statistics_mean', 'statistics.mean']]),
      registryClient: registry as any,
      valueStore: mockValueStore() as any,
      perToolRetryBudget: 3,
    });

    // Budget exhausted message sent on 3rd consecutive failure
    const lastToolResultsCall = (backend.sendToolResults as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: any[]) => call[1]?.[0]?.content?.includes('BUDGET_EXHAUSTED'),
    );
    expect(lastToolResultsCall).toBeDefined();
    expect(result.signal.status).toBe('success');
  });
});

describe('runReasoningNode — max turns', () => {
  it('injects budget message at maxTurns and succeeds when LLM cooperates', async () => {
    let callCount = 0;
    const backend = mockBackend({
      sendMessage: vi.fn().mockImplementation(async () => {
        callCount++;
        // First call returns tool use; subsequent sendMessage (budget) returns final answer
        if (callCount === 1) {
          return makeToolCallResponse('statistics_mean', 'tc_001');
        }
        return makeFinalResponse();
      }),
      sendToolResults: vi.fn().mockImplementation(async () => {
        return makeToolCallResponse('statistics_mean', `tc_loop_${callCount}`);
      }),
    });

    await expect(
      runReasoningNode({
        ...BASE_PARAMS,
        backend,
        toolNameMap: new Map([['statistics_mean', 'statistics.mean']]),
        registryClient: mockRegistry() as any,
        valueStore: mockValueStore() as any,
        maxTurns: 3,
      }),
    ).resolves.toMatchObject({ signal: { status: 'success' } });

    const sendMessageCalls = (backend.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
    const budgetCall = sendMessageCalls.find((call: any[]) =>
      typeof call[1] === 'string' && call[1].includes('turn budget'),
    );
    expect(budgetCall).toBeDefined();
  });

  it('throws max_turns_exceeded when LLM still emits tool calls after budget message', async () => {
    const backend = mockBackend({
      sendMessage: vi.fn().mockResolvedValue(
        makeToolCallResponse('statistics_mean', 'tc_001'),
      ),
      sendToolResults: vi.fn().mockResolvedValue(
        makeToolCallResponse('statistics_mean', 'tc_002'),
      ),
    });

    await expect(
      runReasoningNode({
        ...BASE_PARAMS,
        backend,
        toolNameMap: new Map([['statistics_mean', 'statistics.mean']]),
        registryClient: mockRegistry() as any,
        valueStore: mockValueStore() as any,
        maxTurns: 2,
      }),
    ).rejects.toMatchObject({ category: 'max_turns_exceeded' });
  });
});

describe('runReasoningNode — signal parse error', () => {
  it('sends corrective re-prompt on missing signal block', async () => {
    let sendMessageCallCount = 0;
    const backend = mockBackend({
      sendMessage: vi.fn().mockImplementation(async () => {
        sendMessageCallCount++;
        if (sendMessageCallCount === 1) {
          return { text: 'I forgot the signal block.', content: 'I forgot the signal block.', toolCalls: undefined };
        }
        // Second call (corrective re-prompt)
        return makeFinalResponse();
      }),
    });

    const result = await runReasoningNode({
      ...BASE_PARAMS,
      backend,
      registryClient: mockRegistry() as any,
      valueStore: mockValueStore() as any,
    });

    expect(sendMessageCallCount).toBe(2);
    expect(result.signal.status).toBe('success');
  });

  it('throws signal_parse_error when corrective re-prompt also fails', async () => {
    const backend = mockBackend({
      sendMessage: vi.fn().mockResolvedValue(
        { text: 'No signal here.', content: 'No signal here.', toolCalls: undefined },
      ),
    });

    await expect(
      runReasoningNode({
        ...BASE_PARAMS,
        backend,
        registryClient: mockRegistry() as any,
        valueStore: mockValueStore() as any,
      }),
    ).rejects.toMatchObject({ category: 'signal_parse_error' });
  });
});

describe('runReasoningNode — tool_not_allowed', () => {
  it('returns error result when LLM calls tool not in toolNameMap', async () => {
    const backend = mockBackend({
      sendMessage: vi.fn().mockResolvedValue(
        makeToolCallResponse('unauthorized_tool', 'tc_001'),
      ),
      sendToolResults: vi.fn().mockResolvedValue(makeFinalResponse()),
    });

    const result = await runReasoningNode({
      ...BASE_PARAMS,
      backend,
      toolNameMap: new Map(),   // empty — no tools allowed
      registryClient: mockRegistry() as any,
      valueStore: mockValueStore() as any,
    });

    const toolResultsArg = (backend.sendToolResults as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(toolResultsArg[0].isError).toBe(true);
    expect(toolResultsArg[0].content).toContain('not allowed');
    expect(result.signal.status).toBe('success');
  });
});

describe('runReasoningNode — wall clock timeout', () => {
  it('throws wall_clock_timeout when loop takes too long', async () => {
    const backend = mockBackend({
      sendMessage: vi.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 500)),
      ),
    });

    await expect(
      runReasoningNode({
        ...BASE_PARAMS,
        backend,
        registryClient: mockRegistry() as any,
        valueStore: mockValueStore() as any,
        wallClockTimeoutMs: 50,
      }),
    ).rejects.toMatchObject({ category: 'wall_clock_timeout' });
  });
});
