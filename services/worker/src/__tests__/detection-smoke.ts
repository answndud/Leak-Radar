import assert from "node:assert/strict";

import { makeKeyFingerprint, redactSecret, scanLine } from "../detection";

const assertProviders = (line: string, expected: string[]): void => {
  const results = scanLine(line);
  const providers = results.map((r) => r.provider).sort();
  assert.deepEqual(providers, [...expected].sort());
};

const assertProvidersFiltered = (line: string, allowed: string[], expected: string[]): void => {
  const results = scanLine(line, new Set(allowed));
  const providers = results.map((r) => r.provider).sort();
  assert.deepEqual(providers, [...expected].sort());
};

const openaiKey = ["sk", "-proj-", "abcdefghijklmnopqrstuv", "1234567890"].join("");
const anthropicKey = ["sk", "-ant-", "abcdefghij", "ABCDEFGHIJ", "123456"].join("");
const googleKey = ["AI", "zaSy", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"].join("");

// 기본 탐지 케이스
assertProviders(`OPENAI_API_KEY=${openaiKey}`, ["openai"]);
assertProviders(`ANTHROPIC_API_KEY=${anthropicKey}`, ["anthropic"]);
assertProviders(`GOOGLE_API_KEY=${googleKey}`, ["google"]);

// 오탐 방지: placeholder/변수명
assertProviders("OPENAI_API_KEY=sk-your-key", []);
assertProviders("export const OPENAI_API_KEY = \"\"", []);

// provider 필터링
assertProvidersFiltered(
  `${openaiKey} ${anthropicKey}`,
  ["openai"],
  ["openai"]
);

// redacted_key 기반 지문 일관성
const secretA = ["sk", "-proj-", "ABCD", "xxxxxxxxxxxxxxxxxxx", "999"].join("");
const secretB = ["sk", "-proj-", "ABCD", "yyyyyyyyyyyyyyyyyyy", "999"].join("");
assert.equal(redactSecret(secretA), redactSecret(secretB));
assert.equal(makeKeyFingerprint("openai", secretA), makeKeyFingerprint("openai", secretB));

console.log("[detection-smoke] ok");
