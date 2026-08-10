/**
 * Strip the dynamic Claude Code billing attribution line before forwarding
 * prompts to OpenAI-compatible providers. Derived from cc-switch.
 */
const CLAUDE_CODE_BILLING_HEADER_PREFIX = 'x-anthropic-billing-header:';

export function stripLeadingBillingHeader(text) {
  if (!text.startsWith(CLAUDE_CODE_BILLING_HEADER_PREFIX)) return text;

  const lineEnd = text.search(/[\r\n]/);
  if (lineEnd === -1) return '';

  let restStart = lineEnd + 1;
  if (text[lineEnd] === '\r' && text[restStart] === '\n') restStart += 1;

  const rest = text.slice(restStart);
  if (rest.startsWith('\r\n')) return rest.slice(2);
  if (rest.startsWith('\n') || rest.startsWith('\r')) return rest.slice(1);
  return rest;
}
