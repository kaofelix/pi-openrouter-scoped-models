import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CatalogCache } from './sync.ts';

const filename = 'models-cache.json';

function fingerprint(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export async function readCatalogCache(directory: string, key: string): Promise<CatalogCache | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(directory, filename), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const cache = parsed as Record<string, unknown>;
    if (cache.keyFingerprint !== fingerprint(key) || cache.version !== 1 ||
        !['full', 'free-only'].includes(String(cache.mode)) ||
        typeof cache.timestamp !== 'number' || !Number.isFinite(cache.timestamp) ||
        cache.timestamp > Date.now() + 300000 || !Array.isArray(cache.models) ||
        cache.models.length > 10000) return null;
    return { version: 1, mode: cache.mode as CatalogCache['mode'],
      timestamp: cache.timestamp, models: cache.models };
  } catch { return null; }
}

export async function writeCatalogCache(directory: string, key: string, cache: CatalogCache): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = join(directory, filename);
  const temporary = join(directory, `.models-cache-${process.pid}-${crypto.randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify({ ...cache, keyFingerprint: fingerprint(key) }),
      { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
