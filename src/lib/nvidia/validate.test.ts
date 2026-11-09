import { describe, expect, it } from "vitest";
import { canDisableThinking, getModel, MODELS, supportsEffort } from "./models";
import { MAX_OUTPUT_TOKENS, validateChatRequest } from "./validate";

const base = {
  model: "moonshotai/kimi-k3.1-pro",
  messages: [{ role: "user", content: "hi" }],
};

function ok(raw: unknown) {
  const result = validateChatRequest(raw);
  if (!result.ok)
    throw new Error(`expected success, got ${result.error.body.error.message}`);
  return result.value;
}

function err(raw: unknown) {
  const result = validateChatRequest(raw);
  if (result.ok) throw new Error("expected failure");
  return result.error;
}

describe("model validation", () => {
  it("accepts Kimi K3", () => {
    expect(ok(base).model).toBe("moonshotai/kimi-k3.1-pro");
  });

  it("404s an unknown model with model_not_found", () => {
    const e = err({ ...base, model: "acme/nope" });
    expect(e.status).toBe(404);
    expect(e.body.error.code).toBe("model_not_found");
  });

  it("400s a missing model", () => {
    expect(err({ messages: base.messages }).status).toBe(400);
  });

  it("400s empty or missing messages", () => {
    expect(err({ ...base, messages: [] }).status).toBe(400);
    expect(err({ model: base.model }).status).toBe(400);
  });

  it("400s a non-object body", () => {
    expect(err("hello").status).toBe(400);
    expect(err(null).status).toBe(400);
  });
});

describe("max_tokens", () => {
  it("defaults to the 120,000 cap", () => {
    expect(ok(base).maxTokens).toBe(MAX_OUTPUT_TOKENS);
    expect(MAX_OUTPUT_TOKENS).toBe(120_000);
  });

  it("clamps anything above the cap", () => {
    expect(ok({ ...base, max_tokens: 999_999 }).maxTokens).toBe(120_000);
  });

  it("honors a smaller request", () => {
    expect(ok({ ...base, max_tokens: 256 }).maxTokens).toBe(256);
  });

  it("accepts max_completion_tokens as an alias", () => {
    expect(ok({ ...base, max_completion_tokens: 512 }).maxTokens).toBe(512);
  });

  it("400s a non-positive value", () => {
    expect(err({ ...base, max_tokens: 0 }).status).toBe(400);
    expect(err({ ...base, max_tokens: "lots" }).status).toBe(400);
  });
});

describe("reasoning_effort", () => {
  it.each([
    "none",
    "low",
    "high",
    "max",
  ] as const)("accepts %s on Kimi K3", (effort) => {
    const value = ok({ ...base, reasoning_effort: effort });
    expect(value.reasoningEffort).toBe(effort);
    expect(value.upstreamBody.reasoning_effort).toBe(effort);
  });

  it.each([
    "minimal",
    "medium",
    "xhigh",
  ] as const)("400s %s on Kimi K3, which its backend rejects", (effort) => {
    const e = err({ ...base, reasoning_effort: effort });
    expect(e.status).toBe(400);
    expect(e.body.error.code).toBe("unsupported_value_for_model");
  });

  it.each([
    "none",
    "low",
    "high",
    "max",
  ] as const)("accepts %s, which Kimi implements", (effort) => {
    expect(
      ok({ ...base, reasoning_effort: effort }).upstreamBody.reasoning_effort,
    ).toBe(effort);
  });

  it.each([
    "",
    "LOW",
    "extreme",
    3,
    true,
  ])("400s the unknown value %p", (effort) => {
    const e = err({ ...base, reasoning_effort: effort });
    expect(e.status).toBe(400);
    expect(e.body.error.param).toBe("reasoning_effort");
    expect(e.body.error.code).toBe("invalid_value");
  });

  it("omits the parameter entirely when not requested", () => {
    expect(ok(base).upstreamBody.reasoning_effort).toBeUndefined();
  });

  it("400s an effort the model does not implement rather than clamping it", () => {
    for (const effort of ["xhigh", "minimal", "medium"]) {
      const e = err({ ...base, reasoning_effort: effort });
      expect(e.status).toBe(400);
      expect(e.body.error.code).toBe("unsupported_value_for_model");
    }
  });
});

describe("thinking toggle", () => {
  it("maps thinking:false to reasoning_effort none", () => {
    const value = ok({ ...base, thinking: false });
    expect(value.upstreamBody.reasoning_effort).toBe("none");
  });

  it("maps thinking:true to the model default effort", () => {
    const value = ok({ ...base, thinking: true });
    expect(value.reasoningEffort).toBe("high");
  });

  it("lets an explicit effort win over thinking:true", () => {
    const value = ok({ ...base, thinking: true, reasoning_effort: "max" });
    expect(value.upstreamBody.reasoning_effort).toBe("max");
  });

  it("400s contradictory thinking/reasoning_effort pairs", () => {
    expect(
      err({ ...base, thinking: false, reasoning_effort: "high" }).body.error
        .code,
    ).toBe("conflicting_parameters");
    expect(
      err({ ...base, thinking: true, reasoning_effort: "none" }).body.error
        .code,
    ).toBe("conflicting_parameters");
  });

  it("allows the redundant-but-consistent thinking:false + none", () => {
    expect(
      ok({ ...base, thinking: false, reasoning_effort: "none" })
        .reasoningEffort,
    ).toBe("none");
  });

  it("400s a non-boolean thinking value", () => {
    expect(err({ ...base, thinking: "yes" }).body.error.param).toBe("thinking");
  });
});

describe("model capability table", () => {
  it("Kimi K3.1 Pro can disable thinking and supports low/high/max", () => {
    const kimi = getModel("moonshotai/kimi-k3.1-pro");
    if (!kimi) throw new Error("kimi missing");
    expect(canDisableThinking(kimi)).toBe(true);
    expect(supportsEffort(kimi, "max")).toBe(true);
    expect(supportsEffort(kimi, "xhigh")).toBe(false);
    expect(supportsEffort(kimi, "medium")).toBe(false);
  });

  it("declares modalities and a context window for every model", () => {
    for (const model of MODELS) {
      expect(model.modalities.input.length).toBeGreaterThan(0);
      expect(model.modalities.output).toContain("text");
      expect(model.contextWindow).toBeGreaterThan(0);
    }
  });
});
