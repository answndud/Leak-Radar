# Leak Radar

GitHub 공개 저장소에서 노출된 API 키를 자동으로 탐지하고,
Explore/Leaderboard 형태로 실시간 피드를 제공합니다.

## 핵심 기능
- 자동 폴링 기반 스캔(Events API + 백필)
- AI 모델 provider 중심 기본 스캔
- 수동 스캔(provider 다중 선택)
- leak feed 무한 스크롤 + 아카이브(마크다운)
- 피드 초기화/중복 제거 API

## 빠른 시작

### 1) 인프라 실행
```bash
docker compose -f infra/docker-compose.yml up -d
```

### 2) 스키마 적용
```bash
psql -h localhost -p 5432 -U leak -d leakdb -f infra/schema.sql
```
비밀번호는 `leak` 입니다.

### 3) 의존성 설치
```bash
pnpm install
```

### 4) 환경 변수 설정
`.env`에 GitHub 토큰을 설정하세요.
```bash
GITHUB_TOKEN=여기에_토큰
```

선택: 보관 정책 자동 정리(예: 30일)
```bash
WORKER_RETENTION_DAYS=30
WORKER_RETENTION_INTERVAL_MS=3600000
```

### 5) 전체 실행
```bash
pnpm -w run dev:all
```

## 주요 엔드포인트
- `GET /leaks`
- `GET /providers`
- `GET /stats`
- `GET /leaderboard`
- `GET /activity`
- `GET /internal/worker-status`
- `GET /internal/metrics` (Prometheus 텍스트)
- `POST /scan-requests` (providers 또는 query)
  - providers는 서버에서 지원 목록 검증 후 처리

정리용:
- `DELETE /leaks`
- `DELETE /leaks/duplicates`
- `DELETE /leaks/non-ai`

## 테스트
```bash
pnpm run test
```

## 관측
- 워커 내부 상태(JSON): `GET /internal/worker-status`
- 메트릭(Prometheus): `GET /internal/metrics`
  - retention enabled/days/deleted
  - rate limit remaining/limit/reset
  - pipeline cycle count/duration/inserted/error
  - pipeline 누적 카운터(auto/manual inserted, errors, jobs)
  - 파생 지표(auto/manual error ratio, auto insert ratio, status age)
- 템플릿 파일
  - Grafana: `infra/monitoring/grafana-dashboard.leak-radar-worker.json`
    - 변수: `env`, `team`, `job`
  - Alert rules:
    - `infra/monitoring/alert-rules.leak-radar-worker.local.yml`
    - `infra/monitoring/alert-rules.leak-radar-worker.staging.yml`
    - `infra/monitoring/alert-rules.leak-radar-worker.production.yml`
  - Alertmanager routes: `infra/monitoring/alertmanager.routes.leak-radar.yml`
  - 운영 가이드: `OBSERVABILITY.md` (Runbook 포함)

## 참고 문서
- 실행 가이드: `GUIDE.md`
- 스캔 방식: `SCANNING.md`
- 설계 개요: `DESIGN.md`
- 보관/정리 정책: `RETENTION.md`
- 관측/알림 가이드: `OBSERVABILITY.md`
- 탐지 룰셋/fixture: `DETECTION_RULES.md`
- 탐지 fixture 리포트: `DETECTION_FIXTURES_REPORT.md`

## 주의
- 원문 비밀키는 저장하지 않습니다.
- `.env`는 Git에 커밋하지 마세요.
