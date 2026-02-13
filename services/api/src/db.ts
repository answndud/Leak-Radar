import { Pool } from "pg";
import { loadConfig } from "./config";

let pool: Pool | null = null;

export const getPool = (): Pool => {
  if (pool) {
    return pool;
  }

  const config = loadConfig();
  pool = new Pool({ connectionString: config.databaseUrl });
  return pool;
};
