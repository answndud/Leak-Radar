type ApiConfig = {
  host: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  corsOrigins: string[];
};

const parseCommaSeparated = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const parsePort = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
};

export const loadConfig = (): ApiConfig => ({
  host: process.env.API_HOST ?? "0.0.0.0",
  port: parsePort(process.env.API_PORT, 4000),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://leak:leak@localhost:5432/leakdb",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  corsOrigins: parseCommaSeparated(process.env.API_CORS_ORIGINS)
});
