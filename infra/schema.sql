CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS leaks (
  id UUID PRIMARY KEY,
  provider TEXT NOT NULL,
  redacted_key TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  repo_owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  actor_login TEXT,
  file_path TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  source_url TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL,
  added_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE leaks ADD COLUMN IF NOT EXISTS actor_login TEXT;

CREATE INDEX IF NOT EXISTS leaks_provider_detected_at
  ON leaks (provider, detected_at DESC);

CREATE INDEX IF NOT EXISTS leaks_repo
  ON leaks (repo_owner, repo_name);

CREATE UNIQUE INDEX IF NOT EXISTS leaks_key_hash
  ON leaks (key_hash);

-- 기존 leaks_dedup_per_file 인덱스 제거 (key_hash 하나로 통합)
DROP INDEX IF EXISTS leaks_dedup_per_file;

CREATE TABLE IF NOT EXISTS activity_daily (
  date DATE PRIMARY KEY,
  leaks_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS leaderboard_devs (
  actor_login TEXT PRIMARY KEY,
  leak_count INTEGER NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_schedules (
  id UUID PRIMARY KEY,
  interval_minutes INTEGER NOT NULL,
  query TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scan_jobs (
  id UUID PRIMARY KEY,
  mode TEXT NOT NULL,
  query TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error TEXT
);

CREATE INDEX IF NOT EXISTS scan_jobs_status_created_at
  ON scan_jobs (status, created_at);
