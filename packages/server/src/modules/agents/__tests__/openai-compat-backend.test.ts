import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAICompatBackend } from '../openai-compat-backend.js';
import { BackendError } from '../new-types.js';

function makeSuccessResponse(content: string, finishReason = 'stop') {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: 'chatcmpl-01',
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: finishReason,
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  } as Response;
}

function makeErrorResponse(status: number, errorMessage: string, errorType = 'api_error') {
  return {
    ok: false,
    status,
    json: async () => ({ error: { message: errorMessage, type: errorType, code: null } }),
  } as Response;
}

describe('OpenAICompatBackend', () => {
  let backendWithKey: OpenAICompatBackend;
  let backendNoKey: OpenAICompatBackend;

  beforeEach(() => {
    global.fetch = vi.fn();
    backendWithKey = new OpenAICompatBackend({
      baseUrl: 'http://localhost:8000',
      apiKey: 'test-key',
      model: 'gpt-4o',
      maxTokens: 512,
    });
    backendNoKey = new OpenAICompatBackend({
      baseUrl: 'http://localhost:8000',
      model: 'local-model',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sendMessage with apiKey includes Authorization header', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeSuccessResponse('Hello.')
    );

    const handle = await backendWithKey.startConversation({
      systemPrompt: 'You are helpful.',
      toolDefinitions: [],
      model: 'gpt-4o',
    });
    await backendWithKey.sendMessage(handle, { content: 'Hi.' });

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer test-key');
  });

  it('sendMessage without apiKey omits Authorization header', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeSuccessResponse('Hello.')
    );

    const handle = await backendNoKey.startConversation({
      systemPrompt: 'test',
      toolDefinitions: [],
      model: 'local-model',
    });
    await backendNoKey.sendMessage(handle, { content: 'Hi.' });

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['authorization']).toBeUndefined();
  });

  it('sends correct endpoint, model, and message structure', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeSuccessResponse('Done.')
    );

    const handle = await backendWithKey.startConversation({
      systemPrompt: 'System prompt here.',
      toolDefinitions: [],
      model: 'gpt-4o',
    });
    await backendWithKey.sendMessage(handle, { content: 'User turn.' });

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8000/v1/chat/completions');

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-4o');
    expect(body.max_tokens).toBe(512);
    expect(body.messages).toEqual([
      { role: 'system', content: 'System prompt here.' },
      { role: 'user', content: 'User turn.' },
    ]);
  });

  it('maps finish_reason to stopReason on AssistantMessage', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeSuccessResponse('Output.', 'length')
    );

    const handle = await backendWithKey.startConversation({
      systemPrompt: 'test',
      toolDefinitions: [],
      model: 'gpt-4o',
    });
    const result = await backendWithKey.sendMessage(handle, { content: 'hello' });
    expect(result.stopReason).toBe('length');
    expect(result.toolCalls).toEqual([]);
  });

  it('system message appears only once in multi-turn history', async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeSuccessResponse('Turn 1.'))
      .mockResolvedValueOnce(makeSuccessResponse('Turn 2.'));

    const handle = await backendWithKey.startConversation({
      systemPrompt: 'System.',
      toolDefinitions: [],
      model: 'gpt-4o',
    });
    await backendWithKey.sendMessage(handle, { content: 'Message 1.' });
    await backendWithKey.sendMessage(handle, { content: 'Message 2.' });

    const [, secondInit] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(secondInit.body as string);
    const systemMessages = body.messages.filter((m: { role: string }) => m.role === 'system');
    expect(systemMessages).toHaveLength(1);
    expect(body.messages).toEqual([
      { role: 'system', content: 'System.' },
      { role: 'user', content: 'Message 1.' },
      { role: 'assistant', content: 'Turn 1.' },
      { role: 'user', content: 'Message 2.' },
    ]);
  });

  it('throws BackendError with category backend_error on HTTP 500', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeErrorResponse(500, 'Internal server error.')
    );

    const handle = await backendWithKey.startConversation({
      systemPrompt: 'test',
      toolDefinitions: [],
      model: 'gpt-4o',
    });
    const err = await backendWithKey.sendMessage(handle, { content: 'hello' }).catch(e => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err.category).toBe('backend_error');
    expect(err.statusCode).toBe(500);
  });

  it('throws BackendError with category auth_error on HTTP 401', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeErrorResponse(401, 'Unauthorized.', 'invalid_api_key')
    );

    const handle = await backendWithKey.startConversation({
      systemPrompt: 'test',
      toolDefinitions: [],
      model: 'gpt-4o',
    });
    const err = await backendWithKey.sendMessage(handle, { content: 'hello' }).catch(e => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err.category).toBe('auth_error');
  });

  it('throws BackendError with category rate_limit on HTTP 429', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeErrorResponse(429, 'Rate limit exceeded.')
    );

    const handle = await backendWithKey.startConversation({
      systemPrompt: 'test',
      toolDefinitions: [],
      model: 'gpt-4o',
    });
    const err = await backendWithKey.sendMessage(handle, { content: 'hello' }).catch(e => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err.category).toBe('rate_limit');
  });

  it('sendToolResults throws not_implemented in Phase 1', async () => {
    const handle = await backendWithKey.startConversation({
      systemPrompt: 'test',
      toolDefinitions: [],
      model: 'gpt-4o',
    });
    const err = await backendWithKey.sendToolResults(handle, []).catch(e => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err.category).toBe('not_implemented');
  });
});
