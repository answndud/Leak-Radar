import assert from "node:assert/strict";
import { DETECTION_RULESET_VERSION } from "@leak/shared";

import { scanLine } from "../detection";
import { DETECTION_FIXTURES } from "./detection-fixtures";

assert.match(DETECTION_RULESET_VERSION, /^\d{4}\.\d{2}\.\d{2}\.\d+$/);
assert.equal(DETECTION_FIXTURES.length > 0, true);

for (const fixture of DETECTION_FIXTURES) {
  const providers = scanLine(fixture.line).map((item) => item.provider).sort();
  assert.deepEqual(providers, [...fixture.expectedProviders].sort(), fixture.name);
}

console.log("[detection-fixtures-smoke] ok");
