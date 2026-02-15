export type LeakRecord = {
  id: string;
  provider: string;
  redactedKey: string;
  repoOwner: string;
  repoName: string;
  actorLogin?: string | null;
  filePath: string;
  commitSha: string;
  sourceUrl: string;
  detectedAt: string;
  addedAt: string;
};

export type ProviderStat = {
  provider: string;
  leakCount: number;
};

export type LeaderboardEntry = {
  actorLogin: string;
  leakCount: number;
  lastSeenAt: string;
};

export type ActivityPoint = {
  date: string;
  leakCount: number;
};

export type StatsSummary = {
  leaksToday: number;
  totalLeaks: number;
  totalReposScanned: number;
};

export type WorkerRuntimeStatus = {
  retention: {
    enabled: boolean;
    retentionDays: number;
    lastRunAt: string | null;
    lastDeleted: number;
  };
  rateLimit: {
    eventsResetAfterMs: number | null;
    eventsRemaining: number | null;
    eventsLimit: number | null;
    commitResetAfterMs: number | null;
    commitRemaining: number | null;
    commitLimit: number | null;
    codeResetAfterMs: number | null;
    codeRemaining: number | null;
    codeLimit: number | null;
    updatedAt: string | null;
  };
  pipeline: {
    cycleCount: number;
    lastCycleStartedAt: string | null;
    lastCycleFinishedAt: string | null;
    lastCycleDurationMs: number;
    lastAutoInserted: number;
    lastAutoEventsJobs: number;
    lastAutoBackfillCodeItems: number;
    lastAutoBackfillCommitItems: number;
    lastAutoErrors: number;
    lastManualInserted: number;
    lastManualJobsProcessed: number;
    lastManualJobsErrored: number;
    totalAutoInserted: number;
    totalAutoErrors: number;
    totalManualInserted: number;
    totalManualJobsProcessed: number;
    totalManualJobsErrored: number;
  };
};

export type WorkerSloStatus = {
  thresholds: {
    statusAgeMsMax: number;
    autoErrorRatioMax: number;
  };
  values: {
    statusAgeMs: number;
    autoErrorRatio: number;
    autoInsertRatio: number;
    manualErrorRatio: number;
  };
  met: {
    statusFreshness: boolean;
    autoErrorRatio: boolean;
    overall: boolean;
  };
};

export type LeakQuery = {
  provider?: string;
  sort?: "newest" | "oldest";
  timeRange?: "24h" | "7d" | "30d" | "all";
  page?: number;
  pageSize?: number;
};

export const DETECTION_RULESET_VERSION = "2026.02.14.1";

export type ProviderGroup = "ai" | "service";

export type ProviderCatalogItem = {
  id: string;
  label: string;
  group: ProviderGroup;
};

export const PROVIDER_CATALOG: ProviderCatalogItem[] = [
  { id: "openai", label: "OpenAI", group: "ai" },
  { id: "anthropic", label: "Anthropic", group: "ai" },
  { id: "google", label: "Google", group: "ai" },
  { id: "grok", label: "Grok (xAI)", group: "ai" },
  { id: "kimi", label: "Kimi (Moonshot)", group: "ai" },
  { id: "glm", label: "GLM (Zhipu)", group: "ai" },
  { id: "deepseek", label: "DeepSeek", group: "ai" },
  { id: "mistral", label: "Mistral", group: "ai" },
  { id: "stripe", label: "Stripe", group: "service" },
  { id: "aws", label: "AWS", group: "service" },
  { id: "github", label: "GitHub", group: "service" },
  { id: "slack", label: "Slack", group: "service" },
  { id: "sendgrid", label: "SendGrid", group: "service" },
  { id: "firebase", label: "Firebase", group: "service" },
  { id: "supabase", label: "Supabase", group: "service" },
  { id: "vercel", label: "Vercel", group: "service" },
  { id: "npm", label: "NPM", group: "service" },
  { id: "discord", label: "Discord", group: "service" }
];

export const AI_PROVIDER_IDS = PROVIDER_CATALOG
  .filter((provider) => provider.group === "ai")
  .map((provider) => provider.id);

export const MANUAL_PROVIDER_IDS = PROVIDER_CATALOG.map((provider) => provider.id);

export const PROVIDER_LABELS: Record<string, string> = {
  ...Object.fromEntries(PROVIDER_CATALOG.map((provider) => [provider.id, provider.label])),
  private_key: "Private Key"
};

export const DEFAULT_PAGE_SIZE = 24;

export const normalizePage = (page: number | undefined): number => {
  if (!page || Number.isNaN(page) || page < 1) {
    return 1;
  }

  return Math.floor(page);
};

export const normalizePageSize = (pageSize: number | undefined): number => {
  if (!pageSize || Number.isNaN(pageSize) || pageSize < 1) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(Math.floor(pageSize), 100);
};
