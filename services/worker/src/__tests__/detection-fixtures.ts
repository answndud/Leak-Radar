export type DetectionFixture = {
  name: string;
  line: string;
  expectedProviders: string[];
};

export const DETECTION_FIXTURES: DetectionFixture[] = [
  {
    name: "openai proj key",
    line: "OPENAI_API_KEY=" + ["sk", "-proj-", "abcdefghijklmnopqrstuvwxyz1234567890"].join(""),
    expectedProviders: ["openai"]
  },
  {
    name: "anthropic key",
    line: "ANTHROPIC_API_KEY=" + ["sk", "-ant-", "abcdefghijABCDEFGHIJ1234567890"].join(""),
    expectedProviders: ["anthropic"]
  },
  {
    name: "google key",
    line: "GOOGLE_API_KEY=" + ["AIza", "Sy", "a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuVw"].join(""),
    expectedProviders: ["google"]
  },
  {
    name: "placeholder rejected",
    line: "OPENAI_API_KEY=your-openai-key",
    expectedProviders: []
  },
  {
    name: "templating rejected",
    line: "const apiKey = ${OPENAI_API_KEY}",
    expectedProviders: []
  },
  {
    name: "low entropy rejected",
    line: "OPENAI_API_KEY=" + ["sk", "-proj-", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"].join(""),
    expectedProviders: []
  }
];
