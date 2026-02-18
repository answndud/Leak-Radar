import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type {
  ActivityPoint,
  LeaderboardEntry,
  LeakRecord,
  ProviderStat,
  StatsSummary,
  WorkerSloStatus,
  WorkerRuntimeStatus
} from "@leak/shared";

type ScanJob = {
  id: string;
  mode: "manual" | "scheduled";
  query: string | null;
  status: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

type AdminAuditEntry = {
  id: string;
  occurredAt: string;
  actorId: string | null;
  role: string;
  action: string;
  status: "allowed" | "denied" | "failed";
  resource: string;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
};

type AdminAuditListResponse = {
  data: AdminAuditEntry[];
  nextCursor: string | null;
};

type AuditSortKey = "occurredAt" | "status" | "role" | "actorId" | "action" | "resource";
type AuditSortDir = "asc" | "desc";
type AuditStatusFilter = "all" | AdminAuditEntry["status"];
type AuditRoleFilter = "all" | "ops" | "read" | "write" | "danger";
type AuditSinceHours = "0" | "1" | "6" | "24" | "168";
type AuditPreset = {
  id: string;
  label: string;
  status: AuditStatusFilter;
  role: AuditRoleFilter;
  sinceHours: AuditSinceHours;
  sortKey: AuditSortKey;
  sortDir: AuditSortDir;
  actorFilter?: string;
  searchQuery?: string;
  custom?: boolean;
  shared?: boolean;
  sharedId?: string;
  category?: string;
  description?: string;
  isPinned?: boolean;
};

type SharedAuditView = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  isPinned: boolean;
  filters: {
    status?: "allowed" | "denied" | "failed";
    role?: "ops" | "read" | "write" | "danger";
    actorId?: string;
    sinceHours?: number;
    sortKey?: AuditSortKey;
    sortDir?: AuditSortDir;
    searchQuery?: string;
  };
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  canManage?: boolean;
};

type LeakResponse = {
  data: LeakRecord[];
  page: number;
  pageSize: number;
  total: number;
};

/* ────────────────────────────────────────────────────────
 * provider 정의 – AI 모델과 기타 서비스를 구분
 * ──────────────────────────────────────────────────────── */

type ProviderDef = {
  id: string;
  label: string;
  group: "ai" | "service";
};

const ALL_PROVIDERS: ProviderDef[] = [
  // AI 모델 (디폴트)
  { id: "openai", label: "OpenAI", group: "ai" },
  { id: "anthropic", label: "Anthropic", group: "ai" },
  { id: "google", label: "Google", group: "ai" },
  { id: "grok", label: "Grok (xAI)", group: "ai" },
  { id: "kimi", label: "Kimi (Moonshot)", group: "ai" },
  { id: "glm", label: "GLM (Zhipu)", group: "ai" },
  { id: "deepseek", label: "DeepSeek", group: "ai" },
  { id: "mistral", label: "Mistral", group: "ai" },

  // 기타 서비스
  { id: "stripe", label: "Stripe", group: "service" },
  { id: "aws", label: "AWS", group: "service" },
  { id: "github", label: "GitHub", group: "service" },
  { id: "slack", label: "Slack", group: "service" },
  { id: "sendgrid", label: "SendGrid", group: "service" },
  { id: "firebase", label: "Firebase", group: "service" },
  { id: "supabase", label: "Supabase", group: "service" },
  { id: "vercel", label: "Vercel", group: "service" },
  { id: "npm", label: "NPM", group: "service" },
  { id: "discord", label: "Discord", group: "service" }
];

const AI_PROVIDER_IDS = ALL_PROVIDERS.filter((p) => p.group === "ai").map((p) => p.id);

const PROVIDER_LABELS: Record<string, string> = Object.fromEntries(
  ALL_PROVIDERS.map((p) => [p.id, p.label])
);
Object.assign(PROVIDER_LABELS, {
  private_key: "Private Key"
});

type Page = "home" | "explore" | "leaderboard";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000";
const ADMIN_API_KEY = import.meta.env.VITE_ADMIN_API_KEY;
const DEFAULT_ADMIN_ACTOR_ID = import.meta.env.VITE_ADMIN_ACTOR_ID;
const ADMIN_ACTOR_STORAGE_KEY = "apiradar-admin-actor-id";
const AUDIT_CUSTOM_PRESETS_STORAGE_KEY = "apiradar-audit-custom-presets";
const AUDIT_STATUS_VALUES: AuditStatusFilter[] = ["all", "allowed", "denied", "failed"];
const AUDIT_ROLE_VALUES: AuditRoleFilter[] = ["all", "ops", "read", "write", "danger"];
const AUDIT_SINCE_VALUES: AuditSinceHours[] = ["0", "1", "6", "24", "168"];
const AUDIT_SORT_KEYS: AuditSortKey[] = ["occurredAt", "status", "role", "actorId", "action", "resource"];
const AUDIT_SORT_DIRECTIONS: AuditSortDir[] = ["asc", "desc"];
const AUDIT_PRESETS: AuditPreset[] = [
  {
    id: "failed24h",
    label: "실패 24h",
    status: "failed",
    role: "all",
    sinceHours: "24",
    sortKey: "occurredAt",
    sortDir: "desc"
  },
  {
    id: "danger7d",
    label: "DANGER 7d",
    status: "all",
    role: "danger",
    sinceHours: "168",
    sortKey: "occurredAt",
    sortDir: "desc"
  },
  {
    id: "denied24h",
    label: "거부 24h",
    status: "denied",
    role: "all",
    sinceHours: "24",
    sortKey: "occurredAt",
    sortDir: "desc"
  }
];

const readUrlParam = (key: string): string | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }
  const value = new URLSearchParams(window.location.search).get(key);
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toAuditStatusFilter = (value: string | undefined): AuditStatusFilter => {
  if (value && AUDIT_STATUS_VALUES.includes(value as AuditStatusFilter)) {
    return value as AuditStatusFilter;
  }
  return "all";
};

const toAuditRoleFilter = (value: string | undefined): AuditRoleFilter => {
  if (value && AUDIT_ROLE_VALUES.includes(value as AuditRoleFilter)) {
    return value as AuditRoleFilter;
  }
  return "all";
};

const toAuditSinceHours = (value: string | undefined): AuditSinceHours => {
  if (value && AUDIT_SINCE_VALUES.includes(value as AuditSinceHours)) {
    return value as AuditSinceHours;
  }
  return "24";
};

const toAuditSortKey = (value: string | undefined): AuditSortKey => {
  if (value && AUDIT_SORT_KEYS.includes(value as AuditSortKey)) {
    return value as AuditSortKey;
  }
  return "occurredAt";
};

const toAuditSortDir = (value: string | undefined): AuditSortDir => {
  if (value && AUDIT_SORT_DIRECTIONS.includes(value as AuditSortDir)) {
    return value as AuditSortDir;
  }
  return "desc";
};

const dedupeAuditEntries = (entries: AdminAuditEntry[]): AdminAuditEntry[] => {
  const seen = new Set<string>();
  const output: AdminAuditEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    output.push(entry);
  }
  return output;
};

const toCustomAuditPreset = (value: unknown): AuditPreset | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const label = typeof record.label === "string" ? record.label.trim() : "";
  if (!id || !label) {
    return null;
  }

  const status = toAuditStatusFilter(typeof record.status === "string" ? record.status : undefined);
  const role = toAuditRoleFilter(typeof record.role === "string" ? record.role : undefined);
  const sinceHours = toAuditSinceHours(typeof record.sinceHours === "string" ? record.sinceHours : undefined);
  const sortKey = toAuditSortKey(typeof record.sortKey === "string" ? record.sortKey : undefined);
  const sortDir = toAuditSortDir(typeof record.sortDir === "string" ? record.sortDir : undefined);
  const actorFilter = typeof record.actorFilter === "string" ? record.actorFilter.trim() : "";
  const searchQuery = typeof record.searchQuery === "string" ? record.searchQuery.trim() : "";

  return {
    id,
    label,
    status,
    role,
    sinceHours,
    sortKey,
    sortDir,
    actorFilter,
    searchQuery,
    custom: true
  };
};

const toSharedViewPreset = (view: SharedAuditView): AuditPreset => ({
  id: `shared-${view.id}`,
  label: view.name,
  status: toAuditStatusFilter(view.filters.status),
  role: toAuditRoleFilter(view.filters.role),
  sinceHours: toAuditSinceHours(
    typeof view.filters.sinceHours === "number" && Number.isFinite(view.filters.sinceHours)
      ? String(Math.max(0, Math.floor(view.filters.sinceHours)))
      : undefined
  ),
  sortKey: toAuditSortKey(view.filters.sortKey),
  sortDir: toAuditSortDir(view.filters.sortDir),
  actorFilter: typeof view.filters.actorId === "string" ? view.filters.actorId : "",
  searchQuery: typeof view.filters.searchQuery === "string" ? view.filters.searchQuery : "",
  shared: true,
  sharedId: view.id,
  category: view.category,
  description: view.description ?? undefined,
  isPinned: view.isPinned
});

const readAdminActorId = (): string | undefined => {
  if (typeof window === "undefined") {
    return DEFAULT_ADMIN_ACTOR_ID;
  }
  const saved = localStorage.getItem(ADMIN_ACTOR_STORAGE_KEY)?.trim();
  if (saved) {
    return saved;
  }
  return DEFAULT_ADMIN_ACTOR_ID;
};

const apiFetch = (path: string, init?: RequestInit): Promise<Response> => {
  const headers = new Headers(init?.headers);
  if (ADMIN_API_KEY) {
    headers.set("x-leak-radar-admin-key", ADMIN_API_KEY);
  }
  const actorId = readAdminActorId();
  if (actorId) {
    headers.set("x-leak-radar-admin-id", actorId);
  }

  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers
  });
};

const timeAgo = (iso: string): string => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) {
    return "방금 전";
  }
  if (minutes < 60) {
    return `${minutes}분 전`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}시간 전`;
  }
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
};

const buildRepoUrl = (owner: string, repo: string): string =>
  `https://github.com/${owner}/${repo}`;

const buildFileUrl = (
  owner: string,
  repo: string,
  commitSha: string,
  filePath: string
): string => `https://github.com/${owner}/${repo}/blob/${commitSha}/${filePath}`;

const formatResetMs = (value: number | null): string => {
  if (!value || value <= 0) {
    return "정상";
  }
  return `${Math.ceil(value / 1000)}초 대기`;
};

const formatQuota = (remaining: number | null, limit: number | null): string => {
  if (remaining === null || limit === null || limit <= 0) {
    return "N/A";
  }
  return `${remaining}/${limit}`;
};

const isStaleStatus = (iso: string | null, staleMs: number): boolean => {
  if (!iso) {
    return true;
  }
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return true;
  }
  return Date.now() - parsed > staleMs;
};

const formatUpdatedAt = (iso: string | null): string => {
  if (!iso) {
    return "업데이트 정보 없음";
  }

  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return "업데이트 정보 없음";
  }

  const elapsedSec = Math.floor((Date.now() - parsed) / 1000);
  if (elapsedSec < 60) {
    return `${elapsedSec}초 전 갱신`;
  }
  const elapsedMin = Math.floor(elapsedSec / 60);
  if (elapsedMin < 60) {
    return `${elapsedMin}분 전 갱신`;
  }
  const elapsedHour = Math.floor(elapsedMin / 60);
  return `${elapsedHour}시간 전 갱신`;
};

const useFetch = <T,>(path: string, fallback: T, unwrapData = true): T => {
  const [data, setData] = useState<T>(fallback);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await apiFetch(path);
        if (!response.ok) {
          return;
        }
        const payload = await response.json();
        if (active) {
          const nextValue =
            unwrapData && payload && "data" in payload ? payload.data : payload;
          setData(nextValue as T);
        }
      } catch {
        // ignore
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [path]);

  return data;
};

const useAutoRefresh = <T,>(
  path: string,
  fallback: T,
  intervalMs: number,
  unwrapData = true
): T => {
  const [data, setData] = useState<T>(fallback);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await apiFetch(path);
        if (!response.ok) {
          return;
        }
        const payload = await response.json();
        if (active) {
          const nextValue =
            unwrapData && payload && "data" in payload ? payload.data : payload;
          setData(nextValue as T);
        }
      } catch {
        // ignore
      }
    };

    void load();
    const timer = setInterval(() => void load(), intervalMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [path, intervalMs]);

  return data;
};

export const App = () => {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [page, setPage] = useState<Page>("explore");
  const [provider, setProvider] = useState<string>("");
  const [timeRange, setTimeRange] = useState<string>("all");
  const [sort, setSort] = useState<string>("newest");
  const [showScanPanel, setShowScanPanel] = useState(false);
  const [compactWorkerStatus, setCompactWorkerStatus] = useState(false);
  const [workerStaleMinutes, setWorkerStaleMinutes] = useState(2);
  const [adminActorId, setAdminActorId] = useState("");
  const [auditStatusFilter, setAuditStatusFilter] = useState<AuditStatusFilter>(() =>
    toAuditStatusFilter(readUrlParam("audit_status"))
  );
  const [auditRoleFilter, setAuditRoleFilter] = useState<AuditRoleFilter>(() =>
    toAuditRoleFilter(readUrlParam("audit_role"))
  );
  const [auditActorFilter, setAuditActorFilter] = useState<string>(() =>
    readUrlParam("audit_actor") ?? ""
  );
  const [auditSinceHours, setAuditSinceHours] = useState<AuditSinceHours>(() =>
    toAuditSinceHours(readUrlParam("audit_since"))
  );
  const [auditSearchQuery, setAuditSearchQuery] = useState<string>(() =>
    readUrlParam("audit_q") ?? ""
  );
  const [auditSortKey, setAuditSortKey] = useState<AuditSortKey>(() =>
    toAuditSortKey(readUrlParam("audit_sort"))
  );
  const [auditSortDir, setAuditSortDir] = useState<AuditSortDir>(() =>
    toAuditSortDir(readUrlParam("audit_dir"))
  );
  const [selectedAudit, setSelectedAudit] = useState<AdminAuditEntry | null>(null);
  const [sharedAuditViews, setSharedAuditViews] = useState<SharedAuditView[]>([]);
  const [customAuditPresets, setCustomAuditPresets] = useState<AuditPreset[]>([]);
  const [newPresetLabel, setNewPresetLabel] = useState("");
  const [newSharedPresetLabel, setNewSharedPresetLabel] = useState("");
  const [newSharedPresetCategory, setNewSharedPresetCategory] = useState("general");
  const [newSharedPresetDescription, setNewSharedPresetDescription] = useState("");
  const [newSharedPresetPinned, setNewSharedPresetPinned] = useState(false);
  const [sharedPresetBusy, setSharedPresetBusy] = useState(false);
  const [sharedPresetError, setSharedPresetError] = useState("");
  const presetImportInputRef = useRef<HTMLInputElement | null>(null);
  const [auditLogs, setAuditLogs] = useState<AdminAuditEntry[]>([]);
  const [auditNextCursor, setAuditNextCursor] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditLoadError, setAuditLoadError] = useState("");
  const auditLoadingRef = useRef(false);
  const auditSentinelRef = useRef<HTMLDivElement | null>(null);

  // 수동 스캔: 멀티셀렉트 provider
  const [scanProviders, setScanProviders] = useState<Set<string>>(
    new Set(AI_PROVIDER_IDS)
  );

  const [scanStatus, setScanStatus] = useState<"idle" | "scanning" | "done" | "error">(
    "idle"
  );
  const [scanError, setScanError] = useState<string>("");
  const [leaks, setLeaks] = useState<LeakRecord[]>([]);
  const [leaksPage, setLeaksPage] = useState(1);
  const [leaksTotal, setLeaksTotal] = useState(0);
  const [leaksLoading, setLeaksLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const leaksQuery = `/leaks?provider=${provider}&timeRange=${timeRange}&sort=${sort}&page=${leaksPage}`;
  const providers = useFetch<ProviderStat[]>("/providers", []);

  const stats = useAutoRefresh<StatsSummary>("/stats", {
    leaksToday: 0,
    totalLeaks: 0,
    totalReposScanned: 0
  }, 30000);

  const workerStatus = useAutoRefresh<WorkerRuntimeStatus>(
    "/internal/worker-status",
    {
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
    },
    15000
  );

  const workerSlo = useAutoRefresh<WorkerSloStatus>(
    "/internal/slo",
    {
      thresholds: {
        statusAgeMsMax: 300000,
        autoErrorRatioMax: 0.3
      },
      values: {
        statusAgeMs: -1,
        autoErrorRatio: 0,
        autoInsertRatio: 0,
        manualErrorRatio: 0
      },
      met: {
        statusFreshness: false,
        autoErrorRatio: false,
        overall: false
      }
    },
    15000
  );

  const leaderboard = useFetch<LeaderboardEntry[]>("/leaderboard", []);
  const activity = useFetch<ActivityPoint[]>("/activity", []);
  const auditLogsPathBase = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", "25");
    if (auditStatusFilter !== "all") {
      params.set("status", auditStatusFilter);
    }
    if (auditRoleFilter !== "all") {
      params.set("role", auditRoleFilter);
    }
    if (auditSinceHours !== "0") {
      params.set("sinceHours", auditSinceHours);
    }
    const actor = auditActorFilter.trim();
    if (actor.length > 0) {
      params.set("actorId", actor);
    }
    return `/internal/audit-logs?${params.toString()}`;
  }, [auditActorFilter, auditRoleFilter, auditSinceHours, auditStatusFilter]);

  const loadAuditLogs = useCallback(async (cursor?: string, append = false): Promise<void> => {
    if (auditLoadingRef.current) {
      return;
    }
    auditLoadingRef.current = true;
    setAuditLoading(true);
    setAuditLoadError("");
    try {
      const path = cursor
        ? `${auditLogsPathBase}&cursor=${encodeURIComponent(cursor)}`
        : auditLogsPathBase;
      const response = await apiFetch(path);
      if (!response.ok) {
        setAuditLoadError("감사로그를 불러오지 못했습니다.");
        return;
      }
      const payload = (await response.json()) as AdminAuditListResponse;
      const incoming = payload.data ?? [];
      setAuditLogs((prev) => (append ? dedupeAuditEntries([...prev, ...incoming]) : incoming));
      setAuditNextCursor(payload.nextCursor ?? null);
    } catch {
      setAuditLoadError("감사로그를 불러오지 못했습니다.");
    } finally {
      auditLoadingRef.current = false;
      setAuditLoading(false);
    }
  }, [auditLogsPathBase]);

  const loadSharedAuditViews = useCallback(async (): Promise<void> => {
    try {
      const response = await apiFetch("/internal/audit-views");
      if (!response.ok) {
        setSharedPresetError("공유 프리셋을 불러오지 못했습니다.");
        return;
      }
      const payload = (await response.json()) as { data?: SharedAuditView[] };
      setSharedAuditViews(Array.isArray(payload.data) ? payload.data : []);
      setSharedPresetError("");
    } catch {
      setSharedPresetError("공유 프리셋을 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    void loadAuditLogs(undefined, false);
  }, [loadAuditLogs]);

  useEffect(() => {
    void loadSharedAuditViews();
  }, [loadSharedAuditViews]);

  const loadMoreAuditLogs = useCallback(() => {
    if (!auditNextCursor || auditLoadingRef.current) {
      return;
    }
    void loadAuditLogs(auditNextCursor, true);
  }, [auditNextCursor, loadAuditLogs]);

  useEffect(() => {
    const target = auditSentinelRef.current;
    if (!target) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first?.isIntersecting) {
          return;
        }
        loadMoreAuditLogs();
      },
      {
        root: null,
        rootMargin: "160px 0px",
        threshold: 0.05
      }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMoreAuditLogs]);

  const displayedAuditLogs = useMemo(() => {
    const needle = auditSearchQuery.trim().toLowerCase();
    const filtered = needle.length === 0
      ? auditLogs
      : auditLogs.filter((item) => {
        const haystack = [
          item.actorId ?? "",
          item.role,
          item.status,
          item.action,
          item.resource,
          item.ip ?? "",
          item.userAgent ?? "",
          item.occurredAt
        ].join(" ").toLowerCase();
        return haystack.includes(needle);
      });

    const sorted = [...filtered].sort((a, b) => {
      const getValue = (item: AdminAuditEntry): string => {
        if (auditSortKey === "occurredAt") {
          return item.occurredAt;
        }
        if (auditSortKey === "actorId") {
          return item.actorId ?? "";
        }
        return String(item[auditSortKey] ?? "");
      };

      const left = getValue(a);
      const right = getValue(b);

      if (auditSortKey === "occurredAt") {
        const leftMs = Date.parse(left);
        const rightMs = Date.parse(right);
        const diff = leftMs - rightMs;
        return auditSortDir === "asc" ? diff : -diff;
      }

      const compared = left.localeCompare(right);
      return auditSortDir === "asc" ? compared : -compared;
    });

    return sorted;
  }, [auditLogs, auditSearchQuery, auditSortDir, auditSortKey]);

  const activityPath = useMemo(() => {
    if (activity.length === 0) {
      return "";
    }
    const max = Math.max(...activity.map((point) => point.leakCount), 1);
    return activity
      .map((point, index) => {
        const x = (index / (activity.length - 1 || 1)) * 280;
        const y = 120 - (point.leakCount / max) * 90;
        return `${index === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");
  }, [activity]);

  const providerOptions = useMemo(() => {
    const names = new Set<string>(Object.keys(PROVIDER_LABELS));
    for (const item of providers) {
      names.add(item.provider);
    }

    return Array.from(names)
      .map((value) => ({
        value,
        label: PROVIDER_LABELS[value] ?? value
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [providers]);

  useEffect(() => {
    const saved = localStorage.getItem("apiradar-theme");
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
    }

    const savedActor = localStorage.getItem(ADMIN_ACTOR_STORAGE_KEY);
    if (savedActor && savedActor.trim().length > 0) {
      setAdminActorId(savedActor);
      return;
    }
    if (DEFAULT_ADMIN_ACTOR_ID) {
      setAdminActorId(DEFAULT_ADMIN_ACTOR_ID);
    }

    const savedPresetsRaw = localStorage.getItem(AUDIT_CUSTOM_PRESETS_STORAGE_KEY);
    if (savedPresetsRaw) {
      try {
        const parsed = JSON.parse(savedPresetsRaw) as unknown;
        if (Array.isArray(parsed)) {
          const normalized = parsed
            .map((item) => toCustomAuditPreset(item))
            .filter((item): item is AuditPreset => item !== null);
          setCustomAuditPresets(normalized);
        }
      } catch {
        // ignore preset parsing errors
      }
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("apiradar-theme", theme);
  }, [theme]);

  useEffect(() => {
    const trimmed = adminActorId.trim();
    if (!trimmed) {
      localStorage.removeItem(ADMIN_ACTOR_STORAGE_KEY);
      return;
    }
    localStorage.setItem(ADMIN_ACTOR_STORAGE_KEY, trimmed);
  }, [adminActorId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (customAuditPresets.length === 0) {
      localStorage.removeItem(AUDIT_CUSTOM_PRESETS_STORAGE_KEY);
      return;
    }
    localStorage.setItem(AUDIT_CUSTOM_PRESETS_STORAGE_KEY, JSON.stringify(customAuditPresets));
  }, [customAuditPresets]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);
    const params = url.searchParams;

    const setOrDelete = (key: string, value: string | undefined): void => {
      if (!value || value.length === 0) {
        params.delete(key);
        return;
      }
      params.set(key, value);
    };

    setOrDelete("audit_status", auditStatusFilter === "all" ? undefined : auditStatusFilter);
    setOrDelete("audit_role", auditRoleFilter === "all" ? undefined : auditRoleFilter);
    setOrDelete("audit_actor", auditActorFilter.trim() || undefined);
    setOrDelete("audit_since", auditSinceHours === "24" ? undefined : auditSinceHours);
    setOrDelete("audit_q", auditSearchQuery.trim() || undefined);
    setOrDelete("audit_sort", auditSortKey === "occurredAt" ? undefined : auditSortKey);
    setOrDelete("audit_dir", auditSortDir === "desc" ? undefined : auditSortDir);

    const next = `${url.pathname}${params.toString().length > 0 ? `?${params.toString()}` : ""}${url.hash}`;
    window.history.replaceState({}, "", next);
  }, [
    auditActorFilter,
    auditRoleFilter,
    auditSearchQuery,
    auditSinceHours,
    auditSortDir,
    auditSortKey,
    auditStatusFilter
  ]);

  const toggleScanProvider = (id: string) => {
    setScanProviders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAllAI = () => {
    setScanProviders(new Set(AI_PROVIDER_IDS));
  };

  const selectAll = () => {
    setScanProviders(new Set(ALL_PROVIDERS.map((p) => p.id)));
  };

  const selectNone = () => {
    setScanProviders(new Set());
  };

  const requestScan = async () => {
    if (scanProviders.size === 0) {
      setScanError("스캔할 공급자를 1개 이상 선택하세요.");
      setScanStatus("error");
      setTimeout(() => setScanStatus("idle"), 2000);
      return;
    }

    try {
      setScanError("");
      setScanStatus("scanning");
      const response = await apiFetch("/scan-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providers: Array.from(scanProviders) })
      });
      if (!response.ok) {
        setScanStatus("error");
        setScanError("스캔 요청을 생성하지 못했습니다.");
        return;
      }
      const payload = (await response.json()) as { data?: ScanJob };
      if (!payload.data) {
        setScanStatus("error");
        setScanError("스캔 요청을 확인하지 못했습니다.");
        return;
      }
      await pollScanJob(payload.data.id);
    } catch {
      setScanStatus("error");
      setScanError("스캔 요청에 실패했습니다.");
    }
  };

  const pollScanJob = async (id: string) => {
    const startedAt = Date.now();
    const timeoutMs = 120000;
    while (Date.now() - startedAt < timeoutMs) {
      const response = await apiFetch(`/scan-jobs/${id}`);
      if (!response.ok) {
        setScanStatus("error");
        setScanError("스캔 상태 확인에 실패했습니다.");
        return;
      }
      const payload = (await response.json()) as { data: ScanJob };
      if (payload.data.status === "done") {
        setScanStatus("done");
        setTimeout(() => setScanStatus("idle"), 1500);
        refreshLeaks();
        return;
      }
      if (payload.data.status === "error") {
        setScanStatus("error");
        setScanError("스캔 처리 중 오류가 발생했습니다.");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    setScanStatus("error");
    setScanError("스캔 대기 시간이 초과되었습니다.");
  };

  const refreshLeaks = useCallback(() => {
    setLeaks([]);
    setLeaksPage(1);
  }, []);

  useEffect(() => {
    refreshLeaks();
  }, [provider, timeRange, sort]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (leaksPage === 1) {
        refreshLeaks();
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [leaksPage, refreshLeaks]);

  useEffect(() => {
    let active = true;
    const loadLeaks = async () => {
      setLeaksLoading(true);
      try {
        const response = await apiFetch(leaksQuery);
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as LeakResponse;
        if (active) {
          setLeaks((prev) => {
            if (leaksPage === 1) return payload.data;
            // ID 기반 중복 제거 – 스크롤 추가 시 기존에 이미 있는 항목 제외
            const existingIds = new Set(prev.map((l) => l.id));
            const newItems = payload.data.filter((l) => !existingIds.has(l.id));
            return [...prev, ...newItems];
          });
          setLeaksTotal(payload.total);
        }
      } finally {
        if (active) {
          setLeaksLoading(false);
          setInitialLoading(false);
        }
      }
    };

    void loadLeaks();
    return () => {
      active = false;
    };
  }, [leaksQuery, leaksPage]);

  useEffect(() => {
    if (!sentinelRef.current) {
      return;
    }
    const sentinel = sentinelRef.current;
    const observer = new IntersectionObserver((entries) => {
      const [entry] = entries;
      if (!entry.isIntersecting || leaksLoading) {
        return;
      }
      if (leaks.length >= leaksTotal) {
        return;
      }
      setLeaksPage((prev) => prev + 1);
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [leaks, leaksTotal, leaksLoading]);

  const aiProviders = ALL_PROVIDERS.filter((p) => p.group === "ai");
  const serviceProviders = ALL_PROVIDERS.filter((p) => p.group === "service");

  /** 현재 로드된 leak 데이터를 마크다운 형식으로 다운로드 */
  const exportArchive = useCallback(() => {
    if (leaks.length === 0) return;

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toISOString().slice(11, 19).replace(/:/g, "-");

    // 필터 정보
    const filterProvider = provider ? (PROVIDER_LABELS[provider] ?? provider) : "전체";
    const filterTimeLabel: Record<string, string> = {
      all: "전체 기간",
      "24h": "최근 24시간",
      "7d": "최근 7일",
      "30d": "최근 30일",
    };
    const filterTime = filterTimeLabel[timeRange] ?? timeRange;
    const filterSort = sort === "newest" ? "최신순" : "오래된 순";

    // provider별 통계
    const providerCounts: Record<string, number> = {};
    for (const leak of leaks) {
      const label = PROVIDER_LABELS[leak.provider] ?? leak.provider;
      providerCounts[label] = (providerCounts[label] ?? 0) + 1;
    }
    const providerStatsLines = Object.entries(providerCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => `| ${label} | ${count} |`);

    const lines: string[] = [
      `# Leak Radar Leak Archive`,
      ``,
      `> 내보내기 일시: ${now.toLocaleString("ko-KR")}`,
      ``,
      `## 요약`,
      ``,
      `| 항목 | 값 |`,
      `|------|-----|`,
      `| 내보낸 건수 | ${leaks.length} |`,
      `| 총 탐지 건수 | ${leaksTotal} |`,
      `| 필터 (공급자) | ${filterProvider} |`,
      `| 필터 (기간) | ${filterTime} |`,
      `| 정렬 | ${filterSort} |`,
      ``,
      `## 공급자별 통계`,
      ``,
      `| 공급자 | 건수 |`,
      `|--------|------|`,
      ...providerStatsLines,
      ``,
      `## 탐지 목록`,
      ``,
    ];

    for (let i = 0; i < leaks.length; i++) {
      const leak = leaks[i];
      const providerLabel = PROVIDER_LABELS[leak.provider] ?? leak.provider;
      const repoUrl = buildRepoUrl(leak.repoOwner, leak.repoName);
      const fileUrl = buildFileUrl(leak.repoOwner, leak.repoName, leak.commitSha, leak.filePath);
      const detectedDate = new Date(leak.detectedAt).toLocaleString("ko-KR");

      lines.push(`### ${i + 1}. ${providerLabel} — \`${leak.redactedKey}\``);
      lines.push(``);
      lines.push(`| 항목 | 값 |`);
      lines.push(`|------|-----|`);
      lines.push(`| 공급자 | ${providerLabel} |`);
      lines.push(`| 마스킹 키 | \`${leak.redactedKey}\` |`);
      lines.push(`| 저장소 | [${leak.repoOwner}/${leak.repoName}](${repoUrl}) |`);
      if (leak.actorLogin) {
        lines.push(`| 커미터 | ${leak.actorLogin} |`);
      }
      lines.push(`| 파일 경로 | [\`${leak.filePath}\`](${fileUrl}) |`);
      lines.push(`| 커밋 SHA | \`${leak.commitSha.slice(0, 12)}\` |`);
      lines.push(`| 소스 링크 | [보기](${leak.sourceUrl}) |`);
      lines.push(`| 감지 일시 | ${detectedDate} |`);
      lines.push(``);
      lines.push(`---`);
      lines.push(``);
    }

    lines.push(`*이 파일은 Leak Radar에서 자동 생성되었습니다.*`);

    const markdown = lines.join("\n");
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `apiradar-archive-${dateStr}_${timeStr}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [leaks, leaksTotal, provider, timeRange, sort]);

  /** 피드 초기화 – DB의 모든 leaks 삭제 */
  const [resetting, setResetting] = useState(false);

  const resetFeed = useCallback(async () => {
    if (!window.confirm("정말 피드를 초기화하시겠습니까? 저장된 모든 유출 데이터가 삭제됩니다.")) {
      return;
    }
    setResetting(true);
    try {
      const response = await apiFetch("/leaks", { method: "DELETE" });
      if (response.ok) {
        setLeaks([]);
        setLeaksTotal(0);
        setLeaksPage(1);
      }
    } finally {
      setResetting(false);
    }
  }, []);

  /** 중복 leak 정리 – DB에서 같은 키/파일의 중복 제거 */
  const [deduping, setDeduping] = useState(false);

  const removeDuplicates = useCallback(async () => {
    setDeduping(true);
    try {
      const response = await apiFetch("/leaks/duplicates", { method: "DELETE" });
      if (response.ok) {
        const data = (await response.json()) as { deleted: number };
        if (data.deleted > 0) {
          refreshLeaks();
        }
      }
    } finally {
      setDeduping(false);
    }
  }, [refreshLeaks]);

  const workerStatusStale = isStaleStatus(workerStatus.rateLimit.updatedAt, workerStaleMinutes * 60000);

  const formatAuditStatus = (status: AdminAuditEntry["status"]): string => {
    if (status === "allowed") {
      return "허용";
    }
    if (status === "denied") {
      return "거부";
    }
    return "실패";
  };

  const formatAuditRole = (role: string): string => role.toUpperCase();

  const exportAuditCsv = useCallback(() => {
    const escapeCell = (value: string): string => `"${value.replaceAll("\"", "\"\"")}"`;
    const rows = [
      ["occurred_at", "status", "role", "actor_id", "action", "resource", "ip", "user_agent"]
    ];

    for (const item of displayedAuditLogs) {
      rows.push([
        item.occurredAt,
        item.status,
        item.role,
        item.actorId ?? "",
        item.action,
        item.resource,
        item.ip ?? "",
        item.userAgent ?? ""
      ]);
    }

    const csv = rows
      .map((row) => row.map((cell) => escapeCell(cell)).join(","))
      .join("\n");

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 19).replaceAll(":", "-");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `apiradar-admin-audit-${dateStr}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [displayedAuditLogs]);

  const toggleAuditSort = (key: AuditSortKey): void => {
    if (auditSortKey === key) {
      setAuditSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setAuditSortKey(key);
    setAuditSortDir(key === "occurredAt" ? "desc" : "asc");
  };

  const renderAuditSortLabel = (key: AuditSortKey, label: string): string => {
    if (auditSortKey !== key) {
      return `${label} ·`;
    }
    return `${label} ${auditSortDir === "asc" ? "▲" : "▼"}`;
  };

  const copyAuditMetadata = useCallback(async () => {
    if (!selectedAudit) {
      return;
    }
    const text = JSON.stringify(selectedAudit.metadata, null, 2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore clipboard errors
    }
  }, [selectedAudit]);

  const copyCurrentAuditLink = useCallback(async () => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      // ignore clipboard errors
    }
  }, []);

  const applyAuditPreset = (preset: AuditPreset): void => {
    setAuditStatusFilter(preset.status);
    setAuditRoleFilter(preset.role);
    setAuditSinceHours(preset.sinceHours);
    setAuditSortKey(preset.sortKey);
    setAuditSortDir(preset.sortDir);
    setAuditActorFilter(preset.actorFilter ?? "");
    setAuditSearchQuery(preset.searchQuery ?? "");
  };

  const saveCurrentAuditPreset = (): void => {
    const label = newPresetLabel.trim();
    if (label.length < 2) {
      return;
    }

    const preset: AuditPreset = {
      id: `custom-${Date.now().toString(36)}`,
      label,
      status: auditStatusFilter,
      role: auditRoleFilter,
      sinceHours: auditSinceHours,
      sortKey: auditSortKey,
      sortDir: auditSortDir,
      actorFilter: auditActorFilter.trim(),
      searchQuery: auditSearchQuery.trim(),
      custom: true
    };

    setCustomAuditPresets((prev) => [preset, ...prev].slice(0, 12));
    setNewPresetLabel("");
  };

  const removeCustomAuditPreset = (id: string): void => {
    setCustomAuditPresets((prev) => prev.filter((item) => item.id !== id));
  };

  const saveCurrentSharedAuditPreset = async (): Promise<void> => {
    const name = newSharedPresetLabel.trim();
    if (name.length < 2) {
      return;
    }

    setSharedPresetBusy(true);
    setSharedPresetError("");
    try {
      const response = await apiFetch("/internal/audit-views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category: newSharedPresetCategory.trim() || "general",
          description: newSharedPresetDescription.trim() || undefined,
          isPinned: newSharedPresetPinned,
          status: auditStatusFilter === "all" ? undefined : auditStatusFilter,
          role: auditRoleFilter === "all" ? undefined : auditRoleFilter,
          actorId: auditActorFilter.trim() || undefined,
          sinceHours: Number.parseInt(auditSinceHours, 10),
          sortKey: auditSortKey,
          sortDir: auditSortDir,
          searchQuery: auditSearchQuery.trim() || undefined
        })
      });

      if (!response.ok) {
        setSharedPresetError("공유 프리셋 저장에 실패했습니다.");
        return;
      }

      setNewSharedPresetLabel("");
      setNewSharedPresetDescription("");
      setNewSharedPresetPinned(false);
      await loadSharedAuditViews();
    } catch {
      setSharedPresetError("공유 프리셋 저장에 실패했습니다.");
    } finally {
      setSharedPresetBusy(false);
    }
  };

  const removeSharedAuditPreset = async (id: string): Promise<void> => {
    setSharedPresetBusy(true);
    setSharedPresetError("");
    try {
      const response = await apiFetch(`/internal/audit-views/${id}`, { method: "DELETE" });
      if (!response.ok) {
        setSharedPresetError("공유 프리셋 삭제에 실패했습니다.");
        return;
      }
      await loadSharedAuditViews();
    } catch {
      setSharedPresetError("공유 프리셋 삭제에 실패했습니다.");
    } finally {
      setSharedPresetBusy(false);
    }
  };

  const renameSharedAuditPreset = async (preset: AuditPreset): Promise<void> => {
    if (!preset.sharedId) {
      return;
    }

    const nextName = window.prompt("공유 프리셋 이름", preset.label)?.trim();
    if (!nextName || nextName.length < 2) {
      return;
    }

    setSharedPresetBusy(true);
    setSharedPresetError("");
    try {
      const source = sharedViewById.get(preset.sharedId);
      const response = await apiFetch(`/internal/audit-views/${preset.sharedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nextName,
          category: source?.category ?? preset.category ?? "general",
          description: source?.description ?? preset.description,
          isPinned: source?.isPinned ?? preset.isPinned === true,
          status: preset.status === "all" ? undefined : preset.status,
          role: preset.role === "all" ? undefined : preset.role,
          actorId: preset.actorFilter || undefined,
          sinceHours: Number.parseInt(preset.sinceHours, 10),
          sortKey: preset.sortKey,
          sortDir: preset.sortDir,
          searchQuery: preset.searchQuery || undefined
        })
      });

      if (!response.ok) {
        setSharedPresetError("공유 프리셋 이름 변경에 실패했습니다.");
        return;
      }
      await loadSharedAuditViews();
    } catch {
      setSharedPresetError("공유 프리셋 이름 변경에 실패했습니다.");
    } finally {
      setSharedPresetBusy(false);
    }
  };

  const sharedAuditPresets = sharedAuditViews.map(toSharedViewPreset);
  const sharedManageById = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const item of sharedAuditViews) {
      map.set(item.id, item.canManage === true);
    }
    return map;
  }, [sharedAuditViews]);
  const sharedOwnerById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of sharedAuditViews) {
      map.set(item.id, item.createdBy ?? "(미지정)");
    }
    return map;
  }, [sharedAuditViews]);
  const sharedViewById = useMemo(() => {
    const map = new Map<string, SharedAuditView>();
    for (const item of sharedAuditViews) {
      map.set(item.id, item);
    }
    return map;
  }, [sharedAuditViews]);
  const allAuditPresets = [...sharedAuditPresets, ...AUDIT_PRESETS, ...customAuditPresets];

  const exportCustomAuditPresets = (): void => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      presets: customAuditPresets
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `apiradar-audit-presets-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const importCustomAuditPresets = async (file: File): Promise<void> => {
    const text = await file.text();
    const parsed = JSON.parse(text) as { presets?: unknown };
    if (!parsed || !Array.isArray(parsed.presets)) {
      return;
    }

    const incoming = parsed.presets
      .map((item) => toCustomAuditPreset(item))
      .filter((item): item is AuditPreset => item !== null);
    if (incoming.length === 0) {
      return;
    }

    const existingIds = new Set(customAuditPresets.map((item) => item.id));
    const normalized = incoming.map((preset) => {
      if (!existingIds.has(preset.id)) {
        existingIds.add(preset.id);
        return preset;
      }
      const clonedId = `${preset.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      existingIds.add(clonedId);
      return { ...preset, id: clonedId };
    });

    setCustomAuditPresets((prev) => {
      const merged = [...normalized, ...prev];
      const seen = new Set<string>();
      const deduped: AuditPreset[] = [];
      for (const item of merged) {
        if (seen.has(item.id)) {
          continue;
        }
        seen.add(item.id);
        deduped.push(item);
      }
      return deduped.slice(0, 20);
    });
  };

  const onPresetImportChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    void importCustomAuditPresets(file)
      .catch(() => {
        // ignore malformed preset files
      })
      .finally(() => {
        if (presetImportInputRef.current) {
          presetImportInputRef.current.value = "";
        }
      });
  };

  const renderAuditLogsPanel = () => (
    <section className="panel" style={{ marginTop: "1rem" }}>
      <div className="panel-header">
        <h2>관리자 감사로그</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <select
            className="control-field"
            style={{ padding: "6px 8px", minWidth: "110px", fontSize: "12px" }}
            value={auditStatusFilter}
            onChange={(event) => setAuditStatusFilter(toAuditStatusFilter(event.target.value))}
          >
            <option value="all">전체 상태</option>
            <option value="allowed">허용</option>
            <option value="denied">거부</option>
            <option value="failed">실패</option>
          </select>
          <select
            className="control-field"
            style={{ padding: "6px 8px", minWidth: "110px", fontSize: "12px" }}
            value={auditRoleFilter}
            onChange={(event) => setAuditRoleFilter(toAuditRoleFilter(event.target.value))}
          >
            <option value="all">전체 역할</option>
            <option value="ops">OPS</option>
            <option value="read">READ</option>
            <option value="write">WRITE</option>
            <option value="danger">DANGER</option>
          </select>
          <select
            className="control-field"
            style={{ padding: "6px 8px", minWidth: "104px", fontSize: "12px" }}
            value={auditSinceHours}
            onChange={(event) => setAuditSinceHours(toAuditSinceHours(event.target.value))}
          >
            <option value="0">전체 기간</option>
            <option value="1">1시간</option>
            <option value="6">6시간</option>
            <option value="24">24시간</option>
            <option value="168">7일</option>
          </select>
          <input
            className="control-field"
            style={{ padding: "6px 8px", minWidth: "130px", fontSize: "12px" }}
            value={auditActorFilter}
            onChange={(event) => setAuditActorFilter(event.target.value)}
            placeholder="actor id"
          />
          <button className="action-btn small" onClick={exportAuditCsv}>
            CSV 내보내기
          </button>
          <span className="panel-tag">최근 25건</span>
        </div>
      </div>
      <div className="audit-toolbar">
        <input
          className="control-field"
          style={{ padding: "6px 8px", minWidth: "180px", fontSize: "12px" }}
          value={auditSearchQuery}
          onChange={(event) => setAuditSearchQuery(event.target.value)}
          placeholder="로그 검색"
        />
        <div className="audit-presets">
          {allAuditPresets.map((preset) => (
            <span key={preset.id} className="audit-preset-item">
              <button
                className="quick-btn audit-preset-btn"
                onClick={() => applyAuditPreset(preset)}
                title={preset.shared && preset.sharedId ? `owner: ${sharedOwnerById.get(preset.sharedId) ?? "(미지정)"}` : undefined}
              >
                {preset.shared
                  ? `${preset.isPinned ? "📌" : "☁"} ${preset.category ? `[${preset.category}] ` : ""}${preset.label}`
                  : preset.custom
                    ? `★ ${preset.label}`
                    : preset.label}
              </button>
              {preset.custom && (
                <button
                  className="quick-btn audit-preset-remove"
                  onClick={() => removeCustomAuditPreset(preset.id)}
                  title={`${preset.label} 삭제`}
                >
                  x
                </button>
              )}
              {preset.shared && preset.sharedId && (
                <button
                  className="quick-btn audit-preset-remove"
                  onClick={() => void renameSharedAuditPreset(preset)}
                  title={`${preset.label} 이름 변경`}
                  disabled={sharedPresetBusy || !sharedManageById.get(preset.sharedId)}
                >
                  e
                </button>
              )}
              {preset.shared && preset.sharedId && (
                <button
                  className="quick-btn audit-preset-remove"
                  onClick={() => void removeSharedAuditPreset(preset.sharedId ?? "")}
                  title={`${preset.label} 공유 프리셋 삭제`}
                  disabled={sharedPresetBusy || !sharedManageById.get(preset.sharedId)}
                >
                  x
                </button>
              )}
            </span>
          ))}
          <input
            className="control-field"
            style={{ padding: "6px 8px", minWidth: "120px", fontSize: "12px" }}
            value={newPresetLabel}
            onChange={(event) => setNewPresetLabel(event.target.value)}
            placeholder="프리셋 이름"
          />
          <button
            className="action-btn small"
            onClick={saveCurrentAuditPreset}
            disabled={newPresetLabel.trim().length < 2}
          >
            로컬 저장
          </button>
          <input
            className="control-field"
            style={{ padding: "6px 8px", minWidth: "120px", fontSize: "12px" }}
            value={newSharedPresetLabel}
            onChange={(event) => setNewSharedPresetLabel(event.target.value)}
            placeholder="공유 프리셋 이름"
          />
          <input
            className="control-field"
            style={{ padding: "6px 8px", minWidth: "88px", fontSize: "12px" }}
            value={newSharedPresetCategory}
            onChange={(event) => setNewSharedPresetCategory(event.target.value)}
            placeholder="category"
          />
          <input
            className="control-field"
            style={{ padding: "6px 8px", minWidth: "160px", fontSize: "12px" }}
            value={newSharedPresetDescription}
            onChange={(event) => setNewSharedPresetDescription(event.target.value)}
            placeholder="설명(선택)"
          />
          <label className="status-note" style={{ margin: 0, display: "inline-flex", gap: "4px", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={newSharedPresetPinned}
              onChange={(event) => setNewSharedPresetPinned(event.target.checked)}
            />
            pin
          </label>
          <button
            className="action-btn small"
            onClick={() => void saveCurrentSharedAuditPreset()}
            disabled={newSharedPresetLabel.trim().length < 2 || sharedPresetBusy}
          >
            공유 저장
          </button>
          <button
            className="quick-btn"
            onClick={() => void loadSharedAuditViews()}
            disabled={sharedPresetBusy}
          >
            공유 새로고침
          </button>
          <button
            className="action-btn small"
            onClick={exportCustomAuditPresets}
            disabled={customAuditPresets.length === 0}
          >
            프리셋 내보내기
          </button>
          <button
            className="action-btn small"
            onClick={() => presetImportInputRef.current?.click()}
          >
            프리셋 가져오기
          </button>
          <input
            ref={presetImportInputRef}
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={onPresetImportChange}
          />
          <button className="action-btn small" onClick={() => void copyCurrentAuditLink()}>
            필터 링크 복사
          </button>
        </div>
        <span className="status-note" style={{ margin: 0 }}>
          {displayedAuditLogs.length} / {auditLogs.length}건 표시
        </span>
      </div>
      {sharedPresetError && <div className="status-note">{sharedPresetError}</div>}
      {auditLoadError ? (
        <div className="empty">{auditLoadError}</div>
      ) : auditLoading && displayedAuditLogs.length === 0 ? (
        <div className="empty">감사로그를 불러오는 중입니다...</div>
      ) : displayedAuditLogs.length === 0 ? (
        <div className="empty">감사로그가 없거나 권한이 없습니다.</div>
      ) : (
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th><button className="audit-sort" onClick={() => toggleAuditSort("occurredAt")}>{renderAuditSortLabel("occurredAt", "시각")}</button></th>
                <th><button className="audit-sort" onClick={() => toggleAuditSort("status")}>{renderAuditSortLabel("status", "상태")}</button></th>
                <th><button className="audit-sort" onClick={() => toggleAuditSort("role")}>{renderAuditSortLabel("role", "역할")}</button></th>
                <th><button className="audit-sort" onClick={() => toggleAuditSort("actorId")}>{renderAuditSortLabel("actorId", "액터")}</button></th>
                <th><button className="audit-sort" onClick={() => toggleAuditSort("action")}>{renderAuditSortLabel("action", "액션")}</button></th>
                <th><button className="audit-sort" onClick={() => toggleAuditSort("resource")}>{renderAuditSortLabel("resource", "리소스")}</button></th>
                <th>상세</th>
              </tr>
            </thead>
            <tbody>
              {displayedAuditLogs.map((item) => (
                <tr key={item.id}>
                  <td>{timeAgo(item.occurredAt)}</td>
                  <td>
                    <span className={`audit-status ${item.status}`}>{formatAuditStatus(item.status)}</span>
                  </td>
                  <td>{formatAuditRole(item.role)}</td>
                  <td>{item.actorId ?? "(미지정)"}</td>
                  <td>{item.action}</td>
                  <td>{item.resource}</td>
                  <td>
                    <button className="quick-btn" onClick={() => setSelectedAudit(item)}>
                      보기
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="audit-footer">
        <button
          className="quick-btn"
          onClick={() => void loadAuditLogs(undefined, false)}
          disabled={auditLoading}
        >
          새로고침
        </button>
        <button
          className="action-btn small"
          onClick={loadMoreAuditLogs}
          disabled={!auditNextCursor || auditLoading}
        >
          {auditLoading ? "불러오는 중..." : auditNextCursor ? "더 보기" : "마지막 페이지"}
        </button>
      </div>
      <div ref={auditSentinelRef} className="audit-sentinel" aria-hidden="true" />
    </section>
  );

  const renderWorkerStatusPanel = () => (
    <section className="panel" style={{ marginTop: "1rem" }}>
      <div className="panel-header">
        <h2>워커 상태</h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <select
            className="control-field"
            style={{ padding: "6px 8px", fontSize: "12px", minWidth: "86px" }}
            value={workerStaleMinutes}
            onChange={(event) => setWorkerStaleMinutes(Number(event.target.value))}
          >
            <option value={1}>1m</option>
            <option value={2}>2m</option>
            <option value={5}>5m</option>
          </select>
          <button
            className="quick-btn"
            onClick={() => setCompactWorkerStatus((prev) => !prev)}
          >
            {compactWorkerStatus ? "상세" : "컴팩트"}
          </button>
          <span className={`panel-tag ${workerStatusStale ? "stale" : "live"}`}>
            {workerStatusStale ? "STALE" : "LIVE"}
          </span>
        </div>
      </div>
      <div className="status-note">
        {formatUpdatedAt(workerStatus.rateLimit.updatedAt)}
      </div>
      <div className={`worker-status-grid ${compactWorkerStatus ? "compact" : ""}`} style={{ marginTop: "0.75rem" }}>
        <div className="metric-card small">
          <span className="metric-label">보관 정책</span>
          <span className="metric-value" style={{ fontSize: "16px" }}>
            {workerStatus.retention.enabled
              ? `${workerStatus.retention.retentionDays}일`
              : "비활성"}
          </span>
        </div>
        <div className="metric-card small">
          <span className="metric-label">최근 정리 삭제</span>
          <span className="metric-value" style={{ fontSize: "16px" }}>
            {workerStatus.retention.lastDeleted}건
          </span>
        </div>
        <div className="metric-card small">
          <span className="metric-label">Events 잔여</span>
          <span className="metric-value" style={{ fontSize: "16px" }}>
            {formatQuota(workerStatus.rateLimit.eventsRemaining, workerStatus.rateLimit.eventsLimit)}
          </span>
        </div>
        <div className="metric-card small">
          <span className="metric-label">Commit 잔여</span>
          <span className="metric-value" style={{ fontSize: "16px" }}>
            {formatQuota(workerStatus.rateLimit.commitRemaining, workerStatus.rateLimit.commitLimit)}
          </span>
        </div>
        <div className="metric-card small">
          <span className="metric-label">Code 잔여</span>
          <span className="metric-value" style={{ fontSize: "16px" }}>
            {formatQuota(workerStatus.rateLimit.codeRemaining, workerStatus.rateLimit.codeLimit)}
          </span>
        </div>
        <div className="metric-card small">
          <span className="metric-label">Events 제한</span>
          <span className="metric-value" style={{ fontSize: "16px" }}>
            {formatResetMs(workerStatus.rateLimit.eventsResetAfterMs)}
          </span>
        </div>
        <div className="metric-card small">
          <span className="metric-label">최근 사이클(ms)</span>
          <span className="metric-value" style={{ fontSize: "16px" }}>
            {workerStatus.pipeline.lastCycleDurationMs}
          </span>
        </div>
        <div className="metric-card small">
          <span className="metric-label">최근 자동 삽입</span>
          <span className="metric-value" style={{ fontSize: "16px" }}>
            {workerStatus.pipeline.lastAutoInserted}
          </span>
        </div>
        <div className="metric-card small">
          <span className="metric-label">최근 백필 코드</span>
          <span className="metric-value" style={{ fontSize: "16px" }}>
            {workerStatus.pipeline.lastAutoBackfillCodeItems}
          </span>
        </div>
        <div className="metric-card small">
          <span className="metric-label">최근 백필 커밋</span>
          <span className="metric-value" style={{ fontSize: "16px" }}>
            {workerStatus.pipeline.lastAutoBackfillCommitItems}
          </span>
        </div>
        <div className="metric-card small">
          <span className="metric-label">최근 수동 오류</span>
          <span className="metric-value" style={{ fontSize: "16px" }}>
            {workerStatus.pipeline.lastManualJobsErrored}
          </span>
        </div>
        <div className="metric-card small">
          <span className="metric-label">SLO 전체</span>
          <span className="metric-value" style={{ fontSize: "16px" }}>
            {workerSlo.met.overall ? "준수" : "위반"}
          </span>
        </div>
        <div className="metric-card small">
          <span className="metric-label">SLO 신선도 기준</span>
          <span className="metric-value" style={{ fontSize: "16px" }}>
            {Math.round(workerSlo.thresholds.statusAgeMsMax / 1000)}초
          </span>
        </div>
        {!compactWorkerStatus && (
          <>
            <div className="metric-card small">
              <span className="metric-label">누적 자동 삽입</span>
              <span className="metric-value" style={{ fontSize: "16px" }}>
                {workerStatus.pipeline.totalAutoInserted}
              </span>
            </div>
            <div className="metric-card small">
              <span className="metric-label">누적 자동 오류</span>
              <span className="metric-value" style={{ fontSize: "16px" }}>
                {workerStatus.pipeline.totalAutoErrors}
              </span>
            </div>
            <div className="metric-card small">
              <span className="metric-label">누적 수동 처리</span>
              <span className="metric-value" style={{ fontSize: "16px" }}>
                {workerStatus.pipeline.totalManualJobsProcessed}
              </span>
            </div>
            <div className="metric-card small">
              <span className="metric-label">SLO 자동 오류율</span>
              <span className="metric-value" style={{ fontSize: "16px" }}>
                {Math.round(workerSlo.values.autoErrorRatio * 100)}%
              </span>
            </div>
            <div className="metric-card small">
              <span className="metric-label">SLO 자동 오류 기준</span>
              <span className="metric-value" style={{ fontSize: "16px" }}>
                {Math.round(workerSlo.thresholds.autoErrorRatioMax * 100)}%
              </span>
            </div>
            <div className="metric-card small">
              <span className="metric-label">현재 상태 age(ms)</span>
              <span className="metric-value" style={{ fontSize: "16px" }}>
                {workerSlo.values.statusAgeMs}
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  );

  return (
    <div className="app">
      <div className="scanlines" aria-hidden="true" />
      {scanStatus !== "idle" && (
        <div className="scan-overlay">
          <div className={`scan-overlay-card ${scanStatus}`}>
            {scanStatus === "scanning" && <div className="spinner" />}
            <div className="scan-overlay-title">
              {scanStatus === "scanning" && "공개 저장소를 스캔하는 중입니다"}
              {scanStatus === "done" && "스캔 완료"}
              {scanStatus === "error" && "스캔 실패"}
            </div>
            {scanStatus === "error" && (
              <div className="scan-overlay-text">{scanError}</div>
            )}
            {scanStatus === "scanning" && (
              <div className="scan-overlay-text">
                선택한 {scanProviders.size}개 공급자를 스캔 중입니다.
              </div>
            )}
          </div>
        </div>
      )}
      {selectedAudit && (
        <div className="scan-overlay" onClick={() => setSelectedAudit(null)}>
          <div className="scan-overlay-card audit-detail" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header" style={{ marginBottom: "12px" }}>
              <h2 style={{ margin: 0 }}>감사로그 상세</h2>
              <button className="quick-btn" onClick={() => setSelectedAudit(null)}>닫기</button>
            </div>
            <div className="meta"><span className="label">상태</span>{formatAuditStatus(selectedAudit.status)}</div>
            <div className="meta"><span className="label">역할</span>{formatAuditRole(selectedAudit.role)}</div>
            <div className="meta"><span className="label">액터</span>{selectedAudit.actorId ?? "(미지정)"}</div>
            <div className="meta"><span className="label">액션</span>{selectedAudit.action}</div>
            <div className="meta"><span className="label">리소스</span>{selectedAudit.resource}</div>
            <div className="meta"><span className="label">IP</span>{selectedAudit.ip ?? "-"}</div>
            <div className="meta"><span className="label">UA</span>{selectedAudit.userAgent ?? "-"}</div>
            <div className="scan-overlay-text" style={{ marginTop: "10px", textAlign: "left" }}>metadata</div>
            <pre className="audit-metadata">{JSON.stringify(selectedAudit.metadata, null, 2)}</pre>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
              <button className="action-btn small" onClick={() => void copyAuditMetadata()}>
                metadata 복사
              </button>
            </div>
          </div>
        </div>
      )}
      <header className="topbar">
        <div className="logo">
          <span className="logo-icon">▲</span>
          <div>
            <div className="logo-title">Leak Radar</div>
            <div className="logo-subtitle">Leak Intelligence Console</div>
          </div>
        </div>
        <div className="topbar-meta">
          <input
            className="identity-input"
            value={adminActorId}
            onChange={(event) => setAdminActorId(event.target.value)}
            placeholder="admin actor id"
            aria-label="관리자 actor id"
          />
          <button
            className="theme-toggle"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="테마 전환"
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <div className="status-chip">
            <span className="status-dot" />
            LIVE
          </div>
        </div>
      </header>

      <nav className="nav-bar">
        <button
          className={`nav-btn ${page === "home" ? "active" : ""}`}
          onClick={() => setPage("home")}
        >
          홈
        </button>
        <button
          className={`nav-btn ${page === "explore" ? "active" : ""}`}
          onClick={() => setPage("explore")}
        >
          탐색
        </button>
        <button
          className={`nav-btn ${page === "leaderboard" ? "active" : ""}`}
          onClick={() => setPage("leaderboard")}
        >
          리더보드
        </button>
      </nav>

      {page === "home" && (
        <main className="page">
          <section className="panel hero-panel">
            <div className="panel-header">
              <span className="panel-tag">REAL-TIME MONITOR</span>
              <span className="panel-status">SECURE</span>
            </div>
            <h1 className="hero-title">
              공개 GitHub 저장소에서 API 키가 언제, 어디서, 얼마나 자주
              노출되는지 실시간으로 추적합니다.
            </h1>
            <p className="hero-subtext">
              마스킹된 실제 유출 사례를 탐색하고, 공급자별 패턴을 분석해
              안전한 커밋 습관 교육에 활용하세요.
            </p>
            <div className="hero-grid">
              <div className="metric-card">
                <span className="metric-label">오늘 발견된 유출</span>
                <span className="metric-value">{stats.leaksToday}</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">총 유출 수</span>
                <span className="metric-value">{stats.totalLeaks}</span>
              </div>
              <div className="metric-card">
                <span className="metric-label">스캔 저장소</span>
                <span className="metric-value">{stats.totalReposScanned}</span>
              </div>
            </div>
            {renderWorkerStatusPanel()}
            {renderAuditLogsPanel()}
          </section>
        </main>
      )}

      {page === "explore" && (
        <main className="page">
          {/* 상단 통계 바 */}
          <section className="stats-row compact">
            <div className="metric-card small">
              <span className="metric-label">오늘 발견</span>
              <span className="metric-value">{stats.leaksToday}</span>
            </div>
            <div className="metric-card small">
              <span className="metric-label">총 유출 수</span>
              <span className="metric-value">{stats.totalLeaks}</span>
            </div>
            <div className="metric-card small">
              <span className="metric-label">스캔 저장소</span>
              <span className="metric-value">{stats.totalReposScanned}</span>
            </div>
          </section>

          {/* 필터 + 수동 스캔 토글 */}
          <section className="panel filters-panel">
            <div className="panel-header">
              <h2>탐색 필터</h2>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <span className="panel-tag">
                  {stats.totalLeaks > 0 ? "LIVE SCANNING" : "SCANNING"}
                </span>
                <button
                  className="action-btn small"
                  onClick={() => setShowScanPanel(!showScanPanel)}
                >
                  {showScanPanel ? "닫기" : "수동 스캔"}
                </button>
              </div>
            </div>
            <div className="filters">
              <select
                className="control-field"
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
              >
                <option value="">전체 공급자</option>
                {providerOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <select
                className="control-field"
                value={timeRange}
                onChange={(event) => setTimeRange(event.target.value)}
              >
                <option value="all">전체 기간</option>
                <option value="24h">최근 24시간</option>
                <option value="7d">최근 7일</option>
                <option value="30d">최근 30일</option>
              </select>
              <select
                className="control-field"
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option value="newest">최신순</option>
                <option value="oldest">오래된 순</option>
              </select>
            </div>
          </section>

          {/* 수동 스캔 패널 – 멀티셀렉트 토글 버튼 */}
          {showScanPanel && (
            <section className="panel control-panel">
              <div className="panel-header">
                <div>
                  <h2>수동 스캔</h2>
                  <p style={{ margin: "4px 0 0", color: "var(--text-secondary)", fontSize: "13px" }}>
                    스캔할 공급자를 선택하세요. 자동 스캔은 AI 모델만 대상입니다.
                  </p>
                </div>
              </div>

              {/* 빠른 선택 */}
              <div className="provider-quick-actions">
                <button
                  className="quick-btn"
                  onClick={selectAllAI}
                >
                  AI 모델만
                </button>
                <button
                  className="quick-btn"
                  onClick={selectAll}
                >
                  전체 선택
                </button>
                <button
                  className="quick-btn"
                  onClick={selectNone}
                >
                  선택 해제
                </button>
              </div>

              {/* AI 모델 그룹 */}
              <div className="provider-group">
                <div className="provider-group-label">AI 모델</div>
                <div className="provider-toggles">
                  {aiProviders.map((p) => (
                    <button
                      key={p.id}
                      className={`provider-toggle ${scanProviders.has(p.id) ? "active" : ""}`}
                      onClick={() => toggleScanProvider(p.id)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 기타 서비스 그룹 */}
              <div className="provider-group">
                <div className="provider-group-label">기타 서비스</div>
                <div className="provider-toggles">
                  {serviceProviders.map((p) => (
                    <button
                      key={p.id}
                      className={`provider-toggle ${scanProviders.has(p.id) ? "active" : ""}`}
                      onClick={() => toggleScanProvider(p.id)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 스캔 실행 */}
              <div className="scan-submit">
                <button
                  className="action-btn"
                  onClick={requestScan}
                  disabled={scanProviders.size === 0}
                >
                  {scanProviders.size > 0
                    ? `${scanProviders.size}개 공급자 스캔`
                    : "공급자를 선택하세요"}
                </button>
              </div>
            </section>
          )}

          {/* Leak Feed */}
          <section className="panel leaks-panel">
            <div className="panel-header">
              <h2>Leak Feed</h2>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <span className="panel-tag">
                  {leaksTotal > 0 ? `${leaksTotal}건` : "ACTIVE"}
                </span>
                {leaks.length > 0 && (
                  <button
                    className="action-btn small"
                    onClick={removeDuplicates}
                    disabled={deduping}
                    title="DB에서 중복 leak 제거"
                  >
                    {deduping ? "정리 중..." : "중복 제거"}
                  </button>
                )}
                {leaks.length > 0 && (
                  <button
                    className="action-btn small archive-btn"
                    onClick={exportArchive}
                    title="현재 피드를 마크다운으로 저장"
                  >
                    피드 아카이브
                  </button>
                )}
                <button
                  className="action-btn small reset-btn"
                  onClick={resetFeed}
                  disabled={resetting}
                  title="저장된 모든 유출 데이터 삭제"
                >
                  {resetting ? "초기화 중..." : "피드 초기화"}
                </button>
              </div>
            </div>
            <section className="cards">
              {initialLoading && leaks.length === 0 && (
                <div className="loading">최근 유출 데이터를 불러오는 중...</div>
              )}
              {!initialLoading && leaks.length === 0 && (
                <div className="empty">
                  아직 탐지된 유출이 없습니다. 워커가 자동으로 스캔 중이며, 결과가 쌓이면 여기에 표시됩니다.
                </div>
              )}
              {leaks.map((leak) => (
                <article className="leak-card" key={leak.id}>
                  <div className="key">{leak.redactedKey}</div>
                  <div className="meta">
                    <span className="label">저장소:</span>
                    <a
                      className="link inline"
                      href={buildRepoUrl(leak.repoOwner, leak.repoName)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {leak.repoOwner}/{leak.repoName}
                    </a>
                    {leak.actorLogin && (
                      <span className="byline">by {leak.actorLogin}</span>
                    )}
                  </div>
                  <div className="meta">
                    <span className="label">키 경로:</span>
                    <a
                      className="link inline"
                      href={buildFileUrl(
                        leak.repoOwner,
                        leak.repoName,
                        leak.commitSha,
                        leak.filePath
                      )}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {leak.filePath}
                    </a>
                  </div>
                  <div className="meta">
                    <span className="label">추가:</span>
                    {timeAgo(leak.addedAt)}
                  </div>
                  <div className="meta">
                    <span className="label">감지:</span>
                    {timeAgo(leak.detectedAt)}
                  </div>
                  <a className="link" href={leak.sourceUrl} target="_blank" rel="noreferrer">
                    소스
                  </a>
                  <span className="provider">{PROVIDER_LABELS[leak.provider] ?? leak.provider}</span>
                </article>
              ))}
              <div ref={sentinelRef} className="leaks-sentinel" />
              {leaksLoading && <div className="loading">추가 결과를 불러오는 중...</div>}
            </section>
          </section>
          {renderWorkerStatusPanel()}
        </main>
      )}

      {page === "leaderboard" && (
        <main className="page">
          <section className="stats-row">
            <div className="metric-card">
              <span className="metric-label">오늘 발견</span>
              <span className="metric-value">{stats.leaksToday}</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">총 유출 수</span>
              <span className="metric-value">{stats.totalLeaks}</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">스캔 저장소</span>
              <span className="metric-value">{stats.totalReposScanned}</span>
            </div>
          </section>

          <section className="grid-2">
            <div className="panel leaderboard-panel">
              <div className="panel-header">
                <h2>유출 리더보드</h2>
                <span className="panel-tag">RANKED</span>
              </div>
              <div className="leaderboard-grid">
                {leaderboard.map((entry, index) => (
                  <div className="leaderboard-card" key={entry.actorLogin}>
                    <div className="rank">#{index + 1}</div>
                    <div className="avatar" />
                    <div className="name">{entry.actorLogin}</div>
                    <div className="count">{entry.leakCount}건</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="panel chart-panel">
              <div className="panel-header">
                <h2>주간 유출 추이</h2>
                <span className="panel-tag">TREND</span>
              </div>
              <svg width="100%" height="160" viewBox="0 0 280 140">
                <path d={activityPath} className="chart-line" />
              </svg>
              <div className="chart-labels">
                {activity.map((point) => (
                  <span key={point.date}>{point.date}</span>
                ))}
              </div>
            </div>
          </section>
          {renderWorkerStatusPanel()}
        </main>
      )}
    </div>
  );
};
