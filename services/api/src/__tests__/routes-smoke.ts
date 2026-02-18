import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerRoutes } from "../routes";

const createMockServer = async () => {
  const app = Fastify();
  let capturedAuditQuery: unknown = null;

  await registerRoutes(app, {
    listLeaks: async () => ({ data: [], page: 1, pageSize: 24, total: 0 }),
    listProviders: async () => [],
    getStats: async () => ({ leaksToday: 0, totalLeaks: 0, totalReposScanned: 0 }),
    listLeaderboard: async () => [],
    getWeeklyActivity: async () => [],
    createManualScan: async (query?: string) => ({
      id: "job-1",
      mode: "manual" as const,
      query: query ?? null,
      status: "pending",
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null
    }),
    listSchedules: async () => [],
    listScanJobs: async () => [],
    getScanJob: async () => null,
    createSchedule: async ({ intervalMinutes, query, enabled }) => ({
      id: "schedule-1",
      intervalMinutes,
      query: query ?? null,
      enabled,
      nextRunAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }),
    toggleSchedule: async () => null,
    listAdminAuditLogs: async (query) => {
      capturedAuditQuery = query;
      return { data: [], nextCursor: null };
    },
    recordAdminAudit: async () => {
      // noop
    },
    getWorkerRuntimeStatus: async () => ({
      retention: {
        enabled: true,
        retentionDays: 30,
        lastRunAt: null,
        lastDeleted: 0
      },
      rateLimit: {
        eventsResetAfterMs: null,
        eventsRemaining: null,
        eventsLimit: null,
        commitResetAfterMs: null,
        commitRemaining: null,
        commitLimit: null,
        codeResetAfterMs: null,
        codeRemaining: null,
        codeLimit: null,
        updatedAt: null
      },
      pipeline: {
        cycleCount: 3,
        lastCycleStartedAt: null,
        lastCycleFinishedAt: null,
        lastCycleDurationMs: 1200,
        lastAutoInserted: 4,
        lastAutoEventsJobs: 8,
        lastAutoBackfillCodeItems: 2,
        lastAutoBackfillCommitItems: 3,
        lastAutoErrors: 1,
        lastManualInserted: 2,
        lastManualJobsProcessed: 1,
        lastManualJobsErrored: 0,
        totalAutoInserted: 40,
        totalAutoErrors: 6,
        totalManualInserted: 12,
        totalManualJobsProcessed: 10,
        totalManualJobsErrored: 1
      }
    })
  });

  return { app, getCapturedAuditQuery: () => capturedAuditQuery };
};

const run = async (): Promise<void> => {
  const { app, getCapturedAuditQuery } = await createMockServer();

  process.env.ADMIN_API_KEY = "test-admin-key";

  const unauthorizedStatus = await app.inject({
    method: "GET",
    url: "/internal/worker-status"
  });
  assert.equal(unauthorizedStatus.statusCode, 401);

  const badScan = await app.inject({
    method: "POST",
    url: "/scan-requests",
    headers: { "x-leak-radar-admin-key": "test-admin-key" },
    payload: { query: "sk-proj-", providers: ["openai"] }
  });
  assert.equal(badScan.statusCode, 400);

  const goodScan = await app.inject({
    method: "POST",
    url: "/scan-requests",
    headers: { "x-leak-radar-admin-key": "test-admin-key" },
    payload: { providers: ["openai", "mistral"] }
  });
  assert.equal(goodScan.statusCode, 200);

  const badSchedule = await app.inject({
    method: "POST",
    url: "/scan-schedules",
    headers: { "x-leak-radar-admin-key": "test-admin-key" },
    payload: { intervalMinutes: 10 }
  });
  assert.equal(badSchedule.statusCode, 400);

  const badToggle = await app.inject({
    method: "POST",
    url: "/scan-schedules/a/toggle",
    headers: { "x-leak-radar-admin-key": "test-admin-key" },
    payload: { enabled: "yes" }
  });
  assert.equal(badToggle.statusCode, 400);

  const missingJob = await app.inject({
    method: "GET",
    url: "/scan-jobs/not-found",
    headers: { "x-leak-radar-admin-key": "test-admin-key" }
  });
  assert.equal(missingJob.statusCode, 404);

  const runtimeStatus = await app.inject({
    method: "GET",
    url: "/internal/worker-status",
    headers: { "x-leak-radar-admin-key": "test-admin-key" }
  });
  assert.equal(runtimeStatus.statusCode, 200);

  const sloStatus = await app.inject({
    method: "GET",
    url: "/internal/slo",
    headers: { "x-leak-radar-admin-key": "test-admin-key" }
  });
  assert.equal(sloStatus.statusCode, 200);
  const sloPayload = JSON.parse(sloStatus.body) as {
    data: {
      thresholds: { statusAgeMsMax: number; autoErrorRatioMax: number };
      met: { overall: boolean };
    };
  };
  assert.equal(sloPayload.data.thresholds.statusAgeMsMax, 300000);
  assert.equal(sloPayload.data.thresholds.autoErrorRatioMax, 0.3);
  assert.equal(typeof sloPayload.data.met.overall, "boolean");

  const metrics = await app.inject({
    method: "GET",
    url: "/internal/metrics",
    headers: { "x-leak-radar-admin-key": "test-admin-key" }
  });
  assert.equal(metrics.statusCode, 200);
  const contentType = String(metrics.headers["content-type"] ?? "");
  assert.equal(contentType.includes("text/plain"), true);
  assert.equal(metrics.body.includes("leak_worker_pipeline_cycle_count 3"), true);
  assert.equal(metrics.body.includes("leak_worker_pipeline_total_auto_inserted 40"), true);
  assert.equal(metrics.body.includes("leak_worker_pipeline_last_auto_error_ratio"), true);
  assert.equal(metrics.body.includes("leak_worker_pipeline_last_auto_insert_ratio"), true);
  assert.equal(metrics.body.includes("leak_worker_status_age_ms"), true);
  assert.equal(metrics.body.includes("leak_worker_slo_overall_met"), true);
  assert.equal(metrics.body.includes("leak_worker_detection_ruleset_info"), true);

  const auditLogs = await app.inject({
    method: "GET",
    url: "/internal/audit-logs?limit=10&status=failed&role=ops&actorId=security-ops&sinceHours=24&cursor=abc",
    headers: { "x-leak-radar-admin-key": "test-admin-key" }
  });
  assert.equal(auditLogs.statusCode, 200);
  const auditPayload = JSON.parse(auditLogs.body) as { data: unknown[]; nextCursor: string | null };
  assert.equal(Array.isArray(auditPayload.data), true);
  assert.equal(auditPayload.nextCursor, null);
  assert.deepEqual(getCapturedAuditQuery(), {
    limit: 10,
    sinceHours: 24,
    status: "failed",
    role: "ops",
    actorId: "security-ops",
    cursor: "abc"
  });

  delete process.env.ADMIN_API_KEY;

  process.env.ADMIN_API_KEYS = "ops-key:read|ops;writer-key:read|write";

  const roleForbidden = await app.inject({
    method: "DELETE",
    url: "/leaks/duplicates",
    headers: { "x-leak-radar-admin-key": "writer-key" }
  });
  assert.equal(roleForbidden.statusCode, 403);

  const roleAllowed = await app.inject({
    method: "GET",
    url: "/internal/worker-status",
    headers: { "x-leak-radar-admin-key": "ops-key" }
  });
  assert.equal(roleAllowed.statusCode, 200);

  delete process.env.ADMIN_API_KEYS;

  await app.close();
  console.log("[api-routes-smoke] ok");
};

void run();
