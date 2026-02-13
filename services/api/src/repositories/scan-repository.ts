import { getPool } from "../db";

export type ScanJobRecord = {
  id: string;
  mode: "manual" | "scheduled";
  query: string | null;
  status: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type ScanScheduleRecord = {
  id: string;
  intervalMinutes: number;
  query: string | null;
  enabled: boolean;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const MIN_INTERVAL_MINUTES = 60;

export const createManualScan = async (query?: string): Promise<ScanJobRecord> => {
  const pool = getPool();
  const result = await pool.query<{
    id: string;
    mode: "manual";
    query: string | null;
    status: string;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
  }>(
    `INSERT INTO scan_jobs (id, mode, query, status)
     VALUES (gen_random_uuid(), 'manual', $1, 'pending')
     RETURNING id, mode, query, status, created_at, started_at, finished_at`,
    [query ?? null]
  );

  const row = result.rows[0];
  return {
    id: row.id,
    mode: row.mode,
    query: row.query,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
};

export const createSchedule = async (params: {
  intervalMinutes: number;
  query?: string;
  enabled: boolean;
}): Promise<ScanScheduleRecord> => {
  const interval = Math.max(params.intervalMinutes, MIN_INTERVAL_MINUTES);
  const pool = getPool();
  const result = await pool.query<{
    id: string;
    interval_minutes: number;
    query: string | null;
    enabled: boolean;
    next_run_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `INSERT INTO scan_schedules (id, interval_minutes, query, enabled, next_run_at)
     VALUES (
       gen_random_uuid(),
       $1,
       $2,
       $3,
       CASE WHEN $3 THEN now() + ($1 || ' minutes')::interval ELSE NULL END
     )
     RETURNING id, interval_minutes, query, enabled, next_run_at, created_at, updated_at`,
    [interval, params.query ?? null, params.enabled]
  );

  const row = result.rows[0];
  return {
    id: row.id,
    intervalMinutes: row.interval_minutes,
    query: row.query,
    enabled: row.enabled,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
};

export const listSchedules = async (): Promise<ScanScheduleRecord[]> => {
  const pool = getPool();
  const result = await pool.query<{
    id: string;
    interval_minutes: number;
    query: string | null;
    enabled: boolean;
    next_run_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    "SELECT id, interval_minutes, query, enabled, next_run_at, created_at, updated_at FROM scan_schedules ORDER BY created_at DESC"
  );

  return result.rows.map((row) => ({
    id: row.id,
    intervalMinutes: row.interval_minutes,
    query: row.query,
    enabled: row.enabled,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
};

export const toggleSchedule = async (params: {
  id: string;
  enabled: boolean;
}): Promise<ScanScheduleRecord | null> => {
  const pool = getPool();
  const result = await pool.query<{
    id: string;
    interval_minutes: number;
    query: string | null;
    enabled: boolean;
    next_run_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `UPDATE scan_schedules
     SET enabled = $2,
         next_run_at = CASE WHEN $2 THEN now() + (interval_minutes || ' minutes')::interval ELSE NULL END,
         updated_at = now()
     WHERE id = $1
     RETURNING id, interval_minutes, query, enabled, next_run_at, created_at, updated_at`,
    [params.id, params.enabled]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    intervalMinutes: row.interval_minutes,
    query: row.query,
    enabled: row.enabled,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
};

export const listScanJobs = async (): Promise<ScanJobRecord[]> => {
  const pool = getPool();
  const result = await pool.query<{
    id: string;
    mode: "manual" | "scheduled";
    query: string | null;
    status: string;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
  }>(
    "SELECT id, mode, query, status, created_at, started_at, finished_at FROM scan_jobs ORDER BY created_at DESC LIMIT 10"
  );

  return result.rows.map((row) => ({
    id: row.id,
    mode: row.mode,
    query: row.query,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  }));
};

export const getScanJob = async (id: string): Promise<ScanJobRecord | null> => {
  const pool = getPool();
  const result = await pool.query<{
    id: string;
    mode: "manual" | "scheduled";
    query: string | null;
    status: string;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
  }>(
    "SELECT id, mode, query, status, created_at, started_at, finished_at FROM scan_jobs WHERE id = $1",
    [id]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    mode: row.mode,
    query: row.query,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
};
