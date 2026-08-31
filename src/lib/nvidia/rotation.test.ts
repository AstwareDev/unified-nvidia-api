import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getKeyCount,
  getKeyStats,
  leaseKeysInRotation,
  resetKeyPool,
} from "./keys";
import { callUpstream } from "./upstream";

const ORIGINAL_ENV = { ...process.env };

function setKeys(...keys: string[]) {
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("NVIDIA_API_KEY")) delete process.env[name];
  }
  process.env.NVIDIA_API_KEYS = keys.join(",");
  resetKeyPool();
}

beforeEach(() => {
  vi.useRealTimers();
  setKeys("nvapi-a", "nvapi-b", "nvapi-c");
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
  resetKeyPool();
});

describe("key pool loading", () => {
  it("loads comma-separated keys and de-duplicates them", () => {
    setKeys("nvapi-a", "nvapi-b", "nvapi-a");
    expect(getKeyCount()).toBe(2);
  });

  it("loads the indexed NVIDIA_API_KEY_n form", () => {
    for (const name of Object.keys(process.env)) {
      if (name.startsWith("NVIDIA_API_KEY")) delete process.env[name];
    }
    process.env.NVIDIA_API_KEY_1 = "nvapi-one";
    process.env.NVIDIA_API_KEY_2 = "nvapi-two";
    process.env.NVIDIA_API_KEY_5 = "nvapi-five";
    resetKeyPool();
    expect(getKeyCount()).toBe(3);
  });

  it("never exposes key material through the stats snapshot", () => {
    const serialized = JSON.stringify(getKeyStats());
    expect(serialized).not.toContain("nvapi-a");
    expect(serialized).not.toContain("nvapi-");
  });
});

describe("round-robin ordering", () => {
  it("starts each request on the next key in sequence", () => {
    const first = leaseKeysInRotation().map((k) => k.id);
    const second = leaseKeysInRotation().map((k) => k.id);
    const third = leaseKeysInRotation().map((k) => k.id);

    expect(first[0]).toBe("key_1");
    expect(second[0]).toBe("key_2");
    expect(third[0]).toBe("key_3");
    expect(new Set(first)).toEqual(new Set(["key_1", "key_2", "key_3"]));
  });

  it("wraps around after the last key", () => {
    for (let i = 0; i < 3; i++) leaseKeysInRotation();
    expect(leaseKeysInRotation()[0].id).toBe("key_1");
  });
});

function stubFetch(handler: (key: string) => Response | Promise<Response>) {
  const seen: string[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation((async (
    _url: string,
    init: RequestInit,
  ) => {
    const auth = (init.headers as Record<string, string>).Authorization;
    const key = auth.replace("Bearer ", "");
    seen.push(key);
    return handler(key);
  }) as typeof fetch);
  return { spy, seen };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("failover", () => {
  it("distributes successive requests across different keys", async () => {
    const { seen } = stubFetch(() => json({ ok: true }));
    for (let i = 0; i < 3; i++) {
      await callUpstream("/chat/completions", {});
    }
    expect(new Set(seen).size).toBe(3);
  });

  it("retries on the next key when one is rate limited", async () => {
    const { seen } = stubFetch((key) =>
      key === "nvapi-a" ? json({ status: 429 }, 429) : json({ ok: true }),
    );

    const result = await callUpstream("/chat/completions", {});

    expect(result.ok).toBe(true);
    expect(seen[0]).toBe("nvapi-a");
    expect(seen.length).toBe(2);
    if (result.ok) expect(result.keyId).toBe("key_2");
  });

  it("keeps serving traffic when one key is permanently broken", async () => {
    const { spy } = stubFetch((key) =>
      key === "nvapi-b" ? json({ error: "boom" }, 500) : json({ ok: true }),
    );

    for (let i = 0; i < 6; i++) {
      const result = await callUpstream("/chat/completions", {});
      expect(result.ok).toBe(true);
    }
    expect(spy).toHaveBeenCalled();

    const broken = getKeyStats().find((k) => k.id === "key_2");
    expect(broken?.errors).toBeGreaterThan(0);
  });

  it("retries on network failures too", async () => {
    const { seen } = stubFetch((key) => {
      if (key === "nvapi-a") throw new Error("ECONNRESET");
      return json({ ok: true });
    });

    const result = await callUpstream("/chat/completions", {});
    expect(result.ok).toBe(true);
    expect(seen.length).toBe(2);
  });

  it("returns a 429 with all_keys_exhausted when every key is rate limited", async () => {
    stubFetch(() => json({ status: 429 }, 429));

    const result = await callUpstream("/chat/completions", {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(429);
      expect(result.code).toBe("all_keys_exhausted");
      expect(result.type).toBe("rate_limit_error");
      expect(result.attempts).toHaveLength(3);
      expect(result.message).not.toContain("nvapi-");
    }
  });

  it("does not burn the pool on a non-retriable 4xx", async () => {
    const { seen } = stubFetch(() =>
      json({ error: { message: "bad model" } }, 404),
    );

    const result = await callUpstream("/chat/completions", {});

    expect(seen).toHaveLength(1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.response.status).toBe(404);
  });

  it("reports a config error when no keys are set", async () => {
    for (const name of Object.keys(process.env)) {
      if (name.startsWith("NVIDIA_API_KEY")) delete process.env[name];
    }
    resetKeyPool();

    const result = await callUpstream("/chat/completions", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.code).toBe("no_keys_configured");
    }
  });
});
