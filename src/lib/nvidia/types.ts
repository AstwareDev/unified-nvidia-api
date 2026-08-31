export type ReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export const REASONING_EFFORTS: readonly ReasoningEffort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool" | "developer";
  content: string | unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  seed?: number;
  n?: number;
  tools?: unknown;
  tool_choice?: unknown;
  response_format?: unknown;
  stream_options?: { include_usage?: boolean };
  reasoning_effort?: string;
  thinking?: boolean;
  user?: string;
}

export interface OpenAIErrorBody {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
  };
}

export function openAIError(
  message: string,
  type: string,
  param: string | null = null,
  code: string | null = null,
): OpenAIErrorBody {
  return { error: { message, type, param, code } };
}
