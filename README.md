# pi-openrouter-scoped-models

Keep Pi's OpenRouter model list in sync with your own account — automatically,
in the background, with only your normal inference API key. No management key,
no analytics, and no account administration.

## What you get

- **Your account's real catalog.** Fetches the authenticated, user-scoped list
  (`GET /api/v1/models/user`), not the public `/models` list and not an SDK.
- **Fresh without the wait.** Registers the cached catalog instantly at startup,
  then refreshes in the background when the cache is older than 30 minutes.
- **Offline-safe.** A failed refresh keeps the last good catalog; the cache is
  keyed to your API key, stores no key, and is written with private permissions.
- **Optional free-only mode.** `sync --free` limits the catalog to explicit
  `:free` models plus the `openrouter/free` router, and stays free-only across
  restarts.

## Install

Requires Pi with `@earendil-works/pi-coding-agent` and Node.js 22.19+ (the test
suite uses Node 24). Set your normal inference key in the Pi process environment:

```sh
export OPENROUTER_API_KEY='sk-or-...'
pi --extension ./extensions/index.ts
```

Or install this local package into Pi's settings from this directory:

```sh
pi install .
```

Do not install the original `@robhowley/pi-openrouter` alongside this extension:
both register the `openrouter` provider and their catalogs can overwrite each
other. No management key is needed or read, and the same `OPENROUTER_API_KEY` is
used by Pi for model calls; this extension never stores it.

## Use

```text
/openrouter-models sync          # refresh your full user-scoped catalog
/openrouter-models sync --free   # only explicit free models + free router
/openrouter-models status        # active count, mode, source, and cache age
```

Without a configured API key, the extension does not load the cache or replace
Pi's built-in catalog. On first install the startup sync populates the cache
automatically; `sync` always forces a refresh. Rapid restarts do not re-fetch
while the cache is younger than 30 minutes. After changing API keys, the next
startup (or a manual `sync`) populates that key's own cache and the old cache is
ignored. Delete `~/.pi/openrouter-models/models-cache.json` to clear it.

## How it works

1. **Sync.** `sync` sends `GET https://openrouter.ai/api/v1/models/user` with
   `Authorization: Bearer $OPENROUTER_API_KEY`.
2. **Map.** Text-capable entries become Pi models with context/output limits,
   text/image input, a reasoning flag, and **per-million-token** prices. Entries
   without valid pricing or context limits are skipped. The `openrouter/free`
   router is added because the user endpoint omits router aliases;
   `openrouter/auto` is deliberately excluded because its variable price cannot
   honestly be shown as zero-cost.
3. **Register and cache.** `registerProvider('openrouter', { models })` replaces
   the provider's chat-model list. A successful refresh writes the raw list to
   `~/.pi/openrouter-models/models-cache.json`, keyed by a SHA-256 fingerprint of
   the API key.
4. **Refresh on startup.** When the cache is older than 30 minutes, the extension
   refreshes in the background at process startup; the cached catalog stays
   active until the fresh one is ready, so startup never waits on the network.
   The refresh reuses the last sync mode, non-startup session events (`reload`,
   `new`, `resume`, `fork`) do not refetch, and a manual `sync` supersedes any
   in-flight refresh.
5. **Fail safe.** A failed refresh falls back to the last cached catalog. In
   free-only mode, both live results and fallback cache are filtered to explicit
   `:free` models with zero published input/output price plus `openrouter/free`;
   with no usable fallback, only the free router is registered rather than
   leaving paid models active.

## Limits and safety

- Only chat/text-output models are mapped. Non-text models, model field
  overrides, built-in thinking-level maps, analytics, and account administration
  are out of scope.
- Your account's user list decides which models are offered; it does not
  guarantee a model accepts every prompt or stays available.
- Prices are catalog estimates, not a spending limit. **Free-only mode is not a
  financial guarantee — enforce real spending limits on the OpenRouter API key.**

## Development

```sh
npm install
npm test
npm run typecheck
```

Tests use mocked HTTP and file-backed cache fixtures; they do not contact
OpenRouter. `PI_OPENROUTER_MODELS_CACHE_DIR` redirects the cache for isolated
testing. The original package is MIT licensed; its attribution is retained in
[LICENSE](LICENSE).
