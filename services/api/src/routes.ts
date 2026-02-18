import type { FastifyInstance } from "fastify";
import {
  AI_PROVIDER_IDS,
  DETECTION_RULESET_VERSION,
  type LeakQuery,
  type WorkerSloStatus,
  type WorkerRuntimeStatus
} from "@leak/shared";
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
import { getWorkerRuntimeStatus } from "./repositories/runtime-status-repository";
import {
  listAdminAuditLogs,
  recordAdminAudit,
  type AdminAuditQuery,
  type AdminAuditStatus
} from "./repositories/admin-audit-repository";
import {
  createAdminAuditView,
  deleteAdminAuditView,
  listAdminAuditViews,
  updateAdminAuditView,
  type AdminAuditViewFilters
} from "./repositories/admin-audit-view-repository";
import {
  parseScanRequestBody,
  parseScheduleBody,
  parseScheduleToggleBody
} from "./validation";
import { authEnabled, ensureRole, type AdminRole } from "./auth";

type RoutesDeps = {
  listLeaks: typeof listLeaks;
  listProviders: typeof listProviders;
  getStats: typeof getStats;
  listLeaderboard: typeof listLeaderboard;
  getWeeklyActivity: typeof getWeeklyActivity;
  createManualScan: typeof createManualScan;
  listSchedules: typeof listSchedules;
  listScanJobs: typeof listScanJobs;
  getScanJob: typeof getScanJob;
  createSchedule: typeof createSchedule;
  toggleSchedule: typeof toggleSchedule;
  getWorkerRuntimeStatus: () => Promise<WorkerRuntimeStatus>;
  listAdminAuditLogs: typeof listAdminAuditLogs;
  recordAdminAudit: typeof recordAdminAudit;
  listAdminAuditViews: typeof listAdminAuditViews;
  createAdminAuditView: typeof createAdminAuditView;
  deleteAdminAuditView: typeof deleteAdminAuditView;
  updateAdminAuditView: typeof updateAdminAuditView;
};

const defaultDeps: RoutesDeps = {
  listLeaks,
  listProviders,
  getStats,
  listLeaderboard,
  getWeeklyActivity,
  createManualScan,
  listSchedules,
  listScanJobs,
  getScanJob,
  createSchedule,
  toggleSchedule,
  getWorkerRuntimeStatus,
  listAdminAuditLogs,
  recordAdminAudit,
  listAdminAuditViews,
  createAdminAuditView,
  deleteAdminAuditView,
  updateAdminAuditView
};

const STATUS_AGE_SLO_MAX_MS = 300000;
const AUTO_ERROR_RATIO_SLO_MAX = 0.3;

const buildSloStatus = (status: WorkerRuntimeStatus): WorkerSloStatus => {
  const autoWorkload =
    status.pipeline.lastAutoEventsJobs +
    status.pipeline.lastAutoBackfillCodeItems +
    status.pipeline.lastAutoBackfillCommitItems;

  const autoInsertRatio = autoWorkload > 0
    ? status.pipeline.lastAutoInserted / autoWorkload
    : 0;
  const autoErrorRatio = autoWorkload > 0
    ? status.pipeline.lastAutoErrors / autoWorkload
    : 0;
  const manualErrorRatio = status.pipeline.lastManualJobsProcessed > 0
    ? status.pipeline.lastManualJobsErrored / status.pipeline.lastManualJobsProcessed
    : 0;
  const updatedAtMs = status.rateLimit.updatedAt ? Date.parse(status.rateLimit.updatedAt) : NaN;
  const statusAgeMs = Number.isNaN(updatedAtMs) ? -1 : Math.max(0, Date.now() - updatedAtMs);
  const statusFreshnessMet = statusAgeMs >= 0 && statusAgeMs < STATUS_AGE_SLO_MAX_MS;
  const autoErrorRatioMet = autoErrorRatio < AUTO_ERROR_RATIO_SLO_MAX;

  return {
    thresholds: {
      statusAgeMsMax: STATUS_AGE_SLO_MAX_MS,
      autoErrorRatioMax: AUTO_ERROR_RATIO_SLO_MAX
    },
    values: {
      statusAgeMs,
      autoErrorRatio,
      autoInsertRatio,
      manualErrorRatio
    },
    met: {
      statusFreshness: statusFreshnessMet,
      autoErrorRatio: autoErrorRatioMet,
      overall: statusFreshnessMet && autoErrorRatioMet
    }
  };
};

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

const parsePositiveInt = (value: unknown, fallback: number): number => {
  if (typeof value !== "string") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
};

const parseAuditStatus = (value: unknown): AdminAuditStatus | undefined => {
  if (value !== "allowed" && value !== "denied" && value !== "failed") {
    return undefined;
  }
  return value;
};

const parseAuditQuery = (query: Record<string, unknown>): AdminAuditQuery => {
  const role = typeof query.role === "string" && query.role.trim().length > 0
    ? query.role.trim().toLowerCase()
    : undefined;
  const actorId = typeof query.actorId === "string" && query.actorId.trim().length > 0
    ? query.actorId.trim()
    : undefined;

  return {
    limit: parsePositiveInt(query.limit, 100),
    sinceHours: parsePositiveInt(query.sinceHours, 0),
    status: parseAuditStatus(query.status),
    role,
    actorId,
    cursor: typeof query.cursor === "string" && query.cursor.trim().length > 0
      ? query.cursor.trim()
      : undefined
  };
};

const parseAuditViewBody = (body: unknown):
  { data: { name: string; filters: AdminAuditViewFilters } }
  | { error: string } => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "요청 본문이 필요합니다." };
  }

  const record = body as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (name.length < 2 || name.length > 64) {
    return { error: "name은 2~64자여야 합니다." };
  }

  const status = parseAuditStatus(record.status);
  const role =
    record.role === "ops" ||
    record.role === "read" ||
    record.role === "write" ||
    record.role === "danger"
      ? record.role
      : undefined;
  const actorId = typeof record.actorId === "string" && record.actorId.trim().length > 0
    ? record.actorId.trim()
    : undefined;
  const sinceHours = typeof record.sinceHours === "number" && Number.isFinite(record.sinceHours)
    ? Math.max(0, Math.floor(record.sinceHours))
    : undefined;
  const sortKey =
    record.sortKey === "occurredAt" ||
    record.sortKey === "status" ||
    record.sortKey === "role" ||
    record.sortKey === "actorId" ||
    record.sortKey === "action" ||
    record.sortKey === "resource"
      ? record.sortKey
      : undefined;
  const sortDir = record.sortDir === "asc" || record.sortDir === "desc" ? record.sortDir : undefined;
  const searchQuery = typeof record.searchQuery === "string" && record.searchQuery.trim().length > 0
    ? record.searchQuery.trim().slice(0, 120)
    : undefined;

  return {
    data: {
      name,
      filters: {
        status,
        role,
        actorId,
        sinceHours,
        sortKey,
        sortDir,
        searchQuery
      }
    }
  };
};

export const registerRoutes = async (app: FastifyInstance, deps?: Partial<RoutesDeps>): Promise<void> => {
  const resolvedDeps: RoutesDeps = {
    ...defaultDeps,
    ...(deps ?? {})
  };

  const writeAudit = async (params: {
    request: { ip: string; headers: Record<string, unknown> };
    actorId?: string | null;
    role: AdminRole;
    action: string;
    status: AdminAuditStatus;
    resource: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> => {
    try {
      const userAgent = typeof params.request.headers["user-agent"] === "string"
        ? params.request.headers["user-agent"]
        : null;
      await resolvedDeps.recordAdminAudit({
        actorId: params.actorId ?? null,
        role: params.role,
        action: params.action,
        status: params.status,
        resource: params.resource,
        ip: params.request.ip,
        userAgent,
        metadata: params.metadata ?? {}
      });
    } catch {
      // audit 저장 실패는 API 요청 성공/실패를 막지 않음
    }
  };

  const authorize = async (params: {
    request: Parameters<typeof ensureRole>[0];
    reply: Parameters<typeof ensureRole>[1];
    role: AdminRole;
    action: string;
    resource: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ actorId: string | null; role: AdminRole } | null> => {
    const principal = ensureRole(params.request, params.reply, params.role);
    if (!principal) {
      if (authEnabled()) {
        await writeAudit({
          request: params.request,
          role: params.role,
          action: params.action,
          status: "denied",
          resource: params.resource,
          metadata: params.metadata
        });
      }
      return null;
    }

    return { actorId: principal.actorId, role: params.role };
  };

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/leaks", async (request) => {
    const query = parseQuery(request.query as Record<string, unknown>);
    return await resolvedDeps.listLeaks(query);
  });

  app.get("/providers", async () => ({ data: await resolvedDeps.listProviders() }));
  app.get("/stats", async () => await resolvedDeps.getStats());
  app.get("/leaderboard", async () => ({ data: await resolvedDeps.listLeaderboard() }));
  app.get("/activity", async () => ({ data: await resolvedDeps.getWeeklyActivity() }));
  app.get("/internal/worker-status", async (request, reply) => {
    const granted = await authorize({
      request,
      reply,
      role: "ops",
      action: "read-worker-status",
      resource: "/internal/worker-status"
    });
    if (!granted) {
      return;
    }
    return { data: await resolvedDeps.getWorkerRuntimeStatus() };
  });
  app.get("/internal/slo", async (request, reply) => {
    const granted = await authorize({
      request,
      reply,
      role: "ops",
      action: "read-worker-slo",
      resource: "/internal/slo"
    });
    if (!granted) {
      return;
    }
    const status = await resolvedDeps.getWorkerRuntimeStatus();
    return { data: buildSloStatus(status) };
  });
  app.get("/internal/metrics", async (request, reply) => {
    const granted = await authorize({
      request,
      reply,
      role: "ops",
      action: "read-worker-metrics",
      resource: "/internal/metrics"
    });
    if (!granted) {
      return;
    }
    const status = await resolvedDeps.getWorkerRuntimeStatus();
    const slo = buildSloStatus(status);
    const statusFreshnessSloMet = slo.met.statusFreshness ? 1 : 0;
    const autoErrorSloMet = slo.met.autoErrorRatio ? 1 : 0;
    const sloOverallMet = slo.met.overall ? 1 : 0;

    const metrics = [
      "# HELP leak_worker_retention_enabled Worker retention enabled flag",
      "# TYPE leak_worker_retention_enabled gauge",
      `leak_worker_retention_enabled ${status.retention.enabled ? 1 : 0}`,
      "# HELP leak_worker_retention_days Worker retention period in days",
      "# TYPE leak_worker_retention_days gauge",
      `leak_worker_retention_days ${status.retention.retentionDays}`,
      "# HELP leak_worker_retention_last_deleted Last retention deleted count",
      "# TYPE leak_worker_retention_last_deleted gauge",
      `leak_worker_retention_last_deleted ${status.retention.lastDeleted}`,
      "# HELP leak_worker_ratelimit_remaining GitHub API remaining tokens",
      "# TYPE leak_worker_ratelimit_remaining gauge",
      `leak_worker_ratelimit_remaining{api="events"} ${status.rateLimit.eventsRemaining ?? -1}`,
      `leak_worker_ratelimit_remaining{api="commits"} ${status.rateLimit.commitRemaining ?? -1}`,
      `leak_worker_ratelimit_remaining{api="code"} ${status.rateLimit.codeRemaining ?? -1}`,
      "# HELP leak_worker_ratelimit_limit GitHub API limit",
      "# TYPE leak_worker_ratelimit_limit gauge",
      `leak_worker_ratelimit_limit{api="events"} ${status.rateLimit.eventsLimit ?? -1}`,
      `leak_worker_ratelimit_limit{api="commits"} ${status.rateLimit.commitLimit ?? -1}`,
      `leak_worker_ratelimit_limit{api="code"} ${status.rateLimit.codeLimit ?? -1}`,
      "# HELP leak_worker_ratelimit_reset_after_ms GitHub API reset wait ms",
      "# TYPE leak_worker_ratelimit_reset_after_ms gauge",
      `leak_worker_ratelimit_reset_after_ms{api="events"} ${status.rateLimit.eventsResetAfterMs ?? 0}`,
      `leak_worker_ratelimit_reset_after_ms{api="commits"} ${status.rateLimit.commitResetAfterMs ?? 0}`,
      `leak_worker_ratelimit_reset_after_ms{api="code"} ${status.rateLimit.codeResetAfterMs ?? 0}`,
      "# HELP leak_worker_pipeline_cycle_count Total worker cycles",
      "# TYPE leak_worker_pipeline_cycle_count counter",
      `leak_worker_pipeline_cycle_count ${status.pipeline.cycleCount}`,
      "# HELP leak_worker_pipeline_cycle_duration_ms Last cycle duration in ms",
      "# TYPE leak_worker_pipeline_cycle_duration_ms gauge",
      `leak_worker_pipeline_cycle_duration_ms ${status.pipeline.lastCycleDurationMs}`,
      "# HELP leak_worker_pipeline_last_auto_inserted Last auto-scan inserted leaks",
      "# TYPE leak_worker_pipeline_last_auto_inserted gauge",
      `leak_worker_pipeline_last_auto_inserted ${status.pipeline.lastAutoInserted}`,
      "# HELP leak_worker_pipeline_last_auto_events_jobs Last auto-scan events jobs",
      "# TYPE leak_worker_pipeline_last_auto_events_jobs gauge",
      `leak_worker_pipeline_last_auto_events_jobs ${status.pipeline.lastAutoEventsJobs}`,
      "# HELP leak_worker_pipeline_last_auto_backfill_code_items Last auto-scan code backfill items",
      "# TYPE leak_worker_pipeline_last_auto_backfill_code_items gauge",
      `leak_worker_pipeline_last_auto_backfill_code_items ${status.pipeline.lastAutoBackfillCodeItems}`,
      "# HELP leak_worker_pipeline_last_auto_backfill_commit_items Last auto-scan commit backfill items",
      "# TYPE leak_worker_pipeline_last_auto_backfill_commit_items gauge",
      `leak_worker_pipeline_last_auto_backfill_commit_items ${status.pipeline.lastAutoBackfillCommitItems}`,
      "# HELP leak_worker_pipeline_last_auto_errors Last auto-scan processing errors",
      "# TYPE leak_worker_pipeline_last_auto_errors gauge",
      `leak_worker_pipeline_last_auto_errors ${status.pipeline.lastAutoErrors}`,
      "# HELP leak_worker_pipeline_last_manual_inserted Last manual-scan inserted leaks",
      "# TYPE leak_worker_pipeline_last_manual_inserted gauge",
      `leak_worker_pipeline_last_manual_inserted ${status.pipeline.lastManualInserted}`,
      "# HELP leak_worker_pipeline_last_manual_jobs_processed Last cycle manual jobs processed",
      "# TYPE leak_worker_pipeline_last_manual_jobs_processed gauge",
      `leak_worker_pipeline_last_manual_jobs_processed ${status.pipeline.lastManualJobsProcessed}`,
      "# HELP leak_worker_pipeline_last_manual_jobs_errored Last cycle manual jobs errored",
      "# TYPE leak_worker_pipeline_last_manual_jobs_errored gauge",
      `leak_worker_pipeline_last_manual_jobs_errored ${status.pipeline.lastManualJobsErrored}`,
      "# HELP leak_worker_pipeline_total_auto_inserted Total auto-scan inserted leaks since worker start",
      "# TYPE leak_worker_pipeline_total_auto_inserted counter",
      `leak_worker_pipeline_total_auto_inserted ${status.pipeline.totalAutoInserted}`,
      "# HELP leak_worker_pipeline_total_auto_errors Total auto-scan errors since worker start",
      "# TYPE leak_worker_pipeline_total_auto_errors counter",
      `leak_worker_pipeline_total_auto_errors ${status.pipeline.totalAutoErrors}`,
      "# HELP leak_worker_pipeline_total_manual_inserted Total manual-scan inserted leaks since worker start",
      "# TYPE leak_worker_pipeline_total_manual_inserted counter",
      `leak_worker_pipeline_total_manual_inserted ${status.pipeline.totalManualInserted}`,
      "# HELP leak_worker_pipeline_total_manual_jobs_processed Total manual jobs processed since worker start",
      "# TYPE leak_worker_pipeline_total_manual_jobs_processed counter",
      `leak_worker_pipeline_total_manual_jobs_processed ${status.pipeline.totalManualJobsProcessed}`,
      "# HELP leak_worker_pipeline_total_manual_jobs_errored Total manual jobs errored since worker start",
      "# TYPE leak_worker_pipeline_total_manual_jobs_errored counter",
      `leak_worker_pipeline_total_manual_jobs_errored ${status.pipeline.totalManualJobsErrored}`,
      "# HELP leak_worker_pipeline_last_auto_error_ratio Last auto-scan error ratio",
      "# TYPE leak_worker_pipeline_last_auto_error_ratio gauge",
      `leak_worker_pipeline_last_auto_error_ratio ${slo.values.autoErrorRatio}`,
      "# HELP leak_worker_pipeline_last_auto_insert_ratio Last auto-scan insert ratio",
      "# TYPE leak_worker_pipeline_last_auto_insert_ratio gauge",
      `leak_worker_pipeline_last_auto_insert_ratio ${slo.values.autoInsertRatio}`,
      "# HELP leak_worker_pipeline_last_manual_error_ratio Last manual job error ratio",
      "# TYPE leak_worker_pipeline_last_manual_error_ratio gauge",
      `leak_worker_pipeline_last_manual_error_ratio ${slo.values.manualErrorRatio}`,
      "# HELP leak_worker_status_age_ms Worker status payload age in ms",
      "# TYPE leak_worker_status_age_ms gauge",
      `leak_worker_status_age_ms ${slo.values.statusAgeMs}`,
      "# HELP leak_worker_slo_status_freshness_met Worker freshness SLO met (1/0)",
      "# TYPE leak_worker_slo_status_freshness_met gauge",
      `leak_worker_slo_status_freshness_met ${statusFreshnessSloMet}`,
      "# HELP leak_worker_slo_auto_error_ratio_met Worker auto error ratio SLO met (1/0)",
      "# TYPE leak_worker_slo_auto_error_ratio_met gauge",
      `leak_worker_slo_auto_error_ratio_met ${autoErrorSloMet}`,
      "# HELP leak_worker_slo_overall_met Worker overall SLO met (1/0)",
      "# TYPE leak_worker_slo_overall_met gauge",
      `leak_worker_slo_overall_met ${sloOverallMet}`,
      "# HELP leak_worker_detection_ruleset_info Detection ruleset version info",
      "# TYPE leak_worker_detection_ruleset_info gauge",
      `leak_worker_detection_ruleset_info{version="${DETECTION_RULESET_VERSION}"} 1`
    ].join("\n");

    reply.type("text/plain; version=0.0.4");
    return `${metrics}\n`;
  });

  app.get("/internal/audit-logs", async (request, reply) => {
    const granted = await authorize({
      request,
      reply,
      role: "ops",
      action: "read-admin-audit-logs",
      resource: "/internal/audit-logs"
    });
    if (!granted) {
      return;
    }

    const query = parseAuditQuery(request.query as Record<string, unknown>);
    return await resolvedDeps.listAdminAuditLogs(query);
  });

  app.get("/internal/audit-views", async (request, reply) => {
    const granted = await authorize({
      request,
      reply,
      role: "ops",
      action: "list-admin-audit-views",
      resource: "/internal/audit-views"
    });
    if (!granted) {
      return;
    }

    return { data: await resolvedDeps.listAdminAuditViews() };
  });

  app.post("/internal/audit-views", async (request, reply) => {
    const granted = await authorize({
      request,
      reply,
      role: "ops",
      action: "create-admin-audit-view",
      resource: "/internal/audit-views"
    });
    if (!granted) {
      return;
    }

    const parsed = parseAuditViewBody(request.body);
    if ("error" in parsed) {
      await writeAudit({
        request,
        actorId: granted.actorId,
        role: granted.role,
        action: "create-admin-audit-view",
        status: "failed",
        resource: "/internal/audit-views",
        metadata: { reason: parsed.error }
      });
      reply.code(400);
      return { error: parsed.error };
    }

    const created = await resolvedDeps.createAdminAuditView({
      name: parsed.data.name,
      filters: parsed.data.filters,
      createdBy: granted.actorId
    });

    await writeAudit({
      request,
      actorId: granted.actorId,
      role: granted.role,
      action: "create-admin-audit-view",
      status: "allowed",
      resource: "/internal/audit-views",
      metadata: { auditViewId: created.id, name: created.name }
    });

    return { data: created };
  });

  app.delete("/internal/audit-views/:id", async (request, reply) => {
    const granted = await authorize({
      request,
      reply,
      role: "ops",
      action: "delete-admin-audit-view",
      resource: "/internal/audit-views/:id"
    });
    if (!granted) {
      return;
    }

    const params = request.params as { id?: string };
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) {
      reply.code(400);
      return { error: "id가 필요합니다." };
    }

    const deleted = await resolvedDeps.deleteAdminAuditView(id);
    if (!deleted) {
      reply.code(404);
      return { error: "Audit view not found" };
    }

    await writeAudit({
      request,
      actorId: granted.actorId,
      role: granted.role,
      action: "delete-admin-audit-view",
      status: "allowed",
      resource: "/internal/audit-views/:id",
      metadata: { auditViewId: id }
    });

    return { deleted: 1 };
  });

  app.patch("/internal/audit-views/:id", async (request, reply) => {
    const granted = await authorize({
      request,
      reply,
      role: "ops",
      action: "update-admin-audit-view",
      resource: "/internal/audit-views/:id"
    });
    if (!granted) {
      return;
    }

    const params = request.params as { id?: string };
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) {
      reply.code(400);
      return { error: "id가 필요합니다." };
    }

    const parsed = parseAuditViewBody(request.body);
    if ("error" in parsed) {
      reply.code(400);
      return { error: parsed.error };
    }

    const updated = await resolvedDeps.updateAdminAuditView({
      id,
      name: parsed.data.name,
      filters: parsed.data.filters
    });
    if (!updated) {
      reply.code(404);
      return { error: "Audit view not found" };
    }

    await writeAudit({
      request,
      actorId: granted.actorId,
      role: granted.role,
      action: "update-admin-audit-view",
      status: "allowed",
      resource: "/internal/audit-views/:id",
      metadata: { auditViewId: id, name: updated.name }
    });

    return { data: updated };
  });

  app.post("/scan-requests", async (request, reply) => {
    const granted = await authorize({
      request,
      reply,
      role: "write",
      action: "create-scan-request",
      resource: "/scan-requests"
    });
    if (!granted) {
      return;
    }
    const parsed = parseScanRequestBody(request.body ?? {});
    if (parsed.error) {
      await writeAudit({
        request,
        actorId: granted.actorId,
        role: granted.role,
        action: "create-scan-request",
        status: "failed",
        resource: "/scan-requests",
        metadata: { reason: parsed.error }
      });
      reply.code(400);
      return { error: parsed.error };
    }

    const body = parsed.data;
    if (!body) {
      await writeAudit({
        request,
        actorId: granted.actorId,
        role: granted.role,
        action: "create-scan-request",
        status: "failed",
        resource: "/scan-requests",
        metadata: { reason: "missing-body" }
      });
      reply.code(400);
      return { error: "유효한 스캔 요청 본문이 필요합니다." };
    }
    // providers 배열이 있으면 JSON으로 인코딩하여 query 필드에 저장
    const query = body.providers && body.providers.length > 0
      ? JSON.stringify({ providers: body.providers })
      : body.query;
    const job = await resolvedDeps.createManualScan(query);
    await writeAudit({
      request,
      actorId: granted.actorId,
      role: granted.role,
      action: "create-scan-request",
      status: "allowed",
      resource: "/scan-requests",
      metadata: {
        jobId: job.id,
        providerCount: body.providers?.length ?? 0,
        hasQuery: Boolean(body.query)
      }
    });
    return { data: job };
  });

  app.get("/scan-schedules", async (request, reply) => {
    const granted = await authorize({
      request,
      reply,
      role: "read",
      action: "list-scan-schedules",
      resource: "/scan-schedules"
    });
    if (!granted) {
      return;
    }
    return { data: await resolvedDeps.listSchedules() };
  });

  app.get("/scan-jobs", async (request, reply) => {
    const granted = await authorize({
      request,
      reply,
      role: "read",
      action: "list-scan-jobs",
      resource: "/scan-jobs"
    });
    if (!granted) {
      return;
    }
    return { data: await resolvedDeps.listScanJobs() };
  });

  app.get("/scan-jobs/:id", async (request, reply) => {
    const granted = await authorize({
      request,
      reply,
      role: "read",
      action: "get-scan-job",
      resource: "/scan-jobs/:id"
    });
    if (!granted) {
      return;
    }
    const params = request.params as { id: string };
    const job = await resolvedDeps.getScanJob(params.id);
    if (!job) {
      reply.code(404);
      return { error: "Scan job not found" };
    }
    return { data: job };
  });

  app.post("/scan-schedules", async (request, reply) => {
    const granted = await authorize({
      request,
      reply,
      role: "write",
      action: "create-scan-schedule",
      resource: "/scan-schedules"
    });
    if (!granted) {
      return;
    }
    const parsed = parseScheduleBody(request.body ?? {});
    if (parsed.error) {
      await writeAudit({
        request,
        actorId: granted.actorId,
        role: granted.role,
        action: "create-scan-schedule",
        status: "failed",
        resource: "/scan-schedules",
        metadata: { reason: parsed.error }
      });
      reply.code(400);
      return { error: parsed.error };
    }

    const body = parsed.data;
    if (!body) {
      await writeAudit({
        request,
        actorId: granted.actorId,
        role: granted.role,
        action: "create-scan-schedule",
        status: "failed",
        resource: "/scan-schedules",
        metadata: { reason: "missing-body" }
      });
      reply.code(400);
      return { error: "유효한 스케줄 본문이 필요합니다." };
    }
    const schedule = await resolvedDeps.createSchedule({
      intervalMinutes: body.intervalMinutes,
      query: body.query,
      enabled: body.enabled
    });
    await writeAudit({
      request,
      actorId: granted.actorId,
      role: granted.role,
      action: "create-scan-schedule",
      status: "allowed",
      resource: "/scan-schedules",
      metadata: {
        scheduleId: schedule.id,
        intervalMinutes: schedule.intervalMinutes,
        enabled: schedule.enabled
      }
    });
    return { data: schedule };
  });

  // AI 모델이 아닌 leak 정리 (기존 데이터 클린업용)
  app.delete("/leaks/non-ai", async (request, reply) => {
    const granted = await authorize({
      request,
      reply,
      role: "danger",
      action: "delete-non-ai-leaks",
      resource: "/leaks/non-ai"
    });
    if (!granted) {
      return;
    }
    const { getPool } = await import("./db");
    const pool = getPool();
    const placeholders = AI_PROVIDER_IDS.map((_item: string, i: number) => `$${i + 1}`).join(", ");
    const result = await pool.query(
      `DELETE FROM leaks WHERE provider NOT IN (${placeholders})`,
      AI_PROVIDER_IDS
    );
    const deleted = result.rowCount ?? 0;
    await writeAudit({
      request,
      actorId: granted.actorId,
      role: granted.role,
      action: "delete-non-ai-leaks",
      status: "allowed",
      resource: "/leaks/non-ai",
      metadata: { deleted }
    });
    return { deleted, message: `AI 모델이 아닌 leak ${deleted}건 삭제 완료` };
  });

  // 피드 초기화 – 모든 leaks 삭제 및 관련 집계 리셋
  app.delete("/leaks", async (request, reply) => {
    const granted = await authorize({
      request,
      reply,
      role: "danger",
      action: "reset-leak-feed",
      resource: "/leaks"
    });
    if (!granted) {
      return;
    }
    const { getPool } = await import("./db");
    const pool = getPool();
    const leaksResult = await pool.query("DELETE FROM leaks");
    const deleted = leaksResult.rowCount ?? 0;
    // 집계 테이블도 리셋
    await pool.query("DELETE FROM activity_daily").catch(() => {});
    await pool.query("DELETE FROM leaderboard_devs").catch(() => {});
    await writeAudit({
      request,
      actorId: granted.actorId,
      role: granted.role,
      action: "reset-leak-feed",
      status: "allowed",
      resource: "/leaks",
      metadata: { deleted }
    });
    return { deleted, message: `전체 피드 초기화 완료 (${deleted}건 삭제)` };
  });

  // 중복 leak 정리 – key_hash 기준 전체에서 최신 1건만 남김
  app.delete("/leaks/duplicates", async (request, reply) => {
    const granted = await authorize({
      request,
      reply,
      role: "danger",
      action: "dedupe-leaks",
      resource: "/leaks/duplicates"
    });
    if (!granted) {
      return;
    }
    const { getPool } = await import("./db");
    const pool = getPool();
    const result = await pool.query(`
      DELETE FROM leaks
      WHERE id NOT IN (
        SELECT DISTINCT ON (key_hash)
               id
        FROM leaks
        ORDER BY key_hash, detected_at DESC
      )
    `);
    const deleted = result.rowCount ?? 0;
    await writeAudit({
      request,
      actorId: granted.actorId,
      role: granted.role,
      action: "dedupe-leaks",
      status: "allowed",
      resource: "/leaks/duplicates",
      metadata: { deleted }
    });
    return { deleted, message: `중복 leak ${deleted}건 제거 완료` };
  });

  app.post("/scan-schedules/:id/toggle", async (request, reply) => {
    const granted = await authorize({
      request,
      reply,
      role: "write",
      action: "toggle-scan-schedule",
      resource: "/scan-schedules/:id/toggle"
    });
    if (!granted) {
      return;
    }
    const params = request.params as { id: string };
    const parsed = parseScheduleToggleBody(request.body ?? {});
    if (parsed.error) {
      await writeAudit({
        request,
        actorId: granted.actorId,
        role: granted.role,
        action: "toggle-scan-schedule",
        status: "failed",
        resource: "/scan-schedules/:id/toggle",
        metadata: { reason: parsed.error, scheduleId: params.id }
      });
      reply.code(400);
      return { error: parsed.error };
    }
    const enabled = parsed.enabled ?? false;
    const schedule = await resolvedDeps.toggleSchedule({ id: params.id, enabled });
    if (!schedule) {
      await writeAudit({
        request,
        actorId: granted.actorId,
        role: granted.role,
        action: "toggle-scan-schedule",
        status: "failed",
        resource: "/scan-schedules/:id/toggle",
        metadata: { reason: "not-found", scheduleId: params.id, enabled }
      });
      return { error: "Schedule not found" };
    }
    await writeAudit({
      request,
      actorId: granted.actorId,
      role: granted.role,
      action: "toggle-scan-schedule",
      status: "allowed",
      resource: "/scan-schedules/:id/toggle",
      metadata: { scheduleId: schedule.id, enabled: schedule.enabled }
    });
    return { data: schedule };
  });
};
