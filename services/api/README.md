# API Service

Explore/Leaderboard 데이터를 제공하는 API 서버입니다.

## 주요 엔드포인트
- `GET /leaks` (provider, timeRange, sort, page)
- `GET /providers`
- `GET /stats`
- `GET /leaderboard`
- `GET /activity`
- `GET /internal/audit-logs` (ops 권한)
- `POST /scan-requests` (providers 또는 query)
- `GET /scan-jobs`, `GET /scan-jobs/:id`
- `POST /scan-schedules`, `GET /scan-schedules`, `POST /scan-schedules/:id/toggle`

## 정리용 엔드포인트
- `DELETE /leaks` (피드 초기화)
- `DELETE /leaks/duplicates` (중복 제거)
- `DELETE /leaks/non-ai` (비-AI 데이터 정리)

## 관리자 인증
- `ADMIN_API_KEY`를 설정하면 내부/정리/스캔 제어 엔드포인트는
  `x-leak-radar-admin-key` 헤더가 필요합니다.
- 로컬 웹 콘솔에서 호출하려면 `.env`에 `VITE_ADMIN_API_KEY`도 동일하게 설정하세요.
- 선택: `ADMIN_API_KEYS`로 역할 기반 키를 설정할 수 있습니다.
  - 형식: `key:read|write|danger|ops;another:read|ops`
  - `x-leak-radar-admin-id` 헤더를 함께 보내면 감사로그 actor 식별에 사용됩니다.

## 감사로그 운영
- 조회: `GET /internal/audit-logs?limit=25&status=failed&role=ops&actorId=security-ops&sinceHours=24&cursor=...`
  - 응답: `{ data: [...], nextCursor: "..." | null }`
- 공유 프리셋
  - `GET /internal/audit-views`
  - `POST /internal/audit-views`
  - `PATCH /internal/audit-views/:id`
  - `DELETE /internal/audit-views/:id`
  - 수정/삭제 권한: 생성자 우선, `danger` 권한 키는 override 가능
  - 메타데이터: `category`, `description`, `isPinned`
- 정리 배치: `pnpm -w --filter @leak/api run audit:prune`
  - `ADMIN_AUDIT_RETENTION_DAYS` 값(예: 180) 기준으로 만료 로그 삭제

## 실행
- 개발 서버: `pnpm -w run dev:api`
