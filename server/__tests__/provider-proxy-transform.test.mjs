import { describe, expect, test } from 'vitest';
import { anthropicToOpenaiChat } from '../proxy/transform/anthropicToOpenaiChat.js';
import { anthropicToOpenaiResponses } from '../proxy/transform/anthropicToOpenaiResponses.js';
import { openaiChatToAnthropic } from '../proxy/transform/openaiChatToAnthropic.js';
import { openaiResponsesToAnthropic } from '../proxy/transform/openaiResponsesToAnthropic.js';
import { isLoopbackAddress } from '../routes/providerProxy.js';
import { openaiChatStreamToAnthropic } from '../proxy/streaming/openaiChatStreamToAnthropic.js';
import { openaiResponsesStreamToAnthropic } from '../proxy/streaming/openaiResponsesStreamToAnthropic.js';
import { resolvePromptCacheKey } from '../proxy/promptCacheKey.js';

function textStream(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

async function readText(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) return output;
    output += decoder.decode(value, { stream: true });
  }
}

describe('provider protocol transforms', () => {
  test('recognizes only loopback proxy clients by default', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('192.168.1.5')).toBe(false);
  });

  test('resolves a stable Responses prompt cache key from Claude session identity', () => {
    expect(resolvePromptCacheKey({ metadata: { user_id: 'user_7_session_session-123' } }, 'header-id'))
      .toBe('session-123');
    expect(resolvePromptCacheKey({ metadata: { session_id: 'metadata-id' } }, 'header-id'))
      .toBe('metadata-id');
    expect(resolvePromptCacheKey({}, '  header-id  ')).toBe('header-id');
    expect(resolvePromptCacheKey({})).toBeUndefined();
  });

  test('converts Anthropic system, tools, tool results and thinking to OpenAI Chat', () => {
    const result = anthropicToOpenaiChat({
      model: 'deepseek-test',
      max_tokens: 4096,
      system: 'x-anthropic-billing-header: rotating\n\nYou are helpful',
      thinking: { type: 'enabled', budget_tokens: 4096 },
      tools: [{ name: 'weather', description: 'Weather', input_schema: { type: 'object' } }],
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'call-1', name: 'weather', input: { city: 'NYC' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'Sunny' }] },
      ],
    }, { roundTripReasoningContent: true });
    expect(result.messages[0]).toEqual({ role: 'system', content: 'You are helpful' });
    expect(result.tools[0].function.name).toBe('weather');
    expect(result.messages[1].tool_calls[0].function.arguments).toBe('{"city":"NYC"}');
    expect(result.messages[2]).toMatchObject({ role: 'tool', tool_call_id: 'call-1', content: 'Sunny' });
    expect(result.reasoning_effort).toBe('medium');
  });

  test('round-trips OpenAI Chat text and tool calls to Anthropic Messages', () => {
    const result = openaiChatToAnthropic({
      id: 'chat-1',
      model: 'gpt-test',
      choices: [{
        message: {
          role: 'assistant',
          content: 'Checking',
          tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
    }, 'gpt-test');
    expect(result).toMatchObject({ type: 'message', stop_reason: 'tool_use', usage: { input_tokens: 4, output_tokens: 3 } });
    expect(result.content).toEqual([
      { type: 'text', text: 'Checking' },
      { type: 'tool_use', id: 'call-1', name: 'lookup', input: { q: 'x' } },
    ]);
  });

  test('converts images and functions for OpenAI Responses and maps the response back', () => {
    const request = anthropicToOpenaiResponses({
      model: 'gpt-test',
      max_tokens: 100,
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'Inspect' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
      ] }],
      tools: [{ name: 'lookup', description: 'Lookup', input_schema: { type: 'object' } }],
    });
    expect(JSON.stringify(request)).toContain('data:image/png;base64,abc');
    expect(request.tools[0]).toMatchObject({ type: 'function', name: 'lookup' });

    const response = openaiResponsesToAnthropic({
      id: 'resp-1',
      object: 'response',
      model: 'gpt-test',
      status: 'completed',
      output: [
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done' }] },
        { type: 'function_call', call_id: 'call-2', name: 'lookup', arguments: '{"q":"y"}' },
      ],
      usage: { input_tokens: 5, output_tokens: 6, total_tokens: 11 },
    }, 'gpt-test');
    expect(response.stop_reason).toBe('tool_use');
    expect(response.content).toContainEqual({ type: 'tool_use', id: 'call-2', name: 'lookup', input: { q: 'y' } });
  });

  test('translates OpenAI Chat SSE text, usage and completion lifecycle', async () => {
    const upstream = textStream([
      'data: {"id":"chat-1","model":"gpt-test","choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
      'data: {"id":"chat-1","model":"gpt-test","choices":[{"delta":{"content":"Hel"},"finish_reason":null}]}\n\n',
      'data: {"id":"chat-1","model":"gpt-test","choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\n',
      'data: [DONE]\n\n',
    ]);
    const output = await readText(openaiChatStreamToAnthropic(upstream, 'gpt-test'));
    expect(output).toContain('event: message_start');
    expect(output).toContain('"text":"Hel"');
    expect(output).toContain('"text":"lo"');
    expect(output).toContain('"stop_reason":"end_turn"');
    expect(output).toContain('event: message_stop');
  });

  test('translates OpenAI Responses SSE text and function-call events', async () => {
    const upstream = textStream([
      'event: response.created\ndata: {"model":"gpt-test"}\n\n',
      'event: response.output_item.added\ndata: {"item":{"id":"item-1","type":"message","role":"assistant"}}\n\n',
      'event: response.content_part.added\ndata: {"output_index":0,"content_index":0,"part":{"type":"output_text","text":""}}\n\n',
      'event: response.output_text.delta\ndata: {"output_index":0,"content_index":0,"delta":"Done"}\n\n',
      'event: response.output_text.done\ndata: {"output_index":0,"content_index":0,"text":"Done"}\n\n',
      'event: response.output_item.added\ndata: {"item":{"id":"tool-1","type":"function_call","call_id":"call-1","name":"lookup"}}\n\n',
      'event: response.function_call_arguments.delta\ndata: {"item_id":"tool-1","delta":"{\\"q\\":\\"x\\"}"}\n\n',
      'event: response.completed\ndata: {"response":{"model":"gpt-test","usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}}\n\n',
      'data: [DONE]\n\n',
    ]);
    const output = await readText(openaiResponsesStreamToAnthropic(upstream, 'gpt-test'));
    expect(output).toContain('event: message_start');
    expect(output).toContain('"text":"Done"');
    expect(output).toContain('"name":"lookup"');
    expect(output).toContain('input_json_delta');
    expect(output).toContain('event: message_stop');
  });
});
