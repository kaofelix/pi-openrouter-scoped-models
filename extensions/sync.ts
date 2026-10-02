import { mapCatalog, type CatalogMode, type ModelConfig } from './catalog.ts';

export interface CatalogCache {
  version: 1;
  mode: CatalogMode;
  timestamp: number;
  models: unknown[];
}
export interface SyncOptions {
  mode: CatalogMode;
  fetchModels(): Promise<unknown[]>;
  readCache(): Promise<CatalogCache | null>;
  writeCache(cache: CatalogCache): Promise<void>;
  register(models: ModelConfig[]): void;
}
export interface SyncResult {
  source: 'api' | 'cache' | 'none';
  mode: CatalogMode;
  count: number;
  skipped: number;
  error?: string;
  timestamp?: number;
}
export async function syncModels(options: SyncOptions): Promise<SyncResult> {
  try {
    const raw = await options.fetchModels();
    if (!Array.isArray(raw) || raw.length === 0) throw new Error('Empty model catalog');
    const { models, skipped } = mapCatalog(raw, options.mode);
    if (options.mode === 'full' && models.length <= 1) throw new Error('No usable models');
    options.register(models);
    let error: string | undefined;
    try {
      await options.writeCache({ version: 1, mode: options.mode, timestamp: Date.now(), models: raw });
    } catch {
      error = 'Catalog registered, but its cache could not be saved.';
    }
    return { source: 'api', mode: options.mode, count: models.length, skipped, ...(error ? { error } : {}) };
  } catch {
    let cached: CatalogCache | null = null;
    try { cached = await options.readCache(); } catch { /* Invalid cache is not trusted. */ }
    if (cached && cached.version === 1 && Array.isArray(cached.models) && cached.models.length > 0) {
      // A free-only request MUST NOT resurrect paid models from a full cache.
      const mode = options.mode === 'free-only' ? 'free-only' : cached.mode;
      const { models, skipped } = mapCatalog(cached.models, mode);
      if (mode === 'free-only' || models.length > 1) {
        options.register(models);
        return { source: 'cache', mode, count: models.length, skipped,
          timestamp: cached.timestamp, error: 'Refresh failed; using a cached model catalog.' };
      }
    }
    if (options.mode === 'free-only') {
      // Replace an in-memory paid catalog even if the network and cache are unavailable.
      const { models } = mapCatalog([], 'free-only');
      options.register(models);
      return { source: 'none', mode: 'free-only', count: models.length, skipped: 0,
        error: 'Refresh failed; only the free router is available.' };
    }
    return { source: 'none', mode: options.mode, count: 0, skipped: 0,
      error: 'Refresh failed; no cached catalog is available.' };
  }
}
