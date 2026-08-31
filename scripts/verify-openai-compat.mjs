import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:3000/v1",
  apiKey: "not-required",
});

console.log("--- models.list() ---");
const models = await client.models.list();
const ids = models.data.map((m) => m.id);
console.log(
  "count:",
  ids.length,
  "| kimi-k3 present:",
  ids.includes("moonshotai/kimi-k3"),
);

console.log("--- non-streaming completion ---");
const c = await client.chat.completions.create({
  model: "moonshotai/kimi-k3",
  messages: [{ role: "user", content: "Reply with exactly: PONG" }],
  max_tokens: 2000,
  reasoning_effort: "low",
});
console.log("id:", c.id, "| object:", c.object, "| model:", c.model);
console.log(
  "finish_reason:",
  c.choices[0].finish_reason,
  "| role:",
  c.choices[0].message.role,
);
console.log(
  "content:",
  JSON.stringify(c.choices[0].message.content?.slice(0, 60)),
);
console.log("usage:", JSON.stringify(c.usage));

console.log("--- streaming completion ---");
const stream = await client.chat.completions.create({
  model: "nvidia/nemotron-3-nano-30b-a3b",
  messages: [{ role: "user", content: "Count 1 to 5, comma separated." }],
  max_tokens: 1500,
  stream: true,
  reasoning_effort: "low",
});
let chunks = 0,
  text = "";
for await (const ev of stream) {
  chunks++;
  text += ev.choices[0]?.delta?.content ?? "";
}
console.log("chunks:", chunks, "| text:", JSON.stringify(text.slice(-70)));

console.log("--- SDK error handling (bad model) ---");
try {
  await client.chat.completions.create({
    model: "nope/nope",
    messages: [{ role: "user", content: "x" }],
  });
} catch (e) {
  console.log(
    "caught:",
    e.constructor.name,
    "status:",
    e.status,
    "| code:",
    e.error?.error?.code ?? e.code,
  );
}

console.log("--- SDK error handling (bad reasoning_effort) ---");
try {
  await client.chat.completions.create({
    model: "moonshotai/kimi-k3",
    messages: [{ role: "user", content: "x" }],
    reasoning_effort: "medium",
  });
} catch (e) {
  console.log(
    "caught:",
    e.constructor.name,
    "status:",
    e.status,
    "| msg:",
    (e.error?.error?.message ?? e.message).slice(0, 90),
  );
}
