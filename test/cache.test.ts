import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCatalogCache, writeCatalogCache } from '../extensions/cache.ts';

test('cache is private, excludes the API key, and is not reused for another key', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openrouter-models-'));
  const cache = { version: 1 as const, mode: 'full' as const, timestamp: Date.now(), models: [{ id: 'vendor/model' }] };
  await writeCatalogCache(directory, 'secret-one', cache);
  assert.deepEqual(await readCatalogCache(directory, 'secret-one'), cache);
  assert.equal(await readCatalogCache(directory, 'secret-two'), null);
  assert.ok(!(await readFile(join(directory, 'models-cache.json'), 'utf8')).includes('secret-one'));
  assert.equal((await stat(join(directory, 'models-cache.json'))).mode & 0o077, 0);
});
