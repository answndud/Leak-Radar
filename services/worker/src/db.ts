import { Pool } from "pg";

let pool: Pool | null = null;

export const getPool = (): Pool => {
  if (pool) {
    return pool;
  }

  const connectionString =
    process.env.DATABASE_URL ?? "postgres://leak:leak@localhost:5432/leakdb";
  pool = new Pool({ connectionString });
  return pool;
};
