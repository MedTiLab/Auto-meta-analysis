/**
 * Streaming SSE transformation: OpenAI Responses API → Anthropic Messages
 * Derived from cc-switch (https://github.com/farion1231/cc-switch)
 * Original work by Jason Young, MIT License
 */
import { stringifyOpenAIToolArguments } from '../transform/toolArguments.js';
import { openaiUsageToAnthropic } from '../transform/usage.js';
function formatSse(event, data) {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
/**
 * Transform an OpenAI Responses API SSE stream into an Anthropic Messages SSE stream.
 */
export function openaiResponsesStreamToAnthropic(upstream, model) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let buffer = '';
    const state = {
        nextContentIndex: 0,
        indexByKey: new Map(),
        toolIndexByItemId: new Map(),
        model,
        messageStarted: false,
        messageStopped: false,
    };
    return new ReadableStream({
        async start(controller) {
            const reader = upstream.getReader();
            let currentEvent = '';
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (trimmed.startsWith('event: ')) {
                            currentEvent = trimmed.slice(7).trim();
                            continue;
                        }
                        if (trimmed.startsWith('data: ')) {
                            const jsonStr = trimmed.slice(6);
                            if (jsonStr === '[DONE]') {
                                if (!state.messageStopped) {
                                    state.messageStopped = true;
                                    if (!state.messageStarted) {
                                        emitMessageStart(state, controller, encoder, model);
                                    }
                                    controller.enqueue(encoder.encode(formatSse('message_stop', { type: 'message_stop' })));
                                }
                                continue;
                            }
                            let data;
                            try {
                                data = JSON.parse(jsonStr);
                            }
                            catch {
                                continue;
                            }
                            processEvent(currentEvent, data, state, controller, encoder);
                            currentEvent = '';
                            continue;
                        }
                        if (trimmed === '') {
                            currentEvent = '';
                        }
                    }
                }
            }
            catch (err) {
                controller.error(err);
                return; // don't call close() after error()
            }
            controller.close();
        },
    });
}
function emitMessageStart(state, controller, encoder, model) {
    state.messageStarted = true;
    controller.enqueue(encoder.encode(formatSse('message_start', {
        type: 'message_start',
        message: {
            id: `msg_${Date.now()}`,
            type: 'message',
            role: 'assistant',
            content: [],
            model,
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
        },
    })));
}
function processEvent(event, data, state, controller, encoder) {
    switch (event) {
        case 'response.created': {
            const response = data;
            state.model = response.model || state.model;
            emitMessageStart(state, controller, encoder, state.model);
            break;
        }
        case 'response.output_item.added': {
            if (!state.messageStarted)
                emitMessageStart(state, controller, encoder, state.model);
            const item = data.item;
            if (!item)
                break;
            if (item.type === 'function_call') {
                const index = state.nextContentIndex++;
                const callId = item.call_id || item.id || '';
                const name = item.name || '';
                state.toolIndexByItemId.set(item.id || callId, index);
                controller.enqueue(encoder.encode(formatSse('content_block_start', {
                    type: 'content_block_start',
                    index,
                    content_block: {
                        type: 'tool_use',
                        id: callId,
                        name,
                        input: {},
                    },
                })));
            }
            break;
        }
        case 'response.content_part.added': {
            if (!state.messageStarted)
                emitMessageStart(state, controller, encoder, state.model);
            const part = data.part;
            if (!part)
                break;
            const contentIndex = data.content_index ?? 0;
            const outputIndex = data.output_index ?? 0;
            const key = `${outputIndex}:${contentIndex}`;
            const index = state.nextContentIndex++;
            state.indexByKey.set(key, index);
            controller.enqueue(encoder.encode(formatSse('content_block_start', {
                type: 'content_block_start',
                index,
                content_block: { type: 'text', text: '' },
            })));
            break;
        }
        case 'response.output_text.delta': {
            const contentIndex = data.content_index ?? 0;
            const outputIndex = data.output_index ?? 0;
            const key = `${outputIndex}:${contentIndex}`;
            const index = state.indexByKey.get(key);
            if (index === undefined)
                break;
            const delta = data.delta || '';
            controller.enqueue(encoder.encode(formatSse('content_block_delta', {
                type: 'content_block_delta',
                index,
                delta: { type: 'text_delta', text: delta },
            })));
            break;
        }
        case 'response.refusal.delta': {
            const contentIndex = data.content_index ?? 0;
            const outputIndex = data.output_index ?? 0;
            const key = `${outputIndex}:${contentIndex}`;
            const index = state.indexByKey.get(key);
            if (index === undefined)
                break;
            const delta = data.delta || '';
            controller.enqueue(encoder.encode(formatSse('content_block_delta', {
                type: 'content_block_delta',
                index,
                delta: { type: 'text_delta', text: delta },
            })));
            break;
        }
        case 'response.function_call_arguments.delta': {
            const itemId = data.item_id || '';
            const index = state.toolIndexByItemId.get(itemId);
            if (index === undefined)
                break;
            const delta = stringifyOpenAIToolArguments(data.delta);
            controller.enqueue(encoder.encode(formatSse('content_block_delta', {
                type: 'content_block_delta',
                index,
                delta: { type: 'input_json_delta', partial_json: delta },
            })));
            break;
        }
        case 'response.output_text.done':
        case 'response.refusal.done': {
            const contentIndex = data.content_index ?? 0;
            const outputIndex = data.output_index ?? 0;
            const key = `${outputIndex}:${contentIndex}`;
            const index = state.indexByKey.get(key);
            if (index === undefined)
                break;
            controller.enqueue(encoder.encode(formatSse('content_block_stop', {
                type: 'content_block_stop',
                index,
            })));
            break;
        }
        case 'response.function_call_arguments.done': {
            const itemId = data.item_id || '';
            const index = state.toolIndexByItemId.get(itemId);
            if (index === undefined)
                break;
            controller.enqueue(encoder.encode(formatSse('content_block_stop', {
                type: 'content_block_stop',
                index,
            })));
            break;
        }
        case 'response.completed': {
            const response = data.response;
            const status = response?.status || 'completed';
            const usage = response?.usage;
            const hasToolUse = state.toolIndexByItemId.size > 0;
            const stopReason = status === 'completed'
                ? (hasToolUse ? 'tool_use' : 'end_turn')
                : status === 'incomplete' ? 'max_tokens' : 'end_turn';
            controller.enqueue(encoder.encode(formatSse('message_delta', {
                type: 'message_delta',
                delta: { stop_reason: stopReason, stop_sequence: null },
                usage: openaiUsageToAnthropic(usage),
            })));
            if (!state.messageStopped) {
                state.messageStopped = true;
                controller.enqueue(encoder.encode(formatSse('message_stop', { type: 'message_stop' })));
            }
            break;
        }
    }
}
