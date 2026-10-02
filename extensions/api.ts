export async function fetchUserModels(key: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<unknown[]> {
  const timeout = AbortSignal.timeout(15000);
  const response = await fetcher('https://openrouter.ai/api/v1/models/user', {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`OpenRouter catalog request failed (HTTP ${response.status}).`);
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null || !('data' in body) ||
      !Array.isArray(body.data) || body.data.length > 10000) {
    throw new Error('OpenRouter returned an invalid model catalog.');
  }
  return body.data;
}
