/**
 * Response transformation: OpenAI Chat Completions → Anthropic Messages
 * Derived from cc-switch (https://github.com/farion1231/cc-switch)
 * Original work by Jason Young, MIT License
 */
import { parseOpenAIToolArguments } from './toolArguments.js';
import { openaiUsageToAnthropic } from './usage.js';
/**
 * Convert OpenAI Chat Completions response to Anthropic Messages response.
 */
export function openaiChatToAnthropic(response, model) {
    const choice = response.choices?.[0];
    if (!choice) {
        return createEmptyResponse(response, model);
    }
    const content = [];
    // Convert reasoning/thinking content (all provider formats)
    const msg = choice.message;
    // Format 1: reasoning_content (DeepSeek, OpenRouter, XAI, Perplexity)
    if (typeof msg.reasoning_content === 'string' && msg.reasoning_content) {
        content.push({ type: 'thinking', thinking: msg.reasoning_content });
    }
    // Format 2: reasoning (GLM-5, Cerebras, Groq)
    else if (typeof msg.reasoning === 'string' && msg.reasoning) {
        content.push({ type: 'thinking', thinking: msg.reasoning });
    }
    // Format 3: thinking_blocks (OpenAI o-series)
    else if (Array.isArray(msg.thinking_blocks)) {
        for (const tb of msg.thinking_blocks) {
            if (tb.type === 'thinking' && typeof tb.thinking === 'string') {
                content.push({ type: 'thinking', thinking: tb.thinking, signature: tb.signature });
            }
        }
    }
    // Convert text content
    if (choice.message.content) {
        content.push({ type: 'text', text: choice.message.content });
    }
    // Convert tool calls
    if (choice.message.tool_calls) {
        for (const tc of choice.message.tool_calls) {
            content.push({
                type: 'tool_use',
                id: tc.id,
                name: tc.function.name,
                input: parseOpenAIToolArguments(tc.function.arguments),
            });
        }
    }
    // If no content at all, add empty text
    if (content.length === 0) {
        content.push({ type: 'text', text: '' });
    }
    return {
        id: response.id || `msg_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        content,
        model: response.model || model,
        stop_reason: mapFinishReason(choice.finish_reason),
        stop_sequence: null,
        usage: openaiUsageToAnthropic(response.usage),
    };
}
function mapFinishReason(reason) {
    switch (reason) {
        case 'stop': return 'end_turn';
        case 'tool_calls': return 'tool_use';
        case 'length': return 'max_tokens';
        case 'content_filter': return 'end_turn';
        default: return 'end_turn';
    }
}
function createEmptyResponse(response, model) {
    return {
        id: response.id || `msg_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        model: response.model || model,
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: openaiUsageToAnthropic(response.usage),
    };
}
