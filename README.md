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
docker compose -p leak-radar -f infra/docker-compose.yml up -d
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

권장(운영): 관리자 엔드포인트 보호
```bash
ADMIN_API_KEY=강한_랜덤_값
VITE_ADMIN_API_KEY=강한_랜덤_값
VITE_ADMIN_ACTOR_ID=security-ops
API_CORS_ORIGINS=https://your-console.example.com
KEY_FINGERPRINT_SALT=강한_랜덤_값
ADMIN_AUDIT_RETENTION_DAYS=180

# 역할 기반 키(선택): key:read|write|danger|ops;...
ADMIN_API_KEYS=ops-key:ops|read;writer-key:read|write;danger-key:danger
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
- `GET /internal/slo`
  - thresholds/values/met 구조의 SLO 상태 JSON 반환
- `GET /internal/metrics` (Prometheus 텍스트)
- `GET /internal/audit-logs` (관리자 액션 감사로그)
- `POST /scan-requests` (providers 또는 query)
  - providers는 서버에서 지원 목록 검증 후 처리

`ADMIN_API_KEY`가 설정된 경우 아래 엔드포인트는
`x-leak-radar-admin-key` 헤더가 필요합니다.
- `/internal/*`
- `POST /scan-requests`
- `GET /scan-jobs*`, `GET /scan-schedules`
- `POST /scan-schedules*`
- `DELETE /leaks*`

역할 기반 인증(`ADMIN_API_KEYS`)을 사용하면 권한이 분리됩니다.
- `read`: scan job/schedule 조회
- `write`: scan 요청/스케줄 생성, 토글
- `danger`: leak 삭제/초기화/중복정리
- `ops`: 내부 상태/메트릭/감사로그 조회

감사로그 actor 추적을 위해 웹에서 `x-leak-radar-admin-id` 헤더를 전송합니다.
- 설정 우선순위: UI 입력값(localStorage) > `VITE_ADMIN_ACTOR_ID`
- 웹 감사로그 패널은 필터/검색/정렬 상태를 URL 쿼리로 동기화합니다.
- 웹 감사로그 패널은 프리셋 버튼과 필터 링크 복사 기능을 제공합니다.
- 웹 감사로그 패널은 커스텀 프리셋을 로컬에 저장해 재사용할 수 있습니다.
- 웹 감사로그 커스텀 프리셋은 JSON export/import를 지원합니다.

감사로그 운영:
- 필터 조회: `/internal/audit-logs?limit=25&status=failed&role=ops&actorId=security-ops&sinceHours=24&cursor=...`
  - 응답: `{ data, nextCursor }`
- 공유 프리셋 API: `/internal/audit-views*` (ops 권한, 생성/수정/삭제)
  - 수정/삭제는 생성자 우선, `danger` 권한 키는 override 가능
  - 공유 프리셋 메타데이터: `category`, `description`, `isPinned`
- 보관 정리 배치: `pnpm -w --filter @leak/api run audit:prune`
- 크론용 래퍼: `ADMIN_AUDIT_RETENTION_DAYS=180 ./infra/scripts/run-audit-prune.sh`

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
  - SLO 지표(freshness met, auto error met, overall met)
- SLO JSON: `GET /internal/slo`
- 템플릿 파일
  - Grafana: `infra/monitoring/grafana-dashboard.leak-radar-worker.json`
    - 변수: `env`, `team`, `job`
  - Alert rules:
    - `infra/monitoring/alert-rules.leak-radar-worker.local.yml`
    - `infra/monitoring/alert-rules.leak-radar-worker.staging.yml`
    - `infra/monitoring/alert-rules.leak-radar-worker.production.yml`
  - Alertmanager routes: `infra/monitoring/alertmanager.routes.leak-radar.yml`
    - production critical: PagerDuty + Ticket webhook 동시 전송
    - critical 발생 시 warning 억제(inhibit) 규칙 포함
  - Ticket webhook payload
    - schema: `infra/monitoring/ticket-webhook.payload.schema.json`
    - example: `infra/monitoring/ticket-webhook.payload.example.json`
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
