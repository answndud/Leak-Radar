import assert from "node:assert/strict";

import {
  parseScanRequestBody,
  parseScheduleBody,
  parseScheduleToggleBody
} from "../validation";

const scanProviders = parseScanRequestBody({
  providers: ["openai", "  mistral", "openai", ""]
});
assert.equal(scanProviders.error, undefined);
assert.deepEqual(scanProviders.data?.providers, ["openai", "mistral"]);

const scanQuery = parseScanRequestBody({ query: "sk-proj- in:file" });
assert.equal(scanQuery.error, undefined);
assert.equal(scanQuery.data?.query, "sk-proj- in:file");

const scanConflict = parseScanRequestBody({
  query: "sk-proj- in:file",
  providers: ["openai"]
});
assert.equal(scanConflict.error, "query와 providers를 동시에 보낼 수 없습니다.");

const scanInvalidProvider = parseScanRequestBody({
  providers: ["openai", "unknown-provider"]
});
assert.equal(
  scanInvalidProvider.error,
  "지원하지 않는 provider가 포함되어 있습니다: unknown-provider"
);

const scheduleOk = parseScheduleBody({ intervalMinutes: 60, enabled: true, query: "sk-ant-" });
assert.equal(scheduleOk.error, undefined);
assert.equal(scheduleOk.data?.intervalMinutes, 60);
assert.equal(scheduleOk.data?.enabled, true);

const scheduleInvalidInterval = parseScheduleBody({ intervalMinutes: 30 });
assert.equal(scheduleInvalidInterval.error, "intervalMinutes는 최소 60분이어야 합니다.");

const toggleOk = parseScheduleToggleBody({ enabled: true });
assert.equal(toggleOk.error, undefined);
assert.equal(toggleOk.enabled, true);

const toggleInvalid = parseScheduleToggleBody({ enabled: "true" });
assert.equal(toggleInvalid.error, "enabled는 boolean이어야 합니다.");

console.log("[api-validation-smoke] ok");
