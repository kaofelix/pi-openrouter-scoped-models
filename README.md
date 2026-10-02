# pi-openrouter-models-local

A small Pi extension for the **authenticated, user-scoped OpenRouter chat-model list**. It implements the model-catalog part of [Rob Howley's pi-openrouter](https://github.com/robhowley/pi-userland/tree/main/packages/pi-openrouter) without account analytics, API key creation/toggling, usage/session hooks, or any `OPENROUTER_MANAGEMENT_KEY` support.

## How it works

1. `/openrouter-models sync` sends `GET https://openrouter.ai/api/v1/models/user` with `Authorization: Bearer $OPENROUTER_API_KEY`. It does not use the public `/models` list or an SDK.
2. It maps text-capable catalog entries to Pi's OpenRouter provider, including context/output limits, text/image input capability, reasoning flag, and **per-million-token** prices. Entries without valid pricing or context limits are skipped. It also adds the `openrouter/free` route (the user endpoint does not list router aliases). It deliberately does **not** add `openrouter/auto`, whose variable price cannot honestly be represented by a zero-cost model.
3. Pi's `registerProvider('openrouter', { models: ... })` **replaces** the provider's chat-model list. A successful refresh saves the raw model list under `~/.pi/openrouter-models/models-cache.json`; on the next startup, that cached list registers without a network request. The cache is keyed by a SHA-256 fingerprint of the API key, contains no API key, and is written with private file permissions.
4. A failed refresh falls back to the last cached catalog. `sync --free` filters both live results and any fallback cache to explicit `:free` models with zero published input/output price, plus `openrouter/free`. If there is no usable fallback, it registers only the free router rather than leaving paid models active. **This is not a financial guarantee:** enforce real spending limits on the OpenRouter API key.

## Run locally

Requires Pi with `@earendil-works/pi-coding-agent` and Node.js 22.19+ (the test suite uses Node 24). Set a normal inference API key in the environment of the Pi process:

```sh
export OPENROUTER_API_KEY='sk-or-...'
pi --extension ./extensions/index.ts
```

Or install this local package into Pi's package settings from this directory:

```sh
pi install .
```

Do not install the original `@robhowley/pi-openrouter` alongside this extension: both register the `openrouter` provider and their catalogs could overwrite each other. No management key is needed or read. The same `OPENROUTER_API_KEY` is used by Pi to make model calls; this extension does not store it.

In Pi:

```text
/openrouter-models sync          # refresh your full user-scoped catalog
/openrouter-models sync --free   # only explicit free models + free router
/openrouter-models status        # active count, mode, source, and cache age
```

Without a configured API key, the extension does not load the cache or replace Pi's built-in catalog. On first install, run `sync` once to populate the cache. To refresh on demand, run it again; there is no periodic background polling. If you change API keys, refresh with the new key to populate its own cache. The old cache is ignored. The cache can be removed by deleting `~/.pi/openrouter-models/models-cache.json`.

Only chat/text-output models are mapped. Non-text models, model field overrides, built-in thinking-level maps, analytics, and account administration are outside this focused version. The account's user list determines which models are offered; it does not guarantee a model will accept every prompt or remain available. Prices are catalog estimates, not a spending limit.

## Development

```sh
npm install
npm test
npm run typecheck
```

Tests use mocked HTTP and file-backed cache fixtures; they do not contact OpenRouter. `PI_OPENROUTER_MODELS_CACHE_DIR` can redirect the cache for isolated testing. The original package is MIT licensed; its attribution is retained in [LICENSE](LICENSE).
