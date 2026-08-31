const BASE = process.argv[2] ?? "http://localhost:3000";
const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

const TIMEOUT_MS = 180_000;
const RETRIES = 3;

async function listModels() {
  const res = await fetch(`${BASE}/v1/models`);
  if (!res.ok) throw new Error(`GET /v1/models failed: ${res.status}`);
  const json = await res.json();
  return json.data;
}

async function testEffort(model, effort) {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
          reasoning_effort: effort,
        }),
      });
      clearTimeout(timer);

      if (res.ok) return "OK";

      const body = await res.json().catch(() => null);
      const message = body?.error?.message ?? "";

      if (/does not support|Unsupported|supported values/i.test(message)) {
        return "NO";
      }
      if (res.status === 429 || /overload/i.test(message)) {
        await sleep(8000);
        continue;
      }
      return `?${res.status}`;
    } catch {
      clearTimeout(timer);
      await sleep(3000);
    }
  }
  return "TIMEOUT";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const models = await listModels();
console.log(`Verifying ${models.length} models against ${BASE}\n`);

for (const model of models) {
  const declared = new Set(model.reasoning_efforts ?? []);
  const cells = [];
  for (const effort of EFFORTS) {
    const result = await testEffort(model.id, effort);
    const expected = declared.has(effort);
    const mismatch =
      (result === "OK" && !expected) || (result === "NO" && expected);
    cells.push(`${effort}=${result}${mismatch ? " ⚠MISMATCH" : ""}`);
    await sleep(1500);
  }
  console.log(model.id.padEnd(36), cells.join("  "));
}
