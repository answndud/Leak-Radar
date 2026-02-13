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

export type LeakQuery = {
  provider?: string;
  sort?: "newest" | "oldest";
  timeRange?: "24h" | "7d" | "30d" | "all";
  page?: number;
  pageSize?: number;
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
