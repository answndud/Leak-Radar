# 데이터 보관 및 정리 정책

이 문서는 유출 데이터의 보관 원칙과 정리 방법을 설명합니다.

## 기본 원칙
- 원문 비밀키는 저장하지 않습니다.
- 저장되는 값은 `redacted_key`(앞/뒤 일부만 노출)와 메타데이터입니다.
- `key_hash`는 원문 키 + salt 기반 해시로 중복을 전역 차단합니다.

## 보관 정책(현재)
- 기본 보관: 무기한 (자동 만료 없음)
- 선택 옵션: 워커 자동 보관 정리
  - `WORKER_RETENTION_DAYS=30` 처럼 설정 시 30일 초과 데이터 삭제
  - `WORKER_RETENTION_INTERVAL_MS` 주기로 정리 실행(기본 3600000ms)
- 관리자 감사로그(`admin_audit_logs`)는 기본 무기한 보관
  - 운영 권장: 90~365일 보관 후 배치 삭제
  - 배치 명령: `pnpm -w --filter @leak/api run audit:prune`
  - 기준값: `ADMIN_AUDIT_RETENTION_DAYS`
  - 크론 예시: `ADMIN_AUDIT_RETENTION_DAYS=180 ./infra/scripts/run-audit-prune.sh`

## 정리 기능
API 서버에서 아래 엔드포인트를 제공합니다.

- 전체 삭제(피드 초기화)
  - `DELETE /leaks`
- 중복 제거(`key_hash` 기준)
  - `DELETE /leaks/duplicates`
- 비-AI 데이터 정리(자동 스캔 기준 정합성 유지)
  - `DELETE /leaks/non-ai`

## 권장 운영 방식
- 개발 환경: 필요 시 수동으로 초기화
- 운영 환경: 정책 기반 정리(예: 30~90일 보관)
  - 워커 자동 정리 또는 스케줄러를 통해 `DELETE` 엔드포인트 호출

## 자동 정리 시 집계 동기화
- 자동 정리 실행 후 `activity_daily`, `leaderboard_devs` 집계를 `leaks` 기준으로 재생성합니다.
- 보관 기간 변경 시 다음 정리 주기에서 집계가 자동으로 최신화됩니다.

## 향후 과제
- 보관 기간 만료 정책 자동화
- 레코드 단위 삭제/보관 요청 처리
