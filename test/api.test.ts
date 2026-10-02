import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchUserModels } from '../extensions/api.ts';

test('uses the authenticated user-scoped catalog endpoint, not the public model list', async () => {
  let url = '';
  let authorization = '';
  const models = [{ id: 'vendor/chat' }];
  const result = await fetchUserModels('user-key', undefined, async (input, init) => {
    url = String(input);
    authorization = new Headers(init?.headers).get('Authorization') ?? '';
    return new Response(JSON.stringify({ data: models }), { status: 200 });
  });
  assert.equal(url, 'https://openrouter.ai/api/v1/models/user');
  assert.equal(authorization, 'Bearer user-key');
  assert.deepEqual(result, models);
});
