import { canDisableThinking, getModel, supportsEffort } from "./models";
import {
  type ChatCompletionRequest,
  type OpenAIErrorBody,
  openAIError,
  REASONING_EFFORTS,
  type ReasoningEffort,
} from "./types";

export const MAX_OUTPUT_TOKENS = 120_000;

export interface ValidationFailure {
  status: number;
  body: OpenAIErrorBody;
}

export interface ValidatedRequest {
  model: string;
  maxTokens: number;
  stream: boolean;
  reasoningEffort: ReasoningEffort | null;
  upstreamBody: Record<string, unknown>;
}

function fail(
  status: number,
  message: string,
  type: string,
  param: string | null = null,
  code: string | null = null,
): ValidationFailure {
  return { status, body: openAIError(message, type, param, code) };
}

export function validateChatRequest(
  raw: unknown,
):
  | { ok: true; value: ValidatedRequest }
  | { ok: false; error: ValidationFailure } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      error: fail(
        400,
        "Request body must be a JSON object.",
        "invalid_request_error",
      ),
    };
  }

  const body = raw as ChatCompletionRequest;

  if (typeof body.model !== "string" || body.model.length === 0) {
    return {
      ok: false,
      error: fail(
        400,
        "You must provide a model parameter.",
        "invalid_request_error",
        "model",
      ),
    };
  }

  const model = getModel(body.model);
  if (!model) {
    return {
      ok: false,
      error: fail(
        404,
        `The model '${body.model}' does not exist or you do not have access to it.`,
        "invalid_request_error",
        "model",
        "model_not_found",
      ),
    };
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return {
      ok: false,
      error: fail(
        400,
        "You must provide a non-empty messages array.",
        "invalid_request_error",
        "messages",
      ),
    };
  }

  for (const [index, message] of body.messages.entries()) {
    if (
      typeof message !== "object" ||
      message === null ||
      typeof (message as { role?: unknown }).role !== "string"
    ) {
      return {
        ok: false,
        error: fail(
          400,
          `messages[${index}] must be an object with a 'role' string.`,
          "invalid_request_error",
          `messages[${index}].role`,
        ),
      };
    }
  }

  let thinking: boolean | null = null;
  if (body.thinking !== undefined && body.thinking !== null) {
    if (typeof body.thinking !== "boolean") {
      return {
        ok: false,
        error: fail(
          400,
          "'thinking' must be a boolean.",
          "invalid_request_error",
          "thinking",
          "invalid_value",
        ),
      };
    }
    thinking = body.thinking;
  }

  let reasoningEffort: ReasoningEffort | null = null;
  if (body.reasoning_effort !== undefined && body.reasoning_effort !== null) {
    if (
      typeof body.reasoning_effort !== "string" ||
      !REASONING_EFFORTS.includes(body.reasoning_effort as ReasoningEffort)
    ) {
      return {
        ok: false,
        error: fail(
          400,
          `Invalid value for 'reasoning_effort': ${JSON.stringify(
            body.reasoning_effort,
          )}. Supported values are: ${REASONING_EFFORTS.join(", ")}.`,
          "invalid_request_error",
          "reasoning_effort",
          "invalid_value",
        ),
      };
    }
    if (!supportsEffort(model, body.reasoning_effort)) {
      return {
        ok: false,
        error: fail(
          400,
          `Model '${model.id}' does not support reasoning_effort '${
            body.reasoning_effort
          }'. Supported values for this model are: ${model.reasoningEfforts.join(
            ", ",
          )}.`,
          "invalid_request_error",
          "reasoning_effort",
          "unsupported_value_for_model",
        ),
      };
    }
    reasoningEffort = body.reasoning_effort as ReasoningEffort;
  }

  if (thinking === false) {
    if (!canDisableThinking(model)) {
      return {
        ok: false,
        error: fail(
          400,
          `Model '${model.id}' cannot disable thinking: its upstream only accepts reasoning_effort ${model.reasoningEfforts.join(
            ", ",
          )}. Use a model that supports 'none' if you need reasoning turned off.`,
          "invalid_request_error",
          "thinking",
          "thinking_not_disableable",
        ),
      };
    }
    if (reasoningEffort !== null && reasoningEffort !== "none") {
      return {
        ok: false,
        error: fail(
          400,
          `Conflicting parameters: 'thinking' is false but 'reasoning_effort' is '${reasoningEffort}'. Omit reasoning_effort, or set it to 'none'.`,
          "invalid_request_error",
          "thinking",
          "conflicting_parameters",
        ),
      };
    }
    reasoningEffort = "none";
  } else if (thinking === true) {
    if (reasoningEffort === "none") {
      return {
        ok: false,
        error: fail(
          400,
          "Conflicting parameters: 'thinking' is true but 'reasoning_effort' is 'none'.",
          "invalid_request_error",
          "thinking",
          "conflicting_parameters",
        ),
      };
    }
    if (reasoningEffort === null) reasoningEffort = model.defaultEffort;
  }

  const requested = body.max_completion_tokens ?? body.max_tokens;
  if (requested !== undefined && requested !== null) {
    if (
      typeof requested !== "number" ||
      !Number.isFinite(requested) ||
      requested < 1
    ) {
      return {
        ok: false,
        error: fail(
          400,
          "'max_tokens' must be a positive integer.",
          "invalid_request_error",
          "max_tokens",
        ),
      };
    }
  }

  const maxTokens = Math.min(
    Math.floor(requested ?? MAX_OUTPUT_TOKENS),
    MAX_OUTPUT_TOKENS,
    model.maxOutputTokens,
  );

  const stream = body.stream === true;

  const upstreamBody: Record<string, unknown> = {
    model: model.id,
    messages: body.messages,
    max_tokens: maxTokens,
    stream,
  };

  const passthrough = [
    "temperature",
    "top_p",
    "frequency_penalty",
    "presence_penalty",
    "stop",
    "seed",
    "n",
    "tools",
    "tool_choice",
    "response_format",
  ] as const;
  for (const field of passthrough) {
    const value = body[field];
    if (value !== undefined && value !== null) upstreamBody[field] = value;
  }

  if (stream) {
    upstreamBody.stream_options = { include_usage: true };
  }

  if (reasoningEffort !== null) {
    upstreamBody.reasoning_effort = reasoningEffort;
  }

  return {
    ok: true,
    value: {
      model: model.id,
      maxTokens,
      stream,
      reasoningEffort,
      upstreamBody,
    },
  };
}
