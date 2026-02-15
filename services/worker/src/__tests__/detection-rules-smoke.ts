import assert from "node:assert/strict";

import { scanLine } from "../detection";

const providersOf = (line: string, allowed?: string[]): string[] => {
  const set = allowed ? new Set(allowed) : undefined;
  return scanLine(line, set).map((item) => item.provider).sort();
};

const openaiKey = "sk-proj-abcdefghijklmnopqrstuvwxyz1234567890";
const deepseekLike = "sk-ABCDEFGHIJ1234567890ABCDEFGHIJ1234567890";

assert.deepEqual(providersOf(`OPENAI_API_KEY=${openaiKey}`), ["openai"]);
assert.deepEqual(providersOf(`DEEPSEEK_API_KEY=${deepseekLike}`), ["deepseek"]);
assert.deepEqual(providersOf(`MISTRAL_API_KEY=abcdef123456abcdef123456abcdef12`), ["mistral"]);
assert.deepEqual(providersOf("OPENAI_API_KEY=sk-your-key"), []);
assert.deepEqual(providersOf("const TOKEN = ${OPENAI_API_KEY}"), []);
assert.deepEqual(
  providersOf(`OPENAI_API_KEY=${openaiKey}`, ["anthropic"]),
  []
);
assert.deepEqual(
  providersOf(`OPENAI_API_KEY=${openaiKey}`, ["openai"]),
  ["openai"]
);

console.log("[detection-rules-smoke] ok");
