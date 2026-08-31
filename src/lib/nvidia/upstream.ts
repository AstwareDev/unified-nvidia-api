import { type KeyLease, leaseKeysInRotation } from "./keys";

const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_TIMEOUT_MS = 120_000;

export function getBaseUrl(): string {
  const raw = process.env.NVIDIA_API_URL?.trim();
  if (!raw) return DEFAULT_BASE_URL;
  return raw.replace(/\/chat\/completions\/?$/, "").replace(/\/+$/, "");
}

export type UpstreamAttempt = {
  keyId: string;
  status: number | null;
  outcome:
    | "success"
    | "rate_limited"
    | "server_error"
    | "client_error"
    | "network_error";
};

export interface UpstreamSuccess {
  ok: true;
  response: Response;
  keyId: string;
  attempts: UpstreamAttempt[];
}

export interface UpstreamFailure {
  ok: false;
  status: number;
  message: string;
  type: string;
  code: string;
  attempts: UpstreamAttempt[];
}

export type UpstreamResult = UpstreamSuccess | UpstreamFailure;

function isRetriable(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function callUpstream(
  path: string,
  body: unknown,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<UpstreamResult> {
  const leases = leaseKeysInRotation();
  const attempts: UpstreamAttempt[] = [];

  if (leases.length === 0) {
    return {
      ok: false,
      status: 500,
      message:
        "No NVIDIA API keys are configured on the server. Set NVIDIA_API_KEYS (comma separated) or NVIDIA_API_KEY_1..N.",
      type: "server_error",
      code: "no_keys_configured",
      attempts,
    };
  }

  const url = `${getBaseUrl()}${path}`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastStatus: number | null = null;
  let lastMessage = "";

  for (const leaseEntry of leases) {
    if (options.signal?.aborted) break;

    const result = await attempt(
      url,
      body,
      leaseEntry,
      timeoutMs,
      options.signal,
    );
    attempts.push(result.attempt);

    if (result.kind === "response") {
      return {
        ok: true,
        response: result.response,
        keyId: leaseEntry.id,
        attempts,
      };
    }

    lastStatus = result.attempt.status;
    lastMessage = result.message;
  }

  const allRateLimited = attempts.every((a) => a.outcome === "rate_limited");
  if (allRateLimited) {
    return {
      ok: false,
      status: 429,
      message: `All ${attempts.length} configured NVIDIA API key(s) are currently rate limited. Retry shortly or add more keys.`,
      type: "rate_limit_error",
      code: "all_keys_exhausted",
      attempts,
    };
  }

  if (attempts.every((a) => a.outcome === "network_error")) {
    return {
      ok: false,
      status: 504,
      message: `Could not reach the upstream NVIDIA API on any of ${
        attempts.length
      } key(s) (no response within ${Math.round(timeoutMs / 1000)}s, or the connection failed).`,
      type: "timeout_error",
      code: "upstream_timeout",
      attempts,
    };
  }

  return {
    ok: false,
    status: lastStatus && lastStatus >= 500 ? 502 : (lastStatus ?? 502),
    message:
      lastMessage ||
      "The upstream NVIDIA API failed on every configured key. Please retry.",
    type: "upstream_error",
    code: "upstream_failure",
    attempts,
  };
}

type AttemptResult =
  | { kind: "response"; response: Response; attempt: UpstreamAttempt }
  | { kind: "retry"; message: string; attempt: UpstreamAttempt };

async function attempt(
  url: string,
  body: unknown,
  leaseEntry: KeyLease,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<AttemptResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  leaseEntry.markAttempt();

  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${leaseEntry.secret}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
    });

    if (!isRetriable(response.status)) {
      if (response.ok) {
        leaseEntry.markSuccess();
        return {
          kind: "response",
          response,
          attempt: {
            keyId: leaseEntry.id,
            status: response.status,
            outcome: "success",
          },
        };
      }
      return {
        kind: "response",
        response,
        attempt: {
          keyId: leaseEntry.id,
          status: response.status,
          outcome: "client_error",
        },
      };
    }

    const message = await readErrorMessage(response);
    if (response.status === 429) {
      leaseEntry.markRateLimited();
      return {
        kind: "retry",
        message,
        attempt: { keyId: leaseEntry.id, status: 429, outcome: "rate_limited" },
      };
    }

    leaseEntry.markError();
    return {
      kind: "retry",
      message,
      attempt: {
        keyId: leaseEntry.id,
        status: response.status,
        outcome: "server_error",
      },
    };
  } catch (error) {
    leaseEntry.markError();
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Upstream request timed out."
        : `Upstream request failed: ${String(error)}`;
    return {
      kind: "retry",
      message,
      attempt: { keyId: leaseEntry.id, status: null, outcome: "network_error" },
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as {
        error?: { message?: string };
        detail?: string;
        title?: string;
        message?: string;
      };
      return (
        parsed.error?.message ??
        parsed.detail ??
        parsed.message ??
        parsed.title ??
        text.slice(0, 400)
      );
    } catch {
      return text.slice(0, 400);
    }
  } catch {
    return `Upstream returned ${response.status}.`;
  }
}
