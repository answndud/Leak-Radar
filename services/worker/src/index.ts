import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";

// .env 파일은 프로젝트 루트에 위치 – 워커가 어디서 실행되든 루트 .env를 로드
dotenvConfig({ path: resolve(__dirname, "../../../.env") });
// CWD 기준 .env도 시도 (로컬 오버라이드용)
dotenvConfig();

import { loadConfig, ROTATING_QUERIES } from "./config";
import { fetchBackfillJobs, pollGitHub } from "./github";
import {
  fetchCodeSearchBackfill,
  fetchCommitDetails,
  fetchFileContent
} from "./github-client";
import { getPool } from "./db";
import { makeKeyFingerprint, redactSecret, scanLine, AI_PROVIDERS } from "./detection";
import { parseScanQueryInput } from "./scan-query";
import { upsertRuntimeStatus } from "./runtime-status";

/* ────────────────────────────────────────────────────────
 * 유틸
 * ──────────────────────────────────────────────────────── */

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const log = (tag: string, message: string): void => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${tag}] ${message}`);
};

const logWarn = (tag: string, message: string): void => {
  const ts = new Date().toISOString();
  console.warn(`[${ts}] [${tag}] ⚠ ${message}`);
};

const logError = (tag: string, message: string): void => {
  const ts = new Date().toISOString();
  console.error(`[${ts}] [${tag}] ✖ ${message}`);
};

/* ────────────────────────────────────────────────────────
 * 바이너리 / 대용량 파일 판별
 * ──────────────────────────────────────────────────────── */

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg",
  ".pdf", ".zip", ".gz", ".tar", ".rar", ".7z",
  ".lock", ".exe", ".dll", ".so", ".dylib",
  ".woff", ".woff2", ".ttf", ".eot",
  ".mp3", ".mp4", ".avi", ".mov",
  ".class", ".jar", ".pyc", ".pyo",
  ".min.js", ".min.css",
  ".map"
]);

const isLikelyTextFile = (filePath: string): boolean => {
  const lower = filePath.toLowerCase();
  for (const ext of BINARY_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return false;
    }
  }
  return true;
};

/* ────────────────────────────────────────────────────────
 * DB 저장 – leak INSERT + 관련 집계 테이블 갱신
 * ──────────────────────────────────────────────────────── */

/**
 * 메모리 캐시 – 이번 워커 프로세스에서 이미 저장 시도한 key_hash.
 * DB 라운드트립 없이 확실한 중복을 걸러냄.
 * 최대 10,000개까지만 보관 (메모리 보호).
 */
const recentHashes = new Set<string>();
const MAX_HASH_CACHE = 10_000;

const storeLeak = async (params: {
  provider: string;
  secret: string;
  repoFullName: string;
  actorLogin?: string | null;
  filePath: string;
  commitSha: string;
  addedAt?: string | null;
  sourceUrl?: string;
}): Promise<boolean> => {
  const pool = getPool();
  const [repoOwner, repoName] = params.repoFullName.split("/");
  const detectedAt = new Date();
  const addedAt = params.addedAt ? new Date(params.addedAt) : detectedAt;
  const redactedKey = redactSecret(params.secret);

  // 원문 키 기반 salt hash 지문으로 전역 중복 제거
  const keyHash = makeKeyFingerprint(params.provider, params.secret, params.repoFullName);

  // 메모리 캐시 체크 – DB까지 갈 필요 없이 바로 스킵
  if (recentHashes.has(keyHash)) {
    return false;
  }

  const sourceUrl =
    params.sourceUrl ??
    `https://github.com/${params.repoFullName}/commit/${params.commitSha}`;

  try {
    const result = await pool.query(
      `INSERT INTO leaks (
        id, provider, redacted_key, key_hash, repo_owner, repo_name, actor_login,
        file_path, commit_sha, source_url, detected_at, added_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      ) ON CONFLICT (key_hash) DO NOTHING`,
      [
        params.provider,
        redactedKey,
        keyHash,
        repoOwner ?? "unknown",
        repoName ?? "unknown",
        params.actorLogin ?? null,
        params.filePath,
        params.commitSha,
        sourceUrl,
        detectedAt,
        addedAt
      ]
    );

    // 메모리 캐시에 추가 (성공이든 충돌이든)
    if (recentHashes.size >= MAX_HASH_CACHE) {
      // 오래된 것 일부 제거
      const iter = recentHashes.values();
      for (let i = 0; i < 2000; i++) iter.next();
      // Set은 삽입 순서를 보장하므로 처음 2000개 제거
      let count = 0;
      for (const h of recentHashes) {
        if (count >= 2000) break;
        recentHashes.delete(h);
        count++;
      }
    }
    recentHashes.add(keyHash);

    const inserted = (result.rowCount ?? 0) > 0;

    if (inserted) {
      // activity_daily 집계 갱신
      await pool
        .query(
          `INSERT INTO activity_daily (date, leaks_count)
           VALUES (CURRENT_DATE, 1)
           ON CONFLICT (date) DO UPDATE SET leaks_count = activity_daily.leaks_count + 1`
        )
        .catch((err) => logWarn("DB", `activity_daily 업데이트 실패: ${err}`));

      // leaderboard_devs 집계 갱신
      if (params.actorLogin) {
        await pool
          .query(
            `INSERT INTO leaderboard_devs (actor_login, leak_count, last_seen_at)
             VALUES ($1, 1, now())
             ON CONFLICT (actor_login) DO UPDATE
               SET leak_count = leaderboard_devs.leak_count + 1,
                   last_seen_at = now()`,
            [params.actorLogin]
          )
          .catch((err) => logWarn("DB", `leaderboard_devs 업데이트 실패: ${err}`));
      }
    }

    return inserted;
  } catch (err) {
    // unique constraint 위반은 정상 (중복 키) – 무시
    const errMsg = String(err);
    if (errMsg.includes("duplicate key") || errMsg.includes("unique constraint")) {
      recentHashes.add(keyHash);
      return false;
    }
    throw err;
  }
};

/* ────────────────────────────────────────────────────────
 * 커밋 상세 처리 → 파일별 스캔
 * ──────────────────────────────────────────────────────── */

// 커밋당 최대 처리 파일 수 (API 호출 절약)
const MAX_FILES_PER_COMMIT = 15;

const processJob = async (
  repoFullName: string,
  commitSha: string,
  allowedProviders?: Set<string>
): Promise<number> => {
  const config = loadConfig();
  const details = await fetchCommitDetails(repoFullName, commitSha, config.githubToken);
  if (!details) {
    log("SCAN", `커밋 상세 조회 실패: ${repoFullName}@${commitSha.slice(0, 7)}`);
    return 0;
  }

  // 파일 수가 너무 많으면 앞쪽만 처리 (API 호출 절약)
  const files = details.files.slice(0, MAX_FILES_PER_COMMIT);
  if (details.files.length > MAX_FILES_PER_COMMIT) {
    log("SCAN", `${repoFullName}@${commitSha.slice(0, 7)}: 파일 ${details.files.length}개 중 ${MAX_FILES_PER_COMMIT}개만 처리`);
  }

  let found = 0;
  for (const file of files) {
    // 파일 내 중복 방지 – 같은 파일에서 동일 provider+value 조합 1회만 저장
    const fileSeenKeys = new Set<string>();

    // patch가 있으면 추가된 줄만 스캔
    if (file.patch) {
      const lines = file.patch.split("\n");
      for (const line of lines) {
        if (!line.startsWith("+") || line.startsWith("+++")) {
          continue;
        }
        const matches = scanLine(line, allowedProviders);
        for (const match of matches) {
          const dedupKey = `${match.provider}:${match.value}`;
          if (fileSeenKeys.has(dedupKey)) continue;
          fileSeenKeys.add(dedupKey);

          const inserted = await storeLeak({
            provider: match.provider,
            secret: match.value,
            repoFullName,
            actorLogin: details.authorLogin,
            filePath: file.filename,
            commitSha,
            addedAt: details.committedAt
          });
          if (inserted) {
            found += 1;
          }
        }
      }
      continue;
    }

    // patch가 없으면 contents API로 파일 전체 스캔 (텍스트 파일만)
    if (!isLikelyTextFile(file.filename)) {
      continue;
    }

    const content = await fetchFileContent({
      repoFullName,
      filePath: file.filename,
      ref: commitSha,
      githubToken: config.githubToken,
      maxBytes: config.maxFileBytes
    });
    if (!content) {
      continue;
    }

    const lines = content.split("\n");
    for (const line of lines) {
      const matches = scanLine(line, allowedProviders);
      for (const match of matches) {
        const dedupKey = `${match.provider}:${match.value}`;
        if (fileSeenKeys.has(dedupKey)) continue;
        fileSeenKeys.add(dedupKey);

        const inserted = await storeLeak({
          provider: match.provider,
          secret: match.value,
          repoFullName,
          actorLogin: details.authorLogin,
          filePath: file.filename,
          commitSha,
          addedAt: details.committedAt
        });
        if (inserted) {
          found += 1;
        }
      }
    }
  }

  return found;
};

/* ────────────────────────────────────────────────────────
 * Code Search 결과의 파일 단건 처리
 * ──────────────────────────────────────────────────────── */

const processFileJob = async (params: {
  repoFullName: string;
  filePath: string;
  ref: string;
  sourceUrl: string;
  allowedProviders?: Set<string>;
}): Promise<number> => {
  const config = loadConfig();
  if (!isLikelyTextFile(params.filePath)) {
    return 0;
  }

  const content = await fetchFileContent({
    repoFullName: params.repoFullName,
    filePath: params.filePath,
    ref: params.ref,
    githubToken: config.githubToken,
    maxBytes: config.maxFileBytes
  });
  if (!content) {
    return 0;
  }

  const lines = content.split("\n");
  let found = 0;
  const fileSeenKeys = new Set<string>();
  for (const line of lines) {
    const matches = scanLine(line, params.allowedProviders);
    for (const match of matches) {
      const dedupKey = `${match.provider}:${match.value}`;
      if (fileSeenKeys.has(dedupKey)) continue;
      fileSeenKeys.add(dedupKey);

      const inserted = await storeLeak({
        provider: match.provider,
        secret: match.value,
        repoFullName: params.repoFullName,
        filePath: params.filePath,
        commitSha: params.ref,
        sourceUrl: params.sourceUrl
      });
      if (inserted) {
        found += 1;
      }
    }
  }

  return found;
};

/* ────────────────────────────────────────────────────────
 * (하위 호환) scan_jobs 대기열 처리 – 수동 스캔 버튼 지원
 * ──────────────────────────────────────────────────────── */

const enqueueDueSchedules = async (): Promise<void> => {
  const pool = getPool();
  const schedules = await pool.query<{
    id: string;
    interval_minutes: number;
    query: string | null;
  }>(
    "SELECT id, interval_minutes, query FROM scan_schedules WHERE enabled = true AND next_run_at <= now()"
  );

  for (const schedule of schedules.rows) {
    await pool.query(
      "INSERT INTO scan_jobs (id, mode, query, status) VALUES (gen_random_uuid(), 'scheduled', $1, 'pending')",
      [schedule.query]
    );
    await pool.query(
      "UPDATE scan_schedules SET next_run_at = now() + ($1 || ' minutes')::interval, updated_at = now() WHERE id = $2",
      [schedule.interval_minutes, schedule.id]
    );
  }
};

type ScanJobRow = {
  id: string;
  mode: "manual" | "scheduled";
  query: string | null;
};

const fetchPendingJobs = async (): Promise<ScanJobRow[]> => {
  const pool = getPool();
  const result = await pool.query<ScanJobRow>(
    "SELECT id, mode, query FROM scan_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 5"
  );
  return result.rows;
};

const markJob = async (params: {
  id: string;
  status: "processing" | "done" | "error";
  error?: string;
}): Promise<void> => {
  const pool = getPool();
  if (params.status === "processing") {
    await pool.query(
      "UPDATE scan_jobs SET status = 'processing', started_at = now() WHERE id = $1",
      [params.id]
    );
    return;
  }

  await pool.query(
    "UPDATE scan_jobs SET status = $2, finished_at = now(), error = $3 WHERE id = $1",
    [params.id, params.status, params.error ?? null]
  );
};

const runRetentionCleanup = async (retentionDays: number): Promise<void> => {
  if (retentionDays <= 0) {
    return;
  }

  const pool = getPool();
  const deletedResult = await pool.query(
    `DELETE FROM leaks
     WHERE detected_at < now() - ($1 || ' days')::interval`,
    [retentionDays]
  );
  const deleted = deletedResult.rowCount ?? 0;

  await pool.query("TRUNCATE activity_daily");
  await pool.query(
    `INSERT INTO activity_daily (date, leaks_count)
     SELECT detected_at::date AS date, COUNT(*)::int AS leaks_count
     FROM leaks
     GROUP BY detected_at::date`
  );

  await pool.query("TRUNCATE leaderboard_devs");
  await pool.query(
    `INSERT INTO leaderboard_devs (actor_login, leak_count, last_seen_at)
     SELECT actor_login, COUNT(*)::int AS leak_count, MAX(detected_at) AS last_seen_at
     FROM leaks
     WHERE actor_login IS NOT NULL
     GROUP BY actor_login`
  );

  log("RETENTION", `보관 정책 정리 실행 완료 (retention=${retentionDays}일, 삭제=${deleted}건)`);
  await upsertRuntimeStatus("retention", {
    enabled: true,
    retentionDays,
    lastRunAt: new Date().toISOString(),
    lastDeleted: deleted
  }).catch((error) => logWarn("RETENTION", `상태 저장 실패: ${error}`));
};

const upsertRateLimitStatus = async (status: {
  eventsResetAfterMs?: number | null;
  eventsRemaining?: number | null;
  eventsLimit?: number | null;
  commitResetAfterMs?: number | null;
  commitRemaining?: number | null;
  commitLimit?: number | null;
  codeResetAfterMs?: number | null;
  codeRemaining?: number | null;
  codeLimit?: number | null;
}): Promise<void> => {
  rateLimitState = {
    ...rateLimitState,
    ...status
  };

  await upsertRuntimeStatus("rate_limit", {
    ...rateLimitState,
    updatedAt: new Date().toISOString()
  }).catch((error) => logWarn("RATELIMIT", `상태 저장 실패: ${error}`));
};

let rateLimitState: {
  eventsResetAfterMs: number | null;
  eventsRemaining: number | null;
  eventsLimit: number | null;
  commitResetAfterMs: number | null;
  commitRemaining: number | null;
  commitLimit: number | null;
  codeResetAfterMs: number | null;
  codeRemaining: number | null;
  codeLimit: number | null;
} = {
  eventsResetAfterMs: null,
  eventsRemaining: null,
  eventsLimit: null,
  commitResetAfterMs: null,
  commitRemaining: null,
  commitLimit: null,
  codeResetAfterMs: null,
  codeRemaining: null,
  codeLimit: null
};

/* ────────────────────────────────────────────────────────
 * 자동 스캔 – scan_jobs 없이도 항상 실행되는 핵심 루프
 * 매 사이클마다 로테이션 쿼리를 순환하여 다양한 provider 유출 탐지
 * ──────────────────────────────────────────────────────── */

let queryIndex = 0;

const getNextQuery = (): string => {
  const query = ROTATING_QUERIES[queryIndex % ROTATING_QUERIES.length];
  queryIndex += 1;
  return query;
};

type AutoScanStats = {
  inserted: number;
  eventsJobs: number;
  backfillCodeItems: number;
  backfillCommitItems: number;
  errors: number;
};

const runAutoScan = async (): Promise<AutoScanStats> => {
  const config = loadConfig();
  const seen = new Set<string>();
  let totalFound = 0;
  let errors = 0;
  let backfillCodeItems = 0;
  let backfillCommitItems = 0;

  // 자동 스캔은 AI 모델 provider만 탐지
  log("AUTO", `AI 모델만 스캔: [${[...AI_PROVIDERS].join(", ")}]`);

  // 1단계: Events API 폴링
  log("EVENTS", "GitHub Events API 폴링 시작");
  const result = await pollGitHub();
  await upsertRateLimitStatus({
    eventsResetAfterMs: result.resetAfterMs,
    eventsRemaining: result.remaining,
    eventsLimit: result.limit
  });

  if (result.resetAfterMs && result.resetAfterMs > 0) {
    logWarn("RATELIMIT", `Events API 레이트리밋 - ${Math.ceil(result.resetAfterMs / 1000)}초 대기`);
    await sleep(result.resetAfterMs);
    return {
      inserted: 0,
      eventsJobs: result.jobs.length,
      backfillCodeItems,
      backfillCommitItems,
      errors
    };
  }

  const eventsCount = result.jobs.length;
  log("EVENTS", `Events API에서 ${eventsCount}개 커밋 수집`);

  for (const job of result.jobs) {
    const key = `${job.repoFullName}@${job.commitSha}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    try {
      const found = await processJob(job.repoFullName, job.commitSha, AI_PROVIDERS);
      totalFound += found;
    } catch (err) {
      errors += 1;
      logWarn("SCAN", `커밋 처리 오류 ${job.repoFullName}@${job.commitSha.slice(0, 7)}: ${err}`);
    }
  }

  if (totalFound > 0) {
    log("EVENTS", `Events 스캔에서 ${totalFound}건 leak 발견 및 INSERT`);
  }

  // 2단계: Backfill – 로테이션 쿼리로 Code Search 실행
  const shouldBackfill =
    config.backfillAlways ||
    (config.backfillOnEmpty && eventsCount === 0);

  if (shouldBackfill) {
    const backfillQuery = getNextQuery();
    log("BACKFILL", `백필 스캔 시작 (mode=${config.backfillMode}, query="${backfillQuery}")`);

    // Code Search 백필 (레이트리밋이 10/분으로 낮으므로 한 번만 호출)
    if (config.backfillMode === "code" || config.backfillMode === "both") {
      log("BACKFILL", "Code Search API 호출");
      const codeBackfill = await fetchCodeSearchBackfill(backfillQuery, config.githubToken);
      await upsertRateLimitStatus({
        codeResetAfterMs: codeBackfill.resetAfterMs,
        codeRemaining: codeBackfill.remaining,
        codeLimit: codeBackfill.limit
      });
      if (codeBackfill.resetAfterMs && codeBackfill.resetAfterMs > 0) {
        logWarn("RATELIMIT", `Code Search 레이트리밋 - ${Math.ceil(codeBackfill.resetAfterMs / 1000)}초 대기`);
        await sleep(codeBackfill.resetAfterMs);
      } else {
        const codeItems = codeBackfill.data ?? [];
        backfillCodeItems = codeItems.length;
        log("BACKFILL", `Code Search에서 ${codeItems.length}개 파일 수집`);
        let codeFound = 0;
        for (const item of codeItems) {
          const key = `${item.repoFullName}@${item.ref}@${item.filePath}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          try {
            const found = await processFileJob({
              repoFullName: item.repoFullName,
              filePath: item.filePath,
              ref: item.ref,
              sourceUrl: item.htmlUrl,
              allowedProviders: AI_PROVIDERS
            });
            codeFound += found;
          } catch (err) {
            errors += 1;
            logWarn("SCAN", `Code Search 파일 처리 오류: ${err}`);
          }
        }
        totalFound += codeFound;
        if (codeFound > 0) {
          log("BACKFILL", `Code Search 백필에서 ${codeFound}건 leak INSERT`);
        }
      }
    }

    // Commit Search 백필
    if (config.backfillMode === "commits" || config.backfillMode === "both") {
      log("BACKFILL", "Commit Search API 호출");
      const backfill = await fetchBackfillJobs(backfillQuery);
      await upsertRateLimitStatus({
        commitResetAfterMs: backfill.resetAfterMs,
        commitRemaining: backfill.remaining,
        commitLimit: backfill.limit
      });
      if (backfill.resetAfterMs && backfill.resetAfterMs > 0) {
        logWarn("RATELIMIT", `Commit Search 레이트리밋 - ${Math.ceil(backfill.resetAfterMs / 1000)}초 대기`);
        await sleep(backfill.resetAfterMs);
      } else {
        backfillCommitItems = backfill.jobs.length;
        log("BACKFILL", `Commit Search에서 ${backfill.jobs.length}개 커밋 수집`);
        let backfillFound = 0;
        for (const job of backfill.jobs) {
          const key = `${job.repoFullName}@${job.commitSha}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          try {
            const found = await processJob(job.repoFullName, job.commitSha, AI_PROVIDERS);
            backfillFound += found;
          } catch (err) {
            errors += 1;
            logWarn("SCAN", `백필 커밋 처리 오류: ${err}`);
          }
        }
        totalFound += backfillFound;
        if (backfillFound > 0) {
          log("BACKFILL", `Commit Search 백필에서 ${backfillFound}건 leak INSERT`);
        }
      }
    }
  }

  return {
    inserted: totalFound,
    eventsJobs: result.jobs.length,
    backfillCodeItems,
    backfillCommitItems,
    errors
  };
};

/* ────────────────────────────────────────────────────────
 * scan_jobs 대기열에서 job 하나 처리 (수동/예약 스캔 호환)
 * ──────────────────────────────────────────────────────── */

const runJobScan = async (query: string | null): Promise<number> => {
  const config = loadConfig();
  const seen = new Set<string>();
  let found = 0;

  // 수동 스캔에서 선택된 provider 파싱
  const { queries, allowedProviders, selectedProviders } = parseScanQueryInput(query);
  if (selectedProviders && selectedProviders.length > 0) {
    log("JOBS", `providers [${selectedProviders.join(", ")}] → 쿼리 ${queries.length}개 생성`);
  }
  log("JOBS", `수동 스캔 provider 필터: ${allowedProviders ? `[${[...allowedProviders].join(", ")}]` : "전체"}`);

  // Events API 폴링
  const result = await pollGitHub();
  if (result.resetAfterMs && result.resetAfterMs > 0) {
    await sleep(result.resetAfterMs);
    return 0;
  }

  for (const job of result.jobs) {
    const key = `${job.repoFullName}@${job.commitSha}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    found += await processJob(job.repoFullName, job.commitSha, allowedProviders);
  }

  // 수동 스캔 쿼리 처리 – providers 기반 또는 일반 쿼리
  const shouldBackfill =
    queries.length > 0 ||
    config.backfillAlways ||
    (config.backfillOnEmpty && result.jobs.length === 0);

  const backfillQueries = queries.length > 0
    ? queries
    : (shouldBackfill ? [config.defaultBackfillQuery] : []);

  for (const backfillQuery of backfillQueries) {
    log("JOBS", `백필 쿼리 실행: "${backfillQuery}"`);

    if (config.backfillMode === "code" || config.backfillMode === "both") {
      const codeBackfill = await fetchCodeSearchBackfill(backfillQuery, config.githubToken);
      if (codeBackfill.resetAfterMs && codeBackfill.resetAfterMs > 0) {
        await sleep(codeBackfill.resetAfterMs);
        continue;
      }
      if (codeBackfill.data) {
        for (const item of codeBackfill.data) {
          const key = `${item.repoFullName}@${item.ref}@${item.filePath}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          found += await processFileJob({
            repoFullName: item.repoFullName,
            filePath: item.filePath,
            ref: item.ref,
            sourceUrl: item.htmlUrl,
            allowedProviders
          });
        }
      }
    }

    if (config.backfillMode === "commits" || config.backfillMode === "both") {
      const backfill = await fetchBackfillJobs(backfillQuery);
      if (backfill.resetAfterMs && backfill.resetAfterMs > 0) {
        await sleep(backfill.resetAfterMs);
        continue;
      }
      for (const job of backfill.jobs) {
        const key = `${job.repoFullName}@${job.commitSha}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        found += await processJob(job.repoFullName, job.commitSha, allowedProviders);
      }
    }
  }

  return found;
};

/* ────────────────────────────────────────────────────────
 * 메인 루프 – 자동 폴링 + 수동 job 대기열 병행 처리
 * ──────────────────────────────────────────────────────── */

const run = async (): Promise<void> => {
  const config = loadConfig();

  log("WORKER", "=== Leak Radar 워커 시작 ===");
  log("WORKER", `  폴링 주기: ${config.pollIntervalMs / 1000}초`);
  log("WORKER", `  GitHub 토큰: ${config.githubToken ? "설정됨 (" + config.githubToken.slice(0, 8) + "...)" : "미설정"}`);
  log("WORKER", `  백필 모드: ${config.backfillMode}`);
  log("WORKER", `  백필 항상 실행: ${config.backfillAlways}`);
  log("WORKER", `  백필 빈 결과 시 실행: ${config.backfillOnEmpty}`);
  log("WORKER", `  최대 파일 크기: ${config.maxFileBytes}바이트`);
  log("WORKER", `  보관 기간: ${config.retentionDays > 0 ? `${config.retentionDays}일` : "무기한"}`);
  log("WORKER", `  보관 정리 주기: ${Math.round(config.retentionRunIntervalMs / 1000)}초`);

  await upsertRuntimeStatus("retention", {
    enabled: config.retentionDays > 0,
    retentionDays: config.retentionDays,
    lastRunAt: null,
    lastDeleted: 0
  }).catch((error) => logWarn("RETENTION", `초기 상태 저장 실패: ${error}`));

  await upsertRuntimeStatus("pipeline", {
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
  }).catch((error) => logWarn("CYCLE", `초기 파이프라인 상태 저장 실패: ${error}`));

  if (!config.githubToken) {
    logError("WORKER", "GITHUB_TOKEN이 설정되지 않았습니다. 스캔을 시작할 수 없습니다.");
    process.exit(1);
  }

  let cycleCount = 0;
  let lastRetentionRunAt = 0;
  let totalAutoInserted = 0;
  let totalAutoErrors = 0;
  let totalManualInserted = 0;
  let totalManualJobsProcessed = 0;
  let totalManualJobsErrored = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    cycleCount += 1;
    log("CYCLE", `───── 사이클 #${cycleCount} 시작 ─────`);
    const cycleStartedAt = Date.now();
    const cycleStartedIso = new Date(cycleStartedAt).toISOString();
    let manualInserted = 0;
    let manualJobsProcessed = 0;
    let manualJobsErrored = 0;
    let autoStats: AutoScanStats = {
      inserted: 0,
      eventsJobs: 0,
      backfillCodeItems: 0,
      backfillCommitItems: 0,
      errors: 0
    };

    try {
      if (config.retentionDays > 0 && Date.now() - lastRetentionRunAt >= config.retentionRunIntervalMs) {
        await runRetentionCleanup(config.retentionDays);
        lastRetentionRunAt = Date.now();
      }

      // 1) 수동/예약 스캔 job 대기열 처리 (하위 호환)
      await enqueueDueSchedules();
      const jobs = await fetchPendingJobs();
      if (jobs.length > 0) {
        log("JOBS", `대기 중인 scan_jobs ${jobs.length}건 처리`);
        for (const job of jobs) {
          manualJobsProcessed += 1;
          await markJob({ id: job.id, status: "processing" });
          try {
            const found = await runJobScan(job.query);
            manualInserted += found;
            if (found === 0) {
              log("JOBS", `job ${job.id.slice(0, 8)} 완료 – leaks 0건 (no leaks found)`);
              await markJob({
                id: job.id,
                status: "done",
                error: "no leaks found"
              });
              continue;
            }
            log("JOBS", `job ${job.id.slice(0, 8)} 완료 – ${found}건 leak INSERT`);
            await markJob({ id: job.id, status: "done" });
          } catch (error) {
            manualJobsErrored += 1;
            logError("JOBS", `job ${job.id.slice(0, 8)} 오류: ${error}`);
            await markJob({
              id: job.id,
              status: "error",
              error: error instanceof Error ? error.message : "unknown error"
            });
          }
        }
      }

      // 2) 자동 스캔 – scan_jobs 없이도 항상 실행
      log("AUTO", "자동 스캔 시작");
      autoStats = await runAutoScan();
      log("AUTO", `자동 스캔 완료 – 이번 사이클에서 총 ${autoStats.inserted}건 새 leak INSERT`);

      if (autoStats.inserted === 0) {
        log("AUTO", "leak가 0건인 이유: Events에서 PushEvent가 없거나, 수집한 커밋/파일에서 패턴 매칭 없음, 또는 이미 중복(key_hash 충돌)된 키만 발견됨");
      }
    } catch (err) {
      logError("CYCLE", `사이클 오류: ${err}`);
    }

    const cycleFinishedAt = Date.now();
    const cycleDurationMs = cycleFinishedAt - cycleStartedAt;
    totalAutoInserted += autoStats.inserted;
    totalAutoErrors += autoStats.errors;
    totalManualInserted += manualInserted;
    totalManualJobsProcessed += manualJobsProcessed;
    totalManualJobsErrored += manualJobsErrored;

    await upsertRuntimeStatus("pipeline", {
      cycleCount,
      lastCycleStartedAt: cycleStartedIso,
      lastCycleFinishedAt: new Date(cycleFinishedAt).toISOString(),
      lastCycleDurationMs: cycleDurationMs,
      lastAutoInserted: autoStats.inserted,
      lastAutoEventsJobs: autoStats.eventsJobs,
      lastAutoBackfillCodeItems: autoStats.backfillCodeItems,
      lastAutoBackfillCommitItems: autoStats.backfillCommitItems,
      lastAutoErrors: autoStats.errors,
      lastManualInserted: manualInserted,
      lastManualJobsProcessed: manualJobsProcessed,
      lastManualJobsErrored: manualJobsErrored,
      totalAutoInserted,
      totalAutoErrors,
      totalManualInserted,
      totalManualJobsProcessed,
      totalManualJobsErrored
    }).catch((error) => logWarn("CYCLE", `파이프라인 상태 저장 실패: ${error}`));

    log("CYCLE", `───── 사이클 #${cycleCount} 종료 – ${config.pollIntervalMs / 1000}초 후 재시작 ─────\n`);
    await sleep(config.pollIntervalMs);
  }
};

void run();
