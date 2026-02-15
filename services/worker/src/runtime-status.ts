import { getPool } from "./db";

export const upsertRuntimeStatus = async (key: string, value: unknown): Promise<void> => {
  const pool = getPool();
  await pool.query(
    `INSERT INTO worker_runtime_status (key, value, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
};
