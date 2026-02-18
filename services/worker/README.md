# Worker Service

GitHub 공개 이벤트를 자동 폴링하는 스캔 워커입니다.

## 동작 개요
- 자동 폴링이 기본 동작
- Events API 기반으로 커밋 수집
- 결과가 부족하면 Commit/Code Search로 백필
- 자동 스캔은 AI 모델 provider만 저장
- 수동 스캔은 선택된 provider만 탐지

## 환경 변수
- `GITHUB_TOKEN`: 필수
- `WORKER_POLL_INTERVAL_MS`: 폴링 간격
- `WORKER_BACKFILL_*`: 백필 동작 제어
- `WORKER_MAX_FILE_BYTES`: 파일 본문 스캔 제한
- `KEY_FINGERPRINT_SALT`: key_hash 생성 salt (운영 필수)

## 실행
- 개발 서버: `pnpm -w run dev:worker`
