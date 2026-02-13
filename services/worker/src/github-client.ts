/**
 * GitHub API 클라이언트
 * - 모든 API 호출에 대해 x-ratelimit-remaining / x-ratelimit-reset 기반 대기
 * - remaining이 낮아지면 선제적으로 sleep
 * - 403 응답 시 reset 시각까지 대기
 */

export type PushEvent = {
  repoFullName: string;
  commitSha: string;
};

export type CommitFile = {
  filename: string;
  patch?: string;
};

export type CommitDetails = {
  files: CommitFile[];
  committedAt: string | null;
  authorLogin: string | null;
};

export type CodeSearchResult = {
  repoFullName: string;
  filePath: string;
  ref: string;
  htmlUrl: string;
};

type ContentResponse = {
  type?: string;
  encoding?: string;
  content?: string;
  size?: number;
};

type GithubResponse<T> = {
  ok: boolean;
  data: T | null;
  resetAfterMs: number | null;
};

const log = (tag: string, message: string): void => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${tag}] ${message}`);
};

const logWarn = (tag: string, message: string): void => {
  const ts = new Date().toISOString();
  console.warn(`[${ts}] [${tag}] ⚠ ${message}`);
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 레이트리밋 헤더 파싱
 * remaining이 0이거나 403 응답이면 reset 시각까지의 ms 반환
 * remaining이 낮지만 0은 아닌 경우 null 반환 (호출자가 선제 sleep 결정)
 */
const parseRateLimit = (response: Response): { resetAfterMs: number | null; remaining: number | null } => {
  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = response.headers.get("x-ratelimit-reset");
  const limit = response.headers.get("x-ratelimit-limit");

  const remainingNum = remaining ? Number.parseInt(remaining, 10) : null;

  if (limit && remaining) {
    log("RATELIMIT", `API ${response.url.split("?")[0]?.split("github.com")[1] ?? response.url} → remaining=${remaining}/${limit}`);
  }

  if (!reset) {
    return { resetAfterMs: null, remaining: remainingNum };
  }

  if (remainingNum === 0 || response.status === 403 || response.status === 429) {
    const resetSeconds = Number.parseInt(reset, 10);
    if (Number.isNaN(resetSeconds)) {
      return { resetAfterMs: null, remaining: remainingNum };
    }
    const delay = resetSeconds * 1000 - Date.now();
    return {
      resetAfterMs: delay > 0 ? delay + 1000 : 1000, // 최소 1초 여유
      remaining: remainingNum
    };
  }

  return { resetAfterMs: null, remaining: remainingNum };
};

/**
 * remaining이 임계치 이하이면 선제적으로 짧게 대기
 */
const preemptiveSleep = async (remaining: number | null): Promise<void> => {
  if (remaining !== null && remaining > 0 && remaining <= 5) {
    const waitMs = Math.min(remaining * 1000, 5000);
    logWarn("RATELIMIT", `remaining=${remaining}, 선제 대기 ${waitMs / 1000}초`);
    await sleep(waitMs);
  }
};

const requestGithub = async <T>(
  url: string,
  githubToken: string,
  accept: string,
  retries = 1
): Promise<GithubResponse<T>> => {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${githubToken}`,
      "User-Agent": "github-api-leaked-worker",
      Accept: accept
    }
  });

  const { resetAfterMs, remaining } = parseRateLimit(response);

  // 레이트리밋에 걸린 경우
  if (response.status === 403 || response.status === 429) {
    if (resetAfterMs && resetAfterMs > 0 && retries > 0) {
      logWarn("RATELIMIT", `${response.status} 응답 - ${Math.ceil(resetAfterMs / 1000)}초 대기 후 재시도`);
      await sleep(resetAfterMs);
      return requestGithub<T>(url, githubToken, accept, retries - 1);
    }
    return { ok: false, data: null, resetAfterMs };
  }

  if (!response.ok) {
    logWarn("GITHUB", `HTTP ${response.status} for ${url.split("?")[0]}`);
    return { ok: false, data: null, resetAfterMs };
  }

  // 선제적 대기 (remaining이 매우 낮을 때)
  await preemptiveSleep(remaining);

  const data = (await response.json()) as T;
  return { ok: true, data, resetAfterMs };
};

/* ────────────────────────────────────────────────────────
 * Events API – 공개 PushEvent 수집
 * ──────────────────────────────────────────────────────── */

export const fetchRecentPushEvents = async (
  githubToken?: string
): Promise<GithubResponse<PushEvent[]>> => {
  if (!githubToken) {
    return { ok: false, data: null, resetAfterMs: null };
  }

  // Events API는 페이지당 30개, 최대 10 페이지.
  // 한 번에 2페이지씩 가져와서 커밋을 더 많이 수집
  const allPushes: PushEvent[] = [];
  let lastResetMs: number | null = null;

  for (const pageNum of [1, 2]) {
    const response = await requestGithub<
      Array<{
        type: string;
        repo: { name: string };
        payload?: { commits?: Array<{ sha: string }> };
      }>
    >(
      `https://api.github.com/events?per_page=100&page=${pageNum}`,
      githubToken,
      "application/vnd.github+json"
    );

    if (!response.ok || !response.data) {
      lastResetMs = response.resetAfterMs;
      break;
    }

    for (const event of response.data) {
      if (event.type !== "PushEvent" || !event.payload?.commits) {
        continue;
      }
      for (const commit of event.payload.commits) {
        allPushes.push({ repoFullName: event.repo.name, commitSha: commit.sha });
      }
    }

    lastResetMs = response.resetAfterMs;

    // 2페이지 사이 잠깐 대기
    if (pageNum < 2) {
      await sleep(500);
    }
  }

  // PushEvent가 없어도 API 호출 자체는 성공 – ok: true 반환
  return { ok: true, data: allPushes, resetAfterMs: lastResetMs };
};

/* ────────────────────────────────────────────────────────
 * Commit Details API
 * ──────────────────────────────────────────────────────── */

export const fetchCommitDetails = async (
  repoFullName: string,
  commitSha: string,
  githubToken?: string
): Promise<CommitDetails | null> => {
  if (!githubToken) {
    return null;
  }

  const response = await requestGithub<{
    files?: Array<{ filename: string; patch?: string }>;
  }>(
    `https://api.github.com/repos/${repoFullName}/commits/${commitSha}`,
    githubToken,
    "application/vnd.github+json"
  );

  if (!response.ok || !response.data) {
    return null;
  }

  const files = (response.data.files ?? []).map((file) => ({
    filename: file.filename,
    patch: file.patch
  }));

  const committedAt =
    (response.data as { commit?: { author?: { date?: string } } }).commit?.author
      ?.date ?? null;
  const authorLogin =
    (response.data as { author?: { login?: string } }).author?.login ?? null;

  return { files, committedAt, authorLogin };
};

/* ────────────────────────────────────────────────────────
 * Commit Search API (백필용)
 * ──────────────────────────────────────────────────────── */

export const fetchCommitBackfill = async (
  query: string,
  githubToken?: string
): Promise<GithubResponse<PushEvent[]>> => {
  if (!githubToken) {
    return { ok: false, data: null, resetAfterMs: null };
  }

  const url = `https://api.github.com/search/commits?q=${encodeURIComponent(
    query
  )}&sort=committer-date&order=desc&per_page=50`;

  const response = await requestGithub<{
    total_count?: number;
    items: Array<{
      sha: string;
      repository: { full_name: string; fork: boolean };
    }>;
  }>(url, githubToken, "application/vnd.github.cloak-preview+json");

  if (!response.ok || !response.data) {
    return { ok: false, data: null, resetAfterMs: response.resetAfterMs };
  }

  log("SEARCH", `Commit Search total_count=${response.data.total_count ?? "N/A"}, items=${response.data.items.length}`);

  const jobs: PushEvent[] = response.data.items
    .filter((item) => !item.repository.fork)
    .map((item) => ({
      repoFullName: item.repository.full_name,
      commitSha: item.sha
    }));

  return { ok: true, data: jobs, resetAfterMs: response.resetAfterMs };
};

/* ────────────────────────────────────────────────────────
 * Code Search API (백필용)
 * ──────────────────────────────────────────────────────── */

export const fetchCodeSearchBackfill = async (
  query: string,
  githubToken?: string
): Promise<GithubResponse<CodeSearchResult[]>> => {
  if (!githubToken) {
    return { ok: false, data: null, resetAfterMs: null };
  }

  const url = `https://api.github.com/search/code?q=${encodeURIComponent(
    query
  )}&sort=indexed&order=desc&per_page=50`;

  const response = await requestGithub<{
    total_count?: number;
    items: Array<{
      path: string;
      html_url: string;
      repository: { full_name: string; default_branch: string; fork: boolean };
    }>;
  }>(url, githubToken, "application/vnd.github+json");

  if (!response.ok || !response.data) {
    return { ok: false, data: null, resetAfterMs: response.resetAfterMs };
  }

  log("SEARCH", `Code Search total_count=${response.data.total_count ?? "N/A"}, items=${response.data.items.length}`);

  const results: CodeSearchResult[] = response.data.items
    .filter((item) => !item.repository.fork)
    .map((item) => ({
      repoFullName: item.repository.full_name,
      filePath: item.path,
      ref: item.repository.default_branch,
      htmlUrl: item.html_url
    }));

  return { ok: true, data: results, resetAfterMs: response.resetAfterMs };
};

/* ────────────────────────────────────────────────────────
 * File Content API – 소형 텍스트 파일 내용 가져오기
 * ──────────────────────────────────────────────────────── */

export const fetchFileContent = async (params: {
  repoFullName: string;
  filePath: string;
  ref: string;
  githubToken?: string;
  maxBytes: number;
}): Promise<string | null> => {
  if (!params.githubToken) {
    return null;
  }

  const encodedPath = params.filePath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

  const response = await requestGithub<ContentResponse>(
    `https://api.github.com/repos/${params.repoFullName}/contents/${encodedPath}?ref=${params.ref}`,
    params.githubToken,
    "application/vnd.github+json"
  );

  if (!response.ok || !response.data) {
    return null;
  }

  if (response.data.type !== "file") {
    return null;
  }

  const size = response.data.size ?? 0;
  if (size > params.maxBytes) {
    return null;
  }

  if (response.data.encoding !== "base64" || !response.data.content) {
    return null;
  }

  return Buffer.from(response.data.content, "base64").toString("utf8");
};
