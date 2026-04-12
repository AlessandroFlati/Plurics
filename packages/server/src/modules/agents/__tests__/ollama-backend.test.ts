import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OllamaBackend } from '../ollama-backend.js';
import { BackendError } from '../new-types.js';

function makeSuccessResponse(content: string, doneReason = 'stop') {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      model: 'qwen3.5:35b',
      created_at: '2026-04-11T00:00:00Z',
      message: { role: 'assistant', content },
      done: true,
      done_reason: doneReason,
    }),
  } as Response;
}

function makeErrorResponse(status: number, errorMessage: string) {
  return {
    ok: false,
    status,
    json: async () => ({ error: errorMessage }),
  } as Response;
}

describe('OllamaBackend', () => {
  let backend: OllamaBackend;

  beforeEach(() => {
    global.fetch = vi.fn();
    backend = new OllamaBackend({
      baseUrl: 'http://localhost:11434',
      model: 'qwen3.5:35b',
      maxTokens: 256,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends to correct endpoint with stream: false', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeSuccessResponse('Hello.')
    );

    const handle = await backend.startConversation({
      systemPrompt: 'You are helpful.',
      toolDefinitions: [],
      model: 'qwen3.5:35b',
    });
    await backend.sendMessage(handle, { content: 'Hi.' });

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse(init.body as string);
    expect(body.stream).toBe(false);
  });

  it('includes think:false when disableThinking is true', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeSuccessResponse('Result.')
    );

    const thinkingBackend = new OllamaBackend({
      baseUrl: 'http://localhost:11434',
      model: 'qwen3.5:35b',
      disableThinking: true,
    });

    const handle = await thinkingBackend.startConversation({
      systemPrompt: 'test',
      toolDefinitions: [],
      model: 'qwen3.5:35b',
    });
    await thinkingBackend.sendMessage(handle, { content: 'go' });

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.think).toBe(false);
  });

  it('does NOT include think field when disableThinking is false or unset', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeSuccessResponse('Result.')
    );

    const handle = await backend.startConversation({
      systemPrompt: 'test',
      toolDefinitions: [],
      model: 'qwen3.5:35b',
    });
    await backend.sendMessage(handle, { content: 'go' });

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(Object.prototype.hasOwnProperty.call(body, 'think')).toBe(false);
  });

  it('sets options.num_predict from maxTokens', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeSuccessResponse('Result.')
    );

    const handle = await backend.startConversation({
      systemPrompt: 'test',
      toolDefinitions: [],
      model: 'qwen3.5:35b',
      maxTokens: 512,
    });
    await backend.sendMessage(handle, { content: 'go' });

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.options?.num_predict).toBe(512);
  });

  it('strips <think>...</think> blocks from response content', async () => {
    const rawContent = '<think>\nThis is internal reasoning.\nMultiple lines.\n</think>\nThis is the actual answer.';
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeSuccessResponse(rawContent)
    );

    const handle = await backend.startConversation({
      systemPrompt: 'test',
      toolDefinitions: [],
      model: 'qwen3.5:35b',
    });
    const result = await backend.sendMessage(handle, { content: 'go' });
    expect(result.content).toBe('This is the actual answer.');
    expect(result.content).not.toContain('<think>');
    expect(result.content).not.toContain('internal reasoning');
  });

  it('strips multiple <think> blocks', async () => {
    const rawContent = '<think>First block.</think> Middle text. <think>Second block.</think> Final answer.';
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeSuccessResponse(rawContent)
    );

    const handle = await backend.startConversation({
      systemPrompt: 'test',
      toolDefinitions: [],
      model: 'qwen3.5:35b',
    });
    const result = await backend.sendMessage(handle, { content: 'go' });
    expect(result.content).toBe('Middle text.  Final answer.');
  });

  it('maps done_reason to stopReason', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeSuccessResponse('Done.', 'length')
    );

    const handle = await backend.startConversation({
      systemPrompt: 'test',
      toolDefinitions: [],
      model: 'qwen3.5:35b',
    });
    const result = await backend.sendMessage(handle, { content: 'go' });
    expect(result.stopReason).toBe('length');
  });

  it('wraps network errors as BackendError with category backend_unavailable', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('connect ECONNREFUSED 127.0.0.1:11434')
    );

    const handle = await backend.startConversation({
      systemPrompt: 'test',
      toolDefinitions: [],
      model: 'qwen3.5:35b',
    });
    const err = await backend.sendMessage(handle, { content: 'go' }).catch(e => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err.category).toBe('backend_unavailable');
    expect(err.cause).toBeInstanceOf(Error);
  });

  it('throws BackendError on HTTP non-2xx', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeErrorResponse(404, 'Model not found.')
    );

    const handle = await backend.startConversation({
      systemPrompt: 'test',
      toolDefinitions: [],
      model: 'qwen3.5:35b',
    });
    const err = await backend.sendMessage(handle, { content: 'go' }).catch(e => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err.category).toBe('backend_error');
  });

  it('accumulates history across turns', async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeSuccessResponse('Turn 1.'))
      .mockResolvedValueOnce(makeSuccessResponse('Turn 2.'));

    const handle = await backend.startConversation({
      systemPrompt: 'System.',
      toolDefinitions: [],
      model: 'qwen3.5:35b',
    });
    await backend.sendMessage(handle, { content: 'Msg 1.' });
    await backend.sendMessage(handle, { content: 'Msg 2.' });

    const [, secondInit] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(secondInit.body as string);
    expect(body.messages).toEqual([
      { role: 'system', content: 'System.' },
      { role: 'user', content: 'Msg 1.' },
      { role: 'assistant', content: 'Turn 1.' },
      { role: 'user', content: 'Msg 2.' },
    ]);
  });
});

describe('OllamaBackend — tool wire format', () => {
  it('sends tools array in OpenAI function-calling format', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'qwen3.5:35b',
        created_at: '2026-04-11T00:00:00Z',
        message: { role: 'assistant', content: 'hi' },
        done: true,
        done_reason: 'stop',
      }),
    });
    global.fetch = fetchSpy as any;

    const backend = new OllamaBackend({ baseUrl: 'http://localhost:11434', model: 'qwen3.5:35b' });
    const tools: import('../new-types.js').ToolDefinition[] = [{
      name: 'statistics_mean',
      description: 'Compute mean',
      inputSchema: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
    }];
    const handle = await backend.startConversation({ systemPrompt: 'sys', toolDefinitions: tools, model: 'qwen3.5:35b', maxTokens: 1024 });
    await backend.sendMessage(handle, { content: 'go' });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].type).toBe('function');
    expect(body.tools[0].function.name).toBe('statistics_mean');
    expect(body.tools[0].function.parameters.properties.x.type).toBe('number');
  });

  it('parses tool_calls from assistant response', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'qwen3.5:35b',
        created_at: '2026-04-11T00:00:00Z',
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{
            function: { name: 'statistics_mean', arguments: { x: 5 } },
          }],
        },
        done: true,
        done_reason: 'stop',
      }),
    });
    global.fetch = fetchSpy as any;

    const backend = new OllamaBackend({ baseUrl: 'http://localhost:11434', model: 'qwen3.5:35b' });
    const handle = await backend.startConversation({ systemPrompt: 'sys', toolDefinitions: [], model: 'qwen3.5:35b', maxTokens: 1024 });
    const msg = await backend.sendMessage(handle, { content: 'go' });

    expect(msg.toolCalls).toHaveLength(1);
    expect(msg.toolCalls![0].toolName).toBe('statistics_mean');
    expect(msg.toolCalls![0].inputs.x).toBe(5);
  });

  it('sends tool results as role:tool messages without tool_call_id', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: 'qwen3.5:35b',
          created_at: '2026-04-11T00:00:00Z',
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{
              function: { name: 'statistics_mean', arguments: {} },
            }],
          },
          done: true,
          done_reason: 'stop',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: 'qwen3.5:35b',
          created_at: '2026-04-11T00:00:00Z',
          message: { role: 'assistant', content: 'Result is 42.' },
          done: true,
          done_reason: 'stop',
        }),
      });
    global.fetch = fetchSpy as any;

    const backend = new OllamaBackend({ baseUrl: 'http://localhost:11434', model: 'qwen3.5:35b' });
    const handle = await backend.startConversation({ systemPrompt: 'sys', toolDefinitions: [], model: 'qwen3.5:35b', maxTokens: 1024 });
    await backend.sendMessage(handle, { content: 'go' });
    await backend.sendToolResults(handle, [{ toolCallId: 'ignored', content: '42' }]);

    const body = JSON.parse(fetchSpy.mock.calls[1][1].body);
    const toolMsg = body.messages.find((m: any) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg.content).toBe('42');
    // Ollama 0.4.x does not require tool_call_id
    expect(toolMsg.tool_call_id).toBeUndefined();
  });
});
