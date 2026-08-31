# Design decisions

The brief left four things open. This records what was chosen, why, and — where
it mattered — what was verified against the live NVIDIA NIM API rather than
assumed.

## 1. Key rotation strategy: round-robin with failover

**Chosen:** round-robin cursor + automatic failover on `429`/`5xx`/network error,
with a short per-key cooldown.

Implementation lives in [`src/lib/nvidia/keys.ts`](src/lib/nvidia/keys.ts) and
[`src/lib/nvidia/upstream.ts`](src/lib/nvidia/upstream.ts).

- A module-level cursor advances once per request, so request *N* starts on key
  *N mod poolSize*. Load is spread evenly instead of hammering key 1 until it
  429s.
- Each request receives the **whole pool** in rotated order, not just one key.
  If the first key returns 429 or 5xx, the request transparently retries on the
  next key. The caller sees one successful response; the `X-Nvidia-Attempts`
  header reports how many keys it took.
- A key that 429s is benched for 30s; one that 5xx's or fails at the socket is
  benched for 10s. Benched keys are moved to the *back* of the order rather than
  removed, so if every key is cooling down a request can still get through
  instead of failing artificially.
- Non-retriable `4xx` (bad model, malformed body) returns immediately without
  burning the rest of the pool — those will fail identically on every key.

**Why not least-recently-used:** LRU and round-robin are equivalent when all
requests cost roughly the same, and round-robin needs no timestamp bookkeeping.
**Why not failover-only (key 1 until it dies):** it concentrates load and makes
you discover the rate limit on every single burst instead of avoiding it.

### What the client sees when all keys are exhausted

An OpenAI-shaped error envelope with HTTP `429`:

```json
{"error":{"message":"All 6 configured NVIDIA API key(s) are currently rate limited. Retry shortly or add more keys.","type":"rate_limit_error","param":null,"code":"all_keys_exhausted"}}
```

Other terminal states: `504` + `upstream_timeout` when no key answered in time,
`500` + `no_keys_configured` when the env is empty, and `502` + `upstream_failure`
for anything else. Error messages are constructed from upstream text but are
never allowed to carry key material.

## 2. Key storage: server-only environment variables

Keys are read in [`keys.ts`](src/lib/nvidia/keys.ts) from three accepted forms:

| Form | Example |
| --- | --- |
| Comma-separated (preferred) | `NVIDIA_API_KEYS="nvapi-a,nvapi-b"` |
| Indexed (scanned `_1`…`_64`) | `NVIDIA_API_KEY_1=…` `NVIDIA_API_KEY_2=…` |
| Single | `NVIDIA_API_KEY=…` |

All three are pooled together and de-duplicated. The indexed form is supported
because this repo's existing `.env` already used it.

**None of these are `NEXT_PUBLIC_`-prefixed**, so Next.js never inlines them into
the client bundle. The secret lives only inside the `keys.ts` module closure —
no exported function returns it, and the only public identifier for a key is a
synthetic slot id (`key_1`, `key_2`, …) that contains no key material. The
browser learns *which slot* served a request via the `X-Nvidia-Key-Id` header,
which is deliberately not sensitive.

`GET /v1/keys` exposes masked pool telemetry (counters and cooldown state only)
so rotation is observable from the UI without revealing anything secret.

## 3. `reasoning_effort` — verified per model, never clamped

The gateway accepts whatever levels the **named model** actually implements, and
returns a `400` for anything else. It never substitutes a nearby level, so a
successful request used exactly the effort asked for.

| Model | Verified levels | Thinking off |
| --- | --- | --- |
| `moonshotai/kimi-k3` | `none, low, high, max` | yes |
| `nvidia/nemotron-3-*` (nano, super, ultra) | `none, minimal, low, medium, high, xhigh, max` | yes |
| `deepseek-ai/deepseek-v4-*` | `none, low, high, max` (`high` inferred) | yes |
| `openai/gpt-oss-*` | `low, medium, high` | **no** |

### The trap this went through

The first version of this gateway derived the vocabulary by sending an invalid
value and reading the accepted enumeration out of NIM's error. **That method is
wrong.** NIM's request deserializer accepts all seven values for every model, so
that error reports the shared request-schema enum, not what the model
implements. It made every model look like it supported all seven.

The model backend rejects unsupported levels *separately, at inference time*:

```
Unsupported Kimi K3 thinking_effort="medium"; supported values are low, high, and max
```

The table above was therefore rebuilt by sending each of the seven values to
each model and recording which returned `200`.
`scripts/verify-model-capabilities.mjs` automates this and flags any drift.

An earlier design clamped `max` → `high` for gpt-oss. That is gone: clamping
silently gives you different behaviour than you asked for, so unsupported levels
are now a `400` naming the model's real options.

## 3b. Thinking on/off

`reasoning_effort: "none"` is the canonical off switch, and `thinking: false` is
a convenience flag that maps to it. Verified real, not cosmetic: with `none` the
model returns `reasoning_content: null`, answers directly, and time-to-first-token
dropped from ~3,100 ms to ~774 ms on the same prompt.

`gpt-oss` has no `none` level, so `thinking: false` there is a `400`
(`thinking_not_disableable`) rather than a silently ignored flag. Contradictory
combinations (`thinking: false` with `reasoning_effort: "high"`) are also `400`.

## 4. `max_tokens` policy: clamp, don't reject

The ceiling is **120,000** (`MAX_OUTPUT_TOKENS` in
[`validate.ts`](src/lib/nvidia/validate.ts)) and it is also the default when the
caller omits the field. A request for more is **clamped rather than rejected**,
matching how OpenAI treats an over-large `max_tokens`; rejecting would break
drop-in compatibility for clients that send a large default. Only a
structurally invalid value (zero, negative, non-numeric) is a `400`.
`max_completion_tokens` is accepted as an alias. The effective value is echoed
in `X-Nvidia-Max-Tokens`.

Note that NVIDIA does not itself enforce this ceiling — `max_tokens: 500000` is
accepted upstream — so the 120k cap is this gateway's own policy.

## 5. Model catalog: verified-callable only

[`models.ts`](src/lib/nvidia/models.ts) is a curated list, not a passthrough of
upstream's 83 models. Every entry was confirmed to both appear in NIM's
`/v1/models` *and* return a real 200 completion. Models that upstream advertises
but that are not actually callable are excluded — notably
`moonshotai/kimi-k2.6` (404 for these accounts) and `meta/llama-3.3-70b-instruct`
(410, reached end-of-life 2026-08-26).

**Kimi K3 is served by NVIDIA NIM**, confirmed as `moonshotai/kimi-k3` in the
upstream model list — no separate provider or routing is involved, so the
"NVIDIA only" scope holds.

## 6. Token counting: upstream `usage` is the source of truth

The console shows exact counts from the response `usage` object, which comes
from each model's own tokenizer. Because streaming only delivers `usage` in the
final frame, a local tokenizer (`gpt-tokenizer`, o200k_base) drives a live
counter during generation, and the UI labels which is which — "estimated" while
streaming, "exact (usage)" once it lands.

The local tokenizer is deliberately **not** presented as authoritative. Kimi,
DeepSeek, Nemotron and GPT-OSS all ship different vocabularies, and shipping
four multi-megabyte tokenizers to the browser to approximate a number the API
already returns exactly is not a good trade. Throughput is computed from the
exact count divided by the measured generation window (first token → last token),
so it reflects decode speed rather than including queueing and cold start, which
are reported separately as time-to-first-token.

## 7. Known gaps

- **DeepSeek: six of seven levels confirmed on V4 Flash.** Accepted: `none`,
  `low`, `max`. Rejected: `minimal`, `medium`, `xhigh` — precisely the three
  Kimi rejects. Only `high` is unconfirmed (that single value timed out); it is
  included because the other six results pin the vocabulary to the same coarse
  `none/low/high/max` shape. V4 Pro is reachable but extremely slow: it returned
  one definitive result (`minimal` rejected, matching Flash) after several
  minutes, and inherits the remainder by family. If `high` ever 400s, drop it
  from DEEPSEEK_EFFORTS. Re-run
  `node scripts/verify-model-capabilities.mjs` when the endpoints recover.
- **Context windows come from model cards.** NVIDIA's `/v1/models` returns only
  `{id, object, created, owned_by}`, so context sizes are not verifiable against
  the live service. Modality was checked by sending an image part; every model
  in the catalog is text-only.
