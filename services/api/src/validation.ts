import { MANUAL_PROVIDER_IDS } from "@leak/shared";

type ParsedScanRequestBody = {
  query?: string;
  providers?: string[];
};

type ParsedScheduleBody = {
  intervalMinutes: number;
  query?: string;
  enabled: boolean;
};

const parseString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseProviders = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const cleaned = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);

  if (cleaned.length === 0) {
    return undefined;
  }

  return [...new Set(cleaned)];
};

const VALID_PROVIDERS = new Set(MANUAL_PROVIDER_IDS);

export const parseScanRequestBody = (body: unknown): { data?: ParsedScanRequestBody; error?: string } => {
  if (body === null || typeof body !== "object") {
    return { error: "요청 본문은 JSON 객체여야 합니다." };
  }

  const payload = body as { query?: unknown; providers?: unknown };
  const query = parseString(payload.query);
  const providers = parseProviders(payload.providers);

  if (query && providers) {
    return { error: "query와 providers를 동시에 보낼 수 없습니다." };
  }

  if (!query && !providers) {
    return { error: "query 또는 providers 중 하나는 필수입니다." };
  }

  if (providers) {
    const invalidProviders = providers.filter((provider) => !VALID_PROVIDERS.has(provider));
    if (invalidProviders.length > 0) {
      return { error: `지원하지 않는 provider가 포함되어 있습니다: ${invalidProviders.join(", ")}` };
    }
  }

  return { data: { query, providers } };
};

export const parseScheduleBody = (body: unknown): { data?: ParsedScheduleBody; error?: string } => {
  if (body === null || typeof body !== "object") {
    return { error: "요청 본문은 JSON 객체여야 합니다." };
  }

  const payload = body as {
    intervalMinutes?: unknown;
    query?: unknown;
    enabled?: unknown;
  };

  const intervalRaw = payload.intervalMinutes;
  const interval =
    typeof intervalRaw === "number" && Number.isFinite(intervalRaw)
      ? Math.floor(intervalRaw)
      : 60;

  if (interval < 60) {
    return { error: "intervalMinutes는 최소 60분이어야 합니다." };
  }

  if (payload.enabled !== undefined && typeof payload.enabled !== "boolean") {
    return { error: "enabled는 boolean이어야 합니다." };
  }

  if (payload.query !== undefined && parseString(payload.query) === undefined) {
    return { error: "query는 비어 있지 않은 문자열이어야 합니다." };
  }

  return {
    data: {
      intervalMinutes: interval,
      query: parseString(payload.query),
      enabled: payload.enabled ?? false
    }
  };
};

export const parseScheduleToggleBody = (body: unknown): { enabled?: boolean; error?: string } => {
  if (body === null || typeof body !== "object") {
    return { enabled: false };
  }

  const payload = body as { enabled?: unknown };
  if (payload.enabled !== undefined && typeof payload.enabled !== "boolean") {
    return { error: "enabled는 boolean이어야 합니다." };
  }

  return { enabled: payload.enabled ?? false };
};
