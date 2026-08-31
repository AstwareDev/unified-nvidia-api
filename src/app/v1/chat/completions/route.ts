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

  const {
    stream,
    upstreamBody,
    reasoningEffort,
    upstreamEffort,
    thinkingEnabled,
    maxTokens,
  } = validated.value;

  const result = await callUpstream("/chat/completions", upstreamBody, {
    signal: request.signal,
  });

  if (!result.ok) {
    return NextResponse.json(
      openAIError(result.message, result.type, null, result.code),
      {
        status: result.status,
        headers: gatewayHeaders({
          keyId: null,
          attempts: result.attempts.length,
          reasoningEffort,
          upstreamEffort,
          thinkingEnabled,
          maxTokens,
        }),
      },
    );
  }

  const upstream = result.response;
  const headers = gatewayHeaders({
    keyId: result.keyId,
    attempts: result.attempts.length,
    reasoningEffort,
    upstreamEffort,
    thinkingEnabled,
    maxTokens,
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    let message = text.slice(0, 500);
    try {
      const parsed = JSON.parse(text) as {
        error?: { message?: string };
        detail?: string;
        message?: string;
      };
      message =
        parsed.error?.message ?? parsed.detail ?? parsed.message ?? message;
    } catch {}
    return NextResponse.json(
      openAIError(message, "invalid_request_error", null, "upstream_rejected"),
      { status: upstream.status, headers },
    );
  }

  if (stream) {
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
    headers.set("Connection", "keep-alive");
    headers.set("X-Accel-Buffering", "no");
    return new Response(upstream.body, { status: 200, headers });
  }

  const json = await upstream.json();
  return NextResponse.json(json, { status: 200, headers });
}

function gatewayHeaders(info: {
  keyId: string | null;
  attempts: number;
  reasoningEffort: string | null;
  upstreamEffort: string | null;
  thinkingEnabled: boolean;
  maxTokens: number;
}): Headers {
  const headers = new Headers();
  if (info.keyId) headers.set("X-Nvidia-Key-Id", info.keyId);
  headers.set("X-Nvidia-Attempts", String(info.attempts));
  headers.set("X-Nvidia-Max-Tokens", String(info.maxTokens));
  headers.set("X-Thinking", info.thinkingEnabled ? "enabled" : "disabled");
  if (info.reasoningEffort) {
    headers.set("X-Reasoning-Effort", info.reasoningEffort);
    headers.set(
      "X-Reasoning-Effort-Upstream",
      info.upstreamEffort ?? "unsupported",
    );
  }
  return headers;
}
