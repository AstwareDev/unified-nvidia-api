import { type NextRequest, NextResponse } from "next/server";
import { openAIError } from "@/lib/nvidia/types";
import { callUpstream } from "@/lib/nvidia/upstream";
import { validateChatRequest } from "@/lib/nvidia/validate";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      openAIError(
        "We could not parse the JSON body of your request.",
        "invalid_request_error",
      ),
      { status: 400 },
    );
  }

  const validated = validateChatRequest(raw);
  if (!validated.ok) {
    return NextResponse.json(validated.error.body, {
      status: validated.error.status,
    });
  }

  const { model, stream, upstreamBody, reasoningEffort, maxTokens } =
    validated.value;

  const result = await callUpstream("/chat/completions", upstreamBody, {
    signal: request.signal,
  });

  const headers = new Headers({
    "X-Nvidia-Attempts": String(result.attempts.length),
    "X-Nvidia-Max-Tokens": String(maxTokens),
    "X-Thinking": reasoningEffort === "none" ? "disabled" : "enabled",
  });
  if (reasoningEffort) headers.set("X-Reasoning-Effort", reasoningEffort);

  if (!result.ok) {
    return NextResponse.json(
      openAIError(result.message, result.type, null, result.code),
      { status: result.status, headers },
    );
  }

  headers.set("X-Nvidia-Key-Id", result.keyId);
  const upstream = result.response;

  if (!upstream.ok) {
    const message = await readUpstreamError(upstream);
    if (upstream.status === 404) {
      return NextResponse.json(
        openAIError(
          `NVIDIA's API returned 404 for '${model}'. The model id is not served by this API (it is missing from NVIDIA's /v1/models list) or your key has no access to it. Upstream said: ${message}`,
          "invalid_request_error",
          "model",
          "upstream_model_not_found",
        ),
        { status: 404, headers },
      );
    }
    return NextResponse.json(
      openAIError(message, "invalid_request_error", null, "upstream_rejected"),
      { status: upstream.status, headers },
    );
  }

  if (!stream) {
    return NextResponse.json(await upstream.json(), { status: 200, headers });
  }

  if (!upstream.body) {
    return NextResponse.json(
      openAIError(
        "Upstream returned an empty stream.",
        "upstream_error",
        null,
        "empty_stream",
      ),
      { status: 502, headers },
    );
  }
  headers.set("Content-Type", "text/event-stream; charset=utf-8");
  headers.set("Cache-Control", "no-cache, no-transform");
  headers.set("X-Accel-Buffering", "no");
  return new Response(upstream.body, { status: 200, headers });
}

async function readUpstreamError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string };
      detail?: string;
      message?: string;
    };
    return (
      parsed.error?.message ??
      parsed.detail ??
      parsed.message ??
      text
    ).slice(0, 500);
  } catch {
    return text.trim().slice(0, 500);
  }
}
