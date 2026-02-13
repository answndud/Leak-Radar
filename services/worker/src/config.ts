type WorkerConfig = {
  pollIntervalMs: number;
  githubToken?: string;
  backfillEnabled: boolean;
  backfillQuery: string;
  backfillOnEmpty: boolean;
  defaultBackfillQuery: string;
  backfillMode: "commits" | "code" | "both";
  backfillAlways: boolean;
  maxFileBytes: number;
};

const parseInterval = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1000) {
    return fallback;
  }

  return parsed;
};

export const loadConfig = (): WorkerConfig => ({
  pollIntervalMs: parseInterval(process.env.WORKER_POLL_INTERVAL_MS, 15000),
  githubToken: process.env.GITHUB_TOKEN,
  backfillEnabled: process.env.WORKER_BACKFILL_ENABLED === "true",
  backfillQuery: process.env.WORKER_BACKFILL_QUERY ?? "sk-proj-",
  backfillOnEmpty: process.env.WORKER_BACKFILL_ON_EMPTY === "true",
  defaultBackfillQuery:
    process.env.WORKER_DEFAULT_BACKFILL_QUERY ?? "sk-proj- in:file",
  backfillMode:
    process.env.WORKER_BACKFILL_MODE === "code"
      ? "code"
      : process.env.WORKER_BACKFILL_MODE === "both"
        ? "both"
        : "commits",
  backfillAlways: process.env.WORKER_BACKFILL_ALWAYS === "true",
  maxFileBytes: Number.parseInt(process.env.WORKER_MAX_FILE_BYTES ?? "200000", 10)
});

/**
 * provider → GitHub Search 쿼리 매핑
 * 수동 스캔에서 선택된 provider에 따라 쿼리를 생성하는 데 사용.
 */
export const PROVIDER_QUERIES: Record<string, string[]> = {
  // ── AI 모델 (디폴트) ──
  openai: ["sk-proj- in:file", "OPENAI_API_KEY in:file"],
  anthropic: ["sk-ant- in:file", "ANTHROPIC_API_KEY in:file"],
  google: ["AIzaSy in:file"],
  grok: ["xai- in:file", "GROK_API_KEY in:file"],
  kimi: ["moonshot in:file sk-", "MOONSHOT_API_KEY in:file"],
  glm: ["zhipuai in:file api_key", "GLM_API_KEY in:file"],
  deepseek: ["DEEPSEEK_API_KEY in:file", "deepseek sk- in:file"],

  // ── 기타 서비스 (수동 스캔에서 선택 가능) ──
  stripe: ["sk_live_ in:file"],
  aws: ["AKIA in:file"],
  github: ["ghp_ in:file", "github_pat_ in:file"],
  slack: ["xoxb- in:file"],
  sendgrid: ["SG. in:file extension:env"],
  firebase: ["FIREBASE in:file extension:env"],
  supabase: ["sbp_ in:file"],
  vercel: ["vercel_ in:file extension:env"],
  npm: ["npm_ in:file extension:npmrc"],
  discord: ["DISCORD_TOKEN in:file"],
};

/** 디폴트 AI provider 목록 (자동 스캔에 사용) */
export const DEFAULT_PROVIDERS = [
  "openai", "anthropic", "google", "grok", "kimi", "glm", "deepseek"
] as const;

/**
 * 자동 스캔용 로테이션 쿼리 – AI 모델 provider만 순환
 */
export const ROTATING_QUERIES: string[] = DEFAULT_PROVIDERS.flatMap(
  (p) => PROVIDER_QUERIES[p] ?? []
);

/**
 * providers 배열로부터 GitHub Search 쿼리 목록 생성
 */
export const buildQueriesForProviders = (providers: string[]): string[] => {
  return providers.flatMap((p) => PROVIDER_QUERIES[p] ?? []);
};
