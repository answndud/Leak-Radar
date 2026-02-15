import type { WorkerRuntimeStatus } from "@leak/shared";
import { getPool } from "../db";

type RuntimeRow = {
  key: string;
  value: unknown;
  updated_at: string;
};

const DEFAULT_STATUS: WorkerRuntimeStatus = {
  retention: {
    enabled: false,
    retentionDays: 0,
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
    cycleCount: 0,
    lastCycleStartedAt: null,
    lastCycleFinishedAt: null,
    lastCycleDurationMs: 0,
    lastAutoInserted: 0,
    lastAutoEventsJobs: 0,
    lastAutoBackfillCodeItems: 0,
    lastAutoBackfillCommitItems: 0,
    lastAutoErrors: 0,
    lastManualInserted: 0,
    lastManualJobsProcessed: 0,
    lastManualJobsErrored: 0,
    totalAutoInserted: 0,
    totalAutoErrors: 0,
    totalManualInserted: 0,
    totalManualJobsProcessed: 0,
    totalManualJobsErrored: 0
  }
};

export const getWorkerRuntimeStatus = async (): Promise<WorkerRuntimeStatus> => {
  const pool = getPool();
  const result = await pool.query<RuntimeRow>(
    "SELECT key, value, updated_at::text FROM worker_runtime_status WHERE key IN ('retention', 'rate_limit', 'pipeline')"
  );

  const merged: WorkerRuntimeStatus = {
    retention: { ...DEFAULT_STATUS.retention },
    rateLimit: { ...DEFAULT_STATUS.rateLimit },
    pipeline: { ...DEFAULT_STATUS.pipeline }
  };

  for (const row of result.rows) {
    if (row.key === "retention" && typeof row.value === "object" && row.value !== null) {
      const value = row.value as Partial<WorkerRuntimeStatus["retention"]>;
      merged.retention = {
        enabled: value.enabled ?? merged.retention.enabled,
        retentionDays: value.retentionDays ?? merged.retention.retentionDays,
        lastRunAt: value.lastRunAt ?? merged.retention.lastRunAt,
        lastDeleted: value.lastDeleted ?? merged.retention.lastDeleted
      };
    }

    if (row.key === "rate_limit" && typeof row.value === "object" && row.value !== null) {
      const value = row.value as Partial<WorkerRuntimeStatus["rateLimit"]>;
      merged.rateLimit = {
        eventsResetAfterMs: value.eventsResetAfterMs ?? merged.rateLimit.eventsResetAfterMs,
        eventsRemaining: value.eventsRemaining ?? merged.rateLimit.eventsRemaining,
        eventsLimit: value.eventsLimit ?? merged.rateLimit.eventsLimit,
        commitResetAfterMs: value.commitResetAfterMs ?? merged.rateLimit.commitResetAfterMs,
        commitRemaining: value.commitRemaining ?? merged.rateLimit.commitRemaining,
        commitLimit: value.commitLimit ?? merged.rateLimit.commitLimit,
        codeResetAfterMs: value.codeResetAfterMs ?? merged.rateLimit.codeResetAfterMs,
        codeRemaining: value.codeRemaining ?? merged.rateLimit.codeRemaining,
        codeLimit: value.codeLimit ?? merged.rateLimit.codeLimit,
        updatedAt: value.updatedAt ?? row.updated_at ?? merged.rateLimit.updatedAt
      };
    }

    if (row.key === "pipeline" && typeof row.value === "object" && row.value !== null) {
      const value = row.value as Partial<WorkerRuntimeStatus["pipeline"]>;
      merged.pipeline = {
        cycleCount: value.cycleCount ?? merged.pipeline.cycleCount,
        lastCycleStartedAt: value.lastCycleStartedAt ?? merged.pipeline.lastCycleStartedAt,
        lastCycleFinishedAt: value.lastCycleFinishedAt ?? merged.pipeline.lastCycleFinishedAt,
        lastCycleDurationMs: value.lastCycleDurationMs ?? merged.pipeline.lastCycleDurationMs,
        lastAutoInserted: value.lastAutoInserted ?? merged.pipeline.lastAutoInserted,
        lastAutoEventsJobs: value.lastAutoEventsJobs ?? merged.pipeline.lastAutoEventsJobs,
        lastAutoBackfillCodeItems: value.lastAutoBackfillCodeItems ?? merged.pipeline.lastAutoBackfillCodeItems,
        lastAutoBackfillCommitItems: value.lastAutoBackfillCommitItems ?? merged.pipeline.lastAutoBackfillCommitItems,
        lastAutoErrors: value.lastAutoErrors ?? merged.pipeline.lastAutoErrors,
        lastManualInserted: value.lastManualInserted ?? merged.pipeline.lastManualInserted,
        lastManualJobsProcessed: value.lastManualJobsProcessed ?? merged.pipeline.lastManualJobsProcessed,
        lastManualJobsErrored: value.lastManualJobsErrored ?? merged.pipeline.lastManualJobsErrored,
        totalAutoInserted: value.totalAutoInserted ?? merged.pipeline.totalAutoInserted,
        totalAutoErrors: value.totalAutoErrors ?? merged.pipeline.totalAutoErrors,
        totalManualInserted: value.totalManualInserted ?? merged.pipeline.totalManualInserted,
        totalManualJobsProcessed: value.totalManualJobsProcessed ?? merged.pipeline.totalManualJobsProcessed,
        totalManualJobsErrored: value.totalManualJobsErrored ?? merged.pipeline.totalManualJobsErrored
      };
    }
  }

  return merged;
};
