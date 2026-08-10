function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function parseOpenAIToolArguments(value) {
    if (value == null || value === '')
        return {};
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return isRecord(parsed) ? parsed : { raw: parsed };
        }
        catch {
            return { raw: value };
        }
    }
    if (isRecord(value))
        return value;
    return { raw: value };
}
export function stringifyOpenAIToolArguments(value) {
    if (value == null || value === '')
        return '';
    return typeof value === 'string' ? value : JSON.stringify(value);
}
