import { fetchCommitBackfill, fetchRecentPushEvents } from "./github-client";
import { loadConfig } from "./config";

export type ScanJob = {
  repoFullName: string;
  commitSha: string;
};

export type PollResult = {
  jobs: ScanJob[];
  resetAfterMs: number | null;
  remaining: number | null;
  limit: number | null;
};

const log = (tag: string, message: string): void => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${tag}] ${message}`);
};

/**
 * Events API를 통한 최근 PushEvent 폴링.
 * Events 결과가 없고 backfillEnabled면 Commit Search로 폴백.
 */
export const pollGitHub = async (): Promise<PollResult> => {
  const config = loadConfig();
  const events = await fetchRecentPushEvents(config.githubToken);

  const pushCount = events.data?.length ?? 0;

  if (events.ok && pushCount > 0) {
    log("POLL", `Events API 성공 – ${pushCount}개 PushEvent 커밋 수집`);
    return {
      jobs: events.data!,
      resetAfterMs: events.resetAfterMs,
      remaining: events.remaining,
      limit: events.limit
    };
  }

  if (!events.ok) {
    log("POLL", "Events API 호출 실패");
  } else {
    log("POLL", "Events API 성공, 그러나 PushEvent 커밋 0개 (다른 이벤트 타입만 존재)");
  }

  // Events에서 PushEvent가 없으면 Commit Search로 폴백
  if (config.backfillEnabled) {
    log("POLL", "Events 결과 없음 → Commit Search 폴백 시작");
    const backfill = await fetchCommitBackfill(
      config.backfillQuery,
      config.githubToken
    );
    if (backfill.ok && backfill.data) {
      log("POLL", `Commit Search 폴백 성공 – ${backfill.data.length}개 커밋`);
      return {
        jobs: backfill.data,
        resetAfterMs: backfill.resetAfterMs,
        remaining: backfill.remaining,
        limit: backfill.limit
      };
    }
    log("POLL", "Commit Search 폴백도 결과 없음");
    return {
      jobs: [],
      resetAfterMs: backfill.resetAfterMs,
      remaining: backfill.remaining,
      limit: backfill.limit
    };
  }

  return {
    jobs: [],
    resetAfterMs: events.resetAfterMs,
    remaining: events.remaining,
    limit: events.limit
  };
};

/**
 * 명시적 쿼리로 Commit Search 백필 실행.
 */
export const fetchBackfillJobs = async (query: string): Promise<PollResult> => {
  const config = loadConfig();
  const backfill = await fetchCommitBackfill(query, config.githubToken);
  if (backfill.ok && backfill.data) {
    return {
      jobs: backfill.data,
      resetAfterMs: backfill.resetAfterMs,
      remaining: backfill.remaining,
      limit: backfill.limit
    };
  }
  return {
    jobs: [],
    resetAfterMs: backfill.resetAfterMs,
    remaining: backfill.remaining,
    limit: backfill.limit
  };
};
