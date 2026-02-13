# API Service

Explore/Leaderboard 데이터를 제공하는 API 서버입니다.

## 주요 엔드포인트
- `GET /leaks` (provider, timeRange, sort, page)
- `GET /providers`
- `GET /stats`
- `GET /leaderboard`
- `GET /activity`
- `POST /scan-requests` (providers 또는 query)
- `GET /scan-jobs`, `GET /scan-jobs/:id`
- `POST /scan-schedules`, `GET /scan-schedules`, `POST /scan-schedules/:id/toggle`

## 정리용 엔드포인트
- `DELETE /leaks` (피드 초기화)
- `DELETE /leaks/duplicates` (중복 제거)
- `DELETE /leaks/non-ai` (비-AI 데이터 정리)

## 실행
- 개발 서버: `pnpm -w run dev:api`
