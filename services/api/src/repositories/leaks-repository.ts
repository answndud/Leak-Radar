import type {
  ActivityPoint,
  LeaderboardEntry,
  LeakQuery,
  LeakRecord,
  ProviderStat,
  StatsSummary
} from "@leak/shared";
import { normalizePage, normalizePageSize } from "@leak/shared";
import { getPool } from "../db";

export type LeakListResult = {
  data: LeakRecord[];
  page: number;
  pageSize: number;
  total: number;
};

export const listLeaks = async (query: LeakQuery): Promise<LeakListResult> => {
  const page = normalizePage(query.page);
  const pageSize = normalizePageSize(query.pageSize);
  const offset = (page - 1) * pageSize;
  const sortDirection = query.sort === "oldest" ? "ASC" : "DESC";

  const pool = getPool();
  const values: Array<string | number> = [];
  const where: string[] = [];

  if (query.provider) {
    values.push(query.provider);
    where.push(`provider = $${values.length}`);
  }

  const timeRangeToInterval: Record<string, string> = {
    "24h": "1 day",
    "7d": "7 days",
    "30d": "30 days"
  };

  if (query.timeRange && query.timeRange !== "all") {
    const interval = timeRangeToInterval[query.timeRange];
    if (interval) {
      values.push(interval);
      where.push(`detected_at >= now() - $${values.length}::interval`);
    }
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const totalResult = await pool.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM leaks ${whereClause}`,
    values
  );

  values.push(pageSize, offset);
  const dataResult = await pool.query<{
    id: string;
    provider: string;
    redacted_key: string;
    repo_owner: string;
    repo_name: string;
    actor_login: string | null;
    file_path: string;
    commit_sha: string;
    source_url: string;
    detected_at: string;
    added_at: string;
  }>(
    `SELECT
      id,
      provider,
      redacted_key,
      repo_owner,
      repo_name,
      actor_login,
      file_path,
      commit_sha,
      source_url,
      detected_at,
      added_at
     FROM leaks
     ${whereClause}
     ORDER BY detected_at ${sortDirection}
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  const records: LeakRecord[] = dataResult.rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    redactedKey: row.redacted_key,
    repoOwner: row.repo_owner,
    repoName: row.repo_name,
    actorLogin: row.actor_login,
    filePath: row.file_path,
    commitSha: row.commit_sha,
    sourceUrl: row.source_url,
    detectedAt: row.detected_at,
    addedAt: row.added_at
  }));

  return {
    data: records,
    page,
    pageSize,
    total: Number.parseInt(totalResult.rows[0]?.total ?? "0", 10)
  };
};

export const listProviders = async (): Promise<ProviderStat[]> => {
  const pool = getPool();
  const result = await pool.query<{ provider: string; leak_count: string }>(
    "SELECT provider, COUNT(*)::text AS leak_count FROM leaks GROUP BY provider ORDER BY leak_count DESC"
  );

  return result.rows.map((row) => ({
    provider: row.provider,
    leakCount: Number.parseInt(row.leak_count, 10)
  }));
};

export const getStats = async (): Promise<StatsSummary> => {
  const pool = getPool();
  const totalLeaksResult = await pool.query<{ total: string }>(
    "SELECT COUNT(*)::text AS total FROM leaks"
  );
  const leaksTodayResult = await pool.query<{ total: string }>(
    "SELECT COUNT(*)::text AS total FROM leaks WHERE detected_at >= now() - interval '1 day'"
  );
  const reposResult = await pool.query<{ total: string }>(
    "SELECT COUNT(DISTINCT repo_owner || '/' || repo_name)::text AS total FROM leaks"
  );

  return {
    leaksToday: Number.parseInt(leaksTodayResult.rows[0]?.total ?? "0", 10),
    totalLeaks: Number.parseInt(totalLeaksResult.rows[0]?.total ?? "0", 10),
    totalReposScanned: Number.parseInt(reposResult.rows[0]?.total ?? "0", 10)
  };
};

export const listLeaderboard = async (): Promise<LeaderboardEntry[]> => {
  const pool = getPool();
  const result = await pool.query<{
    actor_login: string;
    leak_count: number;
    last_seen_at: string;
  }>(
    "SELECT actor_login, leak_count, last_seen_at FROM leaderboard_devs ORDER BY leak_count DESC LIMIT 10"
  );

  return result.rows.map((row) => ({
    actorLogin: row.actor_login,
    leakCount: row.leak_count,
    lastSeenAt: row.last_seen_at
  }));
};

export const getWeeklyActivity = async (): Promise<ActivityPoint[]> => {
  const pool = getPool();
  const result = await pool.query<{ date: string; leaks_count: number }>(
    "SELECT date::text AS date, leaks_count FROM activity_daily ORDER BY date DESC LIMIT 7"
  );

  return result.rows
    .reverse()
    .map((row) => ({ date: row.date, leakCount: row.leaks_count }));
};
