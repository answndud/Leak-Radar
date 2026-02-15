import assert from "node:assert/strict";

import { parseScanQueryInput } from "../scan-query";

const providerPayload = JSON.stringify({
  providers: ["openai", "MISTRAL", "openai", "", "  deepseek  ", "unknown"]
});

const parsedProviders = parseScanQueryInput(providerPayload);
assert.equal(parsedProviders.queries.length > 0, true);
assert.deepEqual(parsedProviders.selectedProviders, ["openai", "mistral", "deepseek"]);
assert.deepEqual(
  [...(parsedProviders.allowedProviders ?? new Set<string>())].sort(),
  ["deepseek", "mistral", "openai"].sort()
);

const parsedQuery = parseScanQueryInput("sk-proj- in:file");
assert.deepEqual(parsedQuery.queries, ["sk-proj- in:file"]);
assert.equal(parsedQuery.allowedProviders, undefined);

const parsedBadPayload = parseScanQueryInput("{\"providers\":123}");
assert.deepEqual(parsedBadPayload.queries, ["{\"providers\":123}"]);

console.log("[scan-query-smoke] ok");
