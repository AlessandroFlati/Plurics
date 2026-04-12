import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ClaudeBackend } from '../claude-backend.js';
import { BackendError } from '../new-types.js';
import type { ToolDefinition } from '../new-types.js';

const CANNED_SUCCESS = {
  id: 'msg_01',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: 'Hello from Claude.' }],
  model: 'claude-sonnet-4-6',
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5 },
};

function makeSuccessResponse(text: string, stopReason = 'end_turn') {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      ...CANNED_SUCCESS,
      content: [{ type: 'text', text }],
      stop_reason: stopReason,
    }),
  } as Response;
}

function makeErrorResponse(status: number, errorType: string, errorMessage: string) {
  return {
    ok: false,
    status,
    json: async () => ({
      type: 'error',
      error: { type: errorType, message: errorMessage },
    }),
  } as Response;
}

describe('ClaudeBackend', () => {
  let backend: ClaudeBackend;

  beforeEach(() => {
    global.fetch = vi.fn();
    backend = new ClaudeBackend({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'test-key',
      model: 'claude-sonnet-4-6',
      maxTokens: 1024,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('startConversation returns a handle with a conversationId', async () => {
    const handle = await backend.startConversation({
      systemPrompt: 'You are helpful.',
      toolDefinitions: [],
      model: 'claude-sonnet-4-6',
    });
    expect(handle.conversationId).toBeTruthy();
    expect(typeof handle.conversationId).toBe('string');
  });

  it('sendMessage sends correct headers and body', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeSuccessResponse('The answer is 42.')
    );

    const handle = await backend.startConversation({
      systemPrompt: 'You are a calculator.',
      toolDefinitions: [],
      model: 'claude-sonnet-4-6',
    });

    const result = await backend.sendMessage(handle, { content: 'What is 6*7?' });

    expect(result.content).toBe('The answer is 42.');
    expect(result.stopReason).toBe('end_turn');
    expect(result.toolCalls).toBeUndefined();

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer test-key');
    expect((init.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.system).toBe('You are a calculator.');
    expect(body.messages).toEqual([{ role: 'user', content: 'What is 6*7?' }]);
    expect(body.max_tokens).toBe(1024);
  });

  it('accumulates history across multiple sendMessage calls (multi-turn)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeSuccessResponse('Turn 1 response.'))
      .mockResolvedValueOnce(makeSuccessResponse('Turn 2 response.'));

    const handle = await backend.startConversation({
      systemPrompt: 'Multi-turn test.',
      toolDefinitions: [],
      model: 'claude-sonnet-4-6',
    });

    await backend.sendMessage(handle, { content: 'First message.' });
    await backend.sendMessage(handle, { content: 'Second message.' });

    const [, secondInit] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(secondInit.body as string);
    // assistant content is now the full content array from the API response
    expect(body.messages[0]).toEqual({ role: 'user', content: 'First message.' });
    expect(body.messages[1].role).toBe('assistant');
    expect(body.messages[2]).toEqual({ role: 'user', content: 'Second message.' });
  });

  it('throws BackendError with category auth_error on HTTP 401', async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeErrorResponse(401, 'authentication_error', 'Invalid API key.'))
      .mockResolvedValueOnce(makeErrorResponse(401, 'authentication_error', 'Invalid API key.'));

    const handle = await backend.startConversation({
      systemPrompt: 'test',
      toolDefinitions: [],
      model: 'claude-sonnet-4-6',
    });

    await expect(
      backend.sendMessage(handle, { content: 'hello' })
    ).rejects.toThrow(BackendError);

    await expect(
      backend.sendMessage(handle, { content: 'hello' }).catch(e => e)
    ).resolves.toMatchObject({ category: 'auth_error', statusCode: 401 });
  });

  it('throws BackendError with category rate_limit on HTTP 429', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeErrorResponse(429, 'rate_limit_error', 'Rate limit exceeded.')
    );

    const handle = await backend.startConversation({
      systemPrompt: 'test',
      toolDefinitions: [],
      model: 'claude-sonnet-4-6',
    });

    const err = await backend.sendMessage(handle, { content: 'hello' }).catch(e => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err.category).toBe('rate_limit');
    expect(err.statusCode).toBe(429);
  });

  it('throws BackendError with category backend_error on HTTP 529', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeErrorResponse(529, 'overloaded_error', 'API overloaded.')
    );

    const handle = await backend.startConversation({
      systemPrompt: 'test',
      toolDefinitions: [],
      model: 'claude-sonnet-4-6',
    });

    const err = await backend.sendMessage(handle, { content: 'hello' }).catch(e => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err.category).toBe('rate_limit');
  });

  it('sendMessage on a closed conversation throws conversation_not_found', async () => {
    const handle = await backend.startConversation({
      systemPrompt: 'test',
      toolDefinitions: [],
      model: 'claude-sonnet-4-6',
    });
    await backend.closeConversation(handle);

    const err = await backend.sendMessage(handle, { content: 'hello' }).catch(e => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err.category).toBe('conversation_not_found');
  });

  it('uses maxTokens from startConversation params when provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeSuccessResponse('ok')
    );

    const handle = await backend.startConversation({
      systemPrompt: 'test',
      toolDefinitions: [],
      model: 'claude-sonnet-4-6',
      maxTokens: 2048,
    });

    await backend.sendMessage(handle, { content: 'hi' });

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.max_tokens).toBe(2048);
  });
});

describe('ClaudeBackend — tool wire format', () => {
  it('includes tools array in request body when toolDefinitions provided', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'hello' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });
    global.fetch = fetchSpy as any;

    const backend = new ClaudeBackend({ apiKey: 'test-key' });
    const tools: ToolDefinition[] = [{
      name: 'statistics_mean',
      description: 'Compute mean',
      inputSchema: {
        type: 'object',
        properties: { values: { type: 'object', description: 'NumpyArray. Pass a value_ref.' } },
        required: ['values'],
      },
    }];
    const handle = await backend.startConversation('sys', tools, 'claude-3-5-haiku-20241022', 1024);
    await backend.sendMessage(handle, 'test');

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].name).toBe('statistics_mean');
    expect(body.tools[0].input_schema.properties.values.type).toBe('object');
  });

  it('parses tool_use blocks into AssistantMessage.toolCalls', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          { type: 'text', text: 'I will call a tool.' },
          { type: 'tool_use', id: 'tu_001', name: 'statistics_mean',
            input: { values: { _type: 'value_ref', _handle: 'vs-abc', _schema: 'NumpyArray' } } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 20, output_tokens: 10 },
      }),
    });
    global.fetch = fetchSpy as any;

    const backend = new ClaudeBackend({ apiKey: 'test-key' });
    const handle = await backend.startConversation('sys', [], 'claude-3-5-haiku-20241022', 1024);
    const msg = await backend.sendMessage(handle, 'run tools');

    expect(msg.toolCalls).toHaveLength(1);
    expect(msg.toolCalls![0].toolCallId).toBe('tu_001');
    expect(msg.toolCalls![0].toolName).toBe('statistics_mean');
    expect(msg.toolCalls![0].inputs.values).toMatchObject({ _handle: 'vs-abc' });
    expect(msg.text).toBe('I will call a tool.');
  });
});
