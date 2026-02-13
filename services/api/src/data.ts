import type {
  ActivityPoint,
  LeaderboardEntry,
  LeakRecord,
  ProviderStat,
  StatsSummary
} from "@leak/shared";

export const leakSamples: LeakRecord[] = [
  {
    id: "leak-001",
    provider: "openai",
    redactedKey: "sk-***w9Y",
    repoOwner: "nuclear",
    repoName: "adapter",
    filePath: "tsconfig.json",
    commitSha: "2f1c9e3",
    sourceUrl: "https://github.com/nuclear/adapter/commit/2f1c9e3",
    detectedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    addedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: "leak-002",
    provider: "anthropic",
    redactedKey: "sk-ant-***gAA",
    repoOwner: "arch-dev",
    repoName: "app",
    filePath: "claude/.credentials.json",
    commitSha: "8a9e4d1",
    sourceUrl: "https://github.com/arch-dev/app/commit/8a9e4d1",
    detectedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    addedAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
  },
  {
    id: "leak-003",
    provider: "google",
    redactedKey: "AIza***w5yI",
    repoOwner: "aviation",
    repoName: "analytics",
    filePath: "docker-compose.yml",
    commitSha: "ca19b01",
    sourceUrl: "https://github.com/aviation/analytics/commit/ca19b01",
    detectedAt: new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(),
    addedAt: new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString()
  }
];

export const providerStats: ProviderStat[] = [
  { provider: "openai", leakCount: 8942 },
  { provider: "anthropic", leakCount: 4361 },
  { provider: "google", leakCount: 6213 }
];

export const statsSummary: StatsSummary = {
  leaksToday: 184,
  totalLeaks: 19516,
  totalReposScanned: 67452
};

export const leaderboardEntries: LeaderboardEntry[] = [
  { actorLogin: "Sosislan", leakCount: 112, lastSeenAt: new Date().toISOString() },
  { actorLogin: "perlman-i", leakCount: 97, lastSeenAt: new Date().toISOString() },
  { actorLogin: "khulnasof", leakCount: 91, lastSeenAt: new Date().toISOString() }
];

export const weeklyActivity: ActivityPoint[] = [
  { date: "Sat", leakCount: 450 },
  { date: "Sun", leakCount: 470 },
  { date: "Mon", leakCount: 280 },
  { date: "Tue", leakCount: 240 },
  { date: "Wed", leakCount: 210 },
  { date: "Thu", leakCount: 220 },
  { date: "Fri", leakCount: 120 }
];
