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
    name: "openai svcacct key",
    line: "OPENAI_API_KEY=" + ["sk", "-svcacct-", "abcdefghijklmnopqrstuvwxyz1234567890"].join(""),
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
    name: "grok key",
    line: "XAI_API_KEY=xai-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
    expectedProviders: ["grok"]
  },
  {
    name: "kimi key",
    line: "MOONSHOT_API_KEY=sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
    expectedProviders: ["kimi"]
  },
  {
    name: "deepseek contextual sk",
    line: "DEEPSEEK_API_KEY=sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
    expectedProviders: ["deepseek"]
  },
  {
    name: "mistral contextual value",
    line: "MISTRAL_API_KEY=abcdef123456abcdef123456abcdef12",
    expectedProviders: ["mistral"]
  },
  {
    name: "stripe live key",
    line: "STRIPE_SECRET=" + ["sk_live_", "abcdefghijklmnop", "qrstuvwxyz123456"].join(""),
    expectedProviders: ["stripe"]
  },
  {
    name: "aws access key",
    line: "AWS_ACCESS_KEY_ID=AKIA1234567890ABCDEF",
    expectedProviders: ["aws"]
  },
  {
    name: "slack bot token",
    line: "SLACK_BOT_TOKEN=" + ["xoxb-", "123456789012-", "123456789012-", "abcdefghijklmnop"].join(""),
    expectedProviders: ["slack"]
  },
  {
    name: "sendgrid key",
    line: "SENDGRID_API_KEY=" + [
      "SG.",
      "ABCDEFGHIJKLMNOPQRSTUV",
      ".",
      "abcdefghijklmnopqrstuvwxyzABCDEFG1234567890"
    ].join(""),
    expectedProviders: ["sendgrid"]
  },
  {
    name: "github pat",
    line: "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890ABCD",
    expectedProviders: ["github"]
  },
  {
    name: "npm token",
    line: "NPM_TOKEN=npm_abcdefghijklmnopqrstuvwxyz1234567890ABCD",
    expectedProviders: ["npm"]
  },
  {
    name: "supabase token",
    line: "SUPABASE_ACCESS_TOKEN=" + ["sbp_", "0123456789abcdef0123456789", "abcdef01234567"].join(""),
    expectedProviders: ["supabase"]
  },
  {
    name: "vercel token",
    line: "VERCEL_TOKEN=vercel_ABCDEFGHIJKLMNOPQRSTUVWXYZ12",
    expectedProviders: ["vercel"]
  },
  {
    name: "discord token",
    line: "DISCORD_TOKEN=abcdefghijklmnopqrstuvwx.ABCDEF.abcdefghijklmnopqrstuvwxyz1",
    expectedProviders: ["discord"]
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
  },
  {
    name: "env reference rejected",
    line: "OPENAI_API_KEY=${OPENAI_API_KEY}",
    expectedProviders: []
  },
  {
    name: "empty comment rejected",
    line: "// sk-your-openai-key",
    expectedProviders: []
  }
];
