# Unified NVIDIA API <img src="/public/nvidia-color.svg" alt="NVIDIA logo" height="22">

An OpenAI-compatible chat completions gateway in front of [NVIDIA NIM](https://build.nvidia.com),
with automatic rotation across multiple API keys, Kimi K3 in the model list,
`reasoning_effort` control, tool calling, and a browser console for manual testing.

## Getting started

```bash
pnpm install
cp .env.example .env   # then fill in your NVIDIA keys
pnpm dev
```

Open http://localhost:3000 for the test console, or point any OpenAI client at
`http://localhost:3000/v1`.

## Use it as a drop-in OpenAI endpoint

Only the `baseURL` changes. The gateway does not require its own auth, so
`apiKey` can be any non-empty placeholder — the real NVIDIA keys stay server-side.

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:3000/v1",
  apiKey: "not-required",
});

const completion = await client.chat.completions.create({
  model: "moonshotai/kimi-k3",
  messages: [{ role: "user", content: "Hello!" }],
  max_tokens: 4096,
  reasoning_effort: "max",   // "low" | "high" | "max"
});
```

Streaming works the same way with `stream: true` (server-sent events).

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/v1/chat/completions` | OpenAI-compatible completions, streaming and non-streaming |
| `GET` | `/v1/models` | Model list, including `moonshotai/kimi-k3` |
| `GET` | `/v1/keys` | Masked key-pool telemetry (no key material) |
| `GET` | `/` | Browser test console |
| `GET` | `/docs` | Rendered, copyable integration guide for AI assistants |

Every completion response carries diagnostic headers: `X-Nvidia-Key-Id` (which
key slot served it), `X-Nvidia-Attempts` (how many keys were tried),
`X-Nvidia-Max-Tokens`, `X-Thinking`, and `X-Reasoning-Effort` /
`X-Reasoning-Effort-Upstream`.

## Key rotation

Configure any number of keys; every one joins the pool. This is also how you
add capacity later — there is no in-app "add a key" control, since a
serverless deployment (e.g. Vercel) has no durable place to store one that an
API route could write to. Add the key to your env config and redeploy:

```bash
NVIDIA_API_KEYS="nvapi-aaa,nvapi-bbb,nvapi-ccc"
```

or, numbered one per variable (either form works, and both can be combined):

```bash
NVIDIA_API_KEY_1="nvapi-aaa"
NVIDIA_API_KEY_2="nvapi-bbb"
```

Requests are distributed **round-robin** — a cursor advances once per request so
consecutive calls start on different keys, spreading load instead of exhausting
one key at a time. Each request also carries the rest of the pool as failover:
if a key returns `429` or `5xx`, the request **transparently retries on the next
key** and the caller still sees one clean response. A rate-limited key is benched
for 30s (10s for server/network errors) so it stops receiving traffic while it
recovers, and one dead key cannot take down the endpoint.

When every key is genuinely exhausted the caller gets an OpenAI-shaped `429`
with `code: "all_keys_exhausted"`.

You can watch this live in the test console's key-pool panel, or via `GET /v1/keys`.

## Reasoning effort and thinking

Each model exposes its **own** set of `reasoning_effort` levels — they are not
interchangeable, and the gateway rejects a level the named model does not
implement rather than quietly substituting one:

| Model | Levels | Thinking off |
| --- | --- | --- |
| `moonshotai/kimi-k3` | `none, low, high, max` | yes |
| `nvidia/nemotron-3-*` | `none, minimal, low, medium, high, xhigh, max` | yes |
| `deepseek-ai/deepseek-v4-*` | `none, low, high, max` (`high` inferred) | yes |
| `openai/gpt-oss-*` | `low, medium, high` | no |

Turn thinking off with either `"reasoning_effort": "none"` or the convenience
flag `"thinking": false`. It is a real switch, not a label: the response comes
back with `reasoning_content: null` and time-to-first-token dropped from
~3,100 ms to ~774 ms on an identical prompt.

Query `GET /v1/models` for the authoritative per-model capability data
(`reasoning_efforts`, `can_disable_thinking`, `modalities`, `context_window`),
and see [AI_API_GUIDE.md](AI_API_GUIDE.md) for the full integration reference —
that file is written to be pasted straight into an AI assistant's context, and
is also served at `/docs` with a copy button.

## Test console

`/` is a full manual test console: model picker with provider icons, a thinking
toggle, per-model reasoning-effort picker, an editable `tools` field for
exercising function calling, editable system prompt, and a markdown-rendered,
streamed response with the reasoning trace and any tool calls shown
separately. Live stats show exact token counts from `usage`, tokens/sec, and
time to first token.

## Limits

`max_tokens` is capped at **120,000** and defaults to that when omitted. Larger
requests are clamped rather than rejected, matching OpenAI's behaviour.
`max_completion_tokens` is accepted as an alias.

## Security

API keys are read only from server-side env vars (never `NEXT_PUBLIC_`-prefixed),
are never returned by any endpoint, and do not appear in the client bundle. The
browser only ever sees the synthetic slot id (`key_1`, `key_2`, …).

## Development

```bash
pnpm test    # vitest — rotation, failover, and validation unit tests
pnpm lint    # biome
pnpm build   # production build
```

Two end-to-end checks run against a live server (`pnpm start` first):

```bash
node scripts/verify-openai-compat.mjs
```

```bash
node scripts/verify-model-capabilities.mjs
```

The first drives the official `openai` SDK against the gateway. The second
re-derives every model's real `reasoning_effort` support and flags anything that
disagrees with the catalog — run it after NVIDIA changes a model, and note the
warning inside it about why NIM's own validation errors cannot be trusted here.
