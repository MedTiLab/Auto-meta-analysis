export const DEFAULT_AZURE_OPENAI_API_VERSION = '2025-04-01-preview';

export function resolveAzureOpenAIEndpoint(baseUrl, apiVersion = DEFAULT_AZURE_OPENAI_API_VERSION) {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/$/, '');
  if (/\/openai\/responses$/i.test(path)) {
    url.pathname = path;
  } else if (/\/openai(?:\/.*)?$/i.test(path)) {
    url.pathname = path.replace(/\/openai(?:\/.*)?$/i, '/openai/responses');
  } else {
    url.pathname = `${path}/openai/responses`;
  }
  if (!url.searchParams.has('api-version')) url.searchParams.set('api-version', apiVersion);
  return url.toString();
}
