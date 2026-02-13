import type { FastifyInstance } from "fastify";
import type { LeakQuery } from "@leak/shared";
import {
  getStats,
  getWeeklyActivity,
  listLeaderboard,
  listLeaks,
  listProviders
} from "./repositories/leaks-repository";
import {
  createManualScan,
  createSchedule,
  listSchedules,
  listScanJobs,
  getScanJob,
  toggleSchedule
} from "./repositories/scan-repository";

const parseQuery = (query: Record<string, unknown>): LeakQuery => ({
  provider: typeof query.provider === "string" ? query.provider : undefined,
  sort: query.sort === "oldest" ? "oldest" : "newest",
  timeRange:
    query.timeRange === "24h" ||
    query.timeRange === "7d" ||
    query.timeRange === "30d" ||
    query.timeRange === "all"
      ? query.timeRange
      : "all",
  page: typeof query.page === "string" ? Number.parseInt(query.page, 10) : undefined,
  pageSize:
    typeof query.pageSize === "string" ? Number.parseInt(query.pageSize, 10) : undefined
});

export const registerRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/leaks", async (request) => {
    const query = parseQuery(request.query as Record<string, unknown>);
    return await listLeaks(query);
  });

  app.get("/providers", async () => ({ data: await listProviders() }));
  app.get("/stats", async () => await getStats());
  app.get("/leaderboard", async () => ({ data: await listLeaderboard() }));
  app.get("/activity", async () => ({ data: await getWeeklyActivity() }));

  app.post("/scan-requests", async (request) => {
    const body = (request.body ?? {}) as { query?: string; providers?: string[] };
    // providers 배열이 있으면 JSON으로 인코딩하여 query 필드에 저장
    const query = body.providers && body.providers.length > 0
      ? JSON.stringify({ providers: body.providers })
      : body.query;
    const job = await createManualScan(query);
    return { data: job };
  });

  app.get("/scan-schedules", async () => ({ data: await listSchedules() }));

  app.get("/scan-jobs", async () => ({ data: await listScanJobs() }));

  app.get("/scan-jobs/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const job = await getScanJob(params.id);
    if (!job) {
      reply.code(404);
      return { error: "Scan job not found" };
    }
    return { data: job };
  });

  app.post("/scan-schedules", async (request) => {
    const body = (request.body ?? {}) as {
      intervalMinutes?: number;
      query?: string;
      enabled?: boolean;
    };
    const intervalMinutes = body.intervalMinutes ?? 60;
    const schedule = await createSchedule({
      intervalMinutes,
      query: body.query,
      enabled: body.enabled ?? false
    });
    return { data: schedule };
  });

  // AI 모델이 아닌 leak 정리 (기존 데이터 클린업용)
  app.delete("/leaks/non-ai", async () => {
    const { getPool } = await import("./db");
    const pool = getPool();
    const AI_PROVIDER_LIST = [
      "openai", "anthropic", "google", "grok",
      "kimi", "glm", "deepseek", "mistral"
    ];
    const placeholders = AI_PROVIDER_LIST.map((_, i) => `$${i + 1}`).join(", ");
    const result = await pool.query(
      `DELETE FROM leaks WHERE provider NOT IN (${placeholders})`,
      AI_PROVIDER_LIST
    );
    const deleted = result.rowCount ?? 0;
    return { deleted, message: `AI 모델이 아닌 leak ${deleted}건 삭제 완료` };
  });

  // 피드 초기화 – 모든 leaks 삭제 및 관련 집계 리셋
  app.delete("/leaks", async () => {
    const { getPool } = await import("./db");
    const pool = getPool();
    const leaksResult = await pool.query("DELETE FROM leaks");
    const deleted = leaksResult.rowCount ?? 0;
    // 집계 테이블도 리셋
    await pool.query("DELETE FROM activity_daily").catch(() => {});
    await pool.query("DELETE FROM leaderboard_devs").catch(() => {});
    return { deleted, message: `전체 피드 초기화 완료 (${deleted}건 삭제)` };
  });

  // 중복 leak 정리 – 같은 provider + redacted_key 기준 전체에서 최신 1건만 남김
  // repo가 달라도 같은 키면 중복 → 테스트 키 복붙 스팸 제거
  app.delete("/leaks/duplicates", async () => {
    const { getPool } = await import("./db");
    const pool = getPool();
    const result = await pool.query(`
      DELETE FROM leaks
      WHERE id NOT IN (
        SELECT DISTINCT ON (provider, redacted_key)
               id
        FROM leaks
        ORDER BY provider, redacted_key, detected_at DESC
      )
    `);
    const deleted = result.rowCount ?? 0;
    return { deleted, message: `중복 leak ${deleted}건 제거 완료` };
  });

  app.post("/scan-schedules/:id/toggle", async (request) => {
    const params = request.params as { id: string };
    const body = (request.body ?? {}) as { enabled?: boolean };
    const enabled = body.enabled ?? false;
    const schedule = await toggleSchedule({ id: params.id, enabled });
    if (!schedule) {
      return { error: "Schedule not found" };
    }
    return { data: schedule };
  });
};
