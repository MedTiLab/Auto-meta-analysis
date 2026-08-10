export function normalizeOpenAIReasoningEffort(effort) {
    if (effort === 'low' ||
        effort === 'medium' ||
        effort === 'high' ||
        effort === 'xhigh') {
        return effort;
    }
    if (effort === 'max') {
        return 'high';
    }
    return undefined;
}
