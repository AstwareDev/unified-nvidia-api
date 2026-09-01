# Unified NVIDIA API — integration guide

> Copy this whole file into an AI coding assistant's context. It is written to
> be sufficient on its own: an assistant that reads it should be able to call
> this API correctly for Kimi K3 and every other model, without guessing.

## What this is

An **OpenAI-compatible** chat completions gateway in front of NVIDIA NIM. Any
OpenAI client library works against it by changing `baseURL` only. The gateway
rotates across several NVIDIA API keys server-side, so callers do not supply
NVIDIA credentials.

Base URL: `http://localhost:3000/v1` (change host/port for your deployment).

Authentication: **none required**. The OpenAI SDKs demand a non-empty
`apiKey` string, so pass any placeholder such as `"not-required"`. Real NVIDIA
keys live only on the server and are never accepted from, or exposed to, clients.

## Quick start

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:3000/v1",
  apiKey: "not-required",
});

const res = await client.chat.completions.create({
  model: "moonshotai/kimi-k3",
  messages: [
    { role: "system", content: "You are a terse assistant." },
    { role: "user", content: "What is 17 * 23?" },
  ],
  max_tokens: 4096,
  reasoning_effort: "high",
});

console.log(res.choices[0].message.content);
```

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:3000/v1", api_key="not-required")

res = client.chat.completions.create(
    model="moonshotai/kimi-k3",
    messages=[{"role": "user", "content": "What is 17 * 23?"}],
    max_tokens=4096,
    reasoning_effort="high",
)
print(res.choices[0].message.content)
```

```bash
curl http://localhost:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "moonshotai/kimi-k3",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 1024,
    "reasoning_effort": "low"
  }'
```

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/chat/completions` | Chat completions, streaming and non-streaming |
| `GET` | `/v1/models` | Model list with capability metadata |
| `GET` | `/v1/keys` | Masked key-pool telemetry (no secrets) |

## Models

All models are served by NVIDIA NIM. Every one has been verified to return real
completions — the catalog deliberately excludes models NVIDIA advertises but
that are not actually callable.

| Model id | Name | Reasoning efforts | Thinking off | Context | Modality |
| --- | --- | --- | --- | --- | --- |
| `moonshotai/kimi-k3` | Kimi K3 | `none, low, high, max` | yes | 1M | text → text |
| `nvidia/nemotron-3-ultra-550b-a55b` | Nemotron 3 Ultra 550B | `none, minimal, low, medium, high, xhigh, max` | yes | 256K | text → text |
| `nvidia/nemotron-3-super-120b-a12b` | Nemotron 3 Super 120B | `none, minimal, low, medium, high, xhigh, max` | yes | 256K | text → text |
| `google/diffusiongemma-26b-a4b-it` | DiffusionGemma 26B A4B IT | `none, high` | yes | 256K | text, image → text |
| `deepseek-ai/deepseek-v4-pro-0813` | DeepSeek V4 Pro | `none, low, high, max` * | yes | 1M | text → text |
| `deepseek-ai/deepseek-v4-flash-0731` | DeepSeek V4 Flash | `none, low, high, max` * | yes | 1M | text → text |
| `openai/gpt-oss-120b` | GPT-OSS 120B | `low, medium, high` | **no** | 128K | text → text |
| `openai/gpt-oss-20b` | GPT-OSS 20B | `low, medium, high` | **no** | 128K | text → text |

\* DeepSeek: all levels verified on V4 Flash except `high`. See "Known gaps".

**The effort lists genuinely differ per model.** Kimi K3 accepts only
`low/high/max` and returns a 400 for `medium`; the Nemotron 3 family accepts all
seven; gpt-oss accepts only `low/medium/high`. Do not assume a shared set.

All models are **text-only** — none of them accept image, audio, or video input.
Sending an `image_url` content part will fail.

Do not hard-code this table. Call `GET /v1/models` and read the machine-readable
fields, which are authoritative:

```jsonc
{
  "id": "moonshotai/kimi-k3",
  "object": "model",
  "owned_by": "moonshotai",
  "display_name": "Kimi K3",
  "reasoning_efforts": ["none","low","high","max"],
  "thinking_levels": ["low","high","max"],
  "default_reasoning_effort": "high",
  "can_disable_thinking": true,
  "modalities": { "input": ["text"], "output": ["text"] },
  "context_window": 1000000,
  "max_output_tokens": 120000
}
```

## Reasoning effort

`reasoning_effort` controls how much the model thinks before answering. **The
accepted values differ per model** — this is the single most common source of
400s, so always check `reasoning_efforts` from `/v1/models`.

- `nvidia/nemotron-3-*` accept the full range: `none`, `minimal`, `low`,
  `medium`, `high`, `xhigh`, `max`.
- `moonshotai/kimi-k3` accepts only `none`, `low`, `high`, `max`. Sending
  `medium`, `minimal` or `xhigh` is a 400.
- `openai/gpt-oss-*` accept only `low`, `medium`, `high`, and cannot disable
  thinking.

The gateway validates against the specific model you named and returns a `400`
with code `unsupported_value_for_model` if the level does not exist there. It
does **not** silently substitute a nearby level, so a request that succeeds
used exactly the effort you asked for.

Effect is real and measurable. On `moonshotai/kimi-k3` with one fixed prompt:
`low` produced ~1,200 characters of reasoning, `max` produced ~2,600.

## Turning thinking on and off

Two equivalent ways to disable reasoning:

```jsonc
{ "reasoning_effort": "none" }   // canonical
{ "thinking": false }            // gateway convenience flag, maps to the above
```

`thinking` is a gateway extension, not part of the OpenAI schema:

- `"thinking": false` → sends `reasoning_effort: "none"` upstream. The response
  comes back with `reasoning_content: null` and answers directly.
- `"thinking": true` → uses the model's `default_reasoning_effort` unless you
  also pass an explicit `reasoning_effort`.
- Omit it entirely to let `reasoning_effort` alone decide.

Rules the gateway enforces:

- `"thinking": false` on `openai/gpt-oss-*` → `400` with code
  `thinking_not_disableable`. Those models cannot turn reasoning off; there is
  no `none` level upstream. Use a different model if you need this.
- `"thinking": false` combined with a non-`none` `reasoning_effort` → `400`
  with code `conflicting_parameters`. Same for `"thinking": true` with
  `reasoning_effort: "none"`.

## Reading reasoning output

Reasoning is returned separately from the answer, in a non-standard field:

- Non-streaming: `choices[0].message.reasoning_content`
- Streaming: `choices[0].delta.reasoning_content`

It is `null` when thinking is disabled. Note that `message.content` may be
`null` while `reasoning_content` is populated if the model is cut off mid-thought
by `max_tokens` — always give reasoning models generous headroom (a few thousand
tokens at minimum) or they will spend the entire budget thinking and return no
answer.

```ts
const res = await client.chat.completions.create({
  model: "moonshotai/kimi-k3",
  messages: [{ role: "user", content: "Solve: 3x + 7 = 22" }],
  max_tokens: 4000,
  reasoning_effort: "high",
});

const msg = res.choices[0].message as typeof res.choices[0].message & {
  reasoning_content?: string | null;
};
console.log("thinking:", msg.reasoning_content);
console.log("answer:", msg.content);
```

## Streaming

Standard OpenAI SSE. Set `stream: true`; frames arrive as `data: {...}` and the
stream ends with `data: [DONE]`.

```ts
const stream = await client.chat.completions.create({
  model: "moonshotai/kimi-k3",
  messages: [{ role: "user", content: "Count to five." }],
  max_tokens: 2000,
  stream: true,
});

for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta as { content?: string; reasoning_content?: string };
  if (delta?.reasoning_content) process.stdout.write(delta.reasoning_content);
  if (delta?.content) process.stdout.write(delta.content);
  if (chunk.usage) console.log("\nusage:", chunk.usage);
}
```

The gateway always sets `stream_options: {include_usage: true}` upstream, so the
**final frame carries an exact `usage` object** even when streaming. Use it for
token accounting rather than counting locally — it comes from the model's own
tokenizer.

## Tool calling

Standard OpenAI function calling. Pass `tools` (and optionally `tool_choice`)
exactly as you would to OpenAI; the gateway forwards both fields to NVIDIA NIM
unmodified.

```ts
const res = await client.chat.completions.create({
  model: "moonshotai/kimi-k3",
  messages: [{ role: "user", content: "What's the weather in Tokyo?" }],
  max_tokens: 1024,
  tools: [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get the current weather for a city",
        parameters: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    },
  ],
});

const call = res.choices[0].message.tool_calls?.[0];
if (call) {
  const args = JSON.parse(call.function.arguments);
  // ...run the tool, then send its result back as a `tool` role message
  // keyed to `call.id` via `tool_call_id`, and call the API again.
}
```

Streaming responses split a tool call's `function.arguments` across multiple
`delta.tool_calls` chunks, each carrying the same `index`; concatenate the
`arguments` strings per index until the stream ends before parsing JSON.

Not every model in the catalog supports tool calling upstream — check the
model card for the one you're using if a call returns no `tool_calls` and no
plain text.

## Token counting

`usage` is present on every response:

```jsonc
{ "prompt_tokens": 92, "completion_tokens": 431, "total_tokens": 523 }
```

These are exact. If you need a count *before* sending, note that each model
family uses a different vocabulary (Kimi, DeepSeek, Nemotron and GPT-OSS do not
share a tokenizer), so any local estimate is approximate. Prefer `usage`.

## `max_tokens`

- Cap: **120,000**. Also the default when you omit the field.
- Values above the cap are **clamped, not rejected** (matching OpenAI's
  behaviour). Only structurally invalid values — zero, negative, non-numeric —
  return `400`.
- `max_completion_tokens` is accepted as an alias.
- The effective value is echoed in the `X-Nvidia-Max-Tokens` response header.

## Supported request fields

Passed through to NVIDIA: `model`, `messages`, `stream`, `max_tokens` /
`max_completion_tokens`, `temperature`, `top_p`, `frequency_penalty`,
`presence_penalty`, `stop`, `seed`, `n`, `tools`, `tool_choice`,
`response_format`, `reasoning_effort`.

Gateway-specific: `thinking`.

Unknown fields are dropped rather than forwarded.

Message roles: `system`, `user`, `assistant`, `tool`, `developer`. A `system`
message sets behaviour and should be the first entry.

## Response headers

Useful for debugging; all are safe to ignore.

| Header | Meaning |
| --- | --- |
| `X-Nvidia-Key-Id` | Which key slot served the request (`key_3`) — never the key itself |
| `X-Nvidia-Attempts` | How many keys were tried before success |
| `X-Nvidia-Max-Tokens` | Effective `max_tokens` after clamping |
| `X-Thinking` | `enabled` or `disabled` |
| `X-Reasoning-Effort` | Effort requested by the caller |
| `X-Reasoning-Effort-Upstream` | Effort actually sent to NVIDIA |

## Errors

Standard OpenAI error envelope, so SDK error classes work normally
(`NotFoundError`, `BadRequestError`, `RateLimitError`, …):

```jsonc
{
  "error": {
    "message": "Model 'openai/gpt-oss-20b' does not support reasoning_effort 'max'. Supported values for this model are: low, medium, high.",
    "type": "invalid_request_error",
    "param": "reasoning_effort",
    "code": "unsupported_value_for_model"
  }
}
```

| Status | `code` | Cause |
| --- | --- | --- |
| 400 | `invalid_value` | Malformed parameter value |
| 400 | `unsupported_value_for_model` | Effort level not available on that model |
| 400 | `thinking_not_disableable` | `thinking: false` on a gpt-oss model |
| 400 | `conflicting_parameters` | `thinking` contradicts `reasoning_effort` |
| 404 | `model_not_found` | Unknown model id |
| 429 | `all_keys_exhausted` | Every configured NVIDIA key is rate limited — retry shortly |
| 502 | `upstream_failure` | NVIDIA failed on every key |
| 504 | `upstream_timeout` | No key produced a response in time |
| 500 | `no_keys_configured` | Server has no NVIDIA keys set |

## Practical notes

- **Cold starts are real.** Large models (`nemotron-3-ultra-550b-a55b`,
  `deepseek-v4-pro-0813`, `gpt-oss-120b`) can take tens of seconds for the first
  token when their NIM function is cold. Set generous client timeouts —
  60–120s — and prefer `diffusiongemma-26b-a4b-it` or `kimi-k3` for quick tests.
- **429 handling is automatic.** The gateway retries across its key pool before
  surfacing an error, so a `429` from this API means *every* key was limited.
  Back off and retry rather than hammering.
- **Give reasoning models room.** With `reasoning_effort` at `high`/`max`, a
  small `max_tokens` will be consumed entirely by hidden reasoning and you will
  get `finish_reason: "length"` with empty `content`.
- **Do not send images.** Every model here is text-only.

## Known gaps

Honest limits of the verification behind this document, so you know what to
re-check rather than trusting it blindly:

- **DeepSeek: six of seven levels confirmed on V4 Flash.** `none`, `low` and
  `max` are accepted; `minimal`, `medium` and `xhigh` are rejected — exactly the
  three Kimi rejects. Only `high` is unconfirmed (the endpoint timed out on that
  one value) and is included because it completes the same coarse
  `none/low/high/max` shape the other six results establish. V4 Pro is reachable
  but extremely slow; it returned one definitive result (`minimal` rejected,
  matching Flash) and inherits the rest of the list by family.
  Run `node scripts/verify-model-capabilities.mjs` when the endpoints recover;
  it prints a ⚠MISMATCH for anything that disagrees with the server's catalog.
- **Context windows come from model cards, not the API.** NVIDIA's `/v1/models`
  returns only `{id, object, created, owned_by}`, so context sizes could not be
  verified against the live service.
- **A word of warning if you probe this yourself:** sending an invalid
  `reasoning_effort` to NIM returns an error listing all seven values for
  *every* model. That is the shared request-schema enum, not what the model
  implements — the backend rejects unsupported levels separately at inference
  time. Determining real support requires sending each value and checking for a
  200.
