"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dropdown } from "@/components/dropdown";
import { Markdown } from "@/components/markdown";
import {
  estimateTokens,
  formatTokensPerSecond,
  tokensPerSecond,
} from "@/lib/tokens";

type Modality = "text" | "image" | "audio" | "video";

type ModelEntry = {
  id: string;
  display_name?: string;
  owned_by: string;
  description?: string;
  reasoning_efforts?: string[];
  thinking_levels?: string[];
  default_reasoning_effort?: string;
  can_disable_thinking?: boolean;
  modalities?: { input: Modality[]; output: Modality[] };
  context_window?: number;
  max_output_tokens?: number;
};

type KeyEntry = {
  id: string;
  requests: number;
  successes: number;
  rate_limits: number;
  available: boolean;
};

type Usage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type Stats = {
  usage: Usage | null;
  estimated: number;
  ttftMs: number | null;
  genMs: number | null;
  totalMs: number | null;
};

const EMPTY_STATS: Stats = {
  usage: null,
  estimated: 0,
  ttftMs: null,
  genMs: null,
  totalMs: null,
};

const PROVIDER_ICONS: Record<
  string,
  { src: string; alt: string; invert?: boolean }
> = {
  moonshotai: { src: "/kimi-color.svg", alt: "Kimi" },
  nvidia: { src: "/nvidia-color.svg", alt: "NVIDIA" },
  "deepseek-ai": { src: "/deepseek-color.svg", alt: "DeepSeek" },
  openai: { src: "/openai.svg", alt: "OpenAI", invert: true },
};

const EFFORT_HINTS: Record<string, string> = {
  minimal: "Barely any reasoning",
  low: "Fastest, shortest reasoning",
  medium: "Balanced",
  high: "Deeper reasoning",
  xhigh: "Very deep reasoning",
  max: "Longest reasoning budget",
};

const DEFAULT_MODEL = "moonshotai/kimi-k3";
const CLIENT_TIMEOUT_MS = 240_000;

export default function Playground() {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [effort, setEffort] = useState("medium");
  const [thinking, setThinking] = useState(true);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [streaming, setStreaming] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState(
    "You are a helpful assistant.",
  );
  const [prompt, setPrompt] = useState(
    "Explain why round-robin key rotation helps with rate limits, in three sentences.",
  );

  const [reasoning, setReasoning] = useState("");
  const [answer, setAnswer] = useState("");
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [tools, setTools] = useState(
    '[\n  {\n    "type": "function",\n    "function": {\n      "name": "get_weather",\n      "description": "Get the current weather for a city",\n      "parameters": {\n        "type": "object",\n        "properties": {\n          "city": { "type": "string" }\n        },\n        "required": ["city"]\n      }\n    }\n  }\n]',
  );
  const [toolsEnabled, setToolsEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [meta, setMeta] = useState<{
    keyId: string | null;
    attempts: string | null;
    upstreamEffort: string | null;
    thinking: string | null;
  } | null>(null);
  const [keys, setKeys] = useState<KeyEntry[]>([]);

  const abortRef = useRef<AbortController | null>(null);

  const selected = useMemo(
    () => models.find((m) => m.id === model),
    [models, model],
  );

  const canDisableThinking = selected?.can_disable_thinking ?? true;
  const levels = useMemo(
    () => selected?.thinking_levels ?? ["low", "medium", "high"],
    [selected],
  );

  const refreshKeys = useCallback(async () => {
    try {
      const res = await fetch("/v1/keys");
      const json = (await res.json()) as { data: KeyEntry[] };
      setKeys(json.data);
    } catch {}
  }, []);

  useEffect(() => {
    fetch("/v1/models")
      .then((r) => r.json())
      .then((j: { data: ModelEntry[] }) => setModels(j.data))
      .catch(() => setError("Could not load the model list from /v1/models."));
    refreshKeys();
  }, [refreshKeys]);

  useEffect(() => {
    if (!selected) return;
    if (!levels.includes(effort)) {
      setEffort(selected.default_reasoning_effort ?? levels[0] ?? "medium");
    }
    if (!canDisableThinking) setThinking(true);
  }, [selected, levels, effort, canDisableThinking]);

  const promptTokenEstimate = useMemo(
    () => estimateTokens(systemPrompt) + estimateTokens(prompt),
    [systemPrompt, prompt],
  );

  function stop() {
    abortRef.current?.abort();
  }

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setAnswer("");
    setReasoning("");
    setToolCalls([]);
    setMeta(null);
    setStats(EMPTY_STATS);

    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    const startedAt = performance.now();

    const messages = [
      ...(systemPrompt.trim()
        ? [{ role: "system" as const, content: systemPrompt }]
        : []),
      { role: "user" as const, content: prompt },
    ];

    let parsedTools: unknown;
    if (toolsEnabled) {
      try {
        parsedTools = JSON.parse(tools);
      } catch {
        setError("Tools field is not valid JSON.");
        setBusy(false);
        return;
      }
    }

    try {
      const res = await fetch("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          stream: streaming,
          thinking,
          ...(thinking ? { reasoning_effort: effort } : {}),
          ...(toolsEnabled ? { tools: parsedTools } : {}),
        }),
      });

      setMeta({
        keyId: res.headers.get("x-nvidia-key-id"),
        attempts: res.headers.get("x-nvidia-attempts"),
        upstreamEffort: res.headers.get("x-reasoning-effort-upstream"),
        thinking: res.headers.get("x-thinking"),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string; code?: string };
        } | null;
        setError(
          body?.error?.message ??
            `Request failed with status ${res.status}.` +
              (res.status === 429
                ? " All configured keys are rate limited."
                : ""),
        );
        return;
      }

      if (!streaming) {
        const json = (await res.json()) as {
          choices: {
            message: {
              content: string | null;
              reasoning_content?: string;
              tool_calls?: ToolCall[];
            };
          }[];
          usage?: Usage;
        };
        const content = json.choices[0]?.message?.content ?? "";
        setAnswer(content);
        setReasoning(json.choices[0]?.message?.reasoning_content ?? "");
        setToolCalls(json.choices[0]?.message?.tool_calls ?? []);
        const total = performance.now() - startedAt;
        setStats({
          usage: json.usage ?? null,
          estimated: estimateTokens(content),
          ttftMs: null,
          genMs: total,
          totalMs: total,
        });
        return;
      }

      await consumeStream(res, {
        startedAt,
        onAnswer: setAnswer,
        onReasoning: setReasoning,
        onToolCalls: setToolCalls,
        onStats: setStats,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setError("Request cancelled or timed out before the model responded.");
      } else {
        setError(
          `Network error: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    } finally {
      clearTimeout(timer);
      abortRef.current = null;
      setBusy(false);
      refreshKeys();
    }
  }

  const completionTokens = stats.usage?.completion_tokens ?? stats.estimated;
  const isExact = stats.usage?.completion_tokens !== undefined;
  const speed = tokensPerSecond(completionTokens, stats.genMs ?? 0);

  return (
    <div className="min-h-full bg-black text-zinc-100 font-sans">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <Image
            src="/nvidia-color.svg"
            alt="NVIDIA"
            width={26}
            height={26}
            priority
            className="size-[26px]"
          />
          <div className="h-6 w-px bg-zinc-700" />
          <h1 className="text-sm font-semibold tracking-tight">
            Unified NVIDIA API
            <span className="ml-2 font-normal text-zinc-500">
              OpenAI-compatible gateway with key rotation
            </span>
          </h1>
          <a
            href="/docs"
            className="ml-auto text-xs text-zinc-500 transition-colors hover:text-[#9ede2b]"
          >
            API docs →
          </a>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-6 py-8 lg:grid-cols-[400px_1fr]">
        <section className="flex flex-col gap-4">
          <Field label="Model">
            <Dropdown
              label="Model"
              value={model}
              onChange={setModel}
              placeholder={
                models.length === 0 ? "Loading models…" : "Select a model"
              }
              disabled={models.length === 0}
              options={models.map((m) => ({
                value: m.id,
                label: m.display_name ?? m.id,
                hint: m.id,
                icon: <ProviderIcon ownedBy={m.owned_by} />,
              }))}
            />
          </Field>

          {selected && <ModelCard model={selected} />}

          <Field label="Thinking">
            <div className="flex items-center gap-3">
              <Toggle
                checked={thinking}
                onChange={setThinking}
                disabled={!canDisableThinking}
                label="Enable thinking"
              />
              <span className="text-sm text-zinc-300">
                {thinking ? "Enabled" : "Disabled"}
              </span>
              {!canDisableThinking && (
                <span className="text-xs text-amber-500">
                  this model cannot turn thinking off
                </span>
              )}
            </div>
          </Field>

          <Field label="Reasoning effort">
            <Dropdown
              label="Reasoning effort"
              value={effort}
              onChange={setEffort}
              disabled={!thinking}
              options={levels.map((level, index) => ({
                value: level,
                label: level.charAt(0).toUpperCase() + level.slice(1),
                hint: EFFORT_HINTS[level] ?? "",
                icon: <EffortIcon rank={index} total={levels.length} />,
              }))}
            />
            {!thinking && (
              <p className="mt-1.5 text-xs text-zinc-500">
                Ignored while thinking is off (sent as reasoning_effort “none”).
              </p>
            )}
          </Field>

          <Field label={`Max tokens (cap 120,000)`}>
            <input
              type="number"
              min={1}
              max={120000}
              value={maxTokens}
              onChange={(e) => setMaxTokens(Number(e.target.value))}
              className="w-full rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-3 py-2.5 text-sm outline-none transition-colors duration-150 hover:border-zinc-600 focus:border-[#76b900] focus:ring-2 focus:ring-[#76b900]/25"
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={streaming}
              onChange={(e) => setStreaming(e.target.checked)}
              className="accent-[#76b900]"
            />
            Stream response (SSE)
          </label>

          <Field label="System prompt">
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={3}
              placeholder="Leave empty to send no system message"
              className="w-full resize-y rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-3 py-2.5 text-sm outline-none transition-colors duration-150 hover:border-zinc-600 focus:border-[#76b900] focus:ring-2 focus:ring-[#76b900]/25"
            />
          </Field>

          <Field label="Prompt">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              className="w-full resize-y rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-3 py-2.5 text-sm outline-none transition-colors duration-150 hover:border-zinc-600 focus:border-[#76b900] focus:ring-2 focus:ring-[#76b900]/25"
            />
            <p className="mt-1.5 text-xs text-zinc-500">
              ~{promptTokenEstimate.toLocaleString()} tokens estimated
              {selected?.context_window
                ? ` · ${selected.context_window.toLocaleString()} context`
                : ""}
            </p>
          </Field>

          <Field label="Tool calling">
            <label className="mb-2 flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={toolsEnabled}
                onChange={(e) => setToolsEnabled(e.target.checked)}
                className="accent-[#76b900]"
              />
              Send `tools` with this request
            </label>
            {toolsEnabled && (
              <textarea
                value={tools}
                onChange={(e) => setTools(e.target.value)}
                rows={8}
                spellCheck={false}
                className="w-full resize-y rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-3 py-2.5 font-mono text-xs outline-none transition-colors duration-150 hover:border-zinc-600 focus:border-[#76b900] focus:ring-2 focus:ring-[#76b900]/25"
              />
            )}
          </Field>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="flex-1 rounded-lg bg-[#76b900] px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-[#86cf00] disabled:opacity-50"
            >
              {busy ? "Generating…" : "Send"}
            </button>
            {busy && (
              <button
                type="button"
                onClick={stop}
                className="rounded-lg border border-zinc-700 px-4 py-2.5 text-sm text-zinc-300 hover:border-zinc-500"
              >
                Stop
              </button>
            )}
          </div>

          <KeyPanel keys={keys} onRefresh={refreshKeys} />
        </section>

        <section className="flex flex-col gap-4">
          {error && (
            <div className="rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-300">
              <strong className="font-semibold">Error:</strong> {error}
            </div>
          )}

          <StatsBar
            stats={stats}
            completionTokens={completionTokens}
            isExact={isExact}
            speed={speed}
            meta={meta}
          />

          {reasoning && (
            <details
              open
              className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950"
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase [&::-webkit-details-marker]:hidden">
                <span className="size-1.5 rounded-full bg-amber-500" />
                Reasoning
                <span className="ml-auto font-normal normal-case text-zinc-600">
                  {reasoning.length.toLocaleString()} chars
                </span>
              </summary>
              <div className="max-h-72 overflow-auto border-t border-zinc-900 px-4 py-3 text-xs leading-relaxed whitespace-pre-wrap text-zinc-500">
                {reasoning}
              </div>
            </details>
          )}

          {toolCalls.length > 0 && (
            <div className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-[#9ede2b] uppercase">
                <span className="size-1.5 rounded-full bg-[#76b900]" />
                Tool calls ({toolCalls.length})
              </div>
              {toolCalls.map((call, i) => (
                <div
                  key={call.id || i}
                  className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3"
                >
                  <div className="mb-1.5 flex items-center gap-2 text-xs">
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[#9ede2b]">
                      {call.function?.name || "…"}
                    </span>
                    <span className="text-zinc-600">{call.id}</span>
                  </div>
                  <pre className="overflow-auto rounded-md bg-black/40 p-2 font-mono text-xs text-zinc-400">
                    {call.function?.arguments || "{}"}
                  </pre>
                </div>
              ))}
            </div>
          )}

          <div className="flex min-h-72 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
            <div className="flex items-center gap-2 border-b border-zinc-900 px-4 py-2.5">
              <span
                className={`size-1.5 rounded-full ${busy ? "animate-pulse bg-[#76b900]" : "bg-zinc-700"}`}
              />
              <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                Response
              </span>
              {busy && (
                <span className="text-xs text-zinc-600">generating…</span>
              )}
            </div>
            <div className="flex-1 overflow-auto p-4">
              {answer ? (
                <Markdown>{answer}</Markdown>
              ) : (
                <p className="text-sm text-zinc-600">
                  {busy
                    ? "Waiting for the first token…"
                    : "Send a prompt to see the streamed response."}
                </p>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      {children}
    </div>
  );
}

function StatsBar({
  stats,
  completionTokens,
  isExact,
  speed,
  meta,
}: {
  stats: Stats;
  completionTokens: number;
  isExact: boolean;
  speed: number | null;
  meta: {
    keyId: string | null;
    attempts: string | null;
    upstreamEffort: string | null;
    thinking: string | null;
  } | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-zinc-800 bg-zinc-800 sm:grid-cols-4">
      <Stat
        label="Output tokens"
        value={completionTokens.toLocaleString()}
        sub={isExact ? "exact (usage)" : "estimated"}
        accent={isExact}
      />
      <Stat
        label="Speed"
        value={formatTokensPerSecond(speed)}
        sub={isExact ? "from exact count" : "from estimate"}
      />
      <Stat
        label="Prompt tokens"
        value={
          stats.usage?.prompt_tokens !== undefined
            ? stats.usage.prompt_tokens.toLocaleString()
            : "—"
        }
        sub="exact (usage)"
      />
      <Stat
        label="Time to first token"
        value={stats.ttftMs !== null ? `${Math.round(stats.ttftMs)} ms` : "—"}
        sub={
          stats.totalMs !== null
            ? `${(stats.totalMs / 1000).toFixed(1)}s total`
            : ""
        }
      />
      {meta && (
        <div className="col-span-2 flex flex-wrap gap-x-4 gap-y-1 bg-zinc-950 px-3 py-2 text-xs text-zinc-500 sm:col-span-4">
          <span>
            served by{" "}
            <span className="text-[#9ede2b]">{meta.keyId ?? "—"}</span>
          </span>
          <span>attempts: {meta.attempts ?? "—"}</span>
          <span>thinking: {meta.thinking ?? "—"}</span>
          <span>effort sent: {meta.upstreamEffort ?? "none"}</span>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-zinc-950 px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div
        className={`mt-0.5 text-lg font-semibold tabular-nums ${
          accent ? "text-[#9ede2b]" : "text-zinc-100"
        }`}
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-zinc-600">{sub}</div>}
    </div>
  );
}

function ModelCard({ model }: { model: ModelEntry }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs">
      {model.description && (
        <p className="mb-2 leading-relaxed text-zinc-400">
          {model.description}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <Spec label="Input">
          {(model.modalities?.input ?? ["text"]).join(", ")}
        </Spec>
        <Spec label="Output">
          {(model.modalities?.output ?? ["text"]).join(", ")}
        </Spec>
        <Spec label="Context">
          {model.context_window
            ? `${model.context_window.toLocaleString()} tok`
            : "—"}
        </Spec>
        <Spec label="Max output">
          {model.max_output_tokens
            ? `${model.max_output_tokens.toLocaleString()} tok`
            : "—"}
        </Spec>
        <Spec label="Thinking off">
          {model.can_disable_thinking ? "supported" : "not supported"}
        </Spec>
        <Spec label="Efforts">
          {(model.reasoning_efforts ?? []).length}&nbsp;levels
        </Spec>
      </dl>
      <div className="mt-2 flex flex-wrap gap-1">
        {(model.reasoning_efforts ?? []).map((e) => (
          <span
            key={e}
            className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400"
          >
            {e}
          </span>
        ))}
      </div>
    </div>
  );
}

function Spec({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-zinc-600">{label}</dt>
      <dd className="text-right text-zinc-300">{children}</dd>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? "bg-[#76b900]" : "bg-zinc-700"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform duration-200 ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function ProviderIcon({ ownedBy }: { ownedBy: string }) {
  const icon = PROVIDER_ICONS[ownedBy];
  if (!icon) {
    return (
      <span className="size-2 rounded-full bg-zinc-600" aria-hidden="true" />
    );
  }
  return (
    <Image
      src={icon.src}
      alt={icon.alt}
      width={18}
      height={18}
      className={`size-[18px] ${icon.invert ? "invert" : ""}`}
    />
  );
}

function EffortIcon({ rank, total }: { rank: number; total: number }) {
  const filled = Math.max(1, Math.ceil(((rank + 1) / Math.max(total, 1)) * 3));
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4">
      <title>{`Effort level ${rank + 1} of ${total}`}</title>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={1.5 + i * 4.5}
          y={12 - (i + 1) * 3}
          width="3"
          height={(i + 1) * 3}
          rx="1"
          className={i < filled ? "fill-[#76b900]" : "fill-zinc-700"}
        />
      ))}
    </svg>
  );
}

function KeyPanel({
  keys,
  onRefresh,
}: {
  keys: KeyEntry[];
  onRefresh: () => void;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Key pool ({keys.length})
        </span>
        <button
          type="button"
          onClick={onRefresh}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          refresh
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {keys.map((k) => (
          <div key={k.id} className="flex items-center gap-2 text-xs">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                k.available ? "bg-[#76b900]" : "bg-amber-500"
              }`}
            />
            <span className="w-14 text-zinc-400">{k.id}</span>
            <span className="text-zinc-600">
              {k.requests} req · {k.successes} ok · {k.rate_limits} 429
            </span>
          </div>
        ))}
        {keys.length === 0 && (
          <p className="text-xs text-amber-500">
            No keys configured — set NVIDIA_API_KEYS in .env
          </p>
        )}
      </div>
    </div>
  );
}

async function consumeStream(
  res: Response,
  opts: {
    startedAt: number;
    onAnswer: (fn: (prev: string) => string) => void;
    onReasoning: (fn: (prev: string) => string) => void;
    onToolCalls: (fn: (prev: ToolCall[]) => ToolCall[]) => void;
    onStats: (fn: (prev: Stats) => Stats) => void;
  },
) {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  let firstTokenAt: number | null = null;
  let answerSoFar = "";
  const toolCallsSoFar: ToolCall[] = [];

  const markFirstToken = () => {
    if (firstTokenAt !== null) return;
    firstTokenAt = performance.now();
    const ttft = firstTokenAt - opts.startedAt;
    opts.onStats((s) => ({ ...s, ttftMs: ttft }));
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      for (const line of event.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const chunk = JSON.parse(payload) as {
            choices?: {
              delta?: {
                content?: string | null;
                reasoning_content?: string | null;
                tool_calls?: {
                  index: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }[];
              };
            }[];
            usage?: Usage | null;
          };

          if (chunk.usage) {
            const usage = chunk.usage;
            opts.onStats((s) => ({ ...s, usage }));
          }

          const delta = chunk.choices?.[0]?.delta;
          if (delta?.reasoning_content) {
            markFirstToken();
            const text = delta.reasoning_content;
            opts.onReasoning((prev) => prev + text);
          }
          if (delta?.content) {
            markFirstToken();
            const text = delta.content;
            answerSoFar += text;
            opts.onAnswer((prev) => prev + text);
            const estimated = estimateTokens(answerSoFar);
            opts.onStats((s) => ({ ...s, estimated }));
          }
          if (delta?.tool_calls) {
            markFirstToken();
            for (const tc of delta.tool_calls) {
              const existing = toolCallsSoFar[tc.index];
              if (!existing) {
                toolCallsSoFar[tc.index] = {
                  id: tc.id ?? "",
                  type: "function",
                  function: {
                    name: tc.function?.name ?? "",
                    arguments: tc.function?.arguments ?? "",
                  },
                };
              } else {
                if (tc.function?.name)
                  existing.function.name = tc.function.name;
                if (tc.function?.arguments)
                  existing.function.arguments += tc.function.arguments;
              }
            }
            opts.onToolCalls(() => [...toolCallsSoFar]);
          }
        } catch {}
      }
    }
  }

  const finishedAt = performance.now();
  opts.onStats((s) => ({
    ...s,
    totalMs: finishedAt - opts.startedAt,
    genMs: firstTokenAt !== null ? finishedAt - firstTokenAt : null,
  }));
}
