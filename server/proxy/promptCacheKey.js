/**
 * Resolve a stable OpenAI Responses prompt cache key from Claude session data.
 *
 * The key must remain stable for one conversation. A generated UUID or an
 * OpenAI response id would rotate on every turn and defeat prompt caching.
 */

const SESSION_MARKER = '_session_';

export function resolvePromptCacheKey(body, headerSessionId = null) {
  const userId = body?.metadata?.user_id;
  if (typeof userId === 'string') {
    const markerIndex = userId.indexOf(SESSION_MARKER);
    if (markerIndex !== -1) {
      const sessionId = userId.slice(markerIndex + SESSION_MARKER.length);
      if (sessionId) return sessionId;
    }
  }

  const metadataSessionId = body?.metadata?.session_id;
  if (typeof metadataSessionId === 'string' && metadataSessionId) {
    return metadataSessionId;
  }

  const trimmedHeader = headerSessionId?.trim();
  return trimmedHeader || undefined;
}
